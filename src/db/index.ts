import Dexie, { type EntityTable } from 'dexie'

export interface OwnedByUser {
  ownerId: number
}

// ─── 打卡任务 ───────────────────────────────────────────
export type HabitCategory = 'study' | 'exercise' | 'reading' | 'life' | 'other'
export type HabitFrequency = 'daily' | 'weekly' | 'custom'
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6 // 0=周日, 1=周一...
export type HabitTaskType = 'general' | 'learning'
export type HabitMetricUnit = '次' | '题' | '页' | '分钟' | '单词'
export type HabitLearningMode = 'fixed' | 'free' | 'quantity'
export type CheckInLevel = 'excellent' | 'standard' | 'partial' | 'none'

export interface Habit extends OwnedByUser {
  id?: number
  name: string
  emoji: string           // 任务图标
  category: HabitCategory
  frequency: HabitFrequency
  /** 自定义频率时，指定哪些天需要打卡 (0-6) */
  activeDays: WeekDay[]
  /** 每日目标次数/时长（分钟） */
  targetCount: number
  /** 普通习惯或学习任务；旧记录缺省视为普通习惯 */
  taskType?: HabitTaskType
  /** 学习任务所属科目 */
  subject?: string
  /** 固定题量、自由刷题或仅统计数量 */
  learningMode?: HabitLearningMode
  unit?: HabitMetricUnit
  highTargetCount?: number
  trackAccuracy?: boolean
  targetAccuracy?: number
  highAccuracy?: number
  /** 固定题量模式按最多错题数判断 */
  standardMaxErrors?: number
  highMaxErrors?: number
  /** 未完成的数量是否允许在次日补做；只顺延一天 */
  carryOver?: boolean
  /** 颜色标记 */
  color: string
  archived: number          // 0 = active, 1 = archived
  createdAt: string       // ISO date string
}

export interface HabitCheckIn extends OwnedByUser {
  id?: number
  habitId: number
  date: string            // 'YYYY-MM-DD'
  completed: boolean
  /** 实际完成次数/时长 */
  actualValue: number
  correctCount?: number
  accuracy?: number
  level?: CheckInLevel
  rewardCoins?: number
  rewardDiamonds?: number
  /** 用户已放弃该条次日待补任务 */
  carryOverDismissed?: boolean
  note: string
  createdAt: string
}

// ─── 积分记录 ───────────────────────────────────────────
export type PointAction = 'checkin' | 'streak_bonus' | 'milestone' | 'manual'

export interface PointRecord extends OwnedByUser {
  id?: number
  action: PointAction
  points: number
  habitId?: number
  description: string
  date: string
}

// ─── 单词本 / 闪卡 (FSRS) ───────────────────────────────
export type CardState = 0 | 1 | 2 | 3 // New | Learning | Review | Relearning
export type Rating = 1 | 2 | 3 | 4    // Again | Hard | Good | Easy

export interface VocabCard extends OwnedByUser {
  id?: number
  word: string
  translation: string
  partOfSpeech?: string    // 词性
  tags: string[]            // 标签：如 "雅思"、"动词"
  exchange?: string
  exampleSentence?: string
  phonetic?: string
  posCn?: string
  exampleTranslation?: string
  source?: 'manual' | 'dictionary' | 'ai'
  lemma?: string
  bookIds?: string[]
  notebookIds?: string[]

  // FSRS 调度字段
  due: Date
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  state: CardState
  lastReview?: Date

  createdAt: string
}

export interface ReviewLog extends OwnedByUser {
  id?: number
  cardId: number
  rating: Rating
  reviewedAt: Date
  testMode?: 'choice' | 'spelling'
  correct?: boolean
  timedOut?: boolean
  elapsedMs?: number
  answer?: string
}

export type VocabTestMode = 'choice' | 'spelling' | 'mixed'
export type VocabStudyPhase = 'screening' | 'learning' | 'retest' | 'completed'

export interface VocabNotebook extends OwnedByUser {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface VocabPlan extends OwnedByUser {
  id: string
  bookId: string
  bookName: string
  wordCount: number
  batchSize: number
  dailyTarget: number
  testMode: VocabTestMode
  focusLock: boolean
  cursor: number
  shuffleSeed: string
  studiedWords?: string[]
  active: number           // Legacy compatibility marker, no longer an exclusive current-plan flag.
  status?: 'active' | 'paused' | 'deleted' // Missing means active, including legacy active=0.
  deletedAt?: string
  statusBeforeDelete?: 'active' | 'paused'
  createdAt: string
  updatedAt: string
}

export interface VocabSessionWord {
  word: string
  phonetic: string
  translation: string
  pos: string
  tags: string[]
  exchange: string
  choices: string[]
  cardId?: number
  firstCorrect?: boolean
  firstTimedOut?: boolean
  firstElapsedMs?: number
  firstAnswer?: string
  firstMode?: 'choice' | 'spelling'
  retestCorrect?: boolean
  retestAttempts?: number
}

export interface VocabLearningSession extends OwnedByUser {
  id: string
  planId?: string
  bookId: string
  bookName: string
  phase: VocabStudyPhase
  status: 'active' | 'completed' | 'abandoned'
  testMode: VocabTestMode
  focusLock: boolean
  sourceOffset: number
  nextOffset: number
  words: VocabSessionWord[]
  currentIndex: number
  retestQueue?: string[]
  /** New rounds use balanced mixed questions and at most two retest passes. */
  rulesVersion?: 2
  retestRound?: 1 | 2
  answerRevision?: number
  mistakeScope?: string
  interruptions: number
  startedAt: string
  updatedAt: string
  completedAt?: string
}

export interface VocabAttempt extends OwnedByUser {
  id: string
  sessionId: string
  bookId: string
  word: string
  phase: 'screening' | 'retest'
  mode: 'choice' | 'spelling'
  correct: boolean
  timedOut: boolean
  elapsedMs: number
  answer: string
  /** Immutable context; old attempts fall back to their session/card. */
  translation?: string
  phonetic?: string
  pos?: string
  bookName?: string
  retestRound?: 1 | 2
  createdAt: string
}

// ─── 课程表 ──────────────────────────────────────────────
export interface Course extends OwnedByUser {
  id?: number
  name: string
  teacher?: string
  classroom?: string
  dayOfWeek: number        // 0-6
  startTime: string        // 'HH:mm'
  endTime: string          // 'HH:mm'
  weekRange: [number, number] // [开始周, 结束周]
  color: string
  notes?: string
  semesterId?: number
}

export interface Semester extends OwnedByUser {
  id?: number
  name: string             // '2026 春季学期'
  startDate: string
  endDate: string
  isCurrent: boolean
}

// ─── 成绩分析 ───────────────────────────────────────────
export type GradeType = 'exam' | 'homework' | 'quiz' | 'project' | 'other'

export interface GradeEntry extends OwnedByUser {
  id?: number
  courseId?: number       // 关联课程（可选）
  courseName: string
  type: GradeType
  name: string            // 比如 '期中考试'、'作业一'
  score: number
  maxScore: number        // 默认 100
  weight: number          // 加权比例，默认 1
  date: string
  note?: string
}

// ─── 宠物 & 双货币 ──────────────────────────────────────
export interface Pet extends OwnedByUser {
  id?: number
  name: string
  avatar: string       // emoji 字符
  color: string        // 主色调 hex
  createdAt: string
}

export type CoinSource = 'checkin' | 'pomodoro' | 'vocab_review' | 'shop_purchase'

export interface CoinRecord extends OwnedByUser {
  id?: number
  amount: number
  source: CoinSource
  habitId?: number
  date: string          // 'YYYY-MM-DD'
  description: string
}

export type DiamondSource = 'target_met' | 'reward_redeem'

export interface DiamondRecord extends OwnedByUser {
  id?: number
  amount: number
  source: DiamondSource
  habitId?: number
  customRewardId?: number
  date: string
  description: string
}

export interface CustomDiamondReward extends OwnedByUser {
  id?: number
  name: string
  emoji: string
  price: number
  description?: string
  createdAt: string
}

export interface OwnedItem extends OwnedByUser {
  id?: number
  itemId: string        // 对应 shopItems 中的 id
  equipped: number       // 0 = 未装备, 1 = 已装备
}

// ─── Focus Sessions (番茄钟) ─────────────────────────────
export type SessionKind = 'pomodoro' | 'manual' | 'cards' | 'quiz'

export interface StudySession extends OwnedByUser {
  id?: number
  kind: SessionKind
  durationMinutes: number
  moduleName?: string     // 关联的课程/科目
  startedAt: Date
}

// ─── 作文批改记录 ─────────────────────────────────────────
export interface EssayRecord extends OwnedByUser {
  id?: number
  username: string          // 所属用户名（兼容旧数据；主隔离键为 ownerId）
  essay: string            // 作文原文
  topic: string            // 作文题目
  grade: string            // 年级水平
  score: string            // 评分，如 "B+ (82/100)"
  contentFeedback: string  // 内容评价
  highlights: string       // 亮点
  overallComment: string   // 提升建议
  errors: string           // JSON.stringify(EssayError[])
  modelEssay: string       // 范文
  createdAt: string        // ISO 时间戳
}

// ─── 答疑助手 ─────────────────────────────────────────────
export interface QAConversation extends OwnedByUser {
  id?: number
  username: string          // 所属用户名（兼容旧数据；主隔离键为 ownerId）
  title: string             // 第一条消息截取
  grade: string
  createdAt: string
  updatedAt: string
}

export interface QAMessage extends OwnedByUser {
  id?: number
  conversationId: number
  role: 'user' | 'assistant'
  content: string
  imageBase64?: string      // 用户消息可能含图片
  imagesBase64?: string[]   // 新版答疑支持同一条消息上传多张图片
  pendingTaskId?: string    // 后台图片答疑任务；完成后清空
  taskStatus?: 'pending' | 'processing' | 'failed'
  imagesPruned?: boolean    // 历史图片已被空间清理策略移除（仅保留文字）
  createdAt: string
}

// ─── 试卷错题分析 ────────────────────────────────────────
export type ExamStatus = 'draft' | 'selecting' | 'analyzing' | 'completed'

export interface ExamPaper extends OwnedByUser {
  id?: number
  title: string
  subject: string
  grade: string
  examDate: string
  score?: number
  maxScore?: number
  gradeEntryId?: number
  status: ExamStatus
  createdAt: string
  updatedAt: string
}

export interface ExamPage extends OwnedByUser {
  id?: number
  paperId: number
  pageNumber: number
  image: Blob
  thumbnail: Blob
  createdAt: string
}

export type QuestionAnalysisStatus = 'selected' | 'extracted' | 'analyzed'
export type MasteryStatus = 'unreviewed' | 'weak' | 'learning' | 'mastered'

export interface WrongQuestionFragment {
  pageId: number
  pageNumber: number
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
  cropImage: Blob
  createdAt: string
}

export interface WrongQuestion extends OwnedByUser {
  id?: number
  paperId: number
  pageId: number
  questionNo: string
  lostScore?: number
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
  cropImage: Blob
  /** 同一道题可包含多个手动裁剪片段，用于跨页题目。旧数据仍使用上面的单片段字段。 */
  fragments?: WrongQuestionFragment[]
  extractedText: string
  questionType: string
  chapter: string
  knowledgePoints: string[]
  prerequisiteKnowledge: string[]
  difficulty: '基础' | '中等' | '较难'
  errorReason: string
  analysisSummary: string
  reviewAdvice: string
  correctAnswer?: string
  status: QuestionAnalysisStatus
  mastery: MasteryStatus
  inWrongBook?: boolean
  bookmarkedAt?: string
  reviewNote?: string
  createdAt: string
  updatedAt: string
}

export type PracticeResult = 'unanswered' | 'incorrect' | 'partial' | 'correct'

export interface PracticeQuestion extends OwnedByUser {
  id?: number
  wrongQuestionId: number
  order: number
  content: string
  answer: string
  explanation: string
  difficulty: '基础' | '中等' | '较难'
  knowledgePoint: string
  result: PracticeResult
  /** 重新生成练习后，已收藏的旧题会保留，但不再属于当前批次。 */
  isCurrent?: boolean
  inWrongBook?: boolean
  bookmarkedAt?: string
  mastery?: MasteryStatus
  reviewNote?: string
  createdAt: string
}

// ─── 数据库实例 ─────────────────────────────────────────
export class StudyDB extends Dexie {
  habits!: EntityTable<Habit, 'id'>
  checkIns!: EntityTable<HabitCheckIn, 'id'>
  pointRecords!: EntityTable<PointRecord, 'id'>
  vocabCards!: EntityTable<VocabCard, 'id'>
  reviewLogs!: EntityTable<ReviewLog, 'id'>
  vocabPlans!: EntityTable<VocabPlan, 'id'>
  vocabNotebooks!: EntityTable<VocabNotebook, 'id'>
  vocabSessions!: EntityTable<VocabLearningSession, 'id'>
  vocabAttempts!: EntityTable<VocabAttempt, 'id'>
  semesters!: EntityTable<Semester, 'id'>
  courses!: EntityTable<Course, 'id'>
  gradeEntries!: EntityTable<GradeEntry, 'id'>
  studySessions!: EntityTable<StudySession, 'id'>
  pets!: EntityTable<Pet, 'id'>
  coinRecords!: EntityTable<CoinRecord, 'id'>
  diamondRecords!: EntityTable<DiamondRecord, 'id'>
  customDiamondRewards!: EntityTable<CustomDiamondReward, 'id'>
  ownedItems!: EntityTable<OwnedItem, 'id'>
  essayRecords!: EntityTable<EssayRecord, 'id'>
  qaConversations!: EntityTable<QAConversation, 'id'>
  qaMessages!: EntityTable<QAMessage, 'id'>
  examPapers!: EntityTable<ExamPaper, 'id'>
  examPages!: EntityTable<ExamPage, 'id'>
  wrongQuestions!: EntityTable<WrongQuestion, 'id'>
  practiceQuestions!: EntityTable<PracticeQuestion, 'id'>

  constructor(name = 'StudyAppDB') {
    super(name)
    this.version(1).stores({
      habits: '++id, category, archived, createdAt',
      checkIns: '++id, habitId, date, [habitId+date]',
      pointRecords: '++id, date, action',
      vocabCards: '++id, due, state, tags',
      reviewLogs: '++id, cardId, reviewedAt',
      semesters: '++id, isCurrent',
      courses: '++id, dayOfWeek, semesterId',
      gradeEntries: '++id, courseId, date, type',
      studySessions: '++id, startedAt',
    })
    // v2: 给 vocabCards 加 createdAt 索引
    this.version(2).stores({
      habits: '++id, category, archived, createdAt',
      checkIns: '++id, habitId, date, [habitId+date]',
      pointRecords: '++id, date, action',
      vocabCards: '++id, due, state, tags, createdAt',
      reviewLogs: '++id, cardId, reviewedAt',
      semesters: '++id, isCurrent',
      courses: '++id, dayOfWeek, semesterId',
      gradeEntries: '++id, courseId, date, type',
      studySessions: '++id, startedAt',
    })
    // v3: 宠物系统 + 双货币
    this.version(3).stores({
      habits: '++id, category, archived, createdAt',
      checkIns: '++id, habitId, date, [habitId+date]',
      pointRecords: '++id, date, action',
      vocabCards: '++id, due, state, tags, createdAt',
      reviewLogs: '++id, cardId, reviewedAt',
      semesters: '++id, isCurrent',
      courses: '++id, dayOfWeek, semesterId',
      gradeEntries: '++id, courseId, date, type',
      studySessions: '++id, startedAt',
      pets: '++id',
      coinRecords: '++id, date, source, habitId, [habitId+date]',
      diamondRecords: '++id, date, source, habitId, [habitId+date]',
      ownedItems: '++id, itemId',
    })
    // v4: 作文批改记录
    this.version(4).stores({
      habits: '++id, category, archived, createdAt',
      checkIns: '++id, habitId, date, [habitId+date]',
      pointRecords: '++id, date, action',
      vocabCards: '++id, due, state, tags, createdAt',
      reviewLogs: '++id, cardId, reviewedAt',
      semesters: '++id, isCurrent',
      courses: '++id, dayOfWeek, semesterId',
      gradeEntries: '++id, courseId, date, type',
      studySessions: '++id, startedAt',
      pets: '++id',
      coinRecords: '++id, date, source, habitId, [habitId+date]',
      diamondRecords: '++id, date, source, habitId, [habitId+date]',
      ownedItems: '++id, itemId',
      essayRecords: '++id, createdAt, username',
    })
    // v5: 答疑助手
    this.version(5).stores({
      habits: '++id, category, archived, createdAt',
      checkIns: '++id, habitId, date, [habitId+date]',
      pointRecords: '++id, date, action',
      vocabCards: '++id, due, state, tags, createdAt',
      reviewLogs: '++id, cardId, reviewedAt',
      semesters: '++id, isCurrent',
      courses: '++id, dayOfWeek, semesterId',
      gradeEntries: '++id, courseId, date, type',
      studySessions: '++id, startedAt',
      pets: '++id',
      coinRecords: '++id, date, source, habitId, [habitId+date]',
      diamondRecords: '++id, date, source, habitId, [habitId+date]',
      ownedItems: '++id, itemId',
      essayRecords: '++id, createdAt, username',
      qaConversations: '++id, username, updatedAt',
      qaMessages: '++id, conversationId, createdAt, [conversationId+createdAt]',
    })
    // v6: 本地学习数据按账号隔离
    this.version(6).stores({
      habits: '++id, ownerId, category, archived, createdAt, [ownerId+archived]',
      checkIns: '++id, ownerId, habitId, date, [habitId+date], [ownerId+date]',
      pointRecords: '++id, ownerId, date, action',
      vocabCards: '++id, ownerId, due, state, tags, createdAt, [ownerId+due]',
      reviewLogs: '++id, ownerId, cardId, reviewedAt',
      semesters: '++id, ownerId, isCurrent, [ownerId+isCurrent]',
      courses: '++id, ownerId, dayOfWeek, semesterId',
      gradeEntries: '++id, ownerId, courseId, date, type',
      studySessions: '++id, ownerId, startedAt, [ownerId+startedAt]',
      pets: '++id, ownerId',
      coinRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      diamondRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      ownedItems: '++id, ownerId, itemId, [ownerId+itemId]',
      essayRecords: '++id, createdAt, username',
      qaConversations: '++id, username, updatedAt',
      qaMessages: '++id, conversationId, createdAt, [conversationId+createdAt]',
    })
    // v7: 试卷错题分析与针对练习
    this.version(7).stores({
      habits: '++id, ownerId, category, archived, createdAt, [ownerId+archived]',
      checkIns: '++id, ownerId, habitId, date, [habitId+date], [ownerId+date]',
      pointRecords: '++id, ownerId, date, action',
      vocabCards: '++id, ownerId, due, state, tags, createdAt, [ownerId+due]',
      reviewLogs: '++id, ownerId, cardId, reviewedAt',
      semesters: '++id, ownerId, isCurrent, [ownerId+isCurrent]',
      courses: '++id, ownerId, dayOfWeek, semesterId',
      gradeEntries: '++id, ownerId, courseId, date, type',
      studySessions: '++id, ownerId, startedAt, [ownerId+startedAt]',
      pets: '++id, ownerId',
      coinRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      diamondRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      ownedItems: '++id, ownerId, itemId, [ownerId+itemId]',
      essayRecords: '++id, createdAt, username',
      qaConversations: '++id, username, updatedAt',
      qaMessages: '++id, conversationId, createdAt, [conversationId+createdAt]',
      examPapers: '++id, ownerId, examDate, status, updatedAt',
      examPages: '++id, ownerId, paperId, [paperId+pageNumber]',
      wrongQuestions: '++id, ownerId, paperId, pageId, status, mastery',
      practiceQuestions: '++id, ownerId, wrongQuestionId, [wrongQuestionId+order], result',
    })
    // v8: 学习任务分级目标、正确率与打卡等级
    this.version(8).stores({
      habits: '++id, ownerId, category, archived, createdAt, [ownerId+archived]',
      checkIns: '++id, ownerId, habitId, date, [habitId+date], [ownerId+date]',
      pointRecords: '++id, ownerId, date, action',
      vocabCards: '++id, ownerId, due, state, tags, createdAt, [ownerId+due]',
      reviewLogs: '++id, ownerId, cardId, reviewedAt',
      semesters: '++id, ownerId, isCurrent, [ownerId+isCurrent]',
      courses: '++id, ownerId, dayOfWeek, semesterId',
      gradeEntries: '++id, ownerId, courseId, date, type',
      studySessions: '++id, ownerId, startedAt, [ownerId+startedAt]',
      pets: '++id, ownerId',
      coinRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      diamondRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      ownedItems: '++id, ownerId, itemId, [ownerId+itemId]',
      essayRecords: '++id, createdAt, username',
      qaConversations: '++id, username, updatedAt',
      qaMessages: '++id, conversationId, createdAt, [conversationId+createdAt]',
      examPapers: '++id, ownerId, examDate, status, updatedAt',
      examPages: '++id, ownerId, paperId, [paperId+pageNumber]',
      wrongQuestions: '++id, ownerId, paperId, pageId, status, mastery',
      practiceQuestions: '++id, ownerId, wrongQuestionId, [wrongQuestionId+order], result',
    }).upgrade(async tx => {
      const habits = await tx.table('habits').toArray()
      const habitMap = new Map<number, any>(habits.map(habit => [habit.id, habit]))
      await tx.table('habits').toCollection().modify(habit => {
        habit.taskType ??= 'general'
        habit.unit ??= '次'
        habit.highTargetCount ??= Math.max(habit.targetCount + 1, Math.ceil(habit.targetCount * 1.5))
        habit.trackAccuracy ??= false
        habit.targetAccuracy ??= 80
        habit.highAccuracy ??= 90
      })
      await tx.table('checkIns').toCollection().modify(checkIn => {
        const habit = habitMap.get(checkIn.habitId)
        const met = checkIn.actualValue >= (habit?.targetCount ?? 1)
        checkIn.level ??= checkIn.completed ? (met ? 'standard' : 'partial') : 'none'
        checkIn.rewardCoins ??= checkIn.completed ? 10 : 0
        checkIn.rewardDiamonds ??= met && checkIn.completed ? 1 : 0
      })
    })
    // v9: 自定义钻石奖励与任务次日顺延
    this.version(9).stores({
      habits: '++id, ownerId, category, archived, createdAt, [ownerId+archived]',
      checkIns: '++id, ownerId, habitId, date, [habitId+date], [ownerId+date]',
      pointRecords: '++id, ownerId, date, action',
      vocabCards: '++id, ownerId, due, state, tags, createdAt, [ownerId+due]',
      reviewLogs: '++id, ownerId, cardId, reviewedAt',
      semesters: '++id, ownerId, isCurrent, [ownerId+isCurrent]',
      courses: '++id, ownerId, dayOfWeek, semesterId',
      gradeEntries: '++id, ownerId, courseId, date, type',
      studySessions: '++id, ownerId, startedAt, [ownerId+startedAt]',
      pets: '++id, ownerId',
      coinRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      diamondRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      customDiamondRewards: '++id, ownerId, createdAt',
      ownedItems: '++id, ownerId, itemId, [ownerId+itemId]',
      essayRecords: '++id, createdAt, username',
      qaConversations: '++id, username, updatedAt',
      qaMessages: '++id, conversationId, createdAt, [conversationId+createdAt]',
      examPapers: '++id, ownerId, examDate, status, updatedAt',
      examPages: '++id, ownerId, paperId, [paperId+pageNumber]',
      wrongQuestions: '++id, ownerId, paperId, pageId, status, mastery',
      practiceQuestions: '++id, ownerId, wrongQuestionId, [wrongQuestionId+order], result',
    }).upgrade(async tx => {
      await tx.table('habits').toCollection().modify(habit => {
        habit.carryOver ??= false
      })
    })
    // v10: 单词词条补充音标、来源与例句翻译（字段无需新增索引）
    this.version(10).stores({
      habits: '++id, ownerId, category, archived, createdAt, [ownerId+archived]',
      checkIns: '++id, ownerId, habitId, date, [habitId+date], [ownerId+date]',
      pointRecords: '++id, ownerId, date, action',
      vocabCards: '++id, ownerId, due, state, tags, createdAt, [ownerId+due]',
      reviewLogs: '++id, ownerId, cardId, reviewedAt',
      semesters: '++id, ownerId, isCurrent, [ownerId+isCurrent]',
      courses: '++id, ownerId, dayOfWeek, semesterId',
      gradeEntries: '++id, ownerId, courseId, date, type',
      studySessions: '++id, ownerId, startedAt, [ownerId+startedAt]',
      pets: '++id, ownerId',
      coinRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      diamondRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      customDiamondRewards: '++id, ownerId, createdAt',
      ownedItems: '++id, ownerId, itemId, [ownerId+itemId]',
      essayRecords: '++id, createdAt, username',
      qaConversations: '++id, username, updatedAt',
      qaMessages: '++id, conversationId, createdAt, [conversationId+createdAt]',
      examPapers: '++id, ownerId, examDate, status, updatedAt',
      examPages: '++id, ownerId, paperId, [paperId+pageNumber]',
      wrongQuestions: '++id, ownerId, paperId, pageId, status, mastery',
      practiceQuestions: '++id, ownerId, wrongQuestionId, [wrongQuestionId+order], result',
    })
    // v11: 作文/答疑数据统一按 ownerId 隔离（与其它学习表一致），
    // username 保留作兼容。旧数据由 claimLegacyData 在登录时补充 ownerId。
    this.version(11).stores({
      habits: '++id, ownerId, category, archived, createdAt, [ownerId+archived]',
      checkIns: '++id, ownerId, habitId, date, [habitId+date], [ownerId+date]',
      pointRecords: '++id, ownerId, date, action',
      vocabCards: '++id, ownerId, due, state, tags, createdAt, [ownerId+due]',
      reviewLogs: '++id, ownerId, cardId, reviewedAt',
      semesters: '++id, ownerId, isCurrent, [ownerId+isCurrent]',
      courses: '++id, ownerId, dayOfWeek, semesterId',
      gradeEntries: '++id, ownerId, courseId, date, type',
      studySessions: '++id, ownerId, startedAt, [ownerId+startedAt]',
      pets: '++id, ownerId',
      coinRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      diamondRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      customDiamondRewards: '++id, ownerId, createdAt',
      ownedItems: '++id, ownerId, itemId, [ownerId+itemId]',
      essayRecords: '++id, ownerId, username, createdAt',
      qaConversations: '++id, ownerId, username, updatedAt',
      qaMessages: '++id, ownerId, conversationId, createdAt, [conversationId+createdAt]',
      examPapers: '++id, ownerId, examDate, status, updatedAt',
      examPages: '++id, ownerId, paperId, [paperId+pageNumber]',
      wrongQuestions: '++id, ownerId, paperId, pageId, status, mastery',
      practiceQuestions: '++id, ownerId, wrongQuestionId, [wrongQuestionId+order], result',
    })
    // v12: 词书计划、限时客观检测及可恢复学习会话
    this.version(12).stores({
      habits: '++id, ownerId, category, archived, createdAt, [ownerId+archived]',
      checkIns: '++id, ownerId, habitId, date, [habitId+date], [ownerId+date]',
      pointRecords: '++id, ownerId, date, action',
      vocabCards: '++id, ownerId, word, due, state, tags, createdAt, [ownerId+word], [ownerId+due]',
      reviewLogs: '++id, ownerId, cardId, reviewedAt',
      vocabPlans: 'id, ownerId, bookId, active, [ownerId+bookId], [ownerId+active]',
      vocabSessions: 'id, ownerId, planId, status, updatedAt, [ownerId+status]',
      vocabAttempts: 'id, ownerId, sessionId, bookId, word, correct, createdAt, [ownerId+createdAt]',
      semesters: '++id, ownerId, isCurrent, [ownerId+isCurrent]',
      courses: '++id, ownerId, dayOfWeek, semesterId',
      gradeEntries: '++id, ownerId, courseId, date, type',
      studySessions: '++id, ownerId, startedAt, [ownerId+startedAt]',
      pets: '++id, ownerId',
      coinRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      diamondRecords: '++id, ownerId, date, source, habitId, [habitId+date]',
      customDiamondRewards: '++id, ownerId, createdAt',
      ownedItems: '++id, ownerId, itemId, [ownerId+itemId]',
      essayRecords: '++id, ownerId, username, createdAt',
      qaConversations: '++id, ownerId, username, updatedAt',
      qaMessages: '++id, ownerId, conversationId, createdAt, [conversationId+createdAt]',
      examPapers: '++id, ownerId, examDate, status, updatedAt',
      examPages: '++id, ownerId, paperId, [paperId+pageNumber]',
      wrongQuestions: '++id, ownerId, paperId, pageId, status, mastery',
      practiceQuestions: '++id, ownerId, wrongQuestionId, [wrongQuestionId+order], result',
    })
    this.version(13).stores({
      vocabNotebooks: 'id, ownerId, createdAt',
    })
    // Index-only upgrade: retain all cards, memberships and learning records.
    this.version(14).stores({
      vocabCards: '++id, ownerId, word, due, state, tags, createdAt, [ownerId+word], [ownerId+due], [ownerId+createdAt]',
    })
    this.version(15).stores({
      vocabAttempts: 'id, ownerId, sessionId, bookId, word, correct, createdAt, [ownerId+createdAt], [ownerId+word]',
    })
  }
}

export const db = new StudyDB()

const OWNED_TABLES = [
  'habits', 'checkIns', 'pointRecords', 'vocabCards', 'reviewLogs',
  'semesters', 'courses', 'gradeEntries', 'studySessions', 'pets',
  'coinRecords', 'diamondRecords', 'customDiamondRewards', 'ownedItems',
  'vocabPlans', 'vocabSessions', 'vocabAttempts', 'vocabNotebooks',
  'examPapers', 'examPages', 'wrongQuestions', 'practiceQuestions',
] as const

export function getCurrentOwnerId(): number {
  const raw = localStorage.getItem('auth_user')
  if (!raw) throw new Error('当前用户未登录')
  const id = Number(JSON.parse(raw).id)
  if (!Number.isInteger(id) || id <= 0) throw new Error('当前用户信息无效')
  return id
}

export function ownedByCurrentUser<T extends object>(record: T): T & OwnedByUser {
  return { ...record, ownerId: getCurrentOwnerId() }
}

/** 将 v5 及以前没有 ownerId 的本地数据安全归属给首次登录的账号。 */
export async function claimLegacyData(ownerId: number, username?: string): Promise<void> {
  // v6 及之前的主学习表：保持旧标记，避免已迁移过的安装重复执行。
  const marker = `study_app_owner_claim_v6_${ownerId}`
  if (!localStorage.getItem(marker)) {
    await db.transaction('rw', OWNED_TABLES.map(name => db.table(name)), async () => {
      for (const tableName of OWNED_TABLES) {
        await db.table(tableName).toCollection().modify(record => {
          if (record.ownerId == null) record.ownerId = ownerId
        })
      }
    })
    localStorage.setItem(marker, '1')
  }

  // v11：作文记录与答疑对话/消息补充 ownerId。用独立标记，兼容
  // 已设置过 v6 标记的旧安装。只认领当前账号的用户名记录，避免
  // 多账号共用设备时把其它账号的历史数据错误归属。
  const markerV11 = `study_app_owner_claim_v11_${ownerId}`
  if (!localStorage.getItem(markerV11)) {
    const extraTables = ['essayRecords', 'qaConversations', 'qaMessages'] as const
    await db.transaction('rw', extraTables.map(name => db.table(name)), async () => {
      // 答疑消息没有 username，按所属对话（属于当前账号的）来判断归属。
      const ownConversationIds = new Set(
        (await db.qaConversations.toArray())
          .filter(conversation => conversation.username == null || conversation.username === username)
          .map(conversation => conversation.id)
      )
      for (const tableName of extraTables) {
        await db.table(tableName).toCollection().modify(record => {
          if (record.ownerId != null) return
          if (tableName === 'qaMessages') {
            if (ownConversationIds.has(record.conversationId)) record.ownerId = ownerId
          } else if (record.username == null || record.username === username) {
            record.ownerId = ownerId
          }
        })
      }
    })
    localStorage.setItem(markerV11, '1')
  }
}
