import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, X } from 'lucide-react'
import { getCurrentOwnerId, type VocabPlan } from '../db'
import { deleteVocabPlan, pauseVocabPlan, planStatus } from '../lib/vocabPlans'

export function VocabPlanManagement({ plan, name, children }: { plan: VocabPlan; name: string; children: ReactNode }) {
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<'menu' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  const open = () => { cancel(); setError(''); setDialog('menu') }
  useEffect(() => {
    window.addEventListener('scroll', cancel, true)
    return () => { cancel(); window.removeEventListener('scroll', cancel, true) }
  }, [])
  useEffect(() => {
    if (!dialog) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !locked.current) setDialog(null) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [dialog])
  const act = async (action: 'delete' | 'toggle') => {
    if (locked.current) return
    locked.current = true; setBusy(true); setError('')
    try {
      if (action === 'delete') await deleteVocabPlan(getCurrentOwnerId(), plan.id)
      else await pauseVocabPlan(getCurrentOwnerId(), plan.id, planStatus(plan) !== 'paused')
      setDialog(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试') }
    finally { locked.current = false; setBusy(false) }
  }
  return <>
    <article data-testid="vocab-plan-card" data-book-id={plan.bookId} data-plan-status={planStatus(plan)} tabIndex={0}
      className="card !p-4 space-y-3 border-brand-100 dark:border-brand-900 relative" style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none' }}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('button,input,a,select,label')) return
        cancel(); origin.current = { x: event.clientX, y: event.clientY }; timer.current = setTimeout(open, 550)
      }}
      onPointerMove={event => { if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) cancel() }}
      onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={event => { if ((event.target as HTMLElement).closest('button,input,a,select')) return; event.preventDefault(); open() }}
      onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'ContextMenu' || event.key === 'Enter' || (event.shiftKey && event.key === 'F10'))) { event.preventDefault(); open() } }}>
      <button aria-label={`管理计划：${name}`} onClick={open} className="absolute top-2 right-2 p-2 text-zinc-500 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><MoreHorizontal size={20} /></button>
      {children}
    </article>
    {dialog && <div role="dialog" aria-modal="true" aria-label={dialog === 'delete' ? '删除学习计划' : '计划管理'} className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-5" onClick={event => { if (event.target === event.currentTarget && !busy) setDialog(null) }}>
      <div className="card w-full max-w-sm space-y-3">
        <div className="flex items-start gap-2"><h2 className="font-semibold flex-1 break-words">{dialog === 'delete' ? `删除“${name}”？` : name}</h2><button autoFocus aria-label="关闭计划管理" disabled={busy} onClick={() => setDialog(null)} className="p-1"><X size={18} /></button></div>
        {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
        {dialog === 'menu' ? <>
          <button disabled={busy} className="btn-ghost w-full text-left" onClick={() => navigate(`/vocab/plan?planId=${encodeURIComponent(plan.id)}`)}>调整此计划</button>
          <button disabled={busy} className="btn-ghost w-full text-left" onClick={() => navigate(`/vocab/plan?replacePlanId=${encodeURIComponent(plan.id)}`)}>更换单词本</button>
          <button disabled={busy} className="btn-ghost w-full text-left" onClick={() => void act('toggle')}>{planStatus(plan) === 'paused' ? '恢复计划' : '暂停计划'}</button>
          <button disabled={busy} className="btn-ghost w-full text-left text-red-500" onClick={() => setDialog('delete')}>删除计划</button>
        </> : <>
          <p className="text-sm text-zinc-500">只移除学习安排，不删除单词、单词本、答题历史或复习记忆。删除后可重新建计划；旧进度保存在“已删除计划”中，未建新计划时可以恢复。</p>
          <p className="text-xs text-amber-600">未完成轮次会结束，不补发完成奖励；恢复计划也不会恢复已结束的轮次。</p>
          <button disabled={busy} className="w-full rounded-xl py-3 bg-red-500 text-white disabled:opacity-40" onClick={() => void act('delete')}>{busy ? '处理中…' : '确认删除计划'}</button>
          <button disabled={busy} className="btn-ghost w-full" onClick={() => setDialog('menu')}>取消删除</button>
        </>}
      </div>
    </div>}
  </>
}
