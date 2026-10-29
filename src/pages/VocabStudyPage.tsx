import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Loader2, LockKeyhole, RotateCcw, XCircle } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { db, getCurrentOwnerId, type VocabLearningSession, type VocabSessionWord } from '../db'
import { getVocabBookWords } from '../services/api'
import { normalizeSpelling, spellingTimeLimit } from '../lib/vocabScheduler'
import { startFocusLock, stopFocusLock } from '../services/focusLock'
import clsx from 'clsx'
import { isNotebookBook, notebookIdFromBook, sessionWords, shuffled, wordKey } from '../lib/vocabNotebooks'
import { assertActiveRound, requireStudyPlan } from '../lib/vocabPlans'
import { assignQuestionModes, questionMode, retestWords } from '../lib/vocabLearning'
import { commitStudyAnswer, finishStudyRound, studyReward } from '../lib/vocabStudyRecords'
import { summarizeMistakes } from '../lib/vocabMistakes'
import { normalizeVocabEntry } from '../lib/vocabImport'
import { WordSpeaker } from '../components/WordSpeaker'
import { stopWordSpeech } from '../services/wordSpeech'
import { useWordMistakes } from '../hooks/useWordMistakes'
import { WeakWordsLearning } from '../components/WeakWordsLearning'

const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

export function VocabStudyPage() {
  const ownerId = getCurrentOwnerId()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [session, setSession] = useState<VocabLearningSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [answer, setAnswer] = useState('')
  const [remaining, setRemaining] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | 'timeout' | null>(null)
  const [pendingNext, setPendingNext] = useState<VocabLearningSession | null>(null)
  const [autoRead, setAutoRead] = useState(() => localStorage.getItem('vocab_auto_read') === '1')
  const questionStartedAt = useRef(Date.now())
  const submittingRef = useRef(false)
  const exitTimer = useRef<number | null>(null)
  const initDone = useRef(false)

  const weakWords = useMemo(() => session?.words.filter(word => word.firstCorrect !== true) ?? [], [session])
  const retestQueue = session?.retestQueue ?? weakWords.map(word => word.word)
  const current = session
    ? session.phase === 'retest' ? session.words.find(word => word.word === retestQueue[session.currentIndex]) : session.words[session.currentIndex]
    : undefined
  const mode = session && current ? questionMode(session, current) : 'spelling'
  const timeLimit = current ? (mode === 'choice' ? 6 : spellingTimeLimit(current.word)) : 0
  const errorStats = useWordMistakes(ownerId, current ? [current] : [])

  useEffect(() => {
    const stop = () => { if (document.visibilityState === 'hidden') stopWordSpeech() }
    document.addEventListener('visibilitychange', stop)
    return () => { stopWordSpeech(); document.removeEventListener('visibilitychange', stop) }
  }, [])

  useEffect(() => {
    if (initDone.current) return
    initDone.current = true
    void initialize()
  }, [])

  useEffect(() => {
    if (!session?.focusLock || session.status !== 'active') return
    void startFocusLock()
    return () => { void stopFocusLock() }
  }, [session?.id, session?.focusLock, session?.status])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (session?.status === 'active') event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [session?.status])

  useEffect(() => {
    const trackInterruption = () => {
      if (document.visibilityState !== 'hidden' || !session || session.status !== 'active' || !['screening', 'retest'].includes(session.phase)) return
      if (submittingRef.current || pendingNext) return
      void db.transaction('rw', db.vocabPlans, db.vocabSessions, async () => {
        const saved = await assertActiveRound(ownerId, session.id)
        const next = { ...saved, interruptions: saved.interruptions + 1, updatedAt: new Date().toISOString() }
        await db.vocabSessions.put(next)
        setSession(next)
      }).catch(cause => setError(cause instanceof Error ? cause.message : '进度保存失败'))
    }
    document.addEventListener('visibilitychange', trackInterruption)
    return () => document.removeEventListener('visibilitychange', trackInterruption)
  }, [session, pendingNext, ownerId])

  const initialize = async () => {
    try {
      const requestedSession = params.get('sessionId')
      const planId = params.get('planId')
      if (requestedSession) {
        const saved = await db.vocabSessions.get(requestedSession)
        if (!saved || saved.ownerId !== ownerId || saved.status !== 'active') throw new Error('未找到可继续的学习记录')
        if (saved.planId) await requireStudyPlan(ownerId, saved.planId)
        setSession(saved); return
      }
      if (params.get('mistakes') === '1') {
        const scope = JSON.stringify([params.get('book') ?? '', params.get('kind') ?? '', params.get('mastery') ?? 'pending'])
        const existing = await db.vocabSessions.where('[ownerId+status]').equals([ownerId, 'active']).filter(saved => saved.bookId === 'mistakes' && saved.mistakeScope === scope).first()
        if (existing) { setSession(existing); return }
        const attempts = await db.vocabAttempts.where('ownerId').equals(ownerId).toArray()
        const book = params.get('book'), kind = params.get('kind'), mastery = params.get('mastery') ?? 'pending'
        const mistakes = [...summarizeMistakes(attempts).values()].filter(item => (!book || item.bookIds.includes(book))
          && (!kind || (kind === 'choice' ? item.choiceErrors : item.spellingErrors) > 0)
          && (mastery === 'all' || item.mastered === (mastery === 'mastered')))
        const keys = new Set(mistakes.map(item => item.word))
        const pool = await db.vocabCards.where('ownerId').equals(ownerId).toArray()
        const members = shuffled(pool.filter(card => keys.has(normalizeVocabEntry(card.word)) && card.translation.trim())).slice(0, 30)
        if (!members.length) throw new Error('没有可练习的错词；历史作答仍保留在错词本中')
        const created = makeSession({ ownerId, words: sessionWords(members, pool), bookId: 'mistakes', bookName: '错词专项巩固', testMode: kind === 'spelling' ? 'spelling' : kind === 'choice' ? 'choice' : 'mixed', focusLock: false, sourceOffset: 0, nextOffset: 0, mistakeScope: scope })
        await db.vocabSessions.put(created); setSession(created); return
      }
      const reviewNotebookId = params.get('notebookId')
      const reviewing = params.get('review') === '1'
      if (!reviewing && planId) await requireStudyPlan(ownerId, planId)
      const reviewBookId = reviewNotebookId ? `review:${reviewNotebookId}` : 'review'
      const existing = await db.vocabSessions.where('[ownerId+status]').equals([ownerId, 'active'])
        .filter(saved => reviewing ? saved.bookId === reviewBookId : saved.planId === planId).first()
      if (existing) { setSession(existing); return }

      if (reviewing) {
        const notebook = reviewNotebookId ? await db.vocabNotebooks.get(reviewNotebookId) : undefined
        if (reviewNotebookId && (!notebook || notebook.ownerId !== ownerId)) throw new Error('单词本不存在')
        const due = (await db.vocabCards.where('[ownerId+due]').between([ownerId, DexieMinDate], [ownerId, new Date()], true, true).toArray()).filter(card => !reviewNotebookId || card.notebookIds?.includes(reviewNotebookId)).sort((a, b) => a.due.getTime() - b.due.getTime()).slice(0, 30)
        if (!due.length) throw new Error('目前没有待复习单词')
        const pool = await db.vocabCards.where('ownerId').equals(ownerId).toArray()
        const words = sessionWords(due, pool)
        const created = makeSession({ ownerId, words, bookId: reviewBookId, bookName: notebook ? `${notebook.name} · 到期复习` : '到期单词复习', testMode: 'mixed', focusLock: true, sourceOffset: 0, nextOffset: 0 })
        await db.vocabSessions.put(created); setSession(created); return
      }

      if (!planId) throw new Error('请先选择词书和学习计划')
      const plan = await requireStudyPlan(ownerId, planId)
      if (isNotebookBook(plan.bookId)) {
        const notebookId = notebookIdFromBook(plan.bookId)
        const notebook = await db.vocabNotebooks.get(notebookId)
        if (!notebook || notebook.ownerId !== ownerId) throw new Error('单词本不存在')
        const pool = await db.vocabCards.where('ownerId').equals(ownerId).toArray()
        const members = pool.filter(card => card.notebookIds?.includes(notebookId) && card.translation.trim())
        if (!members.length) throw new Error('这个单词本还没有单词，请先添加')
        const studied = new Set(plan.studiedWords ?? [])
        let available = members.filter(card => !studied.has(wordKey(card.word)))
        const restarting = !available.length
        if (restarting) available = members
        const words = sessionWords(shuffled(available).slice(0, plan.batchSize), pool)
        const sourceOffset = restarting ? 0 : members.length - available.length
        const created = makeSession({ ownerId, planId: plan.id, words, bookId: plan.bookId, bookName: notebook.name, testMode: plan.testMode, focusLock: plan.focusLock, sourceOffset, nextOffset: sourceOffset + words.length })
        await db.transaction('rw', db.vocabPlans, db.vocabSessions, async () => {
          await requireStudyPlan(ownerId, plan.id)
          await db.vocabPlans.update(plan.id, { wordCount: members.length, cursor: sourceOffset, ...(restarting ? { studiedWords: [] } : {}) })
          await db.vocabSessions.put(created)
        })
        setSession(created); return
      }
      const shuffleSeed = plan.shuffleSeed || uuid()
      if (!plan.shuffleSeed) await db.vocabPlans.update(plan.id, { shuffleSeed })
      const batch = await getVocabBookWords(plan.bookId, plan.cursor, plan.batchSize, shuffleSeed)
      if (!batch.words.length) throw new Error('这本词书已经学完了')
      const created = makeSession({ ownerId, planId: plan.id, words: batch.words, bookId: plan.bookId, bookName: plan.bookName, testMode: plan.testMode, focusLock: plan.focusLock, sourceOffset: plan.cursor, nextOffset: batch.nextOffset })
      await db.transaction('rw', db.vocabPlans, db.vocabSessions, async () => {
        await requireStudyPlan(ownerId, plan.id)
        await db.vocabSessions.put(created)
      }); setSession(created)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '学习任务加载失败') }
    finally { setLoading(false) }
  }

  const saveSession = async (next: VocabLearningSession) => {
    next.updatedAt = new Date().toISOString()
    await db.transaction('rw', db.vocabPlans, db.vocabSessions, async () => {
      const saved = await assertActiveRound(ownerId, next.id)
      if (!session || saved.phase !== session.phase || saved.currentIndex !== session.currentIndex || (saved.answerRevision ?? 0) !== (session.answerRevision ?? 0)) throw new Error('轮次进度已变化，请退出后继续本轮')
      next.interruptions = saved.interruptions
      await db.vocabSessions.put(next)
    })
    setSession(next)
  }

  const answerQuestion = useCallback(async (value: string, timedOut = false) => {
    if (!session || !current || submittingRef.current || pendingNext || !['screening', 'retest'].includes(session.phase)) return
    submittingRef.current = true; setSubmitting(true)
    const elapsedMs = Math.min(timeLimit * 1000, Date.now() - questionStartedAt.current)
    const correct = !timedOut && (mode === 'choice' ? value === current.translation : normalizeSpelling(value) === normalizeSpelling(current.word))
    try {
      const next = await commitStudyAnswer(session, ownerId, value, correct, timedOut, elapsedMs, timeLimit * 1000)
      setFeedback(timedOut ? 'timeout' : correct ? 'correct' : 'wrong')
      if (next.status === 'completed') await stopFocusLock()
      if (session.rulesVersion === 2) setPendingNext(next)
      else {
        await new Promise(resolve => setTimeout(resolve, 450))
        setSession(next); setAnswer(''); setFeedback(null)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '答案保存失败') }
    finally { submittingRef.current = false; setSubmitting(false) }
  }, [session, current, ownerId, mode, timeLimit, pendingNext])

  useEffect(() => {
    if (!current || !session || feedback || pendingNext || !['screening', 'retest'].includes(session.phase)) return
    setAnswer(''); setFeedback(null); setRemaining(timeLimit); questionStartedAt.current = Date.now()
    const deadline = Date.now() + timeLimit * 1000
    const timer = window.setInterval(() => {
      const left = Math.max(0, (deadline - Date.now()) / 1000)
      setRemaining(left)
      if (left <= 0) { window.clearInterval(timer); void answerQuestion('', true) }
    }, 100)
    return () => window.clearInterval(timer)
  }, [session?.id, session?.phase, session?.currentIndex, current?.word, timeLimit, feedback, pendingNext])

  const completeSession = async (value: VocabLearningSession) => {
    const completed = await finishStudyRound(ownerId, value.id)
    setSession(completed); await stopFocusLock()
  }

  const beginRetest = async () => {
    if (!session) return
    try {
      const words = retestWords(session)
      if (!words.length) { await completeSession(session); return }
      await saveSession({ ...session, phase: 'retest', currentIndex: 0, retestRound: session.retestRound ?? 1, retestQueue: words.map(word => word.word) })
    } catch (cause) { setError(cause instanceof Error ? cause.message : '轮次已失效，请返回计划列表') }
  }

  const abandon = async () => {
    if (!session) { navigate('/vocab', { replace: true }); return }
    if (!window.confirm('退出会保留当前进度，但本轮专注奖励失效。确定退出吗？')) return
    await db.vocabSessions.where('[ownerId+status]').equals([ownerId, 'active']).filter(value => value.id === session.id).modify({ focusLock: false, updatedAt: new Date().toISOString() })
    await stopFocusLock(); navigate('/vocab', { replace: true })
  }

  useEffect(() => () => { if (exitTimer.current) window.clearTimeout(exitTimer.current) }, [])
  const startExitHold = () => { if (exitTimer.current) window.clearTimeout(exitTimer.current); exitTimer.current = window.setTimeout(() => void abandon(), 3000) }
  const cancelExitHold = () => { if (exitTimer.current) window.clearTimeout(exitTimer.current); exitTimer.current = null }

  if (loading) return <Center><Loader2 className="animate-spin text-brand-500" size={30} /><p>正在准备本轮词汇…</p></Center>
  if (error && !session) return <Center><AlertTriangle className="text-red-500" size={42} /><p className="font-semibold">无法开始背词</p><p className="text-sm text-zinc-400">{error}</p><button onClick={() => navigate('/vocab', { replace: true })} className="btn-primary w-52">返回单词本</button></Center>
  if (!session) return null

  if (session.phase === 'learning') {
    const correct = session.words.length - weakWords.length
    const hesitant = session.words.filter(word => word.firstCorrect && wasHesitant(session, word)).length
    const learningWords = retestWords(session)
    const supplement = session.retestRound === 2
    return <div className="h-full overflow-y-auto p-5 pb-10">
      <Header session={session} onExit={abandon} />
      {error && <div role="alert" className="text-xs text-red-500 my-3">{error}<button className="btn-ghost ml-2" onClick={() => navigate('/vocab', { replace: true })}>返回计划列表</button></div>}
      <div className="card text-center space-y-2 mt-5"><p className="text-3xl font-bold">{correct}/{session.words.length}</p><p className="text-sm text-zinc-500">首次答对</p><div className="grid grid-cols-4 gap-2 pt-2 text-xs"><Stat label="快速答对" value={correct - hesitant} color="text-emerald-500" /><Stat label="犹豫答对" value={hesitant} color="text-amber-500" /><Stat label="本轮错词" value={weakWords.length} color="text-red-500" /><Stat label="中断" value={session.interruptions} color="text-zinc-500" /></div></div>
      <h2 className="font-semibold mt-6 mb-3">{supplement ? '补测前再巩固一下' : '集中学习薄弱词'}</h2>
      <label className="flex items-center gap-2 text-xs text-zinc-500 mb-3"><input type="checkbox" checked={autoRead} onChange={event => { setAutoRead(event.target.checked); localStorage.setItem('vocab_auto_read', event.target.checked ? '1' : '0') }} />学习时自动朗读（检测时不自动播放）</label>
      {learningWords.length ? <WeakWordsLearning key={`${session.id}:${session.retestRound ?? 1}`} words={learningWords} auto={autoRead} /> : <div className="card text-center text-emerald-600">本轮全部首次答对</div>}
      {session.rulesVersion === 2 && learningWords.length > 0 && <p className="text-xs text-zinc-400 mt-3">{supplement ? '这是最后一遍补测，仍错的词会留在错词本，不再追加题目。' : '每词复测一次；仍错的词再集中补测一次，总题数固定。'}</p>}
      <button onClick={() => { stopWordSpeech(); void beginRetest() }} className="btn-primary w-full mt-5 py-3">{learningWords.length ? `${supplement ? '开始集中补测' : '开始拼写复测'}（${learningWords.length}词）` : '完成本轮'}</button>
    </div>
  }

  if (session.phase === 'completed') {
    const firstCorrect = session.words.filter(word => word.firstCorrect).length
    const { bonus: focusBonus, coins } = studyReward(session)
    const unresolved = weakWords.filter(word => word.retestCorrect !== true)
    return <Center><CheckCircle2 size={64} className="text-emerald-500" /><div><h1 className="text-2xl font-bold">本轮背词完成</h1><p className="text-sm text-zinc-400 mt-2">首次答对 {firstCorrect}/{session.words.length} · {unresolved.length ? `${unresolved.length}词仍需巩固，已存入错词本` : weakWords.length ? '本轮薄弱词复测通过，仍保留历史错误' : '本轮没有错词'}</p></div><div className="card w-full max-w-sm grid grid-cols-3 gap-2"><Stat label="获得金币" value={coins} color="text-amber-500" /><Stat label="超时" value={session.words.filter(word => word.firstTimedOut).length} color="text-red-500" /><Stat label={focusBonus ? '专注奖励' : '中断'} value={focusBonus || session.interruptions} color={focusBonus ? 'text-brand-500' : 'text-zinc-500'} /></div><button onClick={() => navigate('/vocab/mistakes', { replace: true })} className="btn-ghost w-full max-w-sm">查看错词本</button><button onClick={() => navigate('/vocab', { replace: true })} className="btn-primary w-full max-w-sm">返回单词首页</button></Center>
  }

  if (!current) return null
  const total = session.phase === 'retest' ? retestQueue.length : session.words.length
  const progress = (session.currentIndex + (pendingNext ? 1 : 0)) / total * 100
  const mistakes = errorStats?.get(normalizeVocabEntry(current.word))
  return <div className="h-full overflow-y-auto flex flex-col p-5 safe-top">
    <div className="flex items-center justify-between"><button onPointerDown={startExitHold} onPointerUp={cancelExitHold} onPointerLeave={cancelExitHold} className="btn-ghost !px-2 text-xs flex items-center gap-1"><ArrowLeft size={17} />长按退出</button><div className="text-center"><p className="text-xs font-semibold">{session.phase === 'retest' ? session.retestRound === 2 ? '薄弱词集中补测' : '薄弱词拼写复测' : session.bookName}</p><p className="text-[10px] text-zinc-400">{session.currentIndex + 1} / {total}</p></div>{session.focusLock ? <LockKeyhole size={18} className="text-brand-500" /> : <span className="w-[18px]" />}</div>
    <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full mt-4 overflow-hidden"><div className="h-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} /></div>
    {error && <p className="text-xs text-red-500 mt-3 text-center">{error}</p>}
    {!session.rulesVersion && <p className="text-[10px] text-zinc-400 mt-2 text-center">旧轮次沿用原题型和复测规则；新轮次启用真正混合与有限复测。</p>}
    <div className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto py-5">
      <div className="flex items-center justify-center gap-2 mb-5"><Clock3 size={18} className={remaining <= 2 ? 'text-red-500' : 'text-zinc-400'} /><span className={clsx('text-2xl font-mono font-bold', remaining <= 2 ? 'text-red-500' : 'text-zinc-700 dark:text-zinc-200')}>{remaining.toFixed(1)}</span></div>
      <p className="text-xs text-zinc-400 text-center mb-3">{mode === 'choice' ? '英译汉' : '中文提示拼写'}</p>
      {mode === 'choice' ? <ChoiceQuestion item={current} disabled={submitting || !!pendingNext} feedback={feedback} onAnswer={value => void answerQuestion(value)} /> : <SpellingQuestion item={current} answer={answer} setAnswer={setAnswer} disabled={submitting || !!pendingNext} feedback={feedback} onSubmit={() => void answerQuestion(answer)} />}
      {pendingNext ? <div className="mt-3 space-y-2"><div className="flex items-center justify-center text-sm"><span>{current.word}</span><WordSpeaker word={current.word} /></div>{mistakes && <p className="text-xs text-red-500 text-center">累计错{mistakes.errors}次 · 英译汉{mistakes.choiceErrors} / 拼写{mistakes.spellingErrors}</p>}<button className="btn-primary w-full" onClick={() => { stopWordSpeech(); setSession(pendingNext); setPendingNext(null); setAnswer(''); setFeedback(null) }}>{pendingNext.phase !== session.phase ? '查看结果' : '下一题'}</button></div> : <button onClick={() => void answerQuestion('', false)} disabled={submitting} className="btn-ghost mt-4 text-zinc-400">不会，直接下一个</button>}
    </div>
  </div>
}

const DexieMinDate = new Date(0)

function makeSession(input: Omit<VocabLearningSession, 'id' | 'phase' | 'status' | 'currentIndex' | 'interruptions' | 'startedAt' | 'updatedAt'>): VocabLearningSession {
  const now = new Date().toISOString()
  return { ...input, words: assignQuestionModes(input.words, input.testMode), rulesVersion: 2, answerRevision: 0, id: uuid(), phase: 'screening', status: 'active', currentIndex: 0, interruptions: 0, startedAt: now, updatedAt: now }
}

function Header({ session, onExit }: { session: VocabLearningSession; onExit: () => void }) {
  return <div className="flex items-center justify-between"><button onClick={onExit} className="btn-ghost !px-2"><ArrowLeft size={18} /></button><div className="text-center"><p className="font-semibold text-sm">{session.bookName}</p><p className="text-[10px] text-zinc-400">答题结果与薄弱词学习</p></div><span className="w-9" /></div>
}

function ChoiceQuestion({ item, disabled, feedback, onAnswer }: { item: VocabSessionWord; disabled: boolean; feedback: string | null; onAnswer: (value: string) => void }) {
  return <><div className="text-center mb-7"><h1 className="text-4xl font-bold break-words">{item.word}</h1>{item.phonetic && <p className="text-sm text-zinc-400 mt-2">/{item.phonetic.replace(/^\/+|\/+$/g, '')}/</p>}</div><div className="grid gap-3">{item.choices.map((choice, index) => <button key={`${choice}-${index}`} onClick={() => onAnswer(choice)} disabled={disabled} className="card !p-4 text-left text-sm active:scale-[.98] disabled:opacity-60"><span className="text-brand-500 font-semibold mr-2">{String.fromCharCode(65 + index)}.</span>{choice}</button>)}</div>{feedback && <Feedback value={feedback} answer={item.translation} />}</>
}

function SpellingQuestion({ item, answer, setAnswer, disabled, feedback, onSubmit }: { item: VocabSessionWord; answer: string; setAnswer: (value: string) => void; disabled: boolean; feedback: string | null; onSubmit: () => void }) {
  return <><div className="text-center mb-7"><p className="text-xl font-semibold leading-8">{item.translation}</p>{item.pos && <p className="text-xs text-brand-500 mt-2">{item.pos}</p>}{item.phonetic && <p className="text-xs text-zinc-400 mt-1">/{item.phonetic.replace(/^\/+|\/+$/g, '')}/</p>}</div><form onSubmit={event => { event.preventDefault(); if (answer.trim()) onSubmit() }} className="space-y-3"><input autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} value={answer} onChange={event => setAnswer(event.target.value)} disabled={disabled} className="input text-center text-xl font-semibold py-4" placeholder="输入英文拼写" /><button type="submit" disabled={disabled || !answer.trim()} className="btn-primary w-full py-3 disabled:opacity-40">提交</button></form>{feedback && <Feedback value={feedback} answer={item.word} />}</>
}

function Feedback({ value, answer }: { value: string; answer: string }) {
  return <div className={clsx('mt-4 rounded-xl p-3 text-sm flex items-center gap-2', value === 'correct' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}>{value === 'correct' ? <CheckCircle2 size={18} /> : value === 'timeout' ? <Clock3 size={18} /> : <XCircle size={18} />}<span>{value === 'correct' ? '回答正确' : `${value === 'timeout' ? '超时' : '回答错误'}，正确答案：${answer}`}</span></div>
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) { return <div className="text-center"><p className={clsx('text-xl font-bold', color)}>{value}</p><p className="text-[10px] text-zinc-400 mt-1">{label}</p></div> }
function Center({ children }: { children: React.ReactNode }) { return <div className="h-full p-6 flex flex-col items-center justify-center text-center gap-4">{children}</div> }
function wasHesitant(session: VocabLearningSession, word: VocabSessionWord) {
  const screeningMode = questionMode({ ...session, phase: 'screening' }, word)
  const limit = screeningMode === 'choice' ? 6 : spellingTimeLimit(word.word)
  return (word.firstElapsedMs ?? 0) >= limit * 700
}
