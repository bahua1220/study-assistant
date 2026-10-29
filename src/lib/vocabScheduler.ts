import { fsrs, generatorParameters, type Card, type Grade, type RecordLogItem } from 'ts-fsrs'
import { db, type Rating, type VocabCard, type VocabSessionWord } from '../db'

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }))

function asFsrsCard(card: VocabCard, now: Date): Card {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: 0,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.lastReview ?? now,
  }
}

export async function recordObjectiveReview(args: {
  ownerId: number
  item: VocabSessionWord
  bookId: string
  mode: 'choice' | 'spelling'
  correct: boolean
  timedOut: boolean
  elapsedMs: number
  timeLimitMs: number
  answer: string
}): Promise<number> {
  const { ownerId, item, bookId, mode, correct, timedOut, elapsedMs, timeLimitMs, answer } = args
  const normalized = item.word.trim().toLowerCase()
  let card = item.cardId ? await db.vocabCards.get(item.cardId) : undefined
  if (card && (card.ownerId !== ownerId || card.word.trim().toLowerCase() !== normalized)) card = undefined
  if (!card) card = await db.vocabCards.where('[ownerId+word]').equals([ownerId, normalized]).first()
  // 兼容早期版本中用户手动保存的大小写形式，避免升级后生成重复卡片。
  if (!card) card = await db.vocabCards.where('ownerId').equals(ownerId).filter(value => value.word.trim().toLowerCase() === normalized).first()
  const now = new Date()
  if (!card) {
    const id = await db.vocabCards.add({
      ownerId,
      word: normalized,
      translation: item.translation,
      phonetic: item.phonetic,
      partOfSpeech: item.pos,
      tags: item.tags,
      exchange: item.exchange,
      source: 'dictionary',
      bookIds: [bookId],
      due: now,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      createdAt: now.toISOString(),
    })
    card = (await db.vocabCards.get(id))!
  } else {
    const bookIds = Array.from(new Set([...(card.bookIds ?? []), bookId]))
    await db.vocabCards.update(card.id!, {
      translation: item.translation || card.translation,
      phonetic: item.phonetic || card.phonetic,
      partOfSpeech: item.pos || card.partOfSpeech,
      exchange: item.exchange || card.exchange,
      tags: Array.from(new Set([...(card.tags ?? []), ...item.tags])),
      bookIds,
    })
  }

  const hesitant = correct && elapsedMs >= timeLimitMs * 0.7
  const rating: Rating = correct ? (hesitant ? 2 : 3) : 1
  const result = (scheduler.repeat(asFsrsCard(card, now), now) as unknown as Record<string, RecordLogItem>)[String(rating as Grade)]
  await db.transaction('rw', db.vocabCards, db.reviewLogs, async () => {
    await db.vocabCards.update(card!.id!, {
      due: result.card.due,
      stability: result.card.stability,
      difficulty: result.card.difficulty,
      elapsedDays: result.card.elapsed_days,
      scheduledDays: result.card.scheduled_days,
      reps: result.card.reps,
      lapses: result.card.lapses,
      state: result.card.state as 0 | 1 | 2 | 3,
      lastReview: now,
    })
    await db.reviewLogs.add({ ownerId, cardId: card!.id!, rating, reviewedAt: now, testMode: mode, correct, timedOut, elapsedMs, answer })
  })
  return card.id!
}

export function spellingTimeLimit(word: string): number {
  if (/\s/.test(word.trim())) return 20
  const length = word.replace(/[^a-z]/gi, '').length
  if (length <= 6) return 10
  if (length <= 10) return 13
  return 16
}

export function normalizeSpelling(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
