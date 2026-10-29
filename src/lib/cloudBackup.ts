import { db, getCurrentOwnerId } from '../db'

const OWNER_TABLES = [
  'habits', 'checkIns', 'pointRecords', 'vocabCards', 'reviewLogs', 'semesters', 'courses',
  'gradeEntries', 'studySessions', 'pets', 'coinRecords', 'diamondRecords',
  'customDiamondRewards', 'ownedItems',
  'vocabPlans', 'vocabSessions', 'vocabAttempts', 'vocabNotebooks',
] as const

// 错题/试卷只备份文字数据（试卷原图、错题截图 Blob 不上传）。
const EXAM_TEXT_TABLES = ['examPapers', 'wrongQuestions', 'practiceQuestions'] as const

// 作文/答疑：v11 起与其它学习表一样按 ownerId 隔离。
const ACCOUNT_TEXT_TABLES = ['essayRecords', 'qaConversations', 'qaMessages'] as const

const KNOWN_TABLES = new Set<string>([...OWNER_TABLES, ...EXAM_TEXT_TABLES, ...ACCOUNT_TEXT_TABLES])

// 剔除 Blob 图片字段（cropImage / fragments 内的截图），Blob 无法 JSON 序列化，
// 直接序列化会变成 {} 并在恢复后导致图片组件异常。
function stripExamImages(record: Record<string, unknown>): Record<string, unknown> {
  const { cropImage, fragments, ...text } = record
  return text
}

export async function exportCloudBackup() {
  const ownerId = getCurrentOwnerId()
  const output: Record<string, Record<string, unknown>[]> = {}
  for (const name of OWNER_TABLES) {
    const records = await db.table(name).where('ownerId').equals(ownerId).toArray()
    output[name] = records.map(record => serializeRecord(record))
  }
  for (const name of EXAM_TEXT_TABLES) {
    const records = await db.table(name).where('ownerId').equals(ownerId).toArray()
    output[name] = records.map(record => serializeRecord(stripExamImages(record)))
  }
  output.essayRecords = (await db.essayRecords.where('ownerId').equals(ownerId).toArray()).map(record => serializeRecord(record))
  const conversations = await db.qaConversations.where('ownerId').equals(ownerId).toArray()
  output.qaConversations = conversations.map(record => serializeRecord(record))
  const conversationIds = conversations.map(item => item.id!).filter(Boolean)
  output.qaMessages = conversationIds.length
    ? (await db.qaMessages.where('conversationId').anyOf(conversationIds).toArray()).map(record => {
      const {
        imageBase64: _imageBase64,
        imagesBase64: _imagesBase64,
        pendingTaskId: _pendingTaskId,
        taskStatus: _taskStatus,
        ...textOnly
      } = record
      return serializeRecord(textOnly)
    })
    : []
  return output
}

export async function restoreCloudBackup(data: Record<string, Record<string, unknown>[]>, username: string) {
  validateBackup(data)
  const ownerId = getCurrentOwnerId()
  const tables = [...OWNER_TABLES, ...EXAM_TEXT_TABLES, ...ACCOUNT_TEXT_TABLES].map(name => db.table(name))
  await db.transaction('rw', tables, async () => {
    const currentConversations = await db.qaConversations.where('ownerId').equals(ownerId).toArray()
    const currentConversationIds = currentConversations.map(item => item.id!).filter(Boolean)
    if (currentConversationIds.length) await db.qaMessages.where('conversationId').anyOf(currentConversationIds).delete()
    await db.qaConversations.where('ownerId').equals(ownerId).delete()
    await db.essayRecords.where('ownerId').equals(ownerId).delete()
    for (const name of [...OWNER_TABLES, ...EXAM_TEXT_TABLES].reverse()) {
      await db.table(name).where('ownerId').equals(ownerId).delete()
    }

    const habitMap = await addWithMap('habits', data.habits, ownerId)
    const vocabMap = await addWithMap('vocabCards', data.vocabCards, ownerId, reviveVocab)
    await addStableRecords('vocabNotebooks', data.vocabNotebooks, ownerId)
    await addStableRecords('vocabPlans', data.vocabPlans, ownerId)
    await addStableRecords('vocabSessions', data.vocabSessions?.map(record => ({
      ...record,
      words: Array.isArray(record.words) ? record.words.map(word => ({ ...word, cardId: remap(word.cardId, vocabMap) })) : [],
    })), ownerId)
    await addStableRecords('vocabAttempts', data.vocabAttempts, ownerId)
    const semesterMap = await addWithMap('semesters', data.semesters, ownerId)
    const courseMap = await addWithMap('courses', data.courses, ownerId, record => ({ ...record, semesterId: remap(record.semesterId, semesterMap) }))
    const rewardMap = await addWithMap('customDiamondRewards', data.customDiamondRewards, ownerId)
    const gradeEntryMap = await addWithMap('gradeEntries', data.gradeEntries, ownerId, record => ({ ...record, courseId: remap(record.courseId, courseMap) }))
    // 错题/试卷：重建 paperId → wrongQuestionId 关联（页面图片不备份，pageId 置空）
    const paperMap = await addWithMap('examPapers', data.examPapers, ownerId, record => ({ ...record, gradeEntryId: remap(record.gradeEntryId, gradeEntryMap) }))
    const questionMap = await addWithMap('wrongQuestions', data.wrongQuestions, ownerId, record => ({
      ...record,
      paperId: requiredRemap(record.paperId, paperMap, '试卷'),
      pageId: undefined,
    }))
    await addRecords('practiceQuestions', data.practiceQuestions, ownerId, record => ({
      ...record,
      wrongQuestionId: requiredRemap(record.wrongQuestionId, questionMap, '错题'),
    }))

    await addRecords('checkIns', data.checkIns, ownerId, record => ({ ...record, habitId: requiredRemap(record.habitId, habitMap, '打卡任务') }))
    await addRecords('pointRecords', data.pointRecords, ownerId, record => ({ ...record, habitId: remap(record.habitId, habitMap) }))
    await addRecords('reviewLogs', data.reviewLogs, ownerId, record => ({ ...record, cardId: requiredRemap(record.cardId, vocabMap, '单词') , reviewedAt: reviveDate(record.reviewedAt) }))
    await addRecords('studySessions', data.studySessions, ownerId, record => ({ ...record, startedAt: reviveDate(record.startedAt) }))
    await addRecords('coinRecords', data.coinRecords, ownerId, record => ({ ...record, habitId: remap(record.habitId, habitMap) }))
    await addRecords('diamondRecords', data.diamondRecords, ownerId, record => ({ ...record, habitId: remap(record.habitId, habitMap), customRewardId: remap(record.customRewardId, rewardMap) }))
    await addRecords('pets', data.pets, ownerId)
    await addRecords('ownedItems', data.ownedItems, ownerId)

    for (const record of data.essayRecords ?? []) await db.table('essayRecords').add(withoutId({ ...record, ownerId, username }))
    const conversationMap = new Map<number, number>()
    for (const record of data.qaConversations ?? []) {
      const oldId = Number(record.id)
      const newId = await db.table('qaConversations').add(withoutId({ ...record, ownerId, username }))
      if (oldId) conversationMap.set(oldId, Number(newId))
    }
    for (const record of data.qaMessages ?? []) {
      const conversationId = conversationMap.get(Number(record.conversationId))
      if (conversationId) await db.table('qaMessages').add(withoutId({ ...record, ownerId, conversationId }))
    }
  })
}

function serializeRecord(record: object) {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>
}
function validateBackup(data: Record<string, Record<string, unknown>[]>) {
  if (!data || typeof data !== 'object') throw new Error('备份格式不正确')
  for (const [name, records] of Object.entries(data)) {
    if (!KNOWN_TABLES.has(name)) throw new Error(`备份包含未知数据表：${name}，已中止恢复`)
    if (!Array.isArray(records)) throw new Error(`备份表 ${name} 格式不正确`)
    if (records.some(record => !record || typeof record !== 'object' || Array.isArray(record))) {
      throw new Error(`备份表 ${name} 包含无效记录，已中止恢复`)
    }
  }
}
async function addWithMap(name: string, records: Record<string, unknown>[] = [], ownerId: number, transform: (record: Record<string, unknown>) => Record<string, unknown> = value => value) {
  const map = new Map<number, number>()
  for (const record of records) {
    const oldId = Number(record.id)
    const newId = await db.table(name).add(withoutId({ ...transform(record), ownerId }))
    if (oldId) map.set(oldId, Number(newId))
  }
  return map
}
async function addRecords(name: string, records: Record<string, unknown>[] = [], ownerId: number, transform: (record: Record<string, unknown>) => Record<string, unknown> = value => value) {
  for (const record of records) await db.table(name).add(withoutId({ ...transform(record), ownerId }))
}
async function addStableRecords(name: string, records: Record<string, unknown>[] = [], ownerId: number) {
  for (const record of records) await db.table(name).add({ ...record, ownerId })
}
function withoutId(record: Record<string, unknown>) { const { id: _id, ...rest } = record; return rest }
function remap(value: unknown, map: Map<number, number>) { return value == null ? undefined : map.get(Number(value)) }
function requiredRemap(value: unknown, map: Map<number, number>, label: string) { const result = remap(value, map); if (!result) throw new Error(`${label}关联数据不完整`); return result }
function reviveDate(value: unknown) { return value ? new Date(String(value)) : undefined }
function reviveVocab(record: Record<string, unknown>) { return { ...record, due: reviveDate(record.due), lastReview: reviveDate(record.lastReview) } }
