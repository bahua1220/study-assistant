// ─── 工具 ───────────────────────────────────────────────
import { redirectToLogin } from '../lib/authRedirect'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`
}

async function apiFetch<T>(url: string, body: unknown, logoutOnUnauthorized = true): Promise<T> {
  let resp: Response
  try {
    resp = await fetch(apiUrl(url), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/timeout|timed out|aborted/i.test(message)) {
      throw new Error('AI 处理时间较长，请减少图片数量后重试')
    }
    throw new Error('连接中断，请检查网络后重试；多图答疑可尝试减少一张图片')
  }

  const raw = await resp.text()
  let data: any
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    throw new Error('服务器返回了异常页面，请检查后端服务是否正常')
  }

  if (!resp.ok) {
    if (resp.status === 401 && logoutOnUnauthorized) redirectToLogin()
    throw new Error(data?.detail ?? `请求失败 (${resp.status})`)
  }

  return data as T
}

async function apiRequest<T>(url: string, method: 'GET' | 'PUT'): Promise<T> {
  let resp: Response
  try {
    resp = await fetch(apiUrl(url), {
      method,
      headers: authHeaders(),
    })
  } catch {
    throw new Error('无法连接服务器，请检查网络或稍后重试')
  }
  const raw = await resp.text()
  let data: any
  try { data = raw ? JSON.parse(raw) : null } catch { throw new Error('服务器返回了异常页面') }
  if (!resp.ok) {
    if (resp.status === 401) redirectToLogin()
    throw new Error(data?.detail ?? `请求失败 (${resp.status})`)
  }
  return data as T
}

async function apiPut<T>(url: string, body: unknown): Promise<T> {
  let resp: Response
  try {
    resp = await fetch(apiUrl(url), { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) })
  } catch { throw new Error('无法连接服务器，请检查网络或稍后重试') }
  const raw = await resp.text()
  let data: any
  try { data = raw ? JSON.parse(raw) : null } catch { throw new Error('服务器返回了异常页面') }
  if (!resp.ok) {
    if (resp.status === 401) redirectToLogin()
    throw new Error(data?.detail ?? `请求失败 (${resp.status})`)
  }
  return data as T
}

// ─── 认证 ───────────────────────────────────────────────
export interface UserInfo {
  id: number
  username: string
  nickname: string
  grade: string
}

export interface AuthResult {
  token: string
  user: UserInfo
}

export async function authLogin(username: string, password: string): Promise<AuthResult> {
  return apiFetch<AuthResult>('/api/auth/login', { username, password }, false)
}

export async function authRegister(username: string, password: string, nickname: string, grade: string): Promise<AuthResult> {
  return apiFetch<AuthResult>('/api/auth/register', { username, password, nickname, grade }, false)
}

// ─── 单词查询 ───────────────────────────────────────────
export interface LookupResult {
  word: string
  phonetic: string
  translation: string
  pos: string
  posCn: string
  example: string
  exampleTranslation: string
  tags?: string[]
  exchange?: string
}

export async function lookupWord(word: string, preferDictionary = false): Promise<LookupResult> {
  return apiFetch<LookupResult>('/api/word-lookup', { word: word.trim(), preferDictionary })
}

export interface RecognizedVocabWord {
  word: string
  phonetic: string
  translation: string
  pos: string
  source: 'dictionary' | 'ai' | 'unresolved'
  tags: string[]
  exchange: string
}

export async function lookupVocabBatch(words: string[]): Promise<{ words: RecognizedVocabWord[] }> {
  return apiFetch('/api/vocab/lookup-batch', { words })
}

export async function recognizeVocab(image: string, mimeType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'): Promise<{ words: RecognizedVocabWord[]; limitReached?: boolean }> {
  try { return await apiFetch('/api/vocab/recognize', { image, mimeType }) }
  catch (cause) {
    if (cause instanceof Error && ['Not Found', '请求失败 (404)'].includes(cause.message)) {
      throw new Error('服务器未安装单词拍照识别接口，请更新后端后重试')
    }
    throw cause
  }
}

export interface VocabBookInfo {
  id: string
  name: string
  description: string
  wordCount: number
}

export interface VocabBookWord {
  word: string
  phonetic: string
  translation: string
  pos: string
  tags: string[]
  exchange: string
  choices: string[]
}

export interface VocabBookWordsResponse {
  bookId: string
  words: VocabBookWord[]
  nextOffset: number
  finished: boolean
}

export async function getVocabBooks(): Promise<VocabBookInfo[]> {
  return apiRequest('/api/vocab/books', 'GET')
}

export async function getVocabBookWords(bookId: string, offset: number, limit: number, seed: string): Promise<VocabBookWordsResponse> {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit), seed })
  return apiRequest(`/api/vocab/books/${encodeURIComponent(bookId)}/words?${query}`, 'GET')
}

export interface CloudBackupStatus {
  exists: boolean
  version?: number
  itemCount: number
  updatedAt?: string
}

export interface CloudBackupResponse extends CloudBackupStatus {
  data?: Record<string, Record<string, unknown>[]>
}

export async function getBackupStatus(): Promise<CloudBackupStatus> {
  return apiRequest('/api/backup/status', 'GET')
}

export async function uploadCloudBackup(data: Record<string, Record<string, unknown>[]>): Promise<CloudBackupStatus> {
  return apiPut('/api/backup', { version: 1, data })
}

export async function downloadCloudBackup(): Promise<CloudBackupResponse> {
  return apiRequest('/api/backup', 'GET')
}

// ─── 作文批改 ───────────────────────────────────────────

export interface EssayOCRResult {
  recognized: string
}

export async function essayOCR(imageBase64: string): Promise<EssayOCRResult> {
  return apiFetch<EssayOCRResult>('/api/essay-ocr', { image: imageBase64 })
}

export interface EssayError {
  original: string
  correction: string
  errorType: 'grammar' | 'spelling' | 'word_choice' | 'punctuation' | 'expression'
  explanation: string
}

export interface EssayCorrectResult {
  score: string
  contentFeedback: string
  highlights: string
  overallComment: string
  errors: EssayError[]
  modelEssay: string
}

export async function essayCorrect(text: string, topic: string, level: string): Promise<EssayCorrectResult> {
  return apiFetch<EssayCorrectResult>('/api/essay-correct', { essay: text, topic, level })
}

// ─── 答疑助手 ───────────────────────────────────────────

export interface QAMessageItem {
  role: 'user' | 'assistant'
  content: string
  image?: string    // base64，仅用户消息可能有
  images?: string[] // base64，最多 4 张；image 保留用于兼容旧记录
}

export interface QAResponse {
  content: string
}

export async function qaText(messages: QAMessageItem[], grade: string): Promise<QAResponse> {
  return apiFetch<QAResponse>('/api/qa-text', { messages, grade })
}

export async function qaVision(messages: QAMessageItem[], grade: string): Promise<QAResponse> {
  return apiFetch<QAResponse>('/api/qa-vision', { messages, grade })
}

export interface QAVisionJobSubmitResponse {
  taskId: string
  status: 'pending' | 'processing'
}

export interface QAVisionJobStatusResponse {
  taskId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  content: string
  error: string
}

export async function submitQAVisionJob(messages: QAMessageItem[], grade: string): Promise<QAVisionJobSubmitResponse> {
  return apiFetch<QAVisionJobSubmitResponse>('/api/qa-vision/jobs', { messages, grade })
}

export async function getQAVisionJob(taskId: string): Promise<QAVisionJobStatusResponse> {
  return apiRequest<QAVisionJobStatusResponse>(`/api/qa-vision/jobs/${encodeURIComponent(taskId)}`, 'GET')
}

// ─── 试卷错题分析 ────────────────────────────────────────
export interface ExamExtractResult {
  questionText: string
  questionType: string
  subject: string
}

export interface ExamAnalysisResult {
  chapter: string
  knowledgePoints: string[]
  prerequisiteKnowledge: string[]
  difficulty: '基础' | '中等' | '较难'
  analysisSummary: string
  reviewAdvice: string
  suggestedErrorReasons: string[]
}

export interface GeneratedPracticeItem {
  content: string
  answer: string
  explanation: string
  difficulty: '基础' | '中等' | '较难'
  knowledgePoint: string
}

export async function extractExamQuestion(image: string, subject: string, grade: string): Promise<ExamExtractResult> {
  return apiFetch('/api/exam/extract-question', { image, subject, grade })
}

export async function analyzeExamQuestion(questionText: string, subject: string, grade: string, errorReason: string): Promise<ExamAnalysisResult> {
  return apiFetch('/api/exam/analyze-question', { questionText, subject, grade, errorReason })
}

export async function solveExamQuestion(questionText: string, subject: string, grade: string): Promise<{ answer: string }> {
  return apiFetch('/api/exam/solve-question', { questionText, subject, grade })
}

export async function generateExamPractice(
  questionText: string,
  subject: string,
  grade: string,
  knowledgePoints: string[],
  difficulty: '基础' | '中等' | '较难',
): Promise<{ questions: GeneratedPracticeItem[] }> {
  return apiFetch('/api/exam/generate-practice', { questionText, subject, grade, knowledgePoints, difficulty })
}
