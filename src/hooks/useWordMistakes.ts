import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { summarizeMistakes } from '../lib/vocabMistakes'
import { normalizeVocabEntry } from '../lib/vocabImport'

/** Only fetch evidence for the mounted page, not every word's history. */
export function useWordMistakes(ownerId: number, cards: { word: string }[]) {
  const key = JSON.stringify([...new Set(cards.flatMap(card => [card.word, normalizeVocabEntry(card.word)]))])
  return useLiveQuery(async () => {
    const words = JSON.parse(key) as string[]
    return summarizeMistakes(words.length ? await db.vocabAttempts.where('[ownerId+word]').anyOf(words.map(word => [ownerId, word])).toArray() : [])
  }, [ownerId, key])
}
