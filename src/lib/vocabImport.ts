export const MAX_VOCAB_IMPORT = 80

export function normalizeVocabEntry(value: string): string {
  return value.normalize('NFKC').replace(/[’‘ʼ]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function parseVocabLines(text: string) {
  const words: string[] = []
  const seen = new Set<string>()
  const invalid: { line: number; text: string }[] = []
  let duplicates = 0
  text.split(/\r\n?|\n|\u2028|\u2029/).forEach((raw, index) => {
    if (!raw.trim()) return
    const word = normalizeVocabEntry(raw.replace(/^\s*(?:\d{1,3}[.)、]\s*|[-*•]\s+)/, ''))
    if (!/^[a-z(][a-z' .()/\-]{0,99}$/.test(word) || !/[a-z]/.test(word)) {
      invalid.push({ line: index + 1, text: raw.trim() })
    } else if (seen.has(word)) {
      duplicates++
    } else {
      seen.add(word)
      words.push(word)
    }
  })
  return { words, duplicates, invalid, overLimit: words.length > MAX_VOCAB_IMPORT }
}
