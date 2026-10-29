import type { VocabLearningSession, VocabSessionWord, VocabTestMode } from '../db'
import { shuffled } from './vocabNotebooks'

/** Persist the assignment once. Small randomized pairs prevent two separate blocks. */
export function assignQuestionModes(words: VocabSessionWord[], testMode: VocabTestMode): VocabSessionWord[] {
  const eligible = words.filter(word => word.choices.length >= 2)
  const choiceCount = testMode === 'mixed' ? Math.min(Math.floor(words.length / 2), eligible.length) : eligible.length
  const chosen = new Set(shuffled(eligible).slice(0, choiceCount))
  const assigned = words.map(word => ({ ...word, firstMode: testMode === 'spelling' || !chosen.has(word) ? 'spelling' as const : 'choice' as const }))
  if (testMode !== 'mixed') return assigned
  const choice = shuffled(assigned.filter(word => word.firstMode === 'choice'))
  const spelling = shuffled(assigned.filter(word => word.firstMode === 'spelling'))
  const result: VocabSessionWord[] = []
  while (choice.length && spelling.length) result.push(...shuffled([choice.pop()!, spelling.pop()!]))
  return [...result, ...choice, ...spelling]
}

export function questionMode(session: VocabLearningSession, word: VocabSessionWord): 'choice' | 'spelling' {
  if (session.phase === 'retest') return 'spelling'
  return word.firstMode ?? (session.testMode === 'spelling' || word.choices.length < 2 ? 'spelling' : 'choice')
}

export function retestWords(session: VocabLearningSession) {
  return session.words.filter(word => word.firstCorrect !== true && (session.retestRound !== 2 || word.retestCorrect !== true))
}

export function nextAnswerSession(session: VocabLearningSession, cardId: number, correct: boolean, timedOut: boolean, elapsedMs: number, answer: string): VocabLearningSession {
  const queue = session.retestQueue ?? retestWords(session).map(word => word.word)
  const currentWord = session.phase === 'retest' ? queue[session.currentIndex] : session.words[session.currentIndex].word
  const words = session.words.map(word => word.word !== currentWord ? word : session.phase === 'screening'
    ? { ...word, cardId, firstCorrect: correct, firstTimedOut: timedOut, firstElapsedMs: elapsedMs, firstAnswer: answer }
    : { ...word, cardId, retestCorrect: correct, retestAttempts: (word.retestAttempts ?? 0) + 1 })
  // Legacy snapshots retain their old queue/order; only newly created rounds change rules.
  const nextQueue = !session.rulesVersion && session.phase === 'retest' && !correct ? [...queue, currentWord] : queue
  const last = session.currentIndex + 1 >= (session.phase === 'retest' ? nextQueue.length : words.length)
  const next = { ...session, words, retestQueue: nextQueue, answerRevision: (session.answerRevision ?? 0) + 1, updatedAt: new Date().toISOString() }
  if (!last) return { ...next, currentIndex: session.currentIndex + 1 }
  if (session.phase === 'screening') return { ...next, phase: 'learning', currentIndex: 0 }
  if (session.rulesVersion === 2 && session.retestRound !== 2 && words.some(word => word.firstCorrect !== true && word.retestCorrect !== true)) {
    return { ...next, phase: 'learning', retestRound: 2, currentIndex: 0 }
  }
  return { ...next, phase: 'completed', currentIndex: 0 }
}
