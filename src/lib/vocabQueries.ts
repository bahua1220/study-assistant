import { db } from '../db'

export const VOCAB_PAGE_SIZE = 50
export const DRAFT_PAGE_SIZE = 30

export function vocabQuery(ownerId: number, notebookId = '', date = '') {
  let start = '', end = '\uffff'
  if (date) {
    const day = new Date(`${date}T00:00:00`)
    if (!Number.isNaN(day.getTime())) {
      start = day.toISOString()
      day.setDate(day.getDate() + 1)
      end = day.toISOString()
    }
  }
  const query = db.vocabCards.where('[ownerId+createdAt]').between([ownerId, start], [ownerId, end], true, false)
  return notebookId ? query.and(card => notebookId === 'unfiled' ? !card.notebookIds?.length : Boolean(card.notebookIds?.includes(notebookId))) : query
}

// Return only aggregate data to React; do not keep a second full card list in page state.
export async function vocabSummary(ownerId: number) {
  const cards = await db.vocabCards.where('ownerId').equals(ownerId).toArray()
  const notebooks: Record<string, number> = Object.create(null)
  let unfiled = 0
  for (const card of cards) {
    if (!card.notebookIds?.length) unfiled++
    for (const id of new Set(card.notebookIds ?? [])) notebooks[id] = (notebooks[id] ?? 0) + 1
  }
  return { total: cards.length, notebooks, unfiled }
}

export function vocabDueQuery(ownerId: number, notebookId = '') {
  const query = db.vocabCards.where('[ownerId+due]').between([ownerId, new Date(0)], [ownerId, new Date()], true, true)
  return notebookId ? query.and(card => Boolean(card.notebookIds?.includes(notebookId))) : query
}
