import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Bookmark, BookmarkCheck, Brain, Camera, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Crop, FilePlus2, ImagePlus,
  Loader2, Plus, RefreshCw, Sparkles, Trash2, X,
} from 'lucide-react'
import {
  db, getCurrentOwnerId, type ExamPage, type ExamPaper, type PracticeResult,
  type PracticeQuestion, type WrongQuestion, type WrongQuestionFragment,
} from '../db'
import { useAuth } from '../context/AuthContext'
import { analyzeExamQuestion, extractExamQuestion, generateExamPractice, solveExamQuestion } from '../services/api'
import { takePhotoFile } from '../utils/camera'

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '其他']
const ERROR_REASONS = ['概念不清', '方法不会', '公式记错', '计算错误', '审题错误', '步骤不完整', '粗心', '时间不足']

type View = 'list' | 'create' | 'paper'

export function ExamAnalysisPage() {
  const ownerId = getCurrentOwnerId()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const requestedPaperId = Number(searchParams.get('paper')) || null
  const requestedQuestionId = Number(searchParams.get('question')) || null
  const [view, setView] = useState<View>(requestedPaperId ? 'paper' : 'list')
  const [activePaperId, setActivePaperId] = useState<number | null>(requestedPaperId)

  const papers = useLiveQuery(
    () => db.examPapers.where('ownerId').equals(ownerId).sortBy('updatedAt').then(items => items.reverse()),
    [ownerId],
  )

  const openPaper = (id: number) => {
    setActivePaperId(id)
    setView('paper')
  }

  const deletePaper = async (paper: ExamPaper) => {
    if (!paper.id || !window.confirm(`确定删除“${paper.title}”及其全部错题和练习吗？`)) return
    const questions = await db.wrongQuestions.where('paperId').equals(paper.id).toArray()
    await db.transaction('rw', db.examPapers, db.examPages, db.wrongQuestions, db.practiceQuestions, async () => {
      for (const question of questions) {
        if (question.id) await db.practiceQuestions.where('wrongQuestionId').equals(question.id).delete()
      }
      await db.wrongQuestions.where('paperId').equals(paper.id!).delete()
      await db.examPages.where('paperId').equals(paper.id!).delete()
      await db.examPapers.delete(paper.id!)
    })
  }

  if (view === 'create') {
    return <CreatePaper ownerId={ownerId} grade={user?.grade ?? 'highschool'} onCancel={() => setView('list')} onCreated={openPaper} />
  }
  if (view === 'paper' && activePaperId != null) {
    return <PaperWorkspace paperId={activePaperId} focusQuestionId={requestedQuestionId} onBack={() => setView('list')} />
  }

  return <div className="p-5 space-y-5">
    <div className="flex items-center gap-3">
      <button onClick={() => navigate('/')} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><ArrowLeft size={20} /></button>
      <div className="flex-1"><h1 className="text-xl font-bold">试卷分析</h1><p className="text-xs text-zinc-400">框选错题，定位薄弱知识点</p></div>
      <button onClick={() => navigate('/wrong-book')} className="p-2 rounded-lg text-amber-600 bg-amber-50 dark:bg-amber-950" aria-label="查看错题本"><Bookmark size={17} /></button>
      <button onClick={() => setView('create')} className="btn-primary text-sm flex items-center gap-1 !px-3"><Plus size={16} />新建</button>
    </div>

    {!papers?.length ? <div className="card text-center py-12">
      <FilePlus2 size={42} className="mx-auto text-zinc-300 mb-3" />
      <p className="text-sm text-zinc-500">还没有试卷分析</p>
      <button onClick={() => setView('create')} className="btn-primary mt-4 text-sm">上传第一份试卷</button>
    </div> : <div className="space-y-2">{papers.map(paper => <div key={paper.id} className="card flex items-center gap-3 !p-3">
      <button onClick={() => openPaper(paper.id!)} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2"><span className="text-sm font-semibold truncate">{paper.title}</span><span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-600">{paper.subject}</span></div>
        <p className="text-xs text-zinc-400 mt-1">{paper.examDate}{paper.score != null && paper.maxScore ? ` · ${paper.score}/${paper.maxScore}` : ''}</p>
      </button>
      <button onClick={() => void deletePaper(paper)} className="p-2 text-zinc-400 hover:text-red-500"><Trash2 size={15} /></button>
      <ChevronRight size={17} className="text-zinc-300" />
    </div>)}</div>}
  </div>
}

function CreatePaper({ ownerId, grade, onCancel, onCreated }: { ownerId: number; grade: string; onCancel: () => void; onCreated: (id: number) => void }) {
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('数学')
  const [examDate, setExamDate] = useState(new Date().toISOString().slice(0, 10))
  const [score, setScore] = useState('')
  const [maxScore, setMaxScore] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const takePagePhoto = async () => {
    setError('')
    try {
      const file = await takePhotoFile(`exam-page-${files.length + 1}`)
      if (file) setFiles(current => [...current, file])
    } catch (e) {
      setError(e instanceof Error ? e.message : '拍照失败')
    }
  }

  const create = async () => {
    if (!title.trim()) return setError('请填写考试名称')
    if (!files.length) return setError('请至少上传一张试卷图片')
    const numericScore = score === '' ? undefined : Number(score)
    const numericMax = maxScore === '' ? undefined : Number(maxScore)
    if (numericScore != null && (!numericMax || numericScore < 0 || numericScore > numericMax)) return setError('请填写正确的得分和满分')
    setSaving(true); setError('')
    try {
      const images = await Promise.all(files.map(async file => ({
        image: await resizeImage(file, 2200, 0.88),
        thumbnail: await resizeImage(file, 360, 0.72),
      })))
      const now = new Date().toISOString()
      let paperId = 0
      await db.transaction('rw', db.gradeEntries, db.examPapers, db.examPages, async () => {
        let gradeEntryId: number | undefined
        if (numericScore != null && numericMax != null) {
          gradeEntryId = await db.gradeEntries.add({ ownerId, courseName: subject, type: 'exam', name: title.trim(), score: numericScore, maxScore: numericMax, weight: 1, date: examDate })
        }
        paperId = await db.examPapers.add({ ownerId, title: title.trim(), subject, grade, examDate, score: numericScore, maxScore: numericMax, gradeEntryId, status: 'selecting', createdAt: now, updatedAt: now }) as number
        await db.examPages.bulkAdd(images.map((item, index) => ({ ownerId, paperId, pageNumber: index + 1, image: item.image, thumbnail: item.thumbnail, createdAt: now })))
      })
      onCreated(paperId)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally { setSaving(false) }
  }

  return <div className="p-5 space-y-5">
    <div className="flex items-center gap-3"><button onClick={onCancel} className="p-1.5"><X size={20} /></button><h1 className="text-lg font-bold">新建试卷分析</h1></div>
    <div><label className="text-xs text-zinc-500 block mb-1.5">考试名称</label><input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：期中考试" autoFocus /></div>
    <div className="grid grid-cols-2 gap-3">
      <div><label className="text-xs text-zinc-500 block mb-1.5">科目</label><select className="input" value={subject} onChange={e => setSubject(e.target.value)}>{SUBJECTS.map(item => <option key={item}>{item}</option>)}</select></div>
      <div><label className="text-xs text-zinc-500 block mb-1.5">日期</label><input type="date" className="input" value={examDate} onChange={e => setExamDate(e.target.value)} /></div>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div><label className="text-xs text-zinc-500 block mb-1.5">得分（选填）</label><input type="number" min="0" className="input" value={score} onChange={e => setScore(e.target.value)} /></div>
      <div><label className="text-xs text-zinc-500 block mb-1.5">满分（选填）</label><input type="number" min="1" className="input" value={maxScore} onChange={e => setMaxScore(e.target.value)} /></div>
    </div>
    <div className="card border-dashed space-y-3 text-center">
      <Camera size={28} className="text-brand-500 mx-auto" />
      <div><p className="text-sm font-medium">添加试卷图片</p><p className="text-xs text-zinc-400 mt-1">已添加 {files.length} 页，可连续拍摄</p></div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => void takePagePhoto()} className="btn-primary text-sm flex items-center justify-center gap-1.5"><Camera size={16} />拍一页</button>
        <label className="btn-ghost text-sm flex items-center justify-center gap-1.5 cursor-pointer"><ImagePlus size={16} />选多张
          <input type="file" accept="image/*" multiple className="hidden" onChange={e => { const selected = Array.from(e.target.files ?? []); setFiles(current => [...current, ...selected]); e.target.value = '' }} />
        </label>
      </div>
    </div>
    {files.length > 0 && <div className="text-xs text-zinc-500 space-y-1">{files.map((file, i) => <div key={`${file.name}-${i}`} className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-900 rounded-lg px-3 py-2"><span className="flex-1 truncate">第 {i + 1} 页 · {file.name}</span><button type="button" onClick={() => setFiles(current => current.filter((_, index) => index !== i))} className="text-zinc-400 hover:text-red-500"><X size={14} /></button></div>)}</div>}
    {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950 rounded-lg p-3">{error}</p>}
    <button onClick={() => void create()} disabled={saving} className="btn-primary w-full flex justify-center gap-2 disabled:opacity-50">{saving && <Loader2 size={17} className="animate-spin" />}保存并框选错题</button>
  </div>
}

function PaperWorkspace({ paperId, focusQuestionId, onBack }: { paperId: number; focusQuestionId: number | null; onBack: () => void }) {
  const ownerId = getCurrentOwnerId()
  const paper = useLiveQuery(() => db.examPapers.get(paperId), [paperId])
  const pages = useLiveQuery(() => db.examPages.where('paperId').equals(paperId).sortBy('pageNumber'), [paperId])
  const questions = useLiveQuery(() => db.wrongQuestions.where('paperId').equals(paperId).toArray(), [paperId])
  const [selectedPageId, setSelectedPageId] = useState<number | null>(null)
  const [cropping, setCropping] = useState(false)

  useEffect(() => { if (!selectedPageId && pages?.[0]?.id) setSelectedPageId(pages[0].id) }, [pages, selectedPageId])
  useEffect(() => {
    if (!focusQuestionId || !questions?.some(question => question.id === focusQuestionId)) return
    requestAnimationFrame(() => document.getElementById(`wrong-question-${focusQuestionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [focusQuestionId, questions])
  const selectedPage = pages?.find(page => page.id === selectedPageId)
  const analyzed = questions?.filter(question => question.status === 'analyzed') ?? []
  const weakness = useMemo(() => aggregateWeakness(analyzed), [analyzed])

  if (!paper) return <div className="p-5">加载中...</div>
  return <div className="p-5 space-y-5">
    <div className="flex items-center gap-3"><button onClick={onBack} className="p-1.5"><ArrowLeft size={20} /></button><div className="flex-1"><h1 className="text-lg font-bold">{paper.title}</h1><p className="text-xs text-zinc-400">{paper.subject} · 已选 {questions?.length ?? 0} 道错题</p></div></div>

    {weakness.length > 0 && <div className="card bg-brand-50 dark:bg-brand-950/30 border-brand-200 dark:border-brand-900">
      <h2 className="text-sm font-semibold flex items-center gap-2 mb-3"><Brain size={16} className="text-brand-500" />薄弱知识点</h2>
      <div className="space-y-2">{weakness.slice(0, 5).map(item => <div key={item.name} className="flex items-center gap-2"><span className="text-sm flex-1">{item.name}</span><span className="text-xs text-brand-600">关联 {item.count} 题{item.lostScore ? ` · 扣 ${item.lostScore} 分` : ''}</span></div>)}</div>
    </div>}

    <div className="flex gap-2 overflow-x-auto pb-1">{pages?.map(page => <PageThumb key={page.id} page={page} active={page.id === selectedPageId} onClick={() => setSelectedPageId(page.id!)} />)}</div>

    {selectedPage && <div className="card !p-3">
      {cropping ? <CropSelector page={selectedPage} paper={paper} ownerId={ownerId} onCancel={() => setCropping(false)} onSaved={() => setCropping(false)} /> : <>
        <PageImage blob={selectedPage.image} />
        <button onClick={() => setCropping(true)} className="btn-primary w-full mt-3 flex items-center justify-center gap-2"><Crop size={16} />框选这页的错题</button>
      </>}
    </div>}

    <div><h2 className="text-sm font-semibold text-zinc-500 mb-2">错题列表</h2>{!questions?.length ? <div className="card text-center py-8 text-sm text-zinc-400">先从试卷中框选一道错题</div> : <div className="space-y-3">{questions.map(question => <WrongQuestionCard key={question.id} question={question} paper={paper} />)}</div>}</div>
  </div>
}

function CropSelector({ page, paper, ownerId, onCancel, onSaved }: { page: ExamPage; paper: ExamPaper; ownerId: number; onCancel: () => void; onSaved: () => void }) {
  const url = useObjectUrl(page.image)
  const imageRef = useRef<HTMLImageElement>(null)
  const [selection, setSelection] = useState({ x: 0.08, y: 0.1, width: 0.84, height: 0.3 })
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [questionNo, setQuestionNo] = useState('')
  const [lostScore, setLostScore] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const point = (event: React.PointerEvent) => {
    const rect = imageRef.current!.getBoundingClientRect()
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) }
  }
  const down = (event: React.PointerEvent) => { event.currentTarget.setPointerCapture(event.pointerId); const p = point(event); setDragStart(p); setSelection({ ...p, width: 0, height: 0 }) }
  const move = (event: React.PointerEvent) => { if (!dragStart) return; const p = point(event); setSelection({ x: Math.min(p.x, dragStart.x), y: Math.min(p.y, dragStart.y), width: Math.abs(p.x - dragStart.x), height: Math.abs(p.y - dragStart.y) }) }
  const up = () => setDragStart(null)

  const save = async () => {
    if (selection.width < 0.03 || selection.height < 0.03) return
    const trimmedQuestionNo = questionNo.trim()
    if (!trimmedQuestionNo) return setSaveError('请填写题号；跨页片段依靠相同题号自动合并')
    setSaveError('')
    setSaving(true)
    try {
      const cropImage = await cropImageBlob(page.image, selection)
      const now = new Date().toISOString()
      const fragment: WrongQuestionFragment = { pageId: page.id!, pageNumber: page.pageNumber, cropX: selection.x, cropY: selection.y, cropWidth: selection.width, cropHeight: selection.height, cropImage, createdAt: now }
      const paperQuestions = await db.wrongQuestions.where('paperId').equals(paper.id!).toArray()
      const existing = paperQuestions.find(item => normalizeQuestionNo(item.questionNo) === normalizeQuestionNo(trimmedQuestionNo))
      await db.transaction('rw', db.wrongQuestions, db.practiceQuestions, async () => {
        if (existing) {
          await db.practiceQuestions.where('wrongQuestionId').equals(existing.id!).delete()
          await db.wrongQuestions.update(existing.id!, {
            ...resetQuestionForFragments([...getQuestionFragments(existing), fragment]),
            lostScore: existing.lostScore ?? (lostScore ? Number(lostScore) : undefined),
            updatedAt: now,
          })
        } else {
          await db.wrongQuestions.add({ ownerId, paperId: paper.id!, pageId: page.id!, questionNo: trimmedQuestionNo, lostScore: lostScore ? Number(lostScore) : undefined, cropX: selection.x, cropY: selection.y, cropWidth: selection.width, cropHeight: selection.height, cropImage, fragments: [fragment], extractedText: '', questionType: '', chapter: '', knowledgePoints: [], prerequisiteKnowledge: [], difficulty: '中等', errorReason: '', analysisSummary: '', reviewAdvice: '', status: 'selected', mastery: 'unreviewed', createdAt: now, updatedAt: now })
        }
      })
      await db.examPapers.update(paper.id!, { updatedAt: now })
      onSaved()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败')
    } finally { setSaving(false) }
  }

  return <div className="space-y-3">
    <p className="text-xs text-zinc-500">拖动框选一道错题。题目跨页时，切换页面后填写完全相同的题号继续框选，系统会自动合并。</p>
    <div className="relative select-none touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      {url && <img ref={imageRef} src={url} className="w-full rounded-lg block" draggable={false} />}
      <div className="absolute border-2 border-brand-500 bg-brand-500/10 pointer-events-none" style={{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%` }} />
    </div>
    <div className="grid grid-cols-2 gap-2"><input className="input" value={questionNo} onChange={e => setQuestionNo(e.target.value)} placeholder="题号，如 12 或 12(1)" /><input className="input" type="number" min="0" value={lostScore} onChange={e => setLostScore(e.target.value)} placeholder="扣分（选填）" /></div>
    {saveError && <p className="text-xs text-red-500">{saveError}</p>}
    <div className="flex gap-2"><button onClick={onCancel} className="btn-ghost flex-1">取消</button><button onClick={() => void save()} disabled={saving || selection.width < 0.03} className="btn-primary flex-1 disabled:opacity-50">保存错题</button></div>
  </div>
}

function WrongQuestionCard({ question, paper }: { question: WrongQuestion; paper: ExamPaper }) {
  const ownerId = getCurrentOwnerId()
  const fragments = getQuestionFragments(question)
  const pageCount = new Set(fragments.map(fragment => fragment.pageId)).size
  const [text, setText] = useState(question.extractedText)
  const [questionNoDraft, setQuestionNoDraft] = useState(question.questionNo)
  const [errorReason, setErrorReason] = useState(question.errorReason)
  const [points, setPoints] = useState(question.knowledgePoints.join('、'))
  const [correctAnswer, setCorrectAnswer] = useState(question.correctAnswer ?? '')
  const [loading, setLoading] = useState<'extract' | 'analyze' | 'answer' | 'practice' | null>(null)
  const [error, setError] = useState('')
  const practice = useLiveQuery(() => question.id ? db.practiceQuestions.where('wrongQuestionId').equals(question.id).sortBy('order').then(items => items.filter(item => item.isCurrent !== false)) : [], [question.id])

  useEffect(() => { setText(question.extractedText); setQuestionNoDraft(question.questionNo); setErrorReason(question.errorReason); setPoints(question.knowledgePoints.join('、')); setCorrectAnswer(question.correctAnswer ?? '') }, [question])

  const replaceFragments = async (nextFragments: WrongQuestionFragment[]) => {
    const now = new Date().toISOString()
    await db.transaction('rw', db.wrongQuestions, db.practiceQuestions, async () => {
      await db.practiceQuestions.where('wrongQuestionId').equals(question.id!).delete()
      await db.wrongQuestions.update(question.id!, { ...resetQuestionForFragments(nextFragments), updatedAt: now })
    })
    setText(''); setErrorReason(''); setPoints(''); setCorrectAnswer('')
  }

  const moveFragment = async (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= fragments.length) return
    const next = [...fragments]
    ;[next[index], next[target]] = [next[target], next[index]]
    await replaceFragments(next)
  }

  const removeFragment = async (index: number) => {
    if (fragments.length === 1) {
      if (!window.confirm('这是最后一个片段，删除后整道错题也会被删除。确定继续吗？')) return
      await db.transaction('rw', db.wrongQuestions, db.practiceQuestions, async () => {
        await db.practiceQuestions.where('wrongQuestionId').equals(question.id!).delete()
        await db.wrongQuestions.delete(question.id!)
      })
      return
    }
    if (!window.confirm(`确定删除片段 ${index + 1} 吗？删除后需要重新识别。`)) return
    await replaceFragments(fragments.filter((_, fragmentIndex) => fragmentIndex !== index))
  }

  const saveQuestionNo = async () => {
    const nextQuestionNo = questionNoDraft.trim()
    if (!nextQuestionNo) { setQuestionNoDraft(question.questionNo); return setError('题号不能为空') }
    if (normalizeQuestionNo(nextQuestionNo) === normalizeQuestionNo(question.questionNo)) {
      if (nextQuestionNo !== question.questionNo) await db.wrongQuestions.update(question.id!, { questionNo: nextQuestionNo, updatedAt: new Date().toISOString() })
      return
    }
    setError('')
    const paperQuestions = await db.wrongQuestions.where('paperId').equals(paper.id!).toArray()
    const target = paperQuestions.find(item => item.id !== question.id && normalizeQuestionNo(item.questionNo) === normalizeQuestionNo(nextQuestionNo))
    if (!target) {
      await db.wrongQuestions.update(question.id!, { questionNo: nextQuestionNo, updatedAt: new Date().toISOString() })
      return
    }
    if (!window.confirm(`第 ${target.questionNo} 题已存在，是否把当前片段合并过去？`)) return setQuestionNoDraft(question.questionNo)
    const mergedFragments = [...getQuestionFragments(target), ...fragments]
    const now = new Date().toISOString()
    await db.transaction('rw', db.wrongQuestions, db.practiceQuestions, async () => {
      await db.practiceQuestions.where('wrongQuestionId').anyOf(target.id!, question.id!).delete()
      await db.wrongQuestions.update(target.id!, { ...resetQuestionForFragments(mergedFragments), lostScore: target.lostScore ?? question.lostScore, inWrongBook: Boolean(target.inWrongBook || question.inWrongBook), bookmarkedAt: target.bookmarkedAt ?? question.bookmarkedAt, reviewNote: target.reviewNote || question.reviewNote, updatedAt: now })
      await db.wrongQuestions.delete(question.id!)
    })
  }

  const extract = async () => {
    setLoading('extract'); setError('')
    try {
      const mergedImage = await stitchQuestionFragments(fragments.map(fragment => fragment.cropImage))
      const result = await extractExamQuestion(await blobToBase64(mergedImage), paper.subject, paper.grade)
      setText(result.questionText)
      await db.wrongQuestions.update(question.id!, { extractedText: result.questionText, questionType: result.questionType, status: 'extracted', updatedAt: new Date().toISOString() })
    } catch (e) { setError(e instanceof Error ? e.message : '识别失败') } finally { setLoading(null) }
  }
  const analyze = async () => {
    if (!text.trim()) return setError('请先识别或输入题目')
    if (!errorReason) return setError('请选择这道题的实际错误原因')
    setLoading('analyze'); setError('')
    try {
      await db.wrongQuestions.update(question.id!, { extractedText: text.trim(), errorReason })
      const result = await analyzeExamQuestion(text.trim(), paper.subject, paper.grade, errorReason)
      setPoints(result.knowledgePoints.join('、'))
      await db.wrongQuestions.update(question.id!, {
        chapter: result.chapter,
        knowledgePoints: result.knowledgePoints,
        prerequisiteKnowledge: result.prerequisiteKnowledge,
        difficulty: result.difficulty,
        analysisSummary: result.analysisSummary,
        reviewAdvice: result.reviewAdvice,
        extractedText: text.trim(), errorReason, status: 'analyzed', mastery: 'weak', updatedAt: new Date().toISOString(),
      })
      await db.examPapers.update(paper.id!, { status: 'completed', updatedAt: new Date().toISOString() })
    } catch (e) { setError(e instanceof Error ? e.message : '分析失败') } finally { setLoading(null) }
  }
  const savePoints = async () => {
    const knowledgePoints = points.split(/[、,，]/).map(item => item.trim()).filter(Boolean)
    await db.wrongQuestions.update(question.id!, { knowledgePoints, errorReason, extractedText: text.trim(), updatedAt: new Date().toISOString() })
  }
  const saveCorrectAnswer = async () => {
    await db.wrongQuestions.update(question.id!, { correctAnswer: correctAnswer.trim(), updatedAt: new Date().toISOString() })
  }
  const generateCorrectAnswer = async () => {
    if (!text.trim()) return setError('请先识别或输入完整题目')
    setLoading('answer'); setError('')
    try {
      const result = await solveExamQuestion(text.trim(), paper.subject, paper.grade)
      setCorrectAnswer(result.answer)
      await db.wrongQuestions.update(question.id!, { correctAnswer: result.answer, updatedAt: new Date().toISOString() })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'AI参考解答生成失败') } finally { setLoading(null) }
  }
  const toggleWrongBook = async () => {
    const inWrongBook = !question.inWrongBook
    await db.wrongQuestions.update(question.id!, { inWrongBook, bookmarkedAt: inWrongBook ? new Date().toISOString() : undefined, updatedAt: new Date().toISOString() })
  }
  const generate = async () => {
    const knowledgePoints = points.split(/[、,，]/).map(item => item.trim()).filter(Boolean)
    if (!knowledgePoints.length) return setError('请先完成知识点分析')
    setLoading('practice'); setError('')
    try {
      const result = await generateExamPractice(text.trim(), paper.subject, paper.grade, knowledgePoints, question.difficulty)
      await db.transaction('rw', db.practiceQuestions, async () => {
        const previous = await db.practiceQuestions.where('wrongQuestionId').equals(question.id!).toArray()
        for (const item of previous) {
          if (item.inWrongBook) await db.practiceQuestions.update(item.id!, { isCurrent: false })
          else await db.practiceQuestions.delete(item.id!)
        }
        await db.practiceQuestions.bulkAdd(result.questions.map((item, index) => ({ ownerId, wrongQuestionId: question.id!, order: index + 1, ...item, result: 'unanswered' as const, isCurrent: true, createdAt: new Date().toISOString() })))
      })
    } catch (e) { setError(e instanceof Error ? e.message : '生成失败') } finally { setLoading(null) }
  }
  const remove = async () => {
    if (!window.confirm('确定删除这道错题吗？')) return
    await db.transaction('rw', db.wrongQuestions, db.practiceQuestions, async () => { await db.practiceQuestions.where('wrongQuestionId').equals(question.id!).delete(); await db.wrongQuestions.delete(question.id!) })
  }

  return <div id={`wrong-question-${question.id}`} className="card space-y-3 scroll-mt-4">
    <div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-semibold flex items-center gap-1">第 <input aria-label="题号" className="input !w-20 !py-1 !px-2 !text-sm" value={questionNoDraft} onChange={event => setQuestionNoDraft(event.target.value)} onBlur={() => void saveQuestionNo()} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /> 题</span>{question.lostScore != null && <span className="text-xs text-red-500">扣 {question.lostScore} 分</span>}{fragments.length > 1 && <span className="text-[10px] rounded-full bg-brand-50 dark:bg-brand-950/40 px-2 py-0.5 text-brand-600">已合并 {fragments.length} 个片段{pageCount > 1 ? ` · 跨 ${pageCount} 页` : ''}</span>}<button onClick={() => void remove()} className="ml-auto text-zinc-400 hover:text-red-500" aria-label="删除整道错题"><Trash2 size={14} /></button></div>
    <div className={`grid gap-2 ${fragments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>{fragments.map((fragment, index) => <FragmentImage key={`${fragment.pageId}-${fragment.createdAt}-${index}`} fragment={fragment} index={index} canMoveUp={index > 0} canMoveDown={index < fragments.length - 1} onMoveUp={() => void moveFragment(index, -1)} onMoveDown={() => void moveFragment(index, 1)} onRemove={() => void removeFragment(index)} />)}</div>
    {!question.extractedText && <button onClick={() => void extract()} disabled={loading != null} className="btn-primary w-full flex justify-center gap-2">{loading === 'extract' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}千问识别题目</button>}
    {(question.extractedText || text) && <>
      <div><label className="text-[10px] text-zinc-400">识别结果（请核对修改）</label><textarea className="input min-h-28 mt-1" value={text} onChange={e => setText(e.target.value)} /></div>
      <div><label className="text-[10px] text-zinc-400">实际错误原因</label><select className="input mt-1" value={errorReason} onChange={e => setErrorReason(e.target.value)}><option value="">请选择</option>{ERROR_REASONS.map(item => <option key={item}>{item}</option>)}</select></div>
      <button onClick={() => void analyze()} disabled={loading != null} className="btn-primary w-full flex justify-center gap-2">{loading === 'analyze' ? <Loader2 size={16} className="animate-spin" /> : <Brain size={16} />}{question.status === 'analyzed' ? '重新分析' : '分析知识点'}</button>
    </>}
    {question.status === 'analyzed' && <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-3 space-y-2">
      <p className="text-xs text-zinc-400">{question.chapter} · {question.difficulty}</p>
      <div><label className="text-[10px] text-zinc-400">知识点（可修改）</label><input className="input !py-2 mt-1" value={points} onChange={e => setPoints(e.target.value)} onBlur={() => void savePoints()} /></div>
      <p className="text-sm">{question.analysisSummary}</p><p className="text-xs text-brand-600">建议：{question.reviewAdvice}</p>
      <div><label className="text-[10px] text-zinc-400">参考答案（可手动填写或修改）</label><textarea className="input min-h-24 mt-1 !text-xs" value={correctAnswer} onChange={event => setCorrectAnswer(event.target.value)} onBlur={() => void saveCorrectAnswer()} placeholder="可填写老师提供的正确答案" /><button onClick={() => void generateCorrectAnswer()} disabled={loading != null} className="mt-2 w-full py-2 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-900 text-brand-600 flex items-center justify-center gap-1.5 disabled:opacity-50">{loading === 'answer' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}AI生成参考解答</button><p className="text-[10px] text-amber-600 mt-1">AI解答仅供参考，请结合老师答案自行核对。</p></div>
      <button onClick={() => void toggleWrongBook()} className={`w-full py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 ${question.inWrongBook ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400' : 'bg-white dark:bg-zinc-900 text-zinc-500 border border-zinc-200 dark:border-zinc-700'}`}>{question.inWrongBook ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}{question.inWrongBook ? '已加入错题本 · 点击移出' : '加入错题本'}</button>
      <button onClick={() => void generate()} disabled={loading != null} className="btn-primary w-full flex justify-center gap-2">{loading === 'practice' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}{practice?.length ? '重新生成3道练习' : '生成3道类似题'}</button>
    </div>}
    {practice && practice.length > 0 && <div className="space-y-3">{practice.map(item => <PracticeCard key={item.id} item={item} />)}</div>}
    {error && <p className="text-xs text-red-500">{error}</p>}
  </div>
}

function FragmentImage({ fragment, index, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onRemove }: { fragment: WrongQuestionFragment; index: number; canMoveUp: boolean; canMoveDown: boolean; onMoveUp: () => void; onMoveDown: () => void; onRemove: () => void }) {
  const url = useObjectUrl(fragment.cropImage)
  return <div className="relative group">{url && <img src={url} className="w-full max-h-56 object-contain rounded-lg bg-zinc-50 dark:bg-zinc-900" />}<span className="absolute top-1 left-1 text-[9px] rounded bg-black/60 text-white px-1.5 py-0.5">片段 {index + 1}{fragment.pageNumber > 0 ? ` · 第${fragment.pageNumber}页` : ''}</span><div className="absolute bottom-1 right-1 flex rounded-lg overflow-hidden bg-black/65 text-white"><button type="button" onClick={onMoveUp} disabled={!canMoveUp} className="p-1.5 disabled:opacity-30" aria-label={`片段 ${index + 1} 上移`}><ChevronUp size={13} /></button><button type="button" onClick={onMoveDown} disabled={!canMoveDown} className="p-1.5 disabled:opacity-30" aria-label={`片段 ${index + 1} 下移`}><ChevronDown size={13} /></button><button type="button" onClick={onRemove} className="p-1.5 hover:text-red-300" aria-label={`删除片段 ${index + 1}`}><Trash2 size={12} /></button></div></div>
}

function PracticeCard({ item }: { item: PracticeQuestion }) {
  const [showAnswer, setShowAnswer] = useState(false)
  const setResult = async (result: PracticeResult) => {
    const practiceMastery = result === 'correct' ? 'mastered' : result === 'partial' ? 'learning' : 'weak'
    await db.practiceQuestions.update(item.id!, { result, ...(item.inWrongBook ? { mastery: practiceMastery } : {}) })
    const siblings = (await db.practiceQuestions.where('wrongQuestionId').equals(item.wrongQuestionId).toArray()).filter(question => question.isCurrent !== false)
    const results = siblings.map(question => question.id === item.id ? result : question.result)
    const mastery = results.every(value => value === 'correct') ? 'mastered' : results.some(value => value === 'correct' || value === 'partial') ? 'learning' : 'weak'
    await db.wrongQuestions.update(item.wrongQuestionId, { mastery })
    setShowAnswer(true)
  }
  const toggleWrongBook = async () => {
    const inWrongBook = !item.inWrongBook
    const mastery = item.result === 'correct' ? 'mastered' : item.result === 'partial' ? 'learning' : 'weak'
    await db.practiceQuestions.update(item.id!, { inWrongBook, bookmarkedAt: inWrongBook ? new Date().toISOString() : undefined, mastery: inWrongBook ? mastery : item.mastery })
  }
  return <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 space-y-2">
    <div className="flex gap-2"><span className="text-xs font-semibold">练习 {item.order}</span><span className="text-[10px] text-zinc-400">{item.difficulty}</span></div>
    <p className="text-sm whitespace-pre-wrap">{item.content}</p>
    <button onClick={() => setShowAnswer(!showAnswer)} className="text-xs text-brand-500">{showAnswer ? '隐藏答案' : '查看答案与解析'}</button>
    {showAnswer && <div className="text-xs bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2"><p><b>答案：</b>{item.answer}</p><p className="mt-1"><b>解析：</b>{item.explanation}</p></div>}
    <div className="grid grid-cols-3 gap-1">{([['incorrect', '不会'], ['partial', '模糊'], ['correct', '掌握']] as const).map(([result, label]) => <button key={result} onClick={() => void setResult(result)} className={`text-xs py-1.5 rounded-lg ${item.result === result ? 'bg-brand-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>{label}</button>)}</div>
    <button onClick={() => void toggleWrongBook()} className={`w-full py-1.5 rounded-lg text-xs flex items-center justify-center gap-1 ${item.inWrongBook ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>{item.inWrongBook ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}{item.inWrongBook ? '已加入错题本' : '将这道练习加入错题本'}</button>
  </div>
}

function PageThumb({ page, active, onClick }: { page: ExamPage; active: boolean; onClick: () => void }) {
  const url = useObjectUrl(page.thumbnail)
  return <button onClick={onClick} className={`shrink-0 w-16 rounded-lg border-2 p-1 ${active ? 'border-brand-500' : 'border-transparent'}`}>{url && <img src={url} className="w-full h-16 object-cover rounded" />}<span className="text-[10px]">第{page.pageNumber}页</span></button>
}

function PageImage({ blob }: { blob: Blob }) { const url = useObjectUrl(blob); return url ? <img src={url} className="w-full rounded-lg" /> : null }

function useObjectUrl(blob?: Blob): string {
  const [url, setUrl] = useState('')
  useEffect(() => { if (!blob) return; const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next) }, [blob])
  return url
}

function normalizeQuestionNo(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/^第/, '').replace(/题$/, '').replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/\s+/g, '')
}

function getQuestionFragments(question: WrongQuestion): WrongQuestionFragment[] {
  if (question.fragments?.length) return question.fragments
  return [{
    pageId: question.pageId,
    pageNumber: 0,
    cropX: question.cropX,
    cropY: question.cropY,
    cropWidth: question.cropWidth,
    cropHeight: question.cropHeight,
    cropImage: question.cropImage,
    createdAt: question.createdAt,
  }]
}

function resetQuestionForFragments(fragments: WrongQuestionFragment[]) {
  const first = fragments[0]
  return {
    fragments,
    pageId: first.pageId,
    cropX: first.cropX,
    cropY: first.cropY,
    cropWidth: first.cropWidth,
    cropHeight: first.cropHeight,
    cropImage: first.cropImage,
    extractedText: '',
    questionType: '',
    chapter: '',
    knowledgePoints: [],
    prerequisiteKnowledge: [],
    difficulty: '中等' as const,
    errorReason: '',
    analysisSummary: '',
    reviewAdvice: '',
    correctAnswer: '',
    status: 'selected' as const,
    mastery: 'unreviewed' as const,
  }
}

function aggregateWeakness(questions: WrongQuestion[]) {
  const map = new Map<string, { name: string; count: number; lostScore: number }>()
  for (const question of questions) for (const name of question.knowledgePoints) {
    const key = name.trim().toLocaleLowerCase()
    const current = map.get(key) ?? { name: name.trim(), count: 0, lostScore: 0 }
    current.count += 1; current.lostScore += question.lostScore ?? 0; map.set(key, current)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.lostScore - a.lostScore)
}

function clamp(value: number) { return Math.max(0, Math.min(1, value)) }

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try { const image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = url }); return image } finally { URL.revokeObjectURL(url) }
}

async function resizeImage(blob: Blob, maxSide: number, quality: number): Promise<Blob> {
  const image = await loadImage(blob)
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale)
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片压缩失败')), 'image/jpeg', quality))
}

async function cropImageBlob(blob: Blob, selection: { x: number; y: number; width: number; height: number }): Promise<Blob> {
  const image = await loadImage(blob)
  const sx = Math.round(selection.x * image.naturalWidth), sy = Math.round(selection.y * image.naturalHeight)
  const sw = Math.max(1, Math.round(selection.width * image.naturalWidth)), sh = Math.max(1, Math.round(selection.height * image.naturalHeight))
  const scale = Math.min(1, 1600 / Math.max(sw, sh)); const canvas = document.createElement('canvas'); canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale)
  canvas.getContext('2d')!.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('裁剪失败')), 'image/jpeg', 0.9))
}

async function stitchQuestionFragments(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 1) return blobs[0]
  const images = await Promise.all(blobs.map(loadImage))
  const gap = 18
  const maxWidth = Math.max(...images.map(image => image.naturalWidth))
  const rawHeight = images.reduce((sum, image) => sum + image.naturalHeight, 0) + gap * (images.length - 1)
  const scale = Math.min(1, 1400 / maxWidth, 7600 / rawHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(maxWidth * scale))
  canvas.height = Math.max(1, Math.round(images.reduce((sum, image) => sum + image.naturalHeight * scale, 0) + gap * (images.length - 1)))
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  let y = 0
  for (const image of images) {
    const width = Math.round(image.naturalWidth * scale)
    const height = Math.round(image.naturalHeight * scale)
    context.drawImage(image, 0, y, width, height)
    y += height + gap
  }
  return new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('跨页题目拼接失败')), 'image/jpeg', 0.88))
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob) })
}
