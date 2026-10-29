import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getCurrentOwnerId, type VocabCard } from '../db'
import { deleteVocabWord } from '../lib/vocabNotebooks'

export function VocabWordDelete({ card, notebookId, children, className }: { card: VocabCard; notebookId?: string; children: ReactNode; className: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const cancelHold = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null }
  useEffect(() => cancelHold, [])
  const remove = async (onlyHere: boolean) => {
    if (!card.id || busy) return
    setBusy(true); setError('')
    try { await deleteVocabWord(getCurrentOwnerId(), card.id, onlyHere ? notebookId : undefined); setOpen(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败，请重试') }
    finally { setBusy(false) }
  }
  return <>
    <div role="button" tabIndex={0} aria-label={`单词${card.word}，长按管理`} className={`${className} select-none`} style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none' }}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('button, input, a')) return
        cancelHold(); origin.current = { x: event.clientX, y: event.clientY }
        timer.current = setTimeout(() => { timer.current = null; setOpen(true) }, 550)
      }}
      onPointerMove={event => { if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) cancelHold() }}
      onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
      onContextMenu={event => { event.preventDefault(); cancelHold(); setOpen(true) }}
      onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' ', 'ContextMenu'].includes(event.key)) { event.preventDefault(); setOpen(true) } }}
    >{children}</div>
    {open && <div role="dialog" aria-modal="true" aria-label="删除单词" className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-5"><div className="card w-full max-w-sm space-y-4">
      <h2 className="font-semibold break-words">删除“{card.word}”？</h2>
      <p className="text-sm text-zinc-500">彻底删除会从全部单词本中删除该词及其复习记录。包含它的未完成背词轮次会结束，避免继续学习时重新添加。</p>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {notebookId && <button disabled={busy} className="btn-ghost w-full border border-zinc-200 dark:border-zinc-700" onClick={() => void remove(true)}>仅移出当前单词本</button>}
      <button disabled={busy} className="w-full py-3 rounded-xl bg-red-500 text-white disabled:opacity-50" onClick={() => void remove(false)}>{busy ? '处理中…' : '彻底删除'}</button>
      <button disabled={busy} className="btn-ghost w-full" onClick={() => setOpen(false)}>取消</button>
    </div></div>}
  </>
}
