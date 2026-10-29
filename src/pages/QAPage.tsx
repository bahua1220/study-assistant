import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, ImagePlus, Loader2, Send, MessageSquare, Trash2, Plus, X, History, RotateCcw, RotateCw } from 'lucide-react'
import clsx from 'clsx'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getCurrentOwnerId, type QAConversation, type QAMessage } from '../db'
import { qaText, submitQAVisionJob, getQAVisionJob, type QAMessageItem } from '../services/api'
import { useAuth, gradeLabel } from '../context/AuthContext'
import { takePhotoFile } from '../utils/camera'
import katex from 'katex'
import 'katex/dist/katex.min.css'

function renderFormula(formula: string, displayMode: boolean): string {
  try {
    return katex.renderToString(formula.trim(), {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      output: 'htmlAndMathml',
    })
  } catch {
    return formula
  }
}

function looksLikeLatex(value: string): boolean {
  return /\\(?:text|frac|sqrt|left|right|begin|end|Delta|cdot|times|rightarrow|rightleftharpoons|leftrightharpoons|mathrm|ce)\b|[_^]\{/.test(value)
}

// 简易 Markdown → HTML 渲染，并用 KaTeX 真正排版数学、物理和化学公式。
function renderMarkdown(text: string): string {
  const mathBlocks: string[] = []

  const protectMath = (formula: string, displayMode: boolean) => {
    const rendered = renderFormula(formula, displayMode)
    mathBlocks.push(
      displayMode
        ? `<div class="my-3 overflow-x-auto overflow-y-hidden py-1 text-center">${rendered}</div>`
        : `<span class="inline-math">${rendered}</span>`,
    )
    return `%%MATHBLOCK${mathBlocks.length - 1}%%`
  }

  // 先保护公式，避免后续 HTML 转义和 Markdown 规则破坏 KaTeX 输出。
  let html = text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, formula) => protectMath(formula, true))
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, formula) => protectMath(formula, true))
    .replace(/\\\((.+?)\\\)/g, (_, formula) => protectMath(formula, false))
    .replace(/\$(?!\$)(.+?)(?<!\$)\$/g, (_, formula) => protectMath(formula, false))

  // HTML 转义
  html = html
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // 代码块 ```
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-zinc-200 dark:bg-zinc-700 rounded-lg p-3 my-2 overflow-x-auto text-xs"><code>$2</code></pre>')
    // 模型偶尔会误把 LaTeX 包在反引号中：公式交给 KaTeX，真正的代码仍按代码显示。
    .replace(/`([^`]+)`/g, (_, value) => {
      if (looksLikeLatex(value)) return protectMath(value, false)
      return `<code class="bg-zinc-200 dark:bg-zinc-700 px-1 py-0.5 rounded text-xs font-mono">${value}</code>`
    })
    // 标题
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-bold mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-3 mb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-3 mb-1">$1</h1>')
    // 粗体 **text**
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 无序列表
    .replace(/^[*-] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // 有序列表
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // 水平线
    .replace(/^---+$/gm, '<hr class="my-2 border-zinc-300 dark:border-zinc-600">')
    // 段落间空行
    .replace(/\n\n/g, '</p><p class="my-1">')
    // 单换行 → <br>
    .replace(/\n/g, '<br>')

  // 还原数学块
  mathBlocks.forEach((block, i) => {
    html = html.replace(`%%MATHBLOCK${i}%%`, block)
  })

  html = '<p class="my-1">' + html + '</p>'
  return html
}

export function QAPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const [conversationId, setConversationId] = useState<number | null>(null)
  const [inputText, setInputText] = useState('')
  const [inputImages, setInputImages] = useState<Array<{ id: string; preview: string; base64: string }>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const username = user?.username || ''

  // 当前对话的消息
  const messages = useLiveQuery(
    () =>
      conversationId != null
        ? db.qaMessages.where('conversationId').equals(conversationId).sortBy('createdAt')
        : [],
    [conversationId]
  )

  // 对话列表（按 ownerId 隔离）
  const conversations = useLiveQuery(
    () =>
      db.qaConversations
        .where('ownerId')
        .equals(getCurrentOwnerId())
        .reverse()
        .sortBy('updatedAt'),
    []
  )

  const pendingMessages = useLiveQuery(
    async () => {
      const userConversations = await db.qaConversations.where('ownerId').equals(getCurrentOwnerId()).toArray()
      const conversationIds = userConversations.map(item => item.id!).filter(Boolean)
      if (!conversationIds.length) return []
      return db.qaMessages
        .where('conversationId')
        .anyOf(conversationIds)
        .filter(message => Boolean(message.pendingTaskId))
        .toArray()
    },
    []
  )

  // 自动滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const pendingTaskIds = (pendingMessages ?? [])
    .filter(message => message.pendingTaskId)
    .map(message => message.pendingTaskId)
    .join(',')

  // 后台答疑恢复：切后台、锁屏或重启 APP 后，继续查询服务器任务并回填答案。
  useEffect(() => {
    if (!pendingTaskIds) return
    let stopped = false
    let checking = false

    const checkPendingTasks = async () => {
      if (checking || stopped) return
      checking = true
      try {
        const userConversations = await db.qaConversations.where('ownerId').equals(getCurrentOwnerId()).toArray()
        const conversationIds = userConversations.map(item => item.id!).filter(Boolean)
        const currentPendingMessages = conversationIds.length
          ? await db.qaMessages
              .where('conversationId')
              .anyOf(conversationIds)
              .filter(message => Boolean(message.pendingTaskId))
              .toArray()
          : []
        for (const message of currentPendingMessages) {
          if (!message.id || !message.pendingTaskId || stopped) continue
          try {
            const task = await getQAVisionJob(message.pendingTaskId)
            if (task.status === 'completed') {
              await db.qaMessages.update(message.id, {
                content: task.content,
                pendingTaskId: undefined,
                taskStatus: undefined,
              })
              await db.qaConversations.update(message.conversationId, { updatedAt: new Date().toISOString() })
            } else if (task.status === 'failed') {
              await db.qaMessages.update(message.id, {
                content: `图片答疑失败：${task.error || '请重新发送图片'}`,
                pendingTaskId: undefined,
                taskStatus: 'failed',
              })
            } else {
              await db.qaMessages.update(message.id, {
                content: task.status === 'processing' ? '正在分析图片，切到后台也会继续…' : '答疑任务已提交，正在排队…',
                taskStatus: task.status,
              })
            }
          } catch {
            // 临时断网时保留任务编号，下次回前台继续查询，不能误判为任务失败。
          }
        }
      } finally {
        checking = false
      }
    }

    void checkPendingTasks()
    const timer = window.setInterval(() => void checkPendingTasks(), 4000)
    const resume = () => { if (document.visibilityState === 'visible') void checkPendingTasks() }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', resume)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', resume)
    }
  }, [pendingTaskIds])

  // 处理图片选择
  const handlePickImage = () => {
    fileRef.current?.click()
  }

  const prepareImage = (file: File): Promise<{ id: string; preview: string; base64: string }> => new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件'))
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error('单张图片不能超过 10MB'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const image = new Image()
      image.onload = () => {
        const maxEdge = 2200
        const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('图片处理失败，请重新选择'))
          return
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const optimized = canvas.toDataURL('image/jpeg', 0.9)
        resolve({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          preview: optimized,
          base64: optimized.split(',')[1],
        })
      }
      image.onerror = () => reject(new Error('无法读取该图片，请换一张重试'))
      image.src = dataUrl
    }
    reader.onerror = () => reject(new Error('图片读取失败，请重试'))
    reader.readAsDataURL(file)
  })

  const appendImageFiles = async (files: File[]) => {
    const available = 4 - inputImages.length
    if (available <= 0) {
      setErrorMessage('一次最多上传 4 张图片')
      return
    }
    const selected = files.slice(0, available)
    try {
      const prepared = await Promise.all(selected.map(prepareImage))
      setInputImages(current => [...current, ...prepared].slice(0, 4))
      setErrorMessage(files.length > available ? `最多保留 4 张，已添加前 ${available} 张` : '')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '图片处理失败')
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) void appendImageFiles(files)
    e.target.value = ''
  }

  const handleTakePhoto = async () => {
    setErrorMessage('')
    try {
      const file = await takePhotoFile('question')
      if (file) await appendImageFiles([file])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '拍照失败')
    }
  }

  const handleRemoveImage = (id: string) => {
    setInputImages(current => current.filter(image => image.id !== id))
  }

  const rotateInputImage = (id: string, degrees: -90 | 90) => {
    const target = inputImages.find(image => image.id === id)
    if (!target) return
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalHeight
      canvas.height = image.naturalWidth
      const context = canvas.getContext('2d')
      if (!context) {
        setErrorMessage('图片旋转失败，请重新选择图片')
        return
      }

      context.translate(canvas.width / 2, canvas.height / 2)
      context.rotate((degrees * Math.PI) / 180)
      context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)

      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      setInputImages(current => current.map(item => item.id === id
        ? { ...item, preview: dataUrl, base64: dataUrl.split(',')[1] }
        : item))
      setErrorMessage('')
    }
    image.onerror = () => setErrorMessage('图片旋转失败，请重新选择图片')
    image.src = target.preview
  }

  // 发送消息
  const handleSend = async () => {
    const text = inputText.trim()
    if (!text && inputImages.length === 0) return
    if (isLoading) return
    const totalBase64Size = inputImages.reduce((total, image) => total + image.base64.length, 0)
    if (totalBase64Size > 12 * 1024 * 1024) {
      setErrorMessage('图片合计过大，请删除一张或分两次拍摄后再发送')
      return
    }

    setErrorMessage('')
    setIsLoading(true)

    try {
      let convId: number

      // 如果没有当前对话，先创建
      if (conversationId == null) {
        const id = await db.qaConversations.add({
          ownerId: getCurrentOwnerId(),
          username,
          title: text.slice(0, 50) || '图片提问',
          grade: user?.grade || 'highschool',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        convId = id as number
        setConversationId(convId)
      } else {
        convId = conversationId
        // 更新对话时间
        await db.qaConversations.update(convId, { updatedAt: new Date().toISOString() })
      }

      // 保存用户消息
      await db.qaMessages.add({
        ownerId: getCurrentOwnerId(),
        conversationId: convId,
        role: 'user',
        content: text || `（${inputImages.length} 张图片）`,
        imagesBase64: inputImages.map(image => image.base64),
        createdAt: new Date().toISOString(),
      })

      // 构建 API 消息列表 — 取最近 20 条作为上下文
      const recentMessages = await db.qaMessages
        .where('conversationId')
        .equals(convId)
        .sortBy('createdAt')
      const context = recentMessages.slice(-21, -1) // 不包括刚刚加的那条 user 消息
      const apiMessages: QAMessageItem[] = [
        ...context.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        {
          role: 'user' as const,
          content: text || `请结合这 ${inputImages.length} 张图片解答`,
          images: inputImages.map(image => image.base64),
        },
      ]

      if (inputImages.length > 0) {
        const task = await submitQAVisionJob(apiMessages, user?.grade || 'highschool')
        await db.qaMessages.add({
          ownerId: getCurrentOwnerId(),
          conversationId: convId,
          role: 'assistant',
          content: '答疑任务已提交，正在分析图片…',
          pendingTaskId: task.taskId,
          taskStatus: task.status,
          createdAt: new Date().toISOString(),
        })
      } else {
        const res = await qaText(apiMessages, user?.grade || 'highschool')
        await db.qaMessages.add({
          ownerId: getCurrentOwnerId(),
          conversationId: convId,
          role: 'assistant',
          content: res.content,
          createdAt: new Date().toISOString(),
        })
      }
      await db.qaConversations.update(convId, { updatedAt: new Date().toISOString() })

      // 清空输入
      setInputText('')
      setInputImages([])
    } catch (e: any) {
      setErrorMessage(e.message || '请求失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }

  // 开始新对话
  const handleNewConversation = () => {
    setConversationId(null)
    setInputText('')
    setInputImages([])
    setErrorMessage('')
    setShowHistory(false)
  }

  // 切换对话
  const handleSelectConversation = (id: number) => {
    setConversationId(id)
    setShowHistory(false)
    setErrorMessage('')
  }

  // 删除对话
  const handleDeleteConversation = async (id: number) => {
    await db.qaMessages.where('conversationId').equals(id).delete()
    await db.qaConversations.delete(id)
    if (conversationId === id) {
      setConversationId(null)
    }
  }

  // 键盘发送
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const hasInput = inputText.trim().length > 0 || inputImages.length > 0
  const showWelcome = !conversationId || (messages && messages.length === 0)

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-lg shrink-0">
        <button onClick={() => navigate('/')} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-lg font-bold flex items-center gap-2 flex-1">🤖 答疑助手</h1>
        <button
          onClick={() => setShowHistory(true)}
          className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg relative"
        >
          <History size={20} />
          {conversations && conversations.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 text-[10px] bg-brand-500 text-white rounded-full flex items-center justify-center">
              {conversations.length}
            </span>
          )}
        </button>
        <button
          onClick={handleNewConversation}
          className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
          title="新对话"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* 错误提示 */}
      {errorMessage && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
          <span>⚠️</span> {errorMessage}
          <button onClick={() => setErrorMessage('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* 聊天消息区域 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {showWelcome && (
          <div className="text-center py-12">
            <div className="text-5xl mb-4">🤖</div>
            <p className="text-lg font-bold text-zinc-700 dark:text-zinc-300">你好！我是你的学习助手</p>
            <p className="text-sm text-zinc-400 mt-2">
              有什么问题尽管问我～<br />
              数学、物理、英语、作文……拍照也行 📷
            </p>
            {user && (
              <p className="text-xs text-zinc-400 mt-3">
                当前答疑标准：<span className="font-medium text-brand-500">{gradeLabel(user.grade)}</span>
              </p>
            )}
          </div>
        )}

        {messages?.map(msg => (
          <div key={msg.id} className={clsx('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={clsx(
              'max-w-[85%] rounded-2xl px-4 py-3',
              msg.role === 'user'
                ? 'bg-brand-500 text-white rounded-br-md'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-bl-md'
            )}>
              {/* 用户消息中的图片 */}
              {msg.imagesPruned && !msg.imagesBase64?.length && !msg.imageBase64 && (
                <div className="text-[10px] opacity-70 mb-1.5 bg-black/10 dark:bg-white/10 rounded-lg px-2 py-1">
                  图片已清理（节省空间），文字记录保留
                </div>
              )}
              {(msg.imagesBase64?.length || msg.imageBase64) && (
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                  {(msg.imagesBase64?.length ? msg.imagesBase64 : [msg.imageBase64!]).map((base64, index) => (
                    <img
                      key={`${msg.id}-${index}`}
                      src={`data:image/jpeg;base64,${base64}`}
                      alt={`提问图片 ${index + 1}`}
                      className="rounded-lg max-h-48 w-full object-contain bg-black/5"
                    />
                  ))}
                </div>
              )}
              {/* 文字内容 — AI 消息渲染 Markdown，用户消息纯文本 */}
              {msg.role === 'assistant' ? (
                <div
                  className="text-sm leading-relaxed break-words qa-markdown"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
              ) : (
                <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* 加载中 */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* 输入栏 */}
      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-lg shrink-0">
        {/* 图片预览 */}
        {inputImages.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-500">已选 {inputImages.length}/4 张 · 按顺序合并理解</span>
              <button type="button" onClick={() => setInputImages([])} className="text-xs text-zinc-400">清空</button>
            </div>
            <div className="flex gap-2 overflow-x-auto py-1">
              {inputImages.map((item, index) => (
                <div key={item.id} className="relative shrink-0 w-28 rounded-xl border border-zinc-200 dark:border-zinc-700 p-1.5 bg-white dark:bg-zinc-900">
                  <span className="absolute top-2 left-2 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{index + 1}</span>
                  <img src={item.preview} alt={`待发送图片 ${index + 1}`} className="h-20 w-full rounded-lg object-contain bg-black/5" />
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(item.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-zinc-800 text-white rounded-full flex items-center justify-center"
                    aria-label={`移除第 ${index + 1} 张图片`}
                  ><X size={12} /></button>
                  <div className="flex justify-center gap-1 mt-1.5">
                    <button type="button" onClick={() => rotateInputImage(item.id, -90)} className="p-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800" aria-label="向左旋转"><RotateCcw size={15} /></button>
                    <button type="button" onClick={() => rotateInputImage(item.id, 90)} className="p-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800" aria-label="向右旋转"><RotateCw size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />

          <button
            onClick={() => void handleTakePhoto()}
            disabled={inputImages.length >= 4}
            className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shrink-0"
            aria-label="拍照提问"
            title="拍照"
          >
            <Camera size={20} className="text-zinc-500" />
          </button>

          <button
            onClick={handlePickImage}
            disabled={inputImages.length >= 4}
            className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shrink-0"
            aria-label="从相册选择"
            title="从相册选择"
          >
            <ImagePlus size={20} className="text-zinc-500" />
          </button>

          <textarea
            ref={inputRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的问题..."
            rows={1}
            className="flex-1 resize-none bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2.5 text-sm
              placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-500/50
              max-h-32"
          />

          <button
            onClick={handleSend}
            disabled={!hasInput || isLoading}
            className={clsx(
              'p-2.5 rounded-xl shrink-0 transition-colors',
              hasInput && !isLoading
                ? 'bg-brand-500 text-white hover:bg-brand-600'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed'
            )}
          >
            {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          </button>
        </div>
      </div>

      {/* ── 历史记录侧边栏 ── */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex">
          {/* 遮罩 */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowHistory(false)} />
          {/* 面板 */}
          <div className="relative ml-auto w-80 max-w-[85vw] h-full bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <h2 className="font-bold text-sm">对话记录</h2>
              <button onClick={() => setShowHistory(false)} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* 新对话按钮 */}
              <button
                onClick={handleNewConversation}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-brand-500 font-medium hover:bg-brand-50 dark:hover:bg-brand-950/30 border-b border-zinc-100 dark:border-zinc-900"
              >
                <Plus size={18} /> 新对话
              </button>

              {!conversations || conversations.length === 0 ? (
                <div className="text-center py-12 text-sm text-zinc-400">
                  <MessageSquare size={32} className="mx-auto mb-2 text-zinc-300 dark:text-zinc-600" />
                  还没有对话记录
                </div>
              ) : (
                conversations.map(conv => (
                  <div
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv.id!)}
                    className={clsx(
                      'flex items-start gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-900 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors',
                      conv.id === conversationId && 'bg-brand-50 dark:bg-brand-950/20'
                    )}
                  >
                    <MessageSquare size={18} className="shrink-0 mt-0.5 text-zinc-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{conv.title}</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5">
                        {new Date(conv.updatedAt).toLocaleString('zh-CN', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        if (conv.id != null) handleDeleteConversation(conv.id)
                      }}
                      className="p-1 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg text-zinc-400 hover:text-red-500 shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
