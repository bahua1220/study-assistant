import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { db, getCurrentOwnerId, type VocabLearningSession, type VocabNotebook } from '../db'
import { getToday } from '../lib/date'
import { isNotebookBook, notebookIdFromBook } from '../lib/vocabNotebooks'
import { emptyBookStats, localStudyDayRange, summarizeBookAttempts, planStatus, pauseVocabPlan, restoreVocabPlan } from '../lib/vocabPlans'
import { VocabPlanManagement } from './VocabPlanManagement'

const MODE_LABELS = { choice: '英译汉', spelling: '拼写', mixed: '混合检测' }
const percentage = (correct: number, total: number) => total ? `${Math.round(correct / total * 100)}%` : '—'

function sessionProgress(session: VocabLearningSession) {
  if (session.phase === 'learning') return session.retestRound === 2 ? '首遍复测已完成 · 待集中补测' : '首轮检测已完成 · 待学习薄弱词'
  if (session.phase === 'retest') return `拼写复测 ${session.currentIndex}/${session.retestQueue?.length ?? 0}`
  return `本轮${MODE_LABELS[session.testMode]} ${session.currentIndex}/${session.words.length}`
}

export function VocabPlansPanel({ notebooks, notebookCounts }: { notebooks?: VocabNotebook[]; notebookCounts?: Record<string, number> }) {
  const ownerId = getCurrentOwnerId()
  const navigate = useNavigate()
  const [today, setToday] = useState(getToday)
  const [filter, setFilter] = useState<'all' | 'learning' | 'done' | 'paused'>('all')
  const [showDeleted, setShowDeleted] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  useEffect(() => {
    const refresh = () => setToday(getToday())
    const timer = window.setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  const result = useLiveQuery(async () => {
    const { start, end } = localStudyDayRange(today)
    return db.transaction('r', db.vocabPlans, db.vocabSessions, db.vocabAttempts, async () => {
      const [plans, sessions, attempts] = await Promise.all([
        // Legacy active=0 only meant "not the currently selected book". Keep these visible too.
        db.vocabPlans.where('ownerId').equals(ownerId).toArray(),
        db.vocabSessions.where('[ownerId+status]').equals([ownerId, 'active']).toArray(),
        db.vocabAttempts.where('[ownerId+createdAt]').between([ownerId, start], [ownerId, end], true, false).toArray(),
      ])
      return { ownerId, day: today, plans, sessions, attempts }
    })
  }, [ownerId, today])
  const current = result?.ownerId === ownerId && result.day === today ? result : undefined
  const allPlans = useMemo(() => [...(current?.plans ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)), [current?.plans])
  const plans = useMemo(() => allPlans.filter(plan => planStatus(plan) !== 'deleted'), [allPlans])
  const deletedPlans = useMemo(() => allPlans.filter(plan => planStatus(plan) === 'deleted'), [allPlans])
  const stats = useMemo(() => summarizeBookAttempts(current?.attempts ?? []), [current?.attempts])
  const sessionsByPlan = useMemo(() => {
    const map = new Map<string, VocabLearningSession>()
    for (const session of [...(current?.sessions ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      if (session.planId && !map.has(session.planId)) map.set(session.planId, session)
    }
    return map
  }, [current?.sessions])
  const planIds = useMemo(() => new Set(allPlans.map(plan => plan.id)), [allPlans])
  const otherSessions = current?.sessions.filter(session => !session.planId || !planIds.has(session.planId)) ?? []
  const category = (plan: typeof plans[number]) => planStatus(plan) === 'paused' ? 'paused' : !sessionsByPlan.has(plan.id) && (stats.get(plan.bookId)?.tested ?? 0) >= plan.dailyTarget ? 'done' : 'learning'
  const displayed = plans.filter(plan => filter === 'all' || category(plan) === filter)
  const manage = async (id: string, restoreDeleted: boolean) => {
    if (locked.current) return
    locked.current = true; setBusy(true); setError('')
    try { if (restoreDeleted) await restoreVocabPlan(ownerId, id); else await pauseVocabPlan(ownerId, id, false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败') }
    finally { locked.current = false; setBusy(false) }
  }

  return <section className="space-y-3" aria-label="我的学习计划">
    <div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">我的学习计划</h2><p className="text-[11px] text-zinc-400 mt-1">多个本子同时安排，进度和今日统计分别记录</p></div><button className="text-xs text-brand-600 flex items-center gap-1 shrink-0" onClick={() => navigate('/vocab/plan?new=1')}><Plus size={14} />添加计划</button></div>
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    {plans.length > 0 && <div role="group" aria-label="计划状态筛选" className="flex gap-1 text-[11px]">{([{ id: 'all', name: '全部' }, { id: 'learning', name: '进行中' }, { id: 'done', name: '今日已完成' }, { id: 'paused', name: '已暂停' }] as const).map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={`rounded-lg px-2 py-1.5 ${filter === item.id ? 'bg-brand-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>{item.name} {item.id === 'all' ? plans.length : plans.filter(plan => category(plan) === item.id).length}</button>)}</div>}
    {!current && <p role="status" className="card text-center text-sm text-zinc-400">正在读取学习计划…</p>}
    {current && !plans.length && <div className="card text-center space-y-3"><BookOpen size={25} className="mx-auto text-brand-500" /><p className="text-sm text-zinc-500">选择自己的单词本或考试词书，为每本安排学习计划。</p><button className="btn-primary w-full" onClick={() => navigate('/vocab/plan?new=1')}>创建计划</button></div>}
    {current && plans.length > 0 && !displayed.length && <p className="text-xs text-zinc-400 py-3">这个分类下暂无计划，可切换“全部”。</p>}
    {displayed.map(plan => {
      const session = sessionsByPlan.get(plan.id)
      const bookStats = stats.get(plan.bookId) ?? emptyBookStats()
      const local = isNotebookBook(plan.bookId)
      const notebook = local ? notebooks?.find(book => book.id === notebookIdFromBook(plan.bookId)) : undefined
      const name = notebook?.name ?? plan.bookName
      const wordCount = local ? notebookCounts?.[notebookIdFromBook(plan.bookId)] ?? plan.wordCount : plan.wordCount
      const missing = local && notebooks !== undefined && !notebook
      const learned = Math.min(wordCount, local && plan.studiedWords ? plan.studiedWords.length : plan.cursor)
      const paused = planStatus(plan) === 'paused'
      return <VocabPlanManagement key={plan.id} plan={plan} name={name}>
        <div className="flex items-start justify-between gap-2 pr-8"><div className="min-w-0"><h3 className="font-semibold break-words">{name}{paused && <span className="text-xs text-amber-600 ml-2">已暂停</span>}</h3><p className="text-[11px] text-zinc-400 mt-1">{MODE_LABELS[plan.testMode]} · 每轮{plan.batchSize}词 · 每日目标{plan.dailyTarget}词</p></div>{plan.focusLock && <span className="text-[10px] text-brand-600 flex items-center gap-1 shrink-0"><ShieldCheck size={12} />专注</span>}</div>
        <div><div className="flex justify-between text-[11px] text-zinc-500 mb-1"><span>累计进度 {learned}/{wordCount}</span><span>{paused ? '暂停期间保留进度' : bookStats.tested >= plan.dailyTarget ? '今日目标已达成' : `今日还差 ${plan.dailyTarget - bookStats.tested} 词`}</span></div><div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-brand-500 rounded-full" style={{ width: `${wordCount ? Math.min(100, learned / wordCount * 100) : 0}%` }} /></div></div>
        <div className="grid grid-cols-3 gap-1 text-center">
          <div><p data-testid="plan-today-count" className="text-sm font-bold">{bookStats.tested}/{plan.dailyTarget}</p><p className="text-[10px] text-zinc-400">今日检测</p></div>
          <div><p data-testid="plan-first-accuracy" className="text-sm font-bold">{percentage(bookStats.correct, bookStats.tested)}</p><p className="text-[10px] text-zinc-400">首测正确率</p></div>
          <div><p data-testid="plan-spelling-accuracy" className="text-sm font-bold">{percentage(bookStats.spellingCorrect, bookStats.spelling)}</p><p className="text-[10px] text-zinc-400">首测拼写正确率</p></div>
        </div>
        <p className="text-[10px] text-zinc-400 mt-2">首次复测正确率 {percentage(bookStats.retestCorrect, bookStats.retest)} · 补测不覆盖首测成绩</p>
        {session && <p className="text-xs text-amber-600 flex items-center gap-1"><RefreshCw size={12} />{sessionProgress(session)}</p>}
        {session && session.testMode !== plan.testMode && <p className="text-[10px] text-zinc-400">当前轮次保留原检测方式，新设置从下一轮生效。</p>}
        {missing && <p className="text-xs text-red-500">这个单词本已不存在，请先检查单词本。</p>}
        <div className="grid grid-cols-2 gap-2"><button className="btn-ghost bg-zinc-50 dark:bg-zinc-800 text-sm" disabled={missing} onClick={() => navigate(`/vocab/plan?planId=${encodeURIComponent(plan.id)}`)}>调整计划</button><button className="btn-primary text-sm disabled:opacity-40" disabled={busy || missing || (!session && !wordCount)} onClick={() => paused ? void manage(plan.id, false) : navigate(session ? `/vocab/study?sessionId=${encodeURIComponent(session.id)}` : `/vocab/study?planId=${encodeURIComponent(plan.id)}`)}>{paused ? '恢复计划' : session ? '继续本轮' : '开始背词'}</button></div>
      </VocabPlanManagement>
    })}
    {plans.length > 0 && <p className="text-[10px] text-zinc-400">今日检测按各本内不同词条计数，重复检测不叠加；复测不增加检测词数。同一单词的复习记忆状态共用。</p>}
    {deletedPlans.length > 0 && <div className="space-y-2"><button className="text-xs text-zinc-400" aria-expanded={showDeleted} onClick={() => setShowDeleted(value => !value)}>已删除计划（{deletedPlans.length}）</button>{showDeleted && <div className="space-y-2"><p className="text-[11px] text-zinc-400">恢复保留计划进度，但不会恢复已结束的轮次。原来暂停的计划恢复后仍暂停。</p>{deletedPlans.map(plan => <div key={plan.id} className="card !p-3 flex items-center gap-2"><span className="text-sm flex-1 break-words">{plan.bookName}</span><button disabled={busy} className="text-xs text-brand-600" onClick={() => void manage(plan.id, true)}>恢复此计划</button></div>)}</div>}</div>}
    {otherSessions.map(session => <button key={session.id} className="card w-full text-left !p-3 border-amber-200 dark:border-amber-900" onClick={() => navigate(`/vocab/study?sessionId=${encodeURIComponent(session.id)}`)}><p className="text-sm font-semibold">继续：{session.bookName}</p><p className="text-xs text-zinc-400 mt-1">{sessionProgress(session)}</p></button>)}
  </section>
}
