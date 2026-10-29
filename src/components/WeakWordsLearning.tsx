import { useState } from 'react'
import type { VocabSessionWord } from '../db'
import { WordSpeaker } from './WordSpeaker'
import { stopWordSpeech } from '../services/wordSpeech'

export function WeakWordsLearning({ words, auto }: { words: VocabSessionWord[]; auto: boolean }) {
  const [index, setIndex] = useState(0)
  const current = words[Math.min(index, words.length - 1)]
  if (!current) return null
  return <section className="card !p-4 space-y-3">
    <div className="flex items-center gap-2"><p className="text-xl font-bold break-words flex-1">{current.word}</p><WordSpeaker key={current.word} word={current.word} auto={auto} /></div>
    {current.pos && <p className="text-xs text-brand-500">{current.pos}</p>}
    {current.phonetic && <p className="text-xs text-zinc-400">/{current.phonetic.replace(/^\/+|\/+$/g, '')}/</p>}
    <p className="text-sm">{current.translation}</p>
    {current.exchange && <p className="text-xs text-zinc-400">{current.exchange}</p>}
    <div className="flex justify-between items-center text-xs"><button className="btn-ghost disabled:opacity-30" disabled={index === 0} onClick={() => { stopWordSpeech(); setIndex(value => value - 1) }}>上一个词</button><span>{index + 1}/{words.length}词</span><button className="btn-ghost disabled:opacity-30" disabled={index + 1 >= words.length} onClick={() => { stopWordSpeech(); setIndex(value => value + 1) }}>下一个词</button></div>
  </section>
}
