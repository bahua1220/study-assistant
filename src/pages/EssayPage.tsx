import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, ImagePlus, Loader2, Check, AlertTriangle, Pencil, Search, Sparkles, ShieldAlert, Star, Lightbulb, MessageSquareText, Clock, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getCurrentOwnerId, type EssayRecord } from '../db'
import { essayOCR, essayCorrect, type EssayCorrectResult } from '../services/api'
import { useAuth, gradeLabel } from '../context/AuthContext'
import { takePhotoFile } from '../utils/camera'

type Step = 'upload' | 'ocr-loading' | 'review' | 'correcting' | 'result'

const ERROR_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  grammar:     { bg: 'bg-red-50 dark:bg-red-950/40', border: 'border-red-200 dark:border-red-900', text: 'text-red-600 dark:text-red-400', label: '语法' },
  spelling:    { bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-900', text: 'text-amber-600 dark:text-amber-400', label: '拼写' },
  word_choice: { bg: 'bg-blue-50 dark:bg-blue-950/40', border: 'border-blue-200 dark:border-blue-900', text: 'text-blue-600 dark:text-blue-400', label: '用词' },
  punctuation: { bg: 'bg-purple-50 dark:bg-purple-950/40', border: 'border-purple-200 dark:border-purple-900', text: 'text-purple-600 dark:text-purple-400', label: '标点' },
  expression:  { bg: 'bg-teal-50 dark:bg-teal-950/40', border: 'border-teal-200 dark:border-teal-900', text: 'text-teal-600 dark:text-teal-400', label: '表达' },
}

export function EssayPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const topicFileRef = useRef<HTMLInputElement>(null)

  const [viewMode, setViewMode] = useState<'new' | 'history'>('new')
  const [step, setStep] = useState<Step>('upload')
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageBase64, setImageBase64] = useState<string>('')
  const [topic, setTopic] = useState('')
  const [topicImagePreview, setTopicImagePreview] = useState<string | null>(null)
  const [topicImageBase64, setTopicImageBase64] = useState<string>('')
  const [topicOCRLoading, setTopicOCRLoading] = useState(false)
  const [recognizedText, setRecognizedText] = useState('')
  const [result, setResult] = useState<EssayCorrectResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  // 交互式修改：用户可一键应用 AI 建议，也可手动编辑
  const [essayWorkingCopy, setEssayWorkingCopy] = useState<string | null>(null)
  const [appliedErrors, setAppliedErrors] = useState<Set<number>>(new Set())
  const [essayEdited, setEssayEdited] = useState(false)  // 手动编辑标记

  const getWorkingEssay = () => essayWorkingCopy ?? recognizedText

  const handleApplyCorrection = (index: number, original: string, correction: string) => {
    const text = getWorkingEssay()
    const newText = text.replace(original, correction)
    setEssayWorkingCopy(newText)
    setAppliedErrors(prev => new Set([...prev, index]))
  }

  const handleUndoCorrection = (index: number, original: string, correction: string) => {
    const text = getWorkingEssay()
    const newText = text.replace(correction, original)
    setEssayWorkingCopy(newText)
    setAppliedErrors(prev => {
      const next = new Set(prev)
      next.delete(index)
      return next
    })
  }

  // 历史记录查询 — 仅当前用户（按 ownerId 隔离）
  const historyRecords = useLiveQuery(
    () => db.essayRecords
      .where('ownerId')
      .equals(getCurrentOwnerId())
      .reverse()
      .sortBy('createdAt'),
    []
  )

  // 处理图片选择
  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage('请选择图片文件')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('图片不能超过 10MB')
      return
    }

    setErrorMessage('')
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setImagePreview(dataUrl)
      const b64 = dataUrl.split(',')[1]
      setImageBase64(b64)
      setStep('upload')
    }
    reader.readAsDataURL(file)
  }

  const handleTakeEssayPhoto = async () => {
    setErrorMessage('')
    try {
      const file = await takePhotoFile('essay')
      if (file) handleFile(file)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '拍照失败')
    }
  }

  // Step 1 → OCR
  const handleOCR = async () => {
    setStep('ocr-loading')
    setErrorMessage('')
    try {
      const res = await essayOCR(imageBase64)
      setRecognizedText(res.recognized || '')
      setStep('review')
    } catch (e: any) {
      setErrorMessage(e.message || 'OCR 识别失败')
      setStep('upload')
    }
  }

  // 处理题目图片选择
  const handleTopicFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage('题目图片格式不支持')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('图片不能超过 10MB')
      return
    }
    setErrorMessage('')
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setTopicImagePreview(dataUrl)
      setTopicImageBase64(dataUrl.split(',')[1])
    }
    reader.readAsDataURL(file)
  }

  const handleTakeTopicPhoto = async () => {
    setErrorMessage('')
    try {
      const file = await takePhotoFile('essay-topic')
      if (file) handleTopicFile(file)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '拍照失败')
    }
  }

  // 题目 OCR
  const handleTopicOCR = async () => {
    setTopicOCRLoading(true)
    setErrorMessage('')
    try {
      const res = await essayOCR(topicImageBase64)
      const recognized = res.recognized || ''
      // 追加到已有的题目文本后面
      setTopic(prev => (prev.trim() + (prev.trim() ? '\n' : '') + recognized).trim())
      setTopicImagePreview(null)
      setTopicImageBase64('')
    } catch (e: any) {
      setErrorMessage(e.message || '题目识别失败')
    } finally {
      setTopicOCRLoading(false)
    }
  }

  // Step 2 → 批改
  const handleCorrect = async () => {
    const text = recognizedText.trim()
    if (!text) {
      setErrorMessage('请先识别或输入作文内容')
      return
    }
    setStep('correcting')
    setErrorMessage('')
    try {
      const res = await essayCorrect(text, topic.trim(), user?.grade || 'highschool')
      setResult(res)
      setStep('result')
      setEssayWorkingCopy(null)
      setAppliedErrors(new Set())
      setEssayEdited(false)
      // 自动保存到历史记录
      await db.essayRecords.add({
        ownerId: getCurrentOwnerId(),
        username: user?.username || '',
        essay: text,
        topic: topic.trim(),
        grade: user?.grade || 'highschool',
        score: res.score,
        contentFeedback: res.contentFeedback,
        highlights: res.highlights,
        overallComment: res.overallComment,
        errors: JSON.stringify(res.errors),
        modelEssay: res.modelEssay || '',
        createdAt: new Date().toISOString(),
      })
    } catch (e: any) {
      setErrorMessage(e.message || '批改请求失败')
      setStep('review')
    }
  }

  const handleSkipOCR = () => setStep('review')
  const hasText = recognizedText.trim().length > 0

  // 用修改后的文本重新批改
  const handleReCorrect = async () => {
    const text = getWorkingEssay().trim()
    if (!text) {
      setErrorMessage('作文内容为空，无法重新批改')
      return
    }
    if (text === recognizedText.trim()) {
      setErrorMessage('作文内容未做任何修改，无需重新批改')
      return
    }
    setStep('correcting')
    setErrorMessage('')
    try {
      const res = await essayCorrect(text, topic.trim(), user?.grade || 'highschool')
      setResult(res)
      setStep('result')
      setRecognizedText(text)   // ✅ 将修改后的文本设为新的基准，下次修改在此基础上叠加
      setEssayWorkingCopy(null)
      setAppliedErrors(new Set())
      setEssayEdited(false)
      // 存为新记录
      await db.essayRecords.add({
        ownerId: getCurrentOwnerId(),
        username: user?.username || '',
        essay: text,
        topic: topic.trim(),
        grade: user?.grade || 'highschool',
        score: res.score,
        contentFeedback: res.contentFeedback,
        highlights: res.highlights,
        overallComment: res.overallComment,
        errors: JSON.stringify(res.errors),
        modelEssay: res.modelEssay || '',
        createdAt: new Date().toISOString(),
      })
    } catch (e: any) {
      setErrorMessage(e.message || '重新批改失败')
      setStep('result')
    }
  }

  // 查看历史记录详情
  const handleViewRecord = (record: EssayRecord) => {
    setResult({
      score: record.score,
      contentFeedback: record.contentFeedback,
      highlights: record.highlights,
      overallComment: record.overallComment,
      errors: JSON.parse(record.errors || '[]'),
      modelEssay: record.modelEssay || '',
    })
    setStep('result')
  }

  // 删除历史记录
  const handleDeleteRecord = async (id: number) => {
    await db.essayRecords.delete(id)
  }

  return (
    <div className="p-5 space-y-5">
      {/* Header + Tab 切换 */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold flex items-center gap-2">✍️ 作文批改</h1>
      </div>

      {/* Tab 切换 */}
      <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1">
        <button
          onClick={() => { setViewMode('new'); setStep('upload'); setResult(null) }}
          className={clsx(
            'flex-1 py-2 rounded-lg text-sm font-medium transition-colors',
            viewMode === 'new'
              ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          )}
        >
          ✍️ 新批改
        </button>
        <button
          onClick={() => { setViewMode('history'); setStep('upload'); setResult(null) }}
          className={clsx(
            'flex-1 py-2 rounded-lg text-sm font-medium transition-colors',
            viewMode === 'history'
              ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          )}
        >
          📋 历史记录
        </button>
      </div>

      {/* 错误提示 */}
      {errorMessage && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-sm">
          <AlertTriangle size={16} />
          {errorMessage}
        </div>
      )}

      {/* ── 历史记录列表 ── */}
      {viewMode === 'history' && step !== 'result' && (
        <div className="space-y-3">
          {!historyRecords || historyRecords.length === 0 ? (
            <div className="card text-center py-10">
              <p className="text-zinc-400 text-sm">还没有批改记录</p>
              <button
                onClick={() => setViewMode('new')}
                className="mt-2 text-sm font-medium text-brand-500 hover:text-brand-600"
              >
                去写一篇吧 ✍️
              </button>
            </div>
          ) : (
            historyRecords.map(record => {
              const scoreMain = record.score.split('(')[0]?.trim() || record.score
              let savedErrors: Array<{ errorType?: string }> = []
              try {
                const parsed = JSON.parse(record.errors || '[]')
                if (Array.isArray(parsed)) savedErrors = parsed
              } catch {
                savedErrors = []
              }
              const grammarErrorCount = savedErrors.filter(error => error.errorType === 'grammar').length
              const dateStr = new Date(record.createdAt).toLocaleString('zh-CN', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })
              const preview = record.topic || record.essay.slice(0, 60)
              return (
                <div
                  key={record.id}
                  onClick={() => handleViewRecord(record)}
                  className="card border cursor-pointer hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <Clock size={12} />
                      <span>{dateStr}</span>
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-zinc-100 dark:bg-zinc-800 font-medium">
                        {gradeLabel(record.grade)}
                      </span>
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        if (record.id != null) handleDeleteRecord(record.id)
                      }}
                      className="p-1 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg text-zinc-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 line-clamp-1">
                    {preview || '（无内容）'}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/40 px-2 py-0.5 rounded-full">
                      {scoreMain}
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      语法错误 {grammarErrorCount} 处 · 全部问题 {savedErrors.length} 处
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ── 步骤 1: 上传 ── */}
      {viewMode === 'new' && (step === 'upload' || step === 'ocr-loading') && (
        <div className="space-y-4">
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

          {imagePreview ? (
            <div className="space-y-3">
              <img src={imagePreview} alt="作文照片"
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 max-h-64 object-contain bg-zinc-50 dark:bg-zinc-900" />
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => void handleTakeEssayPhoto()}
                  className="btn-ghost text-sm flex items-center justify-center gap-1"><Camera size={15} />重新拍照</button>
                <button onClick={() => fileRef.current?.click()}
                  className="btn-ghost text-sm flex items-center justify-center gap-1"><ImagePlus size={15} />更换图片</button>
                <button onClick={handleOCR} disabled={step === 'ocr-loading'}
                  className="btn-primary text-sm col-span-2 flex items-center justify-center gap-2">
                  {step === 'ocr-loading' ? <><Loader2 size={16} className="animate-spin" /> 识别中...</> : <><Search size={16} /> 识别文字</>}
                </button>
              </div>
            </div>
          ) : (
            <div className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-2xl p-6 text-center">
              <Camera size={38} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
              <p className="text-sm font-medium text-zinc-500 mb-3">添加手写作文照片</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => void handleTakeEssayPhoto()} className="btn-primary text-sm flex items-center justify-center gap-1.5"><Camera size={16} />直接拍照</button>
                <button onClick={() => fileRef.current?.click()} className="btn-ghost text-sm flex items-center justify-center gap-1.5"><ImagePlus size={16} />从相册选择</button>
              </div>
              <p className="text-xs text-zinc-400 mt-3">支持 JPG、PNG，不超过 10MB</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
            <span className="text-xs text-zinc-400">或者</span>
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
          </div>

          <button onClick={handleSkipOCR}
            className="w-full py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex items-center justify-center gap-2">
            <Pencil size={16} />直接输入文本（跳过拍照）
          </button>
        </div>
      )}

      {/* ── 步骤 2: 题目 + 核对 ── */}
      {viewMode === 'new' && (step === 'review' || step === 'correcting') && (
        <div className="space-y-4">
          {/* 题目输入 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-500">
                作文题目 / 写作要求
                <span className="text-zinc-400 font-normal ml-1">（AI 会根据题目评价是否切题）</span>
              </label>
              <div className="flex items-center gap-3">
                <button onClick={() => void handleTakeTopicPhoto()} className="flex items-center gap-1 text-[10px] text-brand-500 hover:text-brand-600 font-medium">
                  <Camera size={14} />拍题目
                </button>
                <button onClick={() => topicFileRef.current?.click()} className="flex items-center gap-1 text-[10px] text-brand-500 hover:text-brand-600 font-medium">
                  <ImagePlus size={14} />选图片
                </button>
              </div>
            </div>
            <input ref={topicFileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleTopicFile(f); e.target.value = '' }} />

            <textarea
              value={topic}
              onChange={e => setTopic(e.target.value)}
              className="input min-h-[80px] resize-y text-sm"
              placeholder={`输入或拍照上传作文题目...
例如：
假设你是李华，你的英国笔友 Tom 来信询问你上个周末是如何度过的。请给他回一封邮件，内容包括：
1. 描述你周末做的一件有趣的事
2. 你的感受和收获
注意：词数 100 左右，可适当增加细节。`}
              rows={4}
            />

            {/* 题目照片预览 */}
            {topicImagePreview && (
              <div className="mt-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 space-y-2">
                <img src={topicImagePreview} alt="题目照片"
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 max-h-40 object-contain bg-white dark:bg-zinc-800" />
                <div className="flex gap-2">
                  <button onClick={() => { setTopicImagePreview(null); setTopicImageBase64('') }}
                    className="btn-ghost text-xs flex-1">取消</button>
                  <button onClick={handleTopicOCR} disabled={topicOCRLoading}
                    className="btn-primary text-xs flex-1 flex items-center justify-center gap-1.5">
                    {topicOCRLoading ? <><Loader2 size={12} className="animate-spin" /> 识别中...</> : <><Search size={12} /> 识别题目文字</>}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 年级提示 */}
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span>评分标准：</span>
            <span className="font-medium text-brand-600 dark:text-brand-400">{gradeLabel(user?.grade || 'highschool')}</span>
            <span>（根据你的年级自动适配）</span>
          </div>

          {/* 作文内容 */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs font-medium text-zinc-500">作文内容</label>
              <span className="text-[10px] text-zinc-400">请核对并修改识别结果</span>
            </div>
            <textarea
              value={recognizedText}
              onChange={e => setRecognizedText(e.target.value)}
              className="input min-h-[180px] resize-y text-sm leading-relaxed"
              placeholder="在此输入或修改作文内容..."
              autoFocus
            />
          </div>

          <div className="flex gap-2">
            <button onClick={() => { setStep('upload'); setResult(null) }} className="btn-ghost text-sm flex-1">← 返回</button>
            <button onClick={handleCorrect} disabled={!hasText || step === 'correcting'}
              className="btn-primary text-sm flex-1 flex items-center justify-center gap-2">
              {step === 'correcting' ? <><Loader2 size={16} className="animate-spin" /> 批改中...</> : <><Sparkles size={16} /> 开始批改</>}
            </button>
          </div>
        </div>
      )}

      {/* ── 步骤 3: 结果 ── */}
      {step === 'result' && result && (
        <div className="space-y-4">
          {/* 评分 */}
          <div className="card flex items-center gap-4 !p-5 bg-gradient-to-r from-brand-50 to-purple-50 dark:from-brand-950/30 dark:to-purple-950/30 border-brand-200 dark:border-brand-900">
            <div className="w-16 h-16 rounded-full bg-white dark:bg-zinc-900 flex items-center justify-center border-2 border-brand-300">
              <span className="text-2xl font-bold text-brand-600 dark:text-brand-400">{result.score.split('(')[0]?.trim() || result.score}</span>
            </div>
            <div className="flex-1">
              <p className="text-lg font-bold">综合评分</p>
              <p className="text-sm text-zinc-500">{result.score}</p>
            </div>
          </div>

          {/* 内容评价 */}
          {result.contentFeedback && (
            <div className="card border !p-4">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquareText size={16} className="text-blue-500" />
                <span className="text-sm font-medium">内容评价</span>
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{result.contentFeedback}</p>
            </div>
          )}

          {/* 亮点 */}
          {result.highlights && (
            <div className="card border !p-4 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
              <div className="flex items-center gap-2 mb-2">
                <Star size={16} className="text-emerald-500" />
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">亮点</span>
              </div>
              <p className="text-sm text-emerald-600/80 dark:text-emerald-400/80 leading-relaxed">{result.highlights}</p>
            </div>
          )}

          {/* 问题列表 */}
          {result.errors.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ShieldAlert size={16} className="text-red-500" />
                <span className="text-sm font-medium">
                  共 {result.errors.length} 个问题
                  <span className="text-[10px] text-zinc-400 font-normal ml-1.5">
                    （
                    {(() => {
                      const c: Record<string, number> = {}
                      result.errors.forEach(e => { c[e.errorType] = (c[e.errorType] || 0) + 1 })
                      const lb: Record<string, string> = { grammar: '语法', spelling: '拼写', word_choice: '用词', punctuation: '标点', expression: '表达' }
                      return Object.entries(c).map(([k, v]) => `${lb[k] || k} ${v}`).join(' · ')
                    })()}
                    ）
                  </span>
                  {appliedErrors.size > 0 && (
                    <span className="text-emerald-500 ml-1">— 已修正 {appliedErrors.size} 处</span>
                  )}
                </span>
              </div>
              <div className="space-y-2">
                {result.errors.map((err, i) => {
                  const colors = ERROR_COLORS[err.errorType] || ERROR_COLORS.grammar
                  const isApplied = appliedErrors.has(i)
                  return (
                    <div key={i} className={clsx(
                      'card border !p-3 transition-colors',
                      isApplied
                        ? 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900'
                        : `${colors.bg} ${colors.border}`
                    )}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded-full border', isApplied ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : `${colors.bg} ${colors.text} border-[currentColor]`)}>
                          {isApplied ? '✓ 已修正' : colors.label}
                        </span>
                        {!isApplied ? (
                          <button
                            onClick={() => handleApplyCorrection(i, err.original, err.correction)}
                            className="text-[10px] font-medium text-brand-500 hover:text-brand-600 bg-brand-50 dark:bg-brand-950/30 hover:bg-brand-100 dark:hover:bg-brand-950/50 px-2 py-0.5 rounded-full transition-colors"
                          >
                            ✨ 应用修改
                          </button>
                        ) : (
                          <button
                            onClick={() => handleUndoCorrection(i, err.original, err.correction)}
                            className="text-[10px] font-medium text-zinc-500 hover:text-amber-600 bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-50 dark:hover:bg-amber-950/30 px-2 py-0.5 rounded-full transition-colors"
                          >
                            ↩ 撤销
                          </button>
                        )}
                      </div>
                      <div className="flex items-baseline gap-2 mt-2 text-base">
                        <span className={clsx(isApplied ? 'text-zinc-400' : 'line-through text-red-400')}>
                          {err.original}
                        </span>
                        <span className="text-zinc-300 dark:text-zinc-600">→</span>
                        <span className="text-emerald-500 font-bold">{err.correction}</span>
                      </div>
                      <p className="text-xs text-zinc-500 mt-1">{err.explanation}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── 修改后的全文（可编辑） ── */}
          {(essayWorkingCopy != null || appliedErrors.size > 0 || essayEdited) && (
            <div className="card border !p-4 bg-emerald-50/30 dark:bg-emerald-950/15 border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                    📝 修改后的作文
                  </span>
                  {essayEdited && (
                    <span className="text-[10px] text-zinc-400">（手动编辑中）</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEssayWorkingCopy(null)
                      setAppliedErrors(new Set())
                      setEssayEdited(false)
                    }}
                    className="text-[10px] text-zinc-400 hover:text-red-500 transition-colors"
                  >
                    重置所有修改
                  </button>
                  <button
                    onClick={handleReCorrect}
                    className="text-[10px] font-medium text-brand-500 hover:text-brand-600 bg-brand-50 dark:bg-brand-950/30 hover:bg-brand-100 dark:hover:bg-brand-950/50 px-2.5 py-1 rounded-full transition-colors flex items-center gap-1"
                  >
                    <Sparkles size={10} /> 重新批改
                  </button>
                </div>
              </div>
              <textarea
                value={getWorkingEssay()}
                onChange={e => {
                  setEssayWorkingCopy(e.target.value)
                  setEssayEdited(true)
                }}
                className="input min-h-[120px] resize-y text-sm leading-relaxed bg-white dark:bg-zinc-900"
                placeholder="作文内容..."
              />
              <p className="text-[10px] text-zinc-400 mt-1.5">
                💡 可以直接编辑文本，或点击错误卡片中的「✨ 应用修改」逐个修正。满意后点「✨ 重新批改」查看新评分。
              </p>
            </div>
          )}

          {/* 范文 */}
          {result.modelEssay && (
            <div className="card border !p-4 bg-gradient-to-r from-indigo-50/50 to-violet-50/50 dark:from-indigo-950/20 dark:to-violet-950/20 border-indigo-200 dark:border-indigo-800">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">📖</span>
                <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                  参考范文
                  <span className="text-[10px] text-indigo-400 font-normal ml-2">
                    保留你的原意，语言质量 ≥85 分，用词匹配年级水平
                  </span>
                </span>
              </div>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {result.modelEssay}
              </p>
            </div>
          )}

          {/* 总体建议 */}
          {result.overallComment && (
            <div className="card border !p-4 bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb size={16} className="text-amber-500" />
                <span className="text-sm font-medium text-amber-700 dark:text-amber-300">提升建议</span>
              </div>
              <p className="text-sm text-amber-600/80 dark:text-amber-400/80 leading-relaxed">{result.overallComment}</p>
            </div>
          )}

          {/* 无错误时的正面反馈 */}
          {result.errors.length === 0 && (
            <div className="card flex items-center gap-3 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900">
              <Check size={20} className="text-emerald-500" />
              <div>
                <p className="font-medium text-emerald-700 dark:text-emerald-300">没有发现语言错误！</p>
                <p className="text-xs text-emerald-500/70">写得很好 👍</p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {viewMode === 'new' ? (
              <button onClick={() => { setStep('review'); setResult(null) }} className="btn-ghost text-sm flex-1">修改作文</button>
            ) : (
              <button onClick={() => { setStep('upload'); setResult(null); setViewMode('history') }} className="btn-ghost text-sm flex-1">← 返回列表</button>
            )}
            <button onClick={() => { setViewMode('new'); setStep('upload'); setImagePreview(null); setImageBase64(''); setRecognizedText(''); setTopic(''); setResult(null) }}
              className="btn-primary text-sm flex-1">批改新作文</button>
          </div>
        </div>
      )}
    </div>
  )
}
