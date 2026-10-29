import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, getCurrentOwnerId, type VocabCard, type Rating } from '../db'
import { Plus, Trash2, RefreshCw, Loader2, Sparkles, CheckCircle2, CalendarDays } from 'lucide-react'
import clsx from 'clsx'
import { fsrs, generatorParameters, type Card, type Grade, type RecordLogItem } from 'ts-fsrs'
import { lookupWord, type LookupResult } from '../services/api'
import { getToday } from '../lib/date'
import { VocabListRow } from '../components/VocabListRow'
import { VocabPager } from '../components/VocabPager'
import { useVocabPage } from '../hooks/useVocabPage'
import { VOCAB_PAGE_SIZE, vocabDueQuery, vocabSummary } from '../lib/vocabQueries'
import { VocabPlansPanel } from '../components/VocabPlansPanel'
import { useWordMistakes } from '../hooks/useWordMistakes'
import { normalizeVocabEntry } from '../lib/vocabImport'
import { WordSpeaker } from '../components/WordSpeaker'

const params = generatorParameters({ enable_fuzz: true })
const f = fsrs(params)

const COIN_PER_REVIEW = 1

export function VocabPage() {
  const navigate = useNavigate()
  const ownerId = getCurrentOwnerId()
  const [editingCard, setEditingCard] = useState<VocabCard | null>(null)
  const [selectedDate, setSelectedDate] = useState(getToday())
  const [selectedNotebook, setSelectedNotebook] = useState('')
  const notebooks = useLiveQuery(() => db.vocabNotebooks.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const [studyMode, setStudyMode] = useState(false)
  const [currentCard, setCurrentCard] = useState<VocabCard | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [studyQueue, setStudyQueue] = useState<VocabCard[]>([])
  const [studyIndex, setStudyIndex] = useState(0)
  const [reviewedCount, setReviewedCount] = useState(0)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [ratingInProgress, setRatingInProgress] = useState(false)

  const summary = useLiveQuery(() => vocabSummary(ownerId), [ownerId])
  const { cards, total: filteredTotal, page, setPage, loading: cardsLoading } = useVocabPage(ownerId, selectedNotebook, selectedDate)
  const mistakes = useWordMistakes(ownerId, cards)
  const dueCount = useLiveQuery(() => vocabDueQuery(ownerId).count(), [ownerId])

  const handleSaveWord = async (
    word: string,
    translation: string,
    partOfSpeech?: string,
    exampleSentence?: string,
    phonetic?: string,
    tags?: string[],
    exchange?: string,
    exampleTranslation?: string,
  ) => {
    if (!word.trim() || !translation.trim()) return
    const normalized = word.trim().toLocaleLowerCase()
    const duplicate = await db.vocabCards.where('ownerId').equals(ownerId)
      .filter(card => card.id !== editingCard?.id && card.word.trim().toLocaleLowerCase() === normalized)
      .first()
    if (duplicate) throw new Error('这个单词已经在单词本中了')

    const values = {
      word: word.trim(),
      translation: translation.trim(),
      partOfSpeech: partOfSpeech?.trim(),
      exampleSentence: exampleSentence?.trim(),
      phonetic: phonetic?.trim(),
      tags: tags ?? [],
      exchange: exchange?.trim(),
      exampleTranslation: exampleTranslation?.trim(),
    }
    if (editingCard?.id) {
      await db.vocabCards.update(editingCard.id, values)
    } else {
      await db.vocabCards.add({
        ownerId,
        ...values,
        tags: [],
        due: new Date(),
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        state: 0,
        createdAt: new Date().toISOString(),
      })
    }
    setEditingCard(null)
  }

  const handleRate = async (rating: Rating) => {
    if (!currentCard?.id || ratingInProgress) return
    setRatingInProgress(true)

    // Use FSRS to compute next review date
    const now = new Date()
    const card: Card = {
      due: currentCard.due,
      stability: currentCard.stability,
      difficulty: currentCard.difficulty,
      elapsed_days: currentCard.elapsedDays,
      scheduled_days: currentCard.scheduledDays,
      learning_steps: 0,
      reps: currentCard.reps,
      lapses: currentCard.lapses,
      state: currentCard.state,
      last_review: currentCard.lastReview ?? now,
    }

    const grade: Grade = (rating === 1 ? 1 : rating === 2 ? 2 : rating === 3 ? 3 : 4) as Grade
    const schedulingCards = f.repeat(card, now) as unknown as Record<string, RecordLogItem>
    const result = schedulingCards[String(grade)]

    const newState = result.card.state as 0 | 1 | 2 | 3
    const newDue = result.card.due

    try {
      await db.transaction('rw', db.vocabCards, db.reviewLogs, db.coinRecords, async () => {
        await db.vocabCards.update(currentCard.id!, {
        due: newDue,
        stability: result.card.stability,
        difficulty: result.card.difficulty,
        elapsedDays: result.card.elapsed_days,
        scheduledDays: result.card.scheduled_days,
        reps: result.card.reps,
        lapses: result.card.lapses,
        state: newState,
        lastReview: now,
        })
        await db.reviewLogs.add({ ownerId, cardId: currentCard.id!, rating, reviewedAt: now })
        await db.coinRecords.add({
          ownerId,
          amount: COIN_PER_REVIEW,
          source: 'vocab_review',
          date: now.toISOString().slice(0, 10),
          description: `复习单词：${currentCard.word}`,
        })
      })

      setFlipped(false)
      const nextIndex = studyIndex + 1
      setReviewedCount(count => count + 1)
      if (nextIndex < studyQueue.length) {
        setStudyIndex(nextIndex)
        setCurrentCard(studyQueue[nextIndex])
      } else {
        setCurrentCard(null)
        setSessionComplete(true)
      }
    } finally {
      setRatingInProgress(false)
    }
  }

  const startStudy = () => {
    if (!dueCount) return
    navigate('/vocab/study?review=1')
  }

  const handleNext = () => {
    if (!currentCard) return
    const nextIndex = studyIndex + 1
    if (nextIndex < studyQueue.length) {
      setStudyIndex(nextIndex)
      setCurrentCard(studyQueue[nextIndex])
      setFlipped(false)
    } else {
      setCurrentCard(null)
      setSessionComplete(true)
    }
  }

  if (studyMode && sessionComplete) {
    return (
      <div className="p-5 h-full flex flex-col items-center justify-center text-center gap-4">
        <CheckCircle2 size={64} className="text-emerald-500" />
        <div>
          <h1 className="text-2xl font-bold">本轮复习完成</h1>
          <p className="text-sm text-zinc-400 mt-2">复习 {reviewedCount} 个单词，获得 {reviewedCount * COIN_PER_REVIEW} 金币</p>
        </div>
        <button onClick={() => { setStudyMode(false); setSessionComplete(false) }} className="btn-primary w-full max-w-xs">
          返回单词本
        </button>
      </div>
    )
  }

  // Study mode screen
  if (studyMode && currentCard) {
    return (
      <div className="p-5 h-full flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => { setStudyMode(false); setCurrentCard(null) }}
            className="btn-ghost text-sm"
          >
            ← 退出
          </button>
          <span className="text-xs text-zinc-400">
            {studyIndex + 1} / {studyQueue.length}
          </span>
        </div>

        {/* Flashcard */}
        <div className="flex-1 flex items-center justify-center">
          <button
            onClick={() => setFlipped(!flipped)}
            className="w-full max-w-sm aspect-[4/3] card flex flex-col items-center justify-center gap-4 cursor-pointer hover:shadow-lg transition-all perspective-1000"
          >
            <div className="flex items-center gap-2">
              <span className="text-4xl font-bold">{currentCard.word}</span>
              {currentCard.partOfSpeech && (
                <span className="text-xs text-brand-500 bg-brand-50 dark:bg-brand-950 px-2 py-0.5 rounded-full">
                  {currentCard.partOfSpeech}
                </span>
              )}
            </div>
            {currentCard.phonetic && <span className="text-sm text-zinc-400 font-mono">/{currentCard.phonetic.replace(/^\/+|\/+$/g, '')}/</span>}
            {flipped ? (
              <>
                <span className="text-lg text-zinc-500">{currentCard.translation}</span>
                {currentCard.tags.length > 0 && <div className="flex flex-wrap justify-center gap-1">{currentCard.tags.map(tag => <span key={tag} className="text-[10px] px-2 py-0.5 rounded bg-brand-50 dark:bg-brand-950 text-brand-500">{formatTag(tag)}</span>)}</div>}
                {currentCard.exchange && <p className="text-xs text-zinc-400 text-center px-4">{currentCard.exchange}</p>}
                {currentCard.exampleSentence && (
                  <p className="text-xs text-zinc-400 italic text-center px-4">
                    {currentCard.exampleSentence}
                  </p>
                )}
                <p className="text-[10px] text-zinc-300 mt-2">点击翻转</p>
              </>
            ) : (
              <p className="text-sm text-zinc-400">点击查看释义 →</p>
            )}
          </button>
        </div>

        {/* Rating buttons */}
        {flipped && (
          <div className="flex gap-2 mt-4">
            {[
              { rating: 1 as Rating, label: '忘了', color: 'bg-red-500' },
              { rating: 2 as Rating, label: '模糊', color: 'bg-orange-500' },
              { rating: 3 as Rating, label: '熟悉', color: 'bg-emerald-500' },
              { rating: 4 as Rating, label: '简单', color: 'bg-blue-500' },
            ].map(({ rating, label, color }) => (
              <button
                key={rating}
                onClick={() => handleRate(rating)}
                disabled={ratingInProgress}
                className={`${color} text-white flex-1 py-3 rounded-xl text-sm font-medium active:scale-95 transition-all disabled:opacity-50`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {flipped && (
          <button onClick={handleNext} className="btn-ghost w-full mt-2 text-sm">
            跳过 →
          </button>
        )}
      </div>
    )
  }

  // Main list view
  return (
    <div data-vocab-page-region className="p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold">背单词</h1><p className="text-xs text-zinc-400 mt-1">先检测，再学习真正不会的词</p></div>
        <button onClick={() => navigate(selectedNotebook && selectedNotebook !== 'unfiled' ? `/vocab/add?notebookId=${encodeURIComponent(selectedNotebook)}` : '/vocab/add')} className="btn-primary text-sm flex items-center gap-1 !px-4 !py-2">
          <Plus size={16} />
          添加
        </button>
      </div>

      <div className="card !p-4 space-y-3">
        <div className="flex items-center justify-between"><div><p className="text-sm font-semibold">我的单词本</p><p className="text-xs text-zinc-400 mt-1">{notebooks?.length ?? 0}个本子 · 自由分类，按本背词</p></div><button className="text-sm text-brand-500" onClick={() => navigate('/vocab/notebooks')}>管理 / 新建</button></div>
        <select aria-label="筛选单词本" value={selectedNotebook} onChange={event => { setSelectedNotebook(event.target.value); setSelectedDate('') }} className="input">
          <option value="">全部单词</option><option value="unfiled">未分组</option>{notebooks?.map(book => <option key={book.id} value={book.id}>{book.name}（{summary?.notebooks[book.id] ?? '…'}词）</option>)}
        </select>
        {selectedNotebook && selectedNotebook !== 'unfiled' && <div className="grid grid-cols-2 gap-2"><button className="btn-primary" onClick={() => navigate(`/vocab/plan?bookId=${encodeURIComponent(`notebook:${selectedNotebook}`)}`)}>背这个单词本</button><button className="btn-ghost" onClick={() => navigate(`/vocab/notebooks?id=${encodeURIComponent(selectedNotebook)}`)}>查看 / 管理收录</button></div>}
      </div>

      <button onClick={() => navigate('/vocab/mistakes')} className="card w-full !p-4 text-left border-red-100 dark:border-red-950"><p className="font-semibold text-sm">错词本 →</p><p className="text-xs text-zinc-400 mt-1">查看错误答案、累计次数，专项巩固薄弱词</p></button>
      <VocabPlansPanel notebooks={notebooks} notebookCounts={summary?.notebooks} />

      {/* Stats bar */}
      <div className="flex gap-3">
        <div className="card flex-1 flex items-center justify-between !p-3">
          <span className="text-xs text-zinc-500">全部单词</span>
          <span className="text-sm font-bold">{summary?.total ?? '…'}</span>
        </div>
        <div className="card flex-1 flex items-center justify-between !p-3 bg-brand-50 dark:bg-brand-950 border-brand-200 dark:border-brand-900">
          <span className="text-xs text-brand-600 dark:text-brand-400">待复习</span>
          <span className="text-sm font-bold text-brand-600 dark:text-brand-400">{dueCount ?? '…'}</span>
        </div>
        <button
          onClick={startStudy}
          disabled={!dueCount}
          className="btn-primary text-sm flex items-center gap-1 !px-4 !py-2 disabled:opacity-50"
        >
          <RefreshCw size={14} />
          {dueCount ? `复习到期单词（${dueCount}）` : '今日复习已完成'}
        </button>
      </div>

      {/* 日期筛选 */}
      <div className="card !p-3 flex items-center gap-3">
        <CalendarDays size={18} className="text-brand-500 shrink-0" />
        <input
          type="date"
          value={selectedDate}
          max={getToday()}
          onChange={event => setSelectedDate(event.target.value)}
          className="input !py-2 min-w-0 flex-1"
          aria-label="按添加日期筛选单词"
        />
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-brand-600 dark:text-brand-400">{cardsLoading ? '…' : filteredTotal} 个</p>
          <p className="text-[10px] text-zinc-400">{selectedDate === getToday() ? '今日新增' : '当天新增'}</p>
        </div>
        <button
          onClick={() => setSelectedDate('')}
          className={clsx(
            'px-3 py-2 rounded-lg text-xs font-medium shrink-0',
            selectedDate ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500' : 'bg-brand-500 text-white'
          )}
        >
          全部
        </button>
      </div>

      {/* Add form */}
      {editingCard && (
        <AddWordForm
          card={editingCard}
          onSave={handleSaveWord}
          onClose={() => setEditingCard(null)}
        />
      )}

      {/* Word list */}
      <div data-vocab-list-start />
      <VocabPager page={page} total={filteredTotal} size={VOCAB_PAGE_SIZE} onChange={setPage} disabled={cardsLoading} />
      <div className="space-y-1.5">
        {cardsLoading && <p role="status" className="py-6 text-center text-sm text-zinc-400">正在读取单词…</p>}
        {!cardsLoading && filteredTotal === 0 && (
          <div className="card text-center py-10">
            <p className="text-zinc-400 text-sm">
              {selectedDate ? '这一天还没有添加单词' : '还没有单词，点击右上角添加吧 📝'}
            </p>
          </div>
        )}
        {cards.map(card => <VocabListRow key={card.id} card={card} mistakes={mistakes?.get(normalizeVocabEntry(card.word))} notebookId={selectedNotebook && selectedNotebook !== 'unfiled' ? selectedNotebook : undefined} onEdit={setEditingCard} />)}
      </div>
      <VocabPager page={page} total={filteredTotal} size={VOCAB_PAGE_SIZE} onChange={setPage} disabled={cardsLoading} />
    </div>
  )
}

function AddWordForm({
  card,
  onSave,
  onClose,
}: {
  card: VocabCard | null
  onSave: (word: string, translation: string, pos?: string, example?: string, phonetic?: string, tags?: string[], exchange?: string, exampleTranslation?: string) => Promise<void>
  onClose: () => void
}) {
  const [word, setWord] = useState(card?.word ?? '')
  const [phonetic, setPhonetic] = useState(card?.phonetic ?? '')
  const [translation, setTranslation] = useState(card?.translation ?? '')
  const [pos, setPos] = useState(card?.partOfSpeech ?? '')
  const [posCn, setPosCn] = useState('')
  const [example, setExample] = useState(card?.exampleSentence ?? '')
  const [exampleTranslation, setExampleTranslation] = useState(card?.exampleTranslation ?? '')
  const [tags, setTags] = useState<string[]>(card?.tags ?? [])
  const [exchange, setExchange] = useState(card?.exchange ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lookedUp, setLookedUp] = useState(Boolean(card))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setError('')
    setSaving(true)
    try {
      await onSave(word, translation, pos, example, phonetic, tags, exchange, exampleTranslation)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleLookup = async () => {
    if (!word.trim()) return
    setLoading(true)
    setError('')
    setLookedUp(false)
    try {
      const result: LookupResult = await lookupWord(word.trim())
      setPhonetic(result.phonetic)
      setTranslation(result.translation)
      setPos(result.pos)
      setPosCn(result.posCn)
      setExample(result.example)
      setExampleTranslation(result.exampleTranslation)
      setTags(result.tags ?? [])
      setExchange(result.exchange ?? '')
      setLookedUp(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '查询失败')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      e.preventDefault()
      handleLookup()
    }
  }

  return (
    <div className="card space-y-3 !p-4">
      <div className="flex items-center justify-between"><span className="text-sm font-semibold">单词详情</span><WordSpeaker word={word} /></div>
      {/* 单词输入 + 查询按钮 */}
      <div className="flex gap-2">
        <input
          value={word}
          onChange={e => {
            setWord(e.target.value)
            setLookedUp(false)
            setError('')
          }}
          onKeyDown={handleKeyDown}
          className="input flex-1"
          placeholder="输入英文单词"
          autoFocus
        />
        <button
          onClick={handleLookup}
          disabled={loading || !word.trim()}
          className="btn-primary text-sm flex items-center gap-1.5 !px-4 !py-2.5 shrink-0 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          查询
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* 查询结果 */}
      {lookedUp && !error && (
        <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-3 space-y-3">
          {/* 音标 */}
          {phonetic && (
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-zinc-400 shrink-0">音标</label>
              <span className="text-sm text-zinc-500 font-mono">{phonetic}</span>
            </div>
          )}

          {/* 释义 */}
          <div>
            <label className="text-[10px] text-zinc-400 block mb-1">释义</label>
            <input
              value={translation}
              onChange={e => setTranslation(e.target.value)}
              className="input !py-2 text-sm"
              placeholder="中文释义"
            />
          </div>

          {/* 词性 */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-zinc-400 shrink-0">词性</label>
            <span className="text-xs bg-brand-100 dark:bg-brand-900 text-brand-600 dark:text-brand-400 px-2 py-0.5 rounded font-medium">
              {posCn || pos}
            </span>
          </div>

          {/* 例句 */}
          <div>
            <label className="text-[10px] text-zinc-400 block mb-1">例句</label>
            <input
              value={example}
              onChange={e => setExample(e.target.value)}
              className="input !py-2 text-sm"
              placeholder="英文例句"
            />
            {exampleTranslation && (
              <p className="text-xs text-zinc-400 mt-1 px-1">{exampleTranslation}</p>
            )}
          </div>
          <div><label className="text-[10px] text-zinc-400 block mb-1">标签</label><div className="flex flex-wrap gap-1">{tags.length ? tags.map(tag => <span key={tag} className="text-[10px] px-2 py-0.5 rounded bg-brand-50 dark:bg-brand-950 text-brand-600">{formatTag(tag)}</span>) : <span className="text-xs text-zinc-300">暂无标签</span>}</div></div>
          <div><label className="text-[10px] text-zinc-400 block mb-1">词形变化</label><input value={exchange} onChange={event => setExchange(event.target.value)} className="input !py-2 text-xs" placeholder="暂无词形变化" /></div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-2 pt-1">
        <button onClick={onClose} className="btn-ghost flex-1 text-sm">取消</button>
        <button
          onClick={() => void handleSave()}
          disabled={!translation.trim() || saving}
          className="btn-primary flex-1 text-sm disabled:opacity-50"
        >
          {card ? '保存修改' : '保存'}
        </button>
      </div>
    </div>
  )
}

function formatTag(tag: string) {
  return ({ zk: '中考', gk: '高考', cet4: '四级', cet6: '六级', ky: '考研', ielts: '雅思', toefl: '托福', gre: 'GRE' } as Record<string, string>)[tag] ?? tag
}
