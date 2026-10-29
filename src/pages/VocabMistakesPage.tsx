import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { db, getCurrentOwnerId, type VocabAttempt, type VocabLearningSession } from '../db'
import { summarizeMistakes, type WordMistakes } from '../lib/vocabMistakes'
import { WordSpeaker } from '../components/WordSpeaker'
import { VocabPager } from '../components/VocabPager'

const SIZE = 30
export function VocabMistakesPage() {
  const ownerId = getCurrentOwnerId()
  const navigate = useNavigate()
  const [book, setBook] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState('')
  const attempts = useLiveQuery(() => db.vocabAttempts.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const notebooks = useLiveQuery(() => db.vocabNotebooks.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const all = useMemo(() => [...summarizeMistakes(attempts ?? []).values()].sort((a, b) => b.lastError.localeCompare(a.lastError)), [attempts])
  const books = useMemo(() => {
    const values = new Map<string, string>()
    for (const attempt of attempts ?? []) if (attempt.bookId !== 'mistakes') values.set(attempt.bookId, attempt.bookName ?? attempt.bookId)
    for (const notebook of notebooks ?? []) if (values.has(`notebook:${notebook.id}`)) values.set(`notebook:${notebook.id}`, notebook.name)
    return [...values]
  }, [attempts, notebooks])
  const filtered = all.filter(item => (!book || item.bookIds.includes(book)) && (!kind || (kind === 'choice' ? item.choiceErrors : item.spellingErrors) > 0)
    && (status === 'all' || item.mastered === (status === 'mastered')))
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / SIZE) - 1))
  const current = all.find(item => item.word === selected)
  const filterChanged = (setter: (value: string) => void, value: string) => { setter(value); setPage(0) }
  return <div className="p-5 space-y-4">
    <header className="flex gap-3 items-center"><button className="btn-ghost !p-2" aria-label="返回背单词" onClick={() => navigate('/vocab')}><ArrowLeft size={20} /></button><div><h1 className="text-xl font-bold">错词本</h1><p className="text-xs text-zinc-400 mt-1">作答后立即保存，退出后仍可查看</p></div></header>
    <section className="card !p-4 space-y-3"><div className="flex gap-4 text-sm"><span>待巩固 {all.filter(item => !item.mastered).length}词</span><span>已巩固 {all.filter(item => item.mastered).length}词</span></div>
      <select aria-label="错词来源" value={book} onChange={event => filterChanged(setBook, event.target.value)} className="input"><option value="">全部来源</option>{books.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <div className="grid grid-cols-2 gap-2"><select aria-label="错误类型" className="input" value={kind} onChange={event => filterChanged(setKind, event.target.value)}><option value="">全部类型</option><option value="choice">释义薄弱</option><option value="spelling">拼写薄弱</option></select><select aria-label="巩固状态" className="input" value={status} onChange={event => filterChanged(setStatus, event.target.value)}><option value="pending">待巩固</option><option value="mastered">已巩固</option><option value="all">全部状态</option></select></div>
      <button disabled={!filtered.length} onClick={() => navigate(`/vocab/study?mistakes=1&book=${encodeURIComponent(book)}&kind=${kind}&mastery=${status}`)} className="btn-primary w-full disabled:opacity-40">只练这些错词（最多30词）</button>
      <p className="text-[11px] text-zinc-400">不同轮次连续两次首测答对后标记已巩固；补测答对不刷巩固次数，再错则回到待巩固。错词专项不重复发金币。</p>
    </section>
    {attempts === undefined ? <p role="status">正在读取错词…</p> : !filtered.length && <p className="card text-sm text-zinc-400">当前筛选下没有错词</p>}
    {filtered.slice(safePage * SIZE, (safePage + 1) * SIZE).map(item => <article data-testid="mistake-word" key={item.word} className="card !p-4"><div className="flex items-center"><button onClick={() => setSelected(item.word)} className="text-left flex-1 min-w-0"><p className="font-semibold break-words">{item.word}</p><p className="text-xs text-zinc-500 mt-1 truncate">{item.latest.translation ?? '点击查看释义及历史作答'}</p></button><WordSpeaker word={item.word} /></div><p className="text-xs text-red-500 mt-2">累计错{item.errors}次 · 英译汉{item.choiceErrors}次 / 拼写{item.spellingErrors}次</p><p className="text-xs text-zinc-400 mt-1">{item.choiceErrors > 0 && '释义薄弱 '}{item.spellingErrors > 0 && '拼写薄弱 '} · {item.mastered ? '已巩固' : `待巩固（${Math.min(2, item.correctRounds)}/2轮）`}</p><div className="flex justify-between items-center mt-2"><time className="text-[10px] text-zinc-400">最近错于 {new Date(item.lastError).toLocaleString()}</time><button className="text-xs text-brand-500" onClick={() => setSelected(item.word)}>查看错误记录</button></div></article>)}
    <VocabPager page={safePage} total={filtered.length} size={SIZE} onChange={setPage} />
    {current && <MistakeDetails key={current.word} item={current} ownerId={ownerId} onClose={() => setSelected('')} />}
  </div>
}

function MistakeDetails({ item, ownerId, onClose }: { item: WordMistakes; ownerId: number; onClose: () => void }) {
  const [page, setPage] = useState(0)
  const visible = item.records.slice(page * 20, (page + 1) * 20)
  const context = useLiveQuery(async () => {
    const sessions = await db.vocabSessions.bulkGet([...new Set(visible.map(attempt => attempt.sessionId))])
    return new Map(sessions.filter((session): session is VocabLearningSession => session?.ownerId === ownerId).map(session => [session.id, session]))
  }, [ownerId, item.word, page, item.records.length])
  const explanation = (attempt: VocabAttempt) => attempt.translation ?? context?.get(attempt.sessionId)?.words.find(word => word.word === attempt.word)?.translation
  return <div role="dialog" aria-modal="true" aria-label="单词错误记录" className="fixed inset-0 z-50 bg-black/40 p-4 flex items-center justify-center"><div className="card w-full max-w-md max-h-[85vh] overflow-y-auto space-y-4"><header className="flex gap-2 items-center"><h2 className="font-bold text-xl flex-1 break-words">{item.word}</h2><WordSpeaker word={item.word} /><button className="btn-ghost" onClick={onClose}>关闭</button></header><p className="text-sm">累计错误 {item.errors}次 · 答对不清零</p>
    {visible.map(attempt => <div key={attempt.id} className="border-t border-zinc-100 dark:border-zinc-800 pt-3 text-sm space-y-1"><p className={attempt.correct ? 'text-emerald-600' : 'text-red-500'}>{attempt.correct ? '答对' : attempt.timedOut ? '超时' : !attempt.answer ? '选择不会' : '答错'} · {attempt.mode === 'choice' ? '英译汉' : '拼写'} · {attempt.phase === 'screening' ? '首测' : `复测${attempt.retestRound ?? ''}`}</p><p>你的答案：<span className="break-words">{attempt.answer || '未作答'}</span></p><p>正确答案：{attempt.mode === 'spelling' ? attempt.word : explanation(attempt) ?? '旧记录未保留释义'}</p>{attempt.mode === 'spelling' && explanation(attempt) && <p className="text-zinc-500">{explanation(attempt)}</p>}<p className="text-[11px] text-zinc-400">{attempt.bookName ?? context?.get(attempt.sessionId)?.bookName ?? '历史学习'} · {new Date(attempt.createdAt).toLocaleString()}</p></div>)}
    <VocabPager page={page} total={item.records.length} size={20} onChange={setPage} />
  </div></div>
}
