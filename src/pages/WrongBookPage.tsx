import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bookmark, BookmarkCheck, BookmarkX, Brain, Loader2, RefreshCw, Search } from 'lucide-react'
import { db, getCurrentOwnerId, type ExamPaper, type MasteryStatus, type PracticeQuestion, type PracticeResult, type WrongQuestion } from '../db'
import { generateExamPractice, solveExamQuestion } from '../services/api'

const MASTERY_LABELS: Record<MasteryStatus, string> = { unreviewed: '未复习', weak: '薄弱', learning: '学习中', mastered: '已掌握' }

export function WrongBookPage() {
  const navigate = useNavigate()
  const ownerId = getCurrentOwnerId()
  const [subject, setSubject] = useState('全部')
  const [mastery, setMastery] = useState<'all' | MasteryStatus>('all')
  const [keyword, setKeyword] = useState('')

  const allQuestions = useLiveQuery(() => db.wrongQuestions.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const papers = useLiveQuery(() => db.examPapers.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const allPractices = useLiveQuery(() => db.practiceQuestions.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const paperMap = useMemo(() => new Map((papers ?? []).map(paper => [paper.id!, paper])), [papers])
  const questionMap = useMemo(() => new Map((allQuestions ?? []).map(question => [question.id!, question])), [allQuestions])

  const savedQuestions = useMemo(() => (allQuestions ?? []).filter(item => item.inWrongBook).sort(byBookmarkedAt), [allQuestions])
  const savedPractices = useMemo(() => (allPractices ?? []).filter(item => item.inWrongBook).sort(byBookmarkedAt), [allPractices])
  const subjects = useMemo(() => [...new Set([
    ...savedQuestions.map(question => paperMap.get(question.paperId)?.subject),
    ...savedPractices.map(item => paperMap.get(questionMap.get(item.wrongQuestionId)?.paperId ?? -1)?.subject),
  ].filter((item): item is string => Boolean(item)))], [paperMap, questionMap, savedPractices, savedQuestions])

  const matches = (question: WrongQuestion | undefined, practice?: PracticeQuestion) => {
    const paper = question ? paperMap.get(question.paperId) : undefined
    const itemMastery = practice ? practiceMastery(practice) : question?.mastery
    if (subject !== '全部' && paper?.subject !== subject) return false
    if (mastery !== 'all' && itemMastery !== mastery) return false
    const needle = keyword.trim().toLocaleLowerCase()
    if (!needle) return true
    return [paper?.title, paper?.subject, question?.questionNo, question?.extractedText, question?.analysisSummary, ...(question?.knowledgePoints ?? []), practice?.content, practice?.knowledgePoint].join(' ').toLocaleLowerCase().includes(needle)
  }
  const filteredQuestions = savedQuestions.filter(question => matches(question))
  const filteredPractices = savedPractices.filter(item => matches(questionMap.get(item.wrongQuestionId), item))
  const total = savedQuestions.length + savedPractices.length
  const mastered = savedQuestions.filter(item => item.mastery === 'mastered').length + savedPractices.filter(item => practiceMastery(item) === 'mastered').length

  return <div className="p-5 space-y-5">
    <div className="flex items-center gap-3"><button onClick={() => navigate('/')} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><ArrowLeft size={20} /></button><div className="flex-1"><h1 className="text-xl font-bold">错题本</h1><p className="text-xs text-zinc-400">直接看题、复习和生成针对练习</p></div><button onClick={() => navigate('/exam-analysis')} className="text-xs text-brand-500">试卷分析</button></div>

    <div className="grid grid-cols-3 gap-2"><Stat label="已收藏" value={total} /><Stat label="仍需复习" value={total - mastered} /><Stat label="已掌握" value={mastered} /></div>

    <div className="space-y-2">
      <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" /><input className="input !pl-9" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索题号、知识点或题目内容" /></div>
      <div className="grid grid-cols-2 gap-2"><select className="input" value={subject} onChange={event => setSubject(event.target.value)}><option>全部</option>{subjects.map(item => <option key={item}>{item}</option>)}</select><select className="input" value={mastery} onChange={event => setMastery(event.target.value as 'all' | MasteryStatus)}><option value="all">全部掌握状态</option>{Object.entries(MASTERY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    </div>

    {!total ? <div className="card text-center py-12"><Brain size={40} className="mx-auto text-zinc-300 mb-3" /><p className="text-sm text-zinc-500">错题本还是空的</p><p className="text-xs text-zinc-400 mt-1">试卷错题和针对练习都可以收藏到这里</p><button onClick={() => navigate('/exam-analysis')} className="btn-primary mt-4 text-sm">去分析试卷</button></div> : <>
      {filteredQuestions.length > 0 && <section className="space-y-3"><h2 className="text-sm font-semibold text-zinc-500">试卷错题 · {filteredQuestions.length}</h2>{filteredQuestions.map(question => <WrongQuestionReview key={question.id} question={question} paper={paperMap.get(question.paperId)} practices={(allPractices ?? []).filter(item => item.wrongQuestionId === question.id && item.isCurrent !== false)} ownerId={ownerId} />)}</section>}
      {filteredPractices.length > 0 && <section className="space-y-3"><h2 className="text-sm font-semibold text-zinc-500">练习错题 · {filteredPractices.length}</h2>{filteredPractices.map(item => <PracticeReview key={item.id} item={item} source={questionMap.get(item.wrongQuestionId)} paper={paperMap.get(questionMap.get(item.wrongQuestionId)?.paperId ?? -1)} />)}</section>}
      {!filteredQuestions.length && !filteredPractices.length && <div className="card text-center py-8 text-sm text-zinc-400">没有符合筛选条件的错题</div>}
    </>}
  </div>
}

function WrongQuestionReview({ question, paper, practices, ownerId }: { question: WrongQuestion; paper?: ExamPaper; practices: PracticeQuestion[]; ownerId: number }) {
  const [showPractice, setShowPractice] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [answerLoading, setAnswerLoading] = useState(false)
  const [correctAnswer, setCorrectAnswer] = useState(question.correctAnswer ?? '')
  const [error, setError] = useState('')
  const fragments = question.fragments?.length ? question.fragments : [{ cropImage: question.cropImage, pageId: question.pageId, pageNumber: 0, cropX: question.cropX, cropY: question.cropY, cropWidth: question.cropWidth, cropHeight: question.cropHeight, createdAt: question.createdAt }]

  const regenerate = async () => {
    if (!paper || !question.extractedText || !question.knowledgePoints.length) return setError('这道题缺少识别文本或知识点，请先在试卷分析中补全')
    if (practices.length && !window.confirm('确定重新生成3道练习吗？已收藏的旧练习会保留在错题本。')) return
    setGenerating(true); setError('')
    try {
      const result = await generateExamPractice(question.extractedText, paper.subject, paper.grade, question.knowledgePoints, question.difficulty)
      await db.transaction('rw', db.practiceQuestions, async () => {
        const previous = await db.practiceQuestions.where('wrongQuestionId').equals(question.id!).toArray()
        for (const item of previous) {
          if (item.inWrongBook) await db.practiceQuestions.update(item.id!, { isCurrent: false })
          else await db.practiceQuestions.delete(item.id!)
        }
        await db.practiceQuestions.bulkAdd(result.questions.map((item, index) => ({ ownerId, wrongQuestionId: question.id!, order: index + 1, ...item, result: 'unanswered' as const, isCurrent: true, createdAt: new Date().toISOString() })))
      })
      setShowPractice(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '练习生成失败') } finally { setGenerating(false) }
  }

  const generateAnswer = async () => {
    if (!paper || !question.extractedText) return setError('缺少完整题目，无法生成参考解答')
    setAnswerLoading(true); setError('')
    try {
      const result = await solveExamQuestion(question.extractedText, paper.subject, paper.grade)
      setCorrectAnswer(result.answer)
      await db.wrongQuestions.update(question.id!, { correctAnswer: result.answer, updatedAt: new Date().toISOString() })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'AI参考解答生成失败') } finally { setAnswerLoading(false) }
  }

  return <article className="card space-y-3">
    <div className="flex items-center gap-2"><span className="font-semibold text-sm">第 {question.questionNo} 题</span><span className="text-[10px] rounded-full bg-brand-50 dark:bg-brand-950 text-brand-600 px-2 py-0.5">{paper?.subject ?? '未知科目'}</span><span className="ml-auto text-[10px] text-zinc-400">{paper?.title ?? '原试卷已删除'}</span></div>
    <div className={`grid gap-2 ${fragments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>{fragments.map((fragment, index) => <BlobImage key={`${fragment.pageId}-${fragment.createdAt}-${index}`} blob={fragment.cropImage} label={`片段 ${index + 1}${fragment.pageNumber ? ` · 第${fragment.pageNumber}页` : ''}`} />)}</div>
    {question.extractedText && <details className="text-xs"><summary className="text-brand-500 cursor-pointer">查看识别题目</summary><p className="mt-2 whitespace-pre-wrap bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2">{question.extractedText}</p></details>}
    {question.knowledgePoints.length > 0 && <div className="flex flex-wrap gap-1">{question.knowledgePoints.map(point => <span key={point} className="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 rounded-full px-2 py-1">{point}</span>)}</div>}
    <p className="text-sm">{question.analysisSummary}</p>{question.reviewAdvice && <p className="text-xs text-brand-600">建议：{question.reviewAdvice}</p>}
    <div><label className="text-[10px] text-zinc-400">参考答案（可手动填写或修改）</label><textarea className="input min-h-24 mt-1 !text-xs" value={correctAnswer} onChange={event => setCorrectAnswer(event.target.value)} onBlur={() => void db.wrongQuestions.update(question.id!, { correctAnswer: correctAnswer.trim(), updatedAt: new Date().toISOString() })} placeholder="可填写老师提供的正确答案" /><button onClick={() => void generateAnswer()} disabled={answerLoading} className="mt-2 w-full py-2 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-900 text-brand-600 flex items-center justify-center gap-1.5 disabled:opacity-50">{answerLoading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}AI生成参考解答</button><p className="text-[10px] text-amber-600 mt-1">AI解答仅供参考，请结合老师答案自行核对。</p></div>
    <div className="grid grid-cols-2 gap-2"><select aria-label="掌握状态" className="input !py-2 !text-xs" value={question.mastery} onChange={event => void db.wrongQuestions.update(question.id!, { mastery: event.target.value as MasteryStatus, updatedAt: new Date().toISOString() })}>{masteryOptions()}</select><button onClick={() => setShowPractice(!showPractice)} className="text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800">{showPractice ? '收起练习' : `查看练习 (${practices.length})`}</button></div>
    {showPractice && <div className="space-y-2">{practices.map(item => <InlinePractice key={item.id} item={item} />)}<button onClick={() => void regenerate()} disabled={generating} className="btn-primary w-full flex items-center justify-center gap-1.5 disabled:opacity-50">{generating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{practices.length ? '重新生成3道练习' : '生成3道练习'}</button></div>}
    {!showPractice && !practices.length && <button onClick={() => { setShowPractice(true); void regenerate() }} disabled={generating} className="btn-primary w-full flex items-center justify-center gap-1.5 disabled:opacity-50">{generating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}生成3道针对练习</button>}
    <textarea key={question.reviewNote ?? ''} className="input min-h-16 !text-xs" defaultValue={question.reviewNote ?? ''} onBlur={event => void db.wrongQuestions.update(question.id!, { reviewNote: event.target.value.trim(), updatedAt: new Date().toISOString() })} placeholder="复习备注（选填）" />
    <button onClick={() => { if (window.confirm('确定将这道题移出错题本吗？原分析仍会保留。')) void db.wrongQuestions.update(question.id!, { inWrongBook: false, bookmarkedAt: undefined, updatedAt: new Date().toISOString() }) }} className="text-xs text-zinc-400 hover:text-red-500 flex items-center gap-1"><BookmarkX size={13} />移出错题本</button>
    {error && <p className="text-xs text-red-500">{error}</p>}
  </article>
}

function InlinePractice({ item }: { item: PracticeQuestion }) {
  const [showAnswer, setShowAnswer] = useState(false)
  const toggle = async () => {
    const inWrongBook = !item.inWrongBook
    await db.practiceQuestions.update(item.id!, { inWrongBook, bookmarkedAt: inWrongBook ? new Date().toISOString() : undefined, mastery: inWrongBook ? practiceMastery(item) : item.mastery })
  }
  return <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 space-y-2"><p className="text-xs font-semibold">练习 {item.order} · {item.knowledgePoint}</p><p className="text-sm whitespace-pre-wrap">{item.content}</p><button onClick={() => setShowAnswer(!showAnswer)} className="text-xs text-brand-500">{showAnswer ? '隐藏答案' : '查看答案'}</button>{showAnswer && <div className="text-xs bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2"><p><b>答案：</b>{item.answer}</p><p className="mt-1"><b>解析：</b>{item.explanation}</p></div>}<PracticeResultButtons item={item} /><button onClick={() => void toggle()} className={`w-full py-1.5 rounded-lg text-xs flex items-center justify-center gap-1 ${item.inWrongBook ? 'bg-amber-100 dark:bg-amber-950 text-amber-700' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>{item.inWrongBook ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}{item.inWrongBook ? '已加入错题本' : '加入错题本'}</button></div>
}

function PracticeReview({ item, source, paper }: { item: PracticeQuestion; source?: WrongQuestion; paper?: ExamPaper }) {
  const [showAnswer, setShowAnswer] = useState(false)
  const remove = async () => {
    if (!window.confirm('确定将这道练习移出错题本吗？')) return
    if (item.isCurrent === false) await db.practiceQuestions.delete(item.id!)
    else await db.practiceQuestions.update(item.id!, { inWrongBook: false, bookmarkedAt: undefined })
  }
  return <article className="card space-y-3"><div className="flex items-center gap-2"><span className="font-semibold text-sm">练习错题</span><span className="text-[10px] rounded-full bg-amber-50 dark:bg-amber-950 text-amber-700 px-2 py-0.5">{paper?.subject ?? '未知科目'}</span><span className="ml-auto text-[10px] text-zinc-400">来源：第 {source?.questionNo ?? '?'} 题</span></div><p className="text-sm whitespace-pre-wrap">{item.content}</p><button onClick={() => setShowAnswer(!showAnswer)} className="text-xs text-brand-500">{showAnswer ? '隐藏答案与解析' : '查看答案与解析'}</button>{showAnswer && <div className="text-xs bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2"><p><b>答案：</b>{item.answer}</p><p className="mt-1"><b>解析：</b>{item.explanation}</p></div>}<select className="input !py-2 !text-xs" value={practiceMastery(item)} onChange={event => void db.practiceQuestions.update(item.id!, { mastery: event.target.value as MasteryStatus })}>{masteryOptions()}</select><textarea key={item.reviewNote ?? ''} className="input min-h-16 !text-xs" defaultValue={item.reviewNote ?? ''} onBlur={event => void db.practiceQuestions.update(item.id!, { reviewNote: event.target.value.trim() })} placeholder="复习备注（选填）" /><button onClick={() => void remove()} className="text-xs text-zinc-400 hover:text-red-500 flex items-center gap-1"><BookmarkX size={13} />移出错题本</button></article>
}

function PracticeResultButtons({ item }: { item: PracticeQuestion }) {
  const setResult = async (result: PracticeResult) => db.practiceQuestions.update(item.id!, { result, ...(item.inWrongBook ? { mastery: result === 'correct' ? 'mastered' : result === 'partial' ? 'learning' : 'weak' } : {}) })
  return <div className="grid grid-cols-3 gap-1">{([['incorrect', '不会'], ['partial', '模糊'], ['correct', '掌握']] as const).map(([result, label]) => <button key={result} onClick={() => void setResult(result)} className={`text-xs py-1.5 rounded-lg ${item.result === result ? 'bg-brand-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>{label}</button>)}</div>
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="card !p-3 text-center"><p className="text-lg font-bold">{value}</p><p className="text-[10px] text-zinc-400">{label}</p></div> }
function masteryOptions() { return Object.entries(MASTERY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>) }
function practiceMastery(item: PracticeQuestion): MasteryStatus { return item.mastery ?? (item.result === 'correct' ? 'mastered' : item.result === 'partial' ? 'learning' : 'weak') }
function byBookmarkedAt<T extends { bookmarkedAt?: string; createdAt: string }>(a: T, b: T) { return (b.bookmarkedAt ?? b.createdAt).localeCompare(a.bookmarkedAt ?? a.createdAt) }

function BlobImage({ blob, label }: { blob: Blob; label: string }) {
  const url = useObjectUrl(blob)
  return <div className="relative">{url && <img src={url} className="w-full max-h-72 object-contain rounded-lg bg-zinc-50 dark:bg-zinc-900" />}<span className="absolute top-1 left-1 text-[9px] rounded bg-black/60 text-white px-1.5 py-0.5">{label}</span></div>
}

function useObjectUrl(blob?: Blob): string {
  const [url, setUrl] = useState('')
  useEffect(() => { if (!blob) return; const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next) }, [blob])
  return url
}
