import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, Pencil, Plus, Trash2, X } from 'lucide-react'
import { db, getCurrentOwnerId, type VocabNotebook } from '../db'
import { createNotebook, notebookBookId } from '../lib/vocabNotebooks'
import { VocabWordDelete } from '../components/VocabWordDelete'
import { VocabPager } from '../components/VocabPager'
import { useVocabPage } from '../hooks/useVocabPage'
import { VOCAB_PAGE_SIZE, vocabDueQuery, vocabQuery, vocabSummary } from '../lib/vocabQueries'
import { WordSpeaker } from '../components/WordSpeaker'
import { useWordMistakes } from '../hooks/useWordMistakes'
import { normalizeVocabEntry } from '../lib/vocabImport'

export function VocabNotebooksPage() {
  const ownerId = getCurrentOwnerId()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('id') ?? ''
  const books = useLiveQuery(() => db.vocabNotebooks.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const summary = useLiveQuery(() => vocabSummary(ownerId), [ownerId])
  const selected = books?.find(book => book.id === selectedId)
  const { cards: words, total: wordCount, page, setPage, loading: wordsLoading } = useVocabPage(ownerId, selectedId, '', Boolean(selected))
  const mistakes = useWordMistakes(ownerId, words)
  const dueCount = useLiveQuery(() => selectedId ? vocabDueQuery(ownerId, selectedId).count() : 0, [ownerId, selectedId])
  const [editing, setEditing] = useState<VocabNotebook | 'new' | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const selection = useVocabPage(ownerId, '', '', choosing)

  const openSelection = async () => {
    if (!selected || busy) return
    setBusy(true); setError('')
    try {
      const ids = await vocabQuery(ownerId, selected.id).primaryKeys()
      setChosen(new Set(ids.filter((id): id is number => id !== undefined))); selection.setPage(0); setChoosing(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取收录失败') }
    finally { setBusy(false) }
  }

  const saveBook = async () => {
    if (!editing) return
    setBusy(true); setError('')
    try {
      if (editing === 'new') {
        const book = await createNotebook(ownerId, name)
        setParams({ id: book.id })
      } else {
        const clean = name.trim()
        if (!clean) throw new Error('请输入名称')
        if (books?.some(book => book.id !== editing.id && book.name === clean)) throw new Error('已经有同名的单词本了')
        await db.transaction('rw', db.vocabNotebooks, db.vocabPlans, async () => {
          await db.vocabNotebooks.update(editing.id, { name: clean, updatedAt: new Date().toISOString() })
          await db.vocabPlans.where('[ownerId+bookId]').equals([ownerId, notebookBookId(editing.id)]).modify({ bookName: clean })
        })
      }
      setEditing(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败') }
    finally { setBusy(false) }
  }

  const deleteBook = async (book: VocabNotebook) => {
    if (!window.confirm(`删除“${book.name}”？单词和复习记录会保留，仍可在全部单词中查看。`)) return
    setBusy(true); setError('')
    try {
      await db.transaction('rw', db.vocabNotebooks, db.vocabCards, db.vocabPlans, db.vocabSessions, async () => {
        await db.vocabNotebooks.delete(book.id)
        await db.vocabCards.where('ownerId').equals(ownerId).filter(card => !!card.notebookIds?.includes(book.id)).modify(card => {
          card.notebookIds = card.notebookIds?.filter(id => id !== book.id)
        })
        const bookId = notebookBookId(book.id)
        await db.vocabPlans.where('[ownerId+bookId]').equals([ownerId, bookId]).delete()
        await db.vocabSessions.where('ownerId').equals(ownerId).filter(s => s.bookId === bookId && s.status === 'active').modify({ status: 'abandoned' })
      })
      if (selectedId === book.id) setParams({})
    } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败') }
    finally { setBusy(false) }
  }

  const saveSelection = async () => {
    if (!selected) return
    setBusy(true); setError('')
    try {
      await db.transaction('rw', db.vocabCards, async () => {
        const owned = await db.vocabCards.where('ownerId').equals(ownerId).toArray()
        const changes = owned.flatMap(card => {
          const before = card.notebookIds?.includes(selected.id) ?? false
          const after = chosen.has(card.id!)
          if (before === after) return []
          return [{ ...card, notebookIds: after ? [...(card.notebookIds ?? []), selected.id] : card.notebookIds?.filter(id => id !== selected.id) }]
        })
        if (changes.length) await db.vocabCards.bulkPut(changes)
      })
      setChoosing(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败') }
    finally { setBusy(false) }
  }

  return <div data-vocab-page-region className="p-5 space-y-5 pb-10">
    <div className="flex items-center gap-3"><button aria-label="返回" className="p-2" onClick={() => selected ? setParams({}) : navigate('/vocab')}><ArrowLeft size={20} /></button><div className="flex-1 min-w-0"><h1 className="text-xl font-bold truncate">{selected?.name ?? '我的单词本'}</h1><p className="text-xs text-zinc-400 mt-1">{selected ? `${wordsLoading ? '…' : wordCount}个单词 · 按本背诵和复习` : '自由分类，单词可以收录到多个本子'}</p></div><button aria-label="新建单词本" className="btn-primary !px-3" onClick={() => { setEditing('new'); setName(''); setError('') }}><Plus size={18} /></button></div>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {selected ? <>
      <div className="grid grid-cols-2 gap-2"><button className="btn-primary disabled:opacity-40" disabled={!wordCount || busy} onClick={() => navigate(`/vocab/plan?bookId=${encodeURIComponent(notebookBookId(selected.id))}`)}>背这个单词本</button><button className="btn-ghost bg-zinc-100 dark:bg-zinc-800" onClick={() => navigate(`/vocab/add?notebookId=${encodeURIComponent(selected.id)}`)}>添加新单词</button><button className="btn-ghost disabled:opacity-40" disabled={busy || wordsLoading} onClick={() => void openSelection()}>管理收录 / 添加已有单词</button><button disabled={!dueCount} className="btn-ghost disabled:opacity-40" onClick={() => navigate(`/vocab/study?review=1&notebookId=${encodeURIComponent(selected.id)}`)}>{dueCount ? `复习本内到期词（${dueCount}）` : '本内暂无到期词'}</button></div>
      {wordsLoading && <p role="status" className="py-6 text-center text-sm text-zinc-400">正在读取单词…</p>}
      {!wordsLoading && !wordCount && <div className="card text-center text-sm text-zinc-400 py-10">这个单词本还是空的，先添加一些单词吧</div>}
      {!!wordCount && <p className="text-xs text-zinc-400">长按单词可移出本子或删除</p>}
      <div data-vocab-list-start />
      <VocabPager page={page} total={wordCount} size={VOCAB_PAGE_SIZE} onChange={setPage} disabled={wordsLoading} />
      {words.map(card => <VocabWordDelete key={card.id} card={card} notebookId={selected.id} className="card !p-3"><div className="flex items-center"><p className="font-medium break-words flex-1">{card.word}</p><WordSpeaker word={card.word} /></div><p className="text-xs text-zinc-500 mt-1">{card.translation}</p>{mistakes?.has(normalizeVocabEntry(card.word)) && <p className="text-xs text-red-500 mt-1">累计错{mistakes.get(normalizeVocabEntry(card.word))!.errors}次</p>}</VocabWordDelete>)}
      <VocabPager page={page} total={wordCount} size={VOCAB_PAGE_SIZE} onChange={setPage} disabled={wordsLoading} />
    </> : <>
      {books?.length === 0 && <div className="card py-10 text-center"><BookOpen className="mx-auto text-brand-500 mb-3" /><p className="text-sm text-zinc-500">新建一个单词本，比如“阅读生词”或“课本Unit 1”</p></div>}
      {books?.map(book => <div key={book.id} className="card !p-4 flex items-center gap-3"><button className="flex-1 text-left min-w-0" onClick={() => setParams({ id: book.id })}><p className="font-semibold truncate">{book.name}</p><p className="text-xs text-zinc-400 mt-1">{summary?.notebooks[book.id] ?? '…'}个单词</p></button><button className="p-2 text-zinc-400" aria-label={`重命名${book.name}`} onClick={() => { setEditing(book); setName(book.name); setError('') }}><Pencil size={16} /></button><button disabled={busy} className="p-2 text-zinc-400" aria-label={`删除${book.name}`} onClick={() => void deleteBook(book)}><Trash2 size={16} /></button></div>)}
    </>}
    {editing && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-5" role="dialog" aria-modal="true" aria-label="编辑单词本"><div className="card w-full max-w-sm space-y-4"><h2 className="font-semibold">{editing === 'new' ? '新建单词本' : '重命名单词本'}</h2><input className="input" autoFocus maxLength={40} placeholder="输入名称，最多40字" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !busy) void saveBook() }} />{error && <p className="text-xs text-red-500">{error}</p>}<div className="grid grid-cols-2 gap-2"><button disabled={busy} className="btn-ghost" onClick={() => setEditing(null)}>取消</button><button disabled={busy || !name.trim()} className="btn-primary disabled:opacity-40" onClick={() => void saveBook()}>保存</button></div></div></div>}
    {choosing && <div className="fixed inset-0 z-50 bg-white dark:bg-zinc-900 flex flex-col p-5 safe-top" role="dialog" aria-modal="true" aria-label="管理收录单词"><div className="flex items-center justify-between pb-4"><h2 className="font-semibold">收录已有单词（{chosen.size}）</h2><button aria-label="关闭" disabled={busy} onClick={() => setChoosing(false)}><X /></button></div><p className="text-xs text-zinc-400 pb-3">勾选加入本子，取消勾选仅从本子移除；翻页保留全部选择。</p><div className="flex-1 overflow-y-auto space-y-2">{selection.loading && <p role="status" className="text-sm text-zinc-400 py-5">正在读取单词…</p>}{selection.cards.map(card => <label key={card.id} className="card !p-3 flex items-center gap-3"><input type="checkbox" disabled={busy} checked={chosen.has(card.id!)} onChange={e => setChosen(current => { const next = new Set(current); if (e.target.checked) next.add(card.id!); else next.delete(card.id!); return next })} /><div><p className="text-sm font-semibold">{card.word}</p><p className="text-xs text-zinc-400">{card.translation}</p></div></label>)}{!selection.loading && !selection.total && <p className="text-sm text-zinc-400 py-5">还没有单词，请先添加新单词。</p>}</div><VocabPager page={selection.page} total={selection.total} size={VOCAB_PAGE_SIZE} onChange={selection.setPage} disabled={selection.loading || busy} label="收录单词分页" /><button disabled={busy || selection.loading} className="btn-primary mt-4 mb-6" onClick={() => void saveSelection()}>{busy ? '保存中…' : '保存收录'}</button></div>}
  </div>
}
