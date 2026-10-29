import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { VOCAB_PAGE_SIZE, vocabQuery } from '../lib/vocabQueries'

export function useVocabPage(ownerId: number, notebookId = '', date = '', enabled = true) {
  const filterKey = JSON.stringify([ownerId, notebookId, date])
  const [position, setPosition] = useState({ key: filterKey, page: 0 })
  const page = position.key === filterKey ? position.page : 0
  const key = JSON.stringify([filterKey, page, enabled])
  const result = useLiveQuery(async () => {
    if (!enabled) return undefined
    const [total, cards] = await Promise.all([
      vocabQuery(ownerId, notebookId, date).count(),
      vocabQuery(ownerId, notebookId, date).reverse().offset(page * VOCAB_PAGE_SIZE).limit(VOCAB_PAGE_SIZE).toArray(),
    ])
    return { key, total, cards }
  }, [key])
  // Never display old-book/old-date rows while the next query is pending.
  const current = result?.key === key ? result : undefined
  const setPage = (next: number) => setPosition({ key: filterKey, page: Math.max(0, next) })
  useEffect(() => {
    if (current && page > 0 && page * VOCAB_PAGE_SIZE >= current.total) {
      setPosition({ key: filterKey, page: Math.max(0, Math.ceil(current.total / VOCAB_PAGE_SIZE) - 1) })
    }
  }, [current, page, filterKey])
  return { cards: current?.cards ?? [], total: current?.total ?? 0, page, setPage, loading: enabled && !current }
}
