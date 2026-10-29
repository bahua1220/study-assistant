import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Check, Loader2, LockKeyhole, SpellCheck2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getCurrentOwnerId, type VocabTestMode } from '../db'
import { getVocabBooks, type VocabBookInfo } from '../services/api'
import clsx from 'clsx'
import { isNotebookBook, notebookBookId } from '../lib/vocabNotebooks'
import { vocabSummary } from '../lib/vocabQueries'
import { saveVocabPlan, replaceVocabPlan, planStatus } from '../lib/vocabPlans'

const BATCHES = [20, 30, 50]
const defaults = () => ({ batchSize: 30, dailyTarget: 30, testMode: 'mixed' as VocabTestMode, focusLock: true })

export function VocabPlanPage() {
  const navigate = useNavigate()
  const ownerId = getCurrentOwnerId()
  const [params] = useSearchParams()
  const editId = params.get('planId')
  const replaceId = params.get('replacePlanId')
  const replacing = Boolean(replaceId)
  const notebooks = useLiveQuery(() => db.vocabNotebooks.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const summary = useLiveQuery(() => vocabSummary(ownerId), [ownerId])
  const plans = useLiveQuery(() => db.vocabPlans.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const currentPlans = useMemo(() => plans?.filter(plan => planStatus(plan) !== 'deleted') ?? [], [plans])
  const localBooks: VocabBookInfo[] = useMemo(() => (notebooks ?? []).map(book => ({ id: notebookBookId(book.id), name: book.name, description: '我的单词本', wordCount: summary?.notebooks[book.id] ?? 0 })), [notebooks, summary])
  const [books, setBooks] = useState<VocabBookInfo[]>([])
  const examBooks = useMemo(() => {
    const result = new Map(books.map(book => [book.id, book]))
    for (const plan of [...(plans ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      if (!isNotebookBook(plan.bookId) && !result.has(plan.bookId)) result.set(plan.bookId, { id: plan.bookId, name: plan.bookName, description: '已保存的词书', wordCount: plan.wordCount })
    }
    return [...result.values()]
  }, [books, plans])
  const allBooks = useMemo(() => [...localBooks, ...examBooks], [localBooks, examBooks])
  const sourcePlan = plans?.find(plan => plan.id === (replaceId ?? editId))
  const shortcutPlan = !replacing && !editId && params.get('bookId') ? currentPlans.find(plan => plan.bookId === params.get('bookId')) : undefined
  const editingPlan = replacing ? undefined : sourcePlan ?? shortcutPlan
  const editing = Boolean(editId || shortcutPlan)
  const [chosen, setSelected] = useState(params.get('bookId') ?? '')
  const selected = editing ? editingPlan?.bookId ?? '' : chosen
  const selectedPlan = currentPlans.find(plan => plan.bookId === selected)
  const selectedKey = JSON.stringify([ownerId, selected, editId, replaceId, editingPlan?.id])
  const [loadedKey, setLoadedKey] = useState('')
  const [settings, setSettings] = useState(defaults)
  const { batchSize, dailyTarget, testMode, focusLock } = settings
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const [disposition, setDisposition] = useState<'pause' | 'delete'>('pause')
  const [roundHandling, setRoundHandling] = useState<'next' | 'restart'>('next')
  const invalidSource = Boolean((editId || replaceId) && plans && !sourcePlan) || Boolean((sourcePlan ?? shortcutPlan) && planStatus((sourcePlan ?? shortcutPlan)!) === 'deleted')

  useEffect(() => {
    if (selected || !plans || editing || replacing) return
    const preferred = params.get('new') === '1' ? allBooks.find(book => !currentPlans.some(plan => plan.bookId === book.id)) : undefined
    const previous = params.get('new') !== '1' ? [...currentPlans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] : undefined
    const initial = preferred?.id ?? previous?.bookId ?? localBooks[0]?.id ?? examBooks.find(book => book.id === 'gk')?.id ?? examBooks[0]?.id
    if (initial) setSelected(initial)
  }, [allBooks, plans, currentPlans, localBooks, examBooks, selected, params, editing, replacing])

  useEffect(() => {
    if (!plans || !selected || loadedKey === selectedKey) return
    const old = currentPlans.find(plan => plan.bookId === selected) ?? (replacing ? sourcePlan : undefined)
    setSettings(old ? { batchSize: old.batchSize, dailyTarget: old.dailyTarget, testMode: old.testMode, focusLock: old.focusLock } : defaults())
    setRoundHandling('next')
    setLoadedKey(selectedKey)
  }, [plans, currentPlans, selected, selectedKey, loadedKey, replacing, sourcePlan])

  const unfinished = useLiveQuery(() => selectedPlan ? db.vocabSessions.where('[ownerId+status]').equals([ownerId, 'active']).filter(session => session.planId === selectedPlan.id).first() : undefined, [ownerId, selectedPlan?.id])
  useEffect(() => {
    let mounted = true
    void (async () => {
      try { const items = await getVocabBooks(); if (mounted) setBooks(items) }
      catch { if (mounted) setError('考试词书暂时无法加载，仍可使用自己的单词本和已保存的词书计划。') }
      finally { if (mounted) setLoading(false) }
    })()
    return () => { mounted = false }
  }, [ownerId])

  const save = async (startStudy: boolean) => {
    if (savingRef.current || loadedKey !== selectedKey || invalidSource) return
    const book = allBooks.find(item => item.id === selected)
    if (!book || !book.wordCount) { setError('请先往这个单词本添加单词'); return }
    if (replacing && (!sourcePlan || sourcePlan.bookId === selected)) { setError('请选择与原计划不同的单词本'); return }
    if (replacing && !window.confirm(`将“${sourcePlan!.bookName}”${disposition === 'pause' ? '暂停并保留未完成轮次' : '移入已删除计划并结束未完成轮次'}，改学“${book.name}”。${selectedPlan ? '目标本已有计划，将保留其进度并应用本次设置，不新增副本。' : '原本的单词与学习记录保留。'}确定更换吗？`)) return
    if (!replacing && unfinished && roundHandling === 'restart' && !window.confirm('将结束当前未完成轮次，保留已经发生的答题与复习记录，但不补发完成奖励。新轮次按新设置开始，已完成的词本进度不清零。继续吗？')) return
    savingRef.current = true; setSaving(true); setError('')
    try {
      const input = { bookId: book.id, bookName: book.name, wordCount: book.wordCount, ...settings }
      const plan = replacing ? await replaceVocabPlan(ownerId, sourcePlan!.id, input, disposition)
        : await saveVocabPlan(ownerId, { ...input, planId: editingPlan?.id, restartRound: roundHandling === 'restart' })
      navigate(startStudy ? '/vocab/study?planId=' + encodeURIComponent(plan.id) : '/vocab', { replace: true })
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存计划失败') }
    finally { savingRef.current = false; setSaving(false) }
  }
  const canSave = Boolean(plans) && !saving && !invalidSource && Boolean(selected) && loadedKey === selectedKey && allBooks.some(book => book.id === selected && book.wordCount > 0) && (!replacing || sourcePlan?.bookId !== selected)
  const canStart = canSave && (!editingPlan || planStatus(editingPlan) !== 'paused')
  const chooseBook = (bookId: string) => {
    if (!plans) return
    const existing = currentPlans.find(plan => plan.bookId === bookId)
    setError('')
    if (existing && !replacing) { navigate(`/vocab/plan?planId=${encodeURIComponent(existing.id)}`, { replace: true }); return }
    setSelected(bookId)
  }
  const changeBatch = (value: number) => setSettings(current => ({ ...current, batchSize: value, dailyTarget: Math.max(current.dailyTarget, value) }))

  return <div className="p-5 space-y-5 pb-10">
    <div className="flex items-center gap-3"><button aria-label="返回背单词" onClick={() => navigate('/vocab')} className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"><ArrowLeft size={20} /></button><div><h1 className="text-xl font-bold">{replacing ? '更换单词本' : editing ? '调整学习计划' : '选择学习计划'}</h1><p className="text-xs text-zinc-400">{replacing ? '明确处理旧计划，不会悄悄再加一个' : editing ? '修改原计划，单词本和已学进度保持不变' : '给另一本添加独立计划，已有计划不重复创建'}</p></div></div>
    {error && <p role="alert" className="text-sm text-red-500 bg-red-50 dark:bg-red-950 rounded-xl p-3">{error}</p>}
    {invalidSource && <p role="alert" className="card text-sm text-red-500">计划不存在或已删除，请返回首页刷新或在“已删除计划”中恢复。</p>}
    {editing ? <section className="card space-y-2"><h2 className="text-sm font-semibold">当前单词本（不可在调整中更换）</h2><p className="font-semibold">{editingPlan?.bookName ?? '正在读取…'}</p><p className="text-xs text-zinc-400">只修改数量和检测方式。要换一本背，请使用原计划卡片菜单里的“更换单词本”；要同时背另一本，请用“添加计划”。</p></section> : <section>
      {replacing && <div className="card mb-4 space-y-2"><p className="text-sm font-semibold">原计划：{sourcePlan?.bookName ?? '正在读取…'}</p><label className="block text-xs text-zinc-500">如何处理原计划<select aria-label="原计划处理方式" value={disposition} onChange={event => setDisposition(event.target.value as 'pause' | 'delete')} className="input mt-2" disabled={saving}><option value="pause">暂停原计划，保留进度和未完成轮次</option><option value="delete">删除原计划，保留历史并结束未完成轮次</option></select></label><p className="text-[11px] text-zinc-400">选择另一单词本后才可确认；旧本的单词和历史记录均不删除。</p></div>}
      <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold">1. 选择单词本或考试词书</h2><button className="text-xs text-brand-500" onClick={() => navigate('/vocab/notebooks')}>管理我的单词本</button></div>
      {[{ title: '我的单词本', items: localBooks }, { title: '考试词书', items: examBooks }].map(group => <div key={group.title} className="mb-4">
        <p className="text-xs text-zinc-500 mb-2">{group.title}</p>
        <div className="grid grid-cols-2 gap-3">{group.items.map(book => <button key={book.id} disabled={saving || (replacing && sourcePlan?.bookId === book.id)} aria-pressed={selected === book.id} onClick={() => chooseBook(book.id)} className={clsx('card !p-4 text-left relative disabled:opacity-40', selected === book.id && 'border-brand-500 ring-2 ring-brand-100 dark:ring-brand-950')}>
          <BookOpen size={20} className={selected === book.id ? 'text-brand-500' : 'text-zinc-400'} /><p className="font-semibold text-sm mt-3">{book.name}</p>
          <p className="text-[11px] text-zinc-400 mt-1">{book.wordCount.toLocaleString()}词{!book.wordCount && ' · 请先添加单词'}</p>
          {currentPlans.some(plan => plan.bookId === book.id) && <p className="text-[10px] text-brand-600 mt-1">{currentPlans.find(plan => plan.bookId === book.id)?.status === 'paused' ? '计划已暂停 · 可调整' : '已建计划 · 可调整'}</p>}
          {selected === book.id && <span className="absolute right-3 top-3 w-5 h-5 rounded-full bg-brand-500 text-white flex items-center justify-center"><Check size={13} /></span>}
        </button>)}</div>
        {group.title === '考试词书' && loading && <p role="status" className="text-xs text-zinc-400 flex items-center gap-1 mt-2"><Loader2 size={12} className="animate-spin" />正在加载考试词书，不影响设置自己的单词本…</p>}
        {!group.items.length && !(group.title === '考试词书' && loading) && <p className="text-xs text-zinc-400">{group.title === '我的单词本' ? '还没有自建单词本，点击上方管理入口创建。' : '暂无可用词书'}</p>}
      </div>)}
      {isNotebookBook(selected) && <p className="text-xs text-zinc-500">按本内单词乱序学习；不足一轮时学习剩余词，全部学过后可以再次背诵。选项不足四个不同释义时自动使用拼写。</p>}
      {selectedPlan && <p className="text-xs text-brand-600 mt-2">正在调整“{selectedPlan.bookName}”，已学进度会保留。</p>}
      {!selectedPlan && plans?.some(plan => plan.bookId === selected && planStatus(plan) === 'deleted') && <p className="text-xs text-zinc-400 mt-2">当前没有学习计划，可重新创建。旧计划仅保存在首页“已删除计划”中，新建不会复活旧轮次或清除历史记录。</p>}
    </section>}
    {replacing && selectedPlan && <p className="text-xs text-amber-600">目标本已有计划，将保留其进度、更新本次设置并恢复学习，不创建副本。</p>}
    {!replacing && unfinished && <section className="card space-y-2"><p role="status" className="text-xs text-amber-600">已有未完成轮次，默认保留当前题目，新设置下轮生效。</p><label className="block text-xs"><input type="radio" name="round-handling" value="next" checked={roundHandling === 'next'} onChange={() => setRoundHandling('next')} /> 下轮生效，保留当前轮次</label><label className="block text-xs"><input type="radio" name="round-handling" value="restart" checked={roundHandling === 'restart'} onChange={() => setRoundHandling('restart')} /> 结束本轮，按新设置重新开始</label></section>}
    {editingPlan && planStatus(editingPlan) === 'paused' && <p className="text-xs text-amber-600">这个计划已暂停，保存修改不会自动恢复；请回卡片点击“恢复计划”。</p>}
    <fieldset disabled={saving || loadedKey !== selectedKey} className="space-y-5 min-w-0">
      <section className="card space-y-4"><h2 className="text-sm font-semibold">2. 设置学习数量</h2><div><p className="text-xs text-zinc-500 mb-2">每轮学习</p><div className="grid grid-cols-3 gap-2">{BATCHES.map(value => <button key={value} onClick={() => changeBatch(value)} className={clsx('py-2.5 rounded-xl text-sm font-medium', batchSize === value ? 'bg-brand-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800')}>{value}词</button>)}</div><label className="flex items-center gap-3 mt-3"><span className="text-xs text-zinc-500 shrink-0">自定义</span><input aria-label="每轮学习数量" type="number" min={5} max={100} value={batchSize} onChange={event => changeBatch(Math.max(5, Math.min(100, Number(event.target.value) || 5)))} className="input !py-2" /></label></div><label className="block"><span className="text-xs text-zinc-500">每日检测目标</span><input aria-label="每日检测目标" type="number" min={batchSize} max={300} step={1} value={dailyTarget} onChange={event => setSettings(current => ({ ...current, dailyTarget: Math.max(current.batchSize, Math.min(300, Number(event.target.value) || current.batchSize)) }))} className="input mt-2" /></label></section>
      <section className="card space-y-3"><h2 className="text-sm font-semibold">3. 检测方式</h2>{[
        { id: 'choice' as const, title: '英译汉', desc: '英文四选一，每题6秒' },
        { id: 'spelling' as const, title: '拼写', desc: '根据中文输入英文，10～20秒' },
        { id: 'mixed' as const, title: '混合（推荐）', desc: '英译汉与拼写约各半，随机穿插；错词最多两遍复测' },
      ].map(mode => <button key={mode.id} aria-pressed={testMode === mode.id} onClick={() => setSettings(current => ({ ...current, testMode: mode.id }))} className={clsx('w-full rounded-xl border p-3 flex items-center gap-3 text-left', testMode === mode.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40' : 'border-zinc-200 dark:border-zinc-800')}><SpellCheck2 size={20} className={testMode === mode.id ? 'text-brand-500' : 'text-zinc-400'} /><div className="flex-1"><p className="text-sm font-medium">{mode.title}</p><p className="text-xs text-zinc-400 mt-0.5">{mode.desc}</p></div>{testMode === mode.id && <Check size={17} className="text-brand-500" />}</button>)}</section>
      <section className="card"><button aria-pressed={focusLock} onClick={() => setSettings(current => ({ ...current, focusLock: !current.focusLock }))} className="w-full flex items-center gap-3 text-left"><div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', focusLock ? 'bg-brand-100 dark:bg-brand-950 text-brand-600' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400')}><LockKeyhole size={20} /></div><div className="flex-1"><p className="text-sm font-medium">专注锁定本轮</p><p className="text-xs text-zinc-400 mt-0.5">隐藏导航并尝试启用Android屏幕固定</p></div><span className={clsx('w-11 h-6 rounded-full p-0.5 transition-colors', focusLock ? 'bg-brand-500' : 'bg-zinc-300 dark:bg-zinc-700')}><span className={clsx('block w-5 h-5 rounded-full bg-white transition-transform', focusLock && 'translate-x-5')} /></span></button></section>
    </fieldset>
    <p className="text-[11px] text-zinc-400">每日目标按本内当天检测过的不同词条计数，重复检测和薄弱词复测不增加词数。</p>
    <div className="grid gap-2"><button onClick={() => void save(false)} disabled={!canSave} className="btn-ghost border border-brand-200 dark:border-brand-900 w-full py-3 disabled:opacity-40">{saving ? '保存中…' : replacing ? '确认更换' : editing ? '保存修改' : '保存计划'}</button><button onClick={() => void save(true)} disabled={!canStart} className="btn-primary w-full py-3.5 disabled:opacity-50">{saving ? '保存中…' : replacing ? '更换并开始背词' : editing ? '保存修改并开始背词' : '保存并开始背词'}</button></div>
  </div>
}
