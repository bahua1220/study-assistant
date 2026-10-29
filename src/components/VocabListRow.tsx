import { memo } from 'react'
import { Pencil } from 'lucide-react'
import clsx from 'clsx'
import type { VocabCard } from '../db'
import { VocabWordDelete } from './VocabWordDelete'
import { WordSpeaker } from './WordSpeaker'
import type { WordMistakes } from '../lib/vocabMistakes'

const STATES = ['新学', '学习中', '复习', '重学']
const COLORS = ['bg-zinc-100 dark:bg-zinc-800 text-zinc-500', 'bg-orange-100 dark:bg-orange-900 text-orange-600', 'bg-emerald-100 dark:bg-emerald-900 text-emerald-600', 'bg-red-100 dark:bg-red-900 text-red-500']
const TAGS: Record<string, string> = { zk: '中考', gk: '高考', cet4: '四级', cet6: '六级', ky: '考研', ielts: '雅思', toefl: '托福', gre: 'GRE' }

// An edit dialog or header update must not redraw every unchanged word card.
export const VocabListRow = memo(function VocabListRow({ card, notebookId, onEdit, mistakes }: {
  card: VocabCard; notebookId?: string; onEdit: (card: VocabCard) => void; mistakes?: WordMistakes
}) {
  return <VocabWordDelete card={card} notebookId={notebookId} className="card flex items-center gap-3 !p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium truncate">{card.word}</p>
        {card.word.trim().split(/\s+/).length > 1 && <span className="text-[10px] text-zinc-400 shrink-0">短语</span>}
        {card.partOfSpeech && <span className="text-[10px] text-brand-500 bg-brand-50 dark:bg-brand-950 px-1.5 py-0.5 rounded shrink-0">{card.partOfSpeech}</span>}
      </div>
      <p className="text-xs text-zinc-400 truncate">{card.translation}</p>
      {mistakes && <p className="text-[10px] text-red-500 mt-1">累计错{mistakes.errors}次 · 释义{mistakes.choiceErrors} / 拼写{mistakes.spellingErrors}</p>}
      {card.phonetic && <p className="text-[10px] text-zinc-400 font-mono mt-0.5">/{card.phonetic.replace(/^\/+|\/+$/g, '')}/</p>}
      {(card.tags.length > 0 || card.exchange) && <div className="flex flex-wrap gap-1 mt-1">
        {card.tags.slice(0, 4).map(tag => <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-brand-50 dark:bg-brand-950 text-brand-500">{TAGS[tag] ?? tag}</span>)}
        {card.exchange && <span className="text-[9px] text-zinc-400 truncate max-w-full">{card.exchange}</span>}
      </div>}
    </div>
    <WordSpeaker word={card.word} />
    <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0', COLORS[card.state])}>{STATES[card.state]}</span>
    <button onClick={() => onEdit(card)} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-brand-500" aria-label="编辑单词"><Pencil size={12} /></button>
  </VocabWordDelete>
})
