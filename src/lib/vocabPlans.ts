import { db, type VocabAttempt, type VocabPlan, type VocabTestMode } from '../db'
import { getToday } from './date'
import { isNotebookBook, notebookIdFromBook } from './vocabNotebooks'
import { normalizeVocabEntry } from './vocabImport'

export function localStudyDayRange(day = getToday()) {
  const start = new Date(`${day}T00:00:00`)
  const end = new Date(start); end.setDate(end.getDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

export interface BookAttemptStats { tested: number; correct: number; spelling: number; spellingCorrect: number; retest: number; retestCorrect: number }
export const emptyBookStats = (): BookAttemptStats => ({ tested: 0, correct: 0, spelling: 0, spellingCorrect: 0, retest: 0, retestCorrect: 0 })

export function summarizeBookAttempts(attempts: VocabAttempt[]) {
  const stats = new Map<string, BookAttemptStats>()
  const firstWords = new Map<string, Set<string>>()
  const firstRetests = new Set<string>()
  // A caller may supply unsorted restored records. First means earliest local-day screening.
  for (const attempt of [...attempts].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    if (attempt.bookId === 'review' || attempt.bookId.startsWith('review:')) continue
    let book = stats.get(attempt.bookId)
    if (!book) { book = emptyBookStats(); stats.set(attempt.bookId, book) }
    if (attempt.phase === 'retest') {
      const key = JSON.stringify([attempt.bookId, attempt.sessionId, normalizeVocabEntry(attempt.word)])
      if (!firstRetests.has(key)) { firstRetests.add(key); book.retest++; if (attempt.correct) book.retestCorrect++ }
    }
    if (attempt.phase !== 'screening') continue
    let words = firstWords.get(attempt.bookId)
    if (!words) { words = new Set(); firstWords.set(attempt.bookId, words) }
    const key = normalizeVocabEntry(attempt.word)
    if (!key || words.has(key)) continue
    words.add(key); book.tested++
    if (attempt.correct) book.correct++
    if (attempt.mode === 'spelling') { book.spelling++; if (attempt.correct) book.spellingCorrect++ }
  }
  return stats
}

export interface VocabPlanInput {
  bookId: string; bookName: string; wordCount: number; batchSize: number
  dailyTarget: number; testMode: VocabTestMode; focusLock: boolean
  planId?: string; restartRound?: boolean
}

export const planStatus = (plan: VocabPlan) => plan.status ?? 'active'

export async function ownedPlan(ownerId: number, planId: string) {
  const plan = await db.vocabPlans.get(planId)
  if (!plan || plan.ownerId !== ownerId) throw new Error('学习计划不存在，请返回列表刷新')
  return plan
}

export async function requireStudyPlan(ownerId: number, planId: string) {
  const plan = await ownedPlan(ownerId, planId)
  if (planStatus(plan) === 'deleted') throw new Error('这个计划已删除，请先从已删除计划中恢复')
  if (planStatus(plan) === 'paused') throw new Error('这个计划已暂停，请先恢复计划')
  return plan
}

export async function assertActiveRound(ownerId: number, sessionId: string) {
  const session = await db.vocabSessions.get(sessionId)
  if (!session || session.ownerId !== ownerId || session.status !== 'active') throw new Error('这个轮次已结束，请返回计划列表')
  if (session.planId) await requireStudyPlan(ownerId, session.planId)
  return session
}

async function endPlanRounds(ownerId: number, planId: string) {
  await db.vocabSessions.where('[ownerId+status]').equals([ownerId, 'active']).filter(session => session.planId === planId)
    .modify({ status: 'abandoned', focusLock: false, updatedAt: new Date().toISOString() })
}

async function upsertPlan(ownerId: number, input: VocabPlanInput) {
  if (!input.bookId || !input.bookName.trim()) throw new Error('请先选择单词本或词书')
  if (!Number.isInteger(input.batchSize) || input.batchSize < 5 || input.batchSize > 100) throw new Error('每轮数量应为5～100个词')
  if (!Number.isInteger(input.dailyTarget) || input.dailyTarget < input.batchSize || input.dailyTarget > 300) throw new Error('每日目标应不少于每轮数量，且不超过300个词')
  if (!['choice', 'spelling', 'mixed'].includes(input.testMode)) throw new Error('请选择有效的检测方式')
    let { wordCount, bookName } = input
    if (isNotebookBook(input.bookId)) {
      const notebookId = notebookIdFromBook(input.bookId)
      const notebook = await db.vocabNotebooks.get(notebookId)
      if (!notebook || notebook.ownerId !== ownerId) throw new Error('单词本不存在，请重新选择')
      bookName = notebook.name
      wordCount = await db.vocabCards.where('ownerId').equals(ownerId).filter(card => Boolean(card.notebookIds?.includes(notebookId)) && Boolean(card.translation.trim())).count()
    }
    if (!Number.isInteger(wordCount) || wordCount < 1) throw new Error('请先往这个单词本添加有效单词')
    const old = input.planId ? await ownedPlan(ownerId, input.planId) : await db.vocabPlans.where('[ownerId+bookId]').equals([ownerId, input.bookId]).filter(plan => planStatus(plan) !== 'deleted').first()
    if (old && old.bookId !== input.bookId) throw new Error('调整计划不能更换单词本，请使用“更换单词本”')
    if (old && planStatus(old) === 'deleted') throw new Error('这个计划已删除，不能调整；请新建计划或在已删除计划中恢复')
    let id = old?.id ?? `${ownerId}:${input.bookId}`
    const collision = await db.vocabPlans.get(id)
    if (collision && collision.ownerId !== ownerId) throw new Error('计划标识冲突，未修改任何数据')
    // Historical deleted plans retain their identity and progress; a new plan starts independently.
    if (!old && collision) id = `${ownerId}:${input.bookId}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`
    const now = new Date().toISOString()
    const plan: VocabPlan = {
      id, ownerId, bookId: input.bookId, bookName, wordCount,
      batchSize: input.batchSize, dailyTarget: input.dailyTarget,
      testMode: input.testMode, focusLock: input.focusLock,
      cursor: old?.cursor ?? 0, studiedWords: old?.studiedWords,
      shuffleSeed: old?.shuffleSeed || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`),
      active: 1, createdAt: old?.createdAt ?? now, updatedAt: now,
      status: old?.status ?? 'active',
    }
    // One book, one non-deleted plan. Never overwrite historical deleted plans.
    await db.vocabPlans.put(plan)
    if (input.restartRound) await endPlanRounds(ownerId, id)
    return plan
}

export async function saveVocabPlan(ownerId: number, input: VocabPlanInput) {
  return db.transaction('rw', db.vocabPlans, db.vocabNotebooks, db.vocabCards, db.vocabSessions, () => upsertPlan(ownerId, input))
}

export async function pauseVocabPlan(ownerId: number, planId: string, paused: boolean) {
  return db.transaction('rw', db.vocabPlans, async () => {
    const plan = await ownedPlan(ownerId, planId)
    if (planStatus(plan) === 'deleted') throw new Error('计划已删除，请先恢复')
    await db.vocabPlans.update(planId, { status: paused ? 'paused' : 'active', updatedAt: new Date().toISOString() })
  })
}

async function markDeleted(ownerId: number, plan: VocabPlan) {
  if (planStatus(plan) === 'deleted') return
  const now = new Date().toISOString()
  await db.vocabPlans.update(plan.id, { status: 'deleted', statusBeforeDelete: planStatus(plan) === 'paused' ? 'paused' : 'active', deletedAt: now, updatedAt: now })
  await endPlanRounds(ownerId, plan.id)
}

export async function deleteVocabPlan(ownerId: number, planId: string) {
  return db.transaction('rw', db.vocabPlans, db.vocabSessions, async () => markDeleted(ownerId, await ownedPlan(ownerId, planId)))
}

export async function restoreVocabPlan(ownerId: number, planId: string) {
  return db.transaction('rw', db.vocabPlans, async () => {
    const plan = await ownedPlan(ownerId, planId)
    if (planStatus(plan) !== 'deleted') return
    const current = await db.vocabPlans.where('[ownerId+bookId]').equals([ownerId, plan.bookId]).filter(item => item.id !== planId && planStatus(item) !== 'deleted').first()
    if (current) throw new Error('这本词书已有新计划，请先删除当前计划，再恢复旧计划；不会覆盖新计划或合并进度')
    await db.vocabPlans.update(planId, { status: plan.statusBeforeDelete ?? 'active', deletedAt: undefined, statusBeforeDelete: undefined, updatedAt: new Date().toISOString() })
  })
}

export async function replaceVocabPlan(ownerId: number, sourceId: string, input: VocabPlanInput, disposition: 'pause' | 'delete') {
  return db.transaction('rw', db.vocabPlans, db.vocabNotebooks, db.vocabCards, db.vocabSessions, async () => {
    const source = await ownedPlan(ownerId, sourceId)
    if (planStatus(source) === 'deleted') throw new Error('原计划已删除，请返回列表刷新')
    if (source.bookId === input.bookId) throw new Error('请选择另一个单词本；原本的设置请通过“调整计划”修改')
    if (!['pause', 'delete'].includes(disposition)) throw new Error('请选择如何处理原计划')
    const target = await upsertPlan(ownerId, { ...input, planId: undefined, restartRound: false })
    // A replacement is explicit: reuse the target's identity/progress and resume it.
    await db.vocabPlans.update(target.id, { status: 'active' })
    if (disposition === 'delete') await markDeleted(ownerId, source)
    else await db.vocabPlans.update(source.id, { status: 'paused', updatedAt: new Date().toISOString() })
    return { ...target, status: 'active' as const }
  })
}
