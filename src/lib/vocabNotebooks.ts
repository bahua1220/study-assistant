import { db, type VocabCard, type VocabSessionWord } from '../db'

export const notebookBookId = (id: string) => `notebook:${id}`
export const isNotebookBook = (id: string) => id.startsWith('notebook:')
export const notebookIdFromBook = (id: string) => id.slice('notebook:'.length)
export const wordKey = (word: string) => word.trim().toLowerCase()
export const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

export function shuffled<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function sessionWords(cards: VocabCard[], pool: VocabCard[]): VocabSessionWord[] {
  const meanings = [...new Set(pool.map(item => item.translation.trim()))].filter(Boolean)
  const meaningIndices = new Map(meanings.map((meaning, index) => [meaning, index]))
  return cards.map(card => {
    // Sample three distractors without shuffling the entire dictionary for every question.
    const answer = card.translation.trim()
    const answerIndex = meaningIndices.get(answer) ?? -1
    const available = meanings.length - (answerIndex >= 0 ? 1 : 0)
    const indices = new Set<number>()
    // Partial Fisher-Yates on virtual indices: constant work even for a large word bank.
    const swaps = new Map<number, number>()
    for (let i = 0; i < Math.min(3, available); i++) {
      const remaining = available - i
      const random = Math.floor(Math.random() * remaining)
      const picked = swaps.get(random) ?? random
      swaps.set(random, swaps.get(remaining - 1) ?? remaining - 1)
      indices.add(answerIndex >= 0 && picked >= answerIndex ? picked + 1 : picked)
    }
    const choices = [...indices].map(index => meanings[index])
    return {
      word: card.word, phonetic: card.phonetic ?? '', translation: card.translation.trim(),
      pos: card.partOfSpeech ?? '', tags: card.tags ?? [], exchange: card.exchange ?? '', cardId: card.id,
      // A tiny notebook cannot offer four distinct meanings: use spelling rather than fabricate distractors.
      choices: choices.length === 3 ? shuffled([card.translation.trim(), ...choices]) : [],
    }
  })
}

export async function createNotebook(ownerId: number, name: string) {
  const clean = name.trim()
  if (!clean) throw new Error('请输入单词本名称')
  if (clean.length > 40) throw new Error('名称最多40个字')
  const exists = await db.vocabNotebooks.where('ownerId').equals(ownerId).filter(book => book.name === clean).first()
  if (exists) throw new Error('已经有同名的单词本了')
  const now = new Date().toISOString()
  const book = { id: makeId(), ownerId, name: clean, createdAt: now, updatedAt: now }
  await db.vocabNotebooks.add(book)
  return book
}

/** Remove a mistaken entry and invalidate resumable snapshots that could re-create it. */
export async function deleteVocabWord(ownerId: number, cardId: number, notebookId?: string) {
  await db.transaction('rw', [db.vocabCards, db.reviewLogs, db.vocabAttempts, db.vocabSessions, db.vocabPlans], async () => {
    const card = await db.vocabCards.get(cardId)
    if (!card || card.ownerId !== ownerId) throw new Error('单词不存在，请刷新后重试')
    const key = wordKey(card.word)
    if (notebookId) {
      await db.vocabCards.update(cardId, { notebookIds: card.notebookIds?.filter(id => id !== notebookId) })
    } else {
      await db.vocabCards.delete(cardId)
      await db.reviewLogs.where('ownerId').equals(ownerId).filter(log => log.cardId === cardId).delete()
      await db.vocabAttempts.where('ownerId').equals(ownerId).filter(attempt => wordKey(attempt.word) === key).delete()
    }
    await db.vocabSessions.where('[ownerId+status]').equals([ownerId, 'active'])
      .filter(session => (!notebookId || session.bookId === notebookBookId(notebookId) || session.bookId === `review:${notebookId}`)
        && session.words.some(item => item.cardId === cardId || wordKey(item.word) === key))
      .modify({ status: 'abandoned', updatedAt: new Date().toISOString() })

    const cards = await db.vocabCards.where('ownerId').equals(ownerId).toArray()
    await db.vocabPlans.where('ownerId').equals(ownerId).filter(plan => isNotebookBook(plan.bookId)).modify(plan => {
      const members = cards.filter(item => item.notebookIds?.includes(notebookIdFromBook(plan.bookId)))
      const keys = new Set(members.map(item => wordKey(item.word)))
      plan.studiedWords = (plan.studiedWords ?? []).filter(word => keys.has(word))
      plan.wordCount = members.length
      plan.cursor = plan.studiedWords.length
      plan.updatedAt = new Date().toISOString()
    })
  })
}
