import { useRef } from 'react'

export function VocabPager({ page, total, size, onChange, disabled = false, label = '单词列表分页' }: {
  page: number; total: number; size: number; onChange: (page: number) => void; disabled?: boolean; label?: string
}) {
  const nav = useRef<HTMLElement>(null)
  if (total <= size) return null
  const pages = Math.max(1, Math.ceil(total / size))
  const navigate = (next: number) => {
    // Capture targets before loading can temporarily unmount this pager.
    const region = nav.current?.closest('[role="dialog"]') ?? nav.current?.closest('[data-vocab-page-region]')
    const anchor = region?.querySelector('[data-vocab-list-start]')
    const scroller = region?.querySelector('.overflow-y-auto')
    onChange(next)
    requestAnimationFrame(() => { if (anchor) anchor.scrollIntoView({ block: 'start' }); else scroller?.scrollTo({ top: 0 }) })
  }
  return <nav ref={nav} aria-label={label} className="flex items-center justify-between gap-2 py-2 text-xs">
    <button type="button" className="btn-ghost disabled:opacity-30" disabled={disabled || page === 0} onClick={() => navigate(page - 1)}>上一页</button>
    <span role="status" className="text-zinc-500 text-center">第 {page + 1}/{pages} 页 · 共 {total} 项</span>
    <button type="button" className="btn-ghost disabled:opacity-30" disabled={disabled || page + 1 >= pages} onClick={() => navigate(page + 1)}>下一页</button>
  </nav>
}
