import { db, type VocabAttempt, type VocabLearningSession } from '../db'
import { assertActiveRound } from './vocabPlans'
import { isNotebookBook, wordKey } from './vocabNotebooks'
import { nextAnswerSession, questionMode } from './vocabLearning'
import { recordObjectiveReview } from './vocabScheduler'

export function studyReward(session: VocabLearningSession) {
  const bonus = session.bookId === 'mistakes' ? 0 : session.focusLock && session.interruptions === 0 ? Math.max(1, Math.ceil(session.words.length / 10)) : 0
  return { bonus, coins: session.bookId === 'mistakes' ? 0 : session.words.length + bonus }
}

async function finish(session: VocabLearningSession) {
  const now = new Date().toISOString()
  const completed = { ...session, phase: 'completed' as const, status: 'completed' as const, completedAt: now, updatedAt: now }
  await db.vocabSessions.put(completed)
  if (completed.planId) {
    const plan = await db.vocabPlans.get(completed.planId)
    if (plan?.ownerId === completed.ownerId) await db.vocabPlans.update(plan.id, { cursor: completed.nextOffset, updatedAt: now,
      ...(isNotebookBook(plan.bookId) ? { studiedWords: [...new Set([...(plan.studiedWords ?? []), ...completed.words.map(word => wordKey(word.word))])] } : {}) })
  }
  const { bonus, coins } = studyReward(completed)
  if (coins) await db.coinRecords.add({ ownerId: completed.ownerId, amount: coins, source: 'vocab_review', date: now.slice(0, 10), description: `完成单词学习：${completed.words.length}词${bonus ? `，专注奖励+${bonus}` : ''}` })
  return completed
}

/** One transaction: evidence, FSRS and progress either all commit or all roll back. */
export async function commitStudyAnswer(snapshot: VocabLearningSession, ownerId: number, value: string, correct: boolean, timedOut: boolean, elapsedMs: number, timeLimitMs: number) {
  return db.transaction('rw', [db.vocabPlans, db.vocabSessions, db.vocabCards, db.reviewLogs, db.vocabAttempts, db.coinRecords], async () => {
    const session = await assertActiveRound(ownerId, snapshot.id)
    if (session.phase !== snapshot.phase || session.currentIndex !== snapshot.currentIndex || (session.answerRevision ?? 0) !== (snapshot.answerRevision ?? 0)) throw new Error('这道题已经提交，请退出后继续本轮')
    if (!['screening', 'retest'].includes(session.phase)) throw new Error('当前不是答题阶段')
    const queue = session.retestQueue ?? session.words.filter(item => item.firstCorrect !== true).map(item => item.word)
    const word = session.phase === 'retest' ? session.words.find(item => item.word === queue[session.currentIndex]) : session.words[session.currentIndex]
    if (!word) throw new Error('未找到当前题目')
    const mode = questionMode(session, word)
    const id = JSON.stringify([session.id, session.phase, session.retestRound ?? 1, session.currentIndex])
    if (await db.vocabAttempts.get(id)) throw new Error('这道题已经提交，请退出后继续本轮')
    const cardId = await recordObjectiveReview({ ownerId, item: word, bookId: session.bookId, mode, correct, timedOut, elapsedMs, timeLimitMs, answer: value })
    const attempt: VocabAttempt = { id, ownerId, sessionId: session.id, bookId: session.bookId, word: word.word, phase: session.phase as 'screening' | 'retest', mode, correct, timedOut, elapsedMs, answer: value,
      createdAt: new Date().toISOString(), translation: word.translation, phonetic: word.phonetic, pos: word.pos, bookName: session.bookName, retestRound: session.retestRound }
    await db.vocabAttempts.add(attempt)
    const next = nextAnswerSession(session, cardId, correct, timedOut, elapsedMs, value)
    if (next.phase === 'completed') return finish(next)
    await db.vocabSessions.put(next)
    return next
  })
}

export async function finishStudyRound(ownerId: number, id: string) {
  return db.transaction('rw', db.vocabSessions, db.vocabPlans, db.coinRecords, async () => {
    const session = await assertActiveRound(ownerId, id)
    if (session.phase !== 'learning' || session.words.some(word => word.firstCorrect !== true && word.retestCorrect !== true)) throw new Error('还有待复测单词')
    return finish(session)
  })
}
