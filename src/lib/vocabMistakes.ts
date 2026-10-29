import type { VocabAttempt } from '../db'
import { normalizeVocabEntry } from './vocabImport'

export interface WordMistakes {
  word: string; errors: number; choiceErrors: number; spellingErrors: number
  lastError: string; correctRounds: number; mastered: boolean; bookIds: string[]
  latest: VocabAttempt; records: VocabAttempt[]
}

/** Attempts are the source of truth, not FSRS lapses or a separate mutable counter. */
export function summarizeMistakes(attempts: VocabAttempt[]): Map<string, WordMistakes> {
  const grouped = new Map<string, VocabAttempt[]>()
  const ids = new Set<string>()
  for (const item of attempts) {
    if (ids.has(item.id)) continue
    ids.add(item.id)
    const key = normalizeVocabEntry(item.word)
    if (!key) continue
    const records = grouped.get(key) ?? []; records.push(item); grouped.set(key, records)
  }
  const result = new Map<string, WordMistakes>()
  for (const [word, raw] of grouped) {
    const records = raw.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    const errors = records.filter(item => !item.correct)
    if (!errors.length) continue
    let lastErrorIndex = records.length - 1
    while (records[lastErrorIndex].correct) lastErrorIndex--
    const lastFailure = records[lastErrorIndex]
    const passed = new Set(records.slice(lastErrorIndex + 1)
      .filter(item => item.phase === 'screening' && item.correct && item.sessionId !== lastFailure.sessionId)
      .map(item => item.sessionId))
    result.set(word, { word, errors: errors.length, choiceErrors: errors.filter(item => item.mode === 'choice').length,
      spellingErrors: errors.filter(item => item.mode === 'spelling').length, lastError: lastFailure.createdAt,
      correctRounds: passed.size, mastered: passed.size >= 2, bookIds: [...new Set(records.map(item => item.bookId))],
      latest: records[records.length - 1], records: [...records].reverse() })
  }
  return result
}
