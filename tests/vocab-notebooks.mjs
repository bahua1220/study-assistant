import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--no-proxy-server'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
await page.route('https://fonts.googleapis.com/**', route => route.abort())
await page.route('https://fonts.gstatic.com/**', route => route.abort())
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5181'
const errors = []
page.on('pageerror', error => errors.push(error.message))
const user = { id: 987001, username: 'notebook-test', nickname: '测试', grade: 'highschool' }
await page.route('**/api/**', route => {
  const url = new URL(route.request().url())
  if (url.pathname === '/api/auth/me') return route.fulfill({ json: user })
  if (url.pathname === '/api/vocab/books') return route.fulfill({ json: [] })
  if (url.pathname === '/api/vocab/recognize') return route.fulfill({ status: 404, json: { detail: 'Not Found' } })
  if (url.pathname.includes('lookup')) return route.fulfill({ json: { word: 'apple', translation: '苹果', phonetic: '', pos: 'noun', tags: [], exchange: '' } })
  return route.fulfill({ status: 404, json: { detail: 'unexpected test request' } })
})
await page.addInitScript(user => {
  localStorage.setItem('auth_token', 'isolated-test')
  localStorage.setItem('auth_user', JSON.stringify(user))
}, user)

try {
  await page.goto(`${origin}/vocab/notebooks`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '我的单词本', exact: true }).waitFor()
  await page.getByRole('button', { name: '新建单词本', exact: true }).click()
  await page.getByPlaceholder('输入名称，最多40字').fill('阅读生词')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('heading', { name: '阅读生词', exact: true }).waitFor()
  const bookId = new URL(page.url()).searchParams.get('id')
  assert.ok(bookId)

  // Seed words in the isolated browser, including another account's card.
  await page.evaluate(async ({ user, bookId }) => {
    const { db } = await import('/src/db/index.ts')
    const base = { ownerId: user.id, tags: [], due: new Date(0), stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 7, lapses: 0, state: 2, createdAt: new Date().toISOString() }
    await db.vocabCards.bulkAdd([
      { ...base, word: 'apple', translation: '苹果', notebookIds: [] },
      { ...base, word: 'book', translation: '书', notebookIds: [] },
      { ...base, word: 'cat', translation: '猫', notebookIds: [] },
      { ...base, word: 'dog', translation: '狗', notebookIds: [] },
      { ...base, ownerId: user.id + 1, word: 'private', translation: '其他账号', notebookIds: [bookId] },
    ])
  }, { user, bookId })
  await page.getByRole('button', { name: '管理收录 / 添加已有单词', exact: true }).click()
  await page.getByRole('checkbox', { name: 'apple 苹果', exact: true }).check()
  assert.equal(await page.getByRole('checkbox').count(), 4)
  await page.getByRole('button', { name: '保存收录', exact: true }).click()
  await page.getByText('1个单词 · 按本背诵和复习', { exact: true }).waitFor()

  // Adding the same word to a second book reuses its card and FSRS progress.
  await page.getByRole('button', { name: '新建单词本', exact: true }).click()
  await page.getByPlaceholder('输入名称，最多40字').fill('课本Unit 1')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('heading', { name: '课本Unit 1', exact: true }).waitFor()
  const secondId = new URL(page.url()).searchParams.get('id')
  await page.getByRole('button', { name: '添加新单词', exact: true }).click()
  await page.getByPlaceholder('例如：abandon / look forward to').fill('apple')
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await page.getByRole('button', { name: '加入单词本', exact: true }).click()
  await page.getByRole('heading', { name: '课本Unit 1', exact: true }).waitFor()
  const saved = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    return db.vocabCards.where('ownerId').equals(user.id).filter(card => card.word === 'apple').toArray()
  }, user)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].reps, 7)
  assert.deepEqual(new Set(saved[0].notebookIds), new Set([bookId, secondId]))

  // One-word custom books start a one-word session, never call a dictionary book API.
  await page.getByRole('button', { name: '背这个单词本', exact: true }).click()
  await page.getByRole('heading', { name: '选择学习计划' }).waitFor()
  await page.getByRole('button', { name: '专注锁定本轮', exact: false }).click()
  await page.getByRole('button', { name: '保存并开始背词', exact: true }).click()
  await page.getByText('1 / 1', { exact: true }).waitFor()
  const session = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    return db.vocabSessions.where('[ownerId+status]').equals([user.id, 'active']).first()
  }, user)
  assert.equal(session.bookId, `notebook:${secondId}`)
  assert.equal(session.words.length, 1)
  assert.equal(session.words[0].word, 'apple')
  await page.getByPlaceholder('输入英文拼写').fill('apple')
  await page.getByRole('button', { name: '提交', exact: true }).click()
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
  await page.getByRole('button', { name: '完成本轮', exact: true }).waitFor()
  await page.getByRole('button', { name: '完成本轮', exact: true }).click()
  await page.getByRole('heading', { name: '本轮背词完成' }).waitFor()

  // Backup round trip restores notebook membership and remaps card IDs in sessions.
  const restored = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const { exportCloudBackup, restoreCloudBackup } = await import('/src/lib/cloudBackup.ts')
    const data = await exportCloudBackup()
    await restoreCloudBackup(data, user.username)
    const card = await db.vocabCards.where('ownerId').equals(user.id).filter(card => card.word === 'apple').first()
    const session = await db.vocabSessions.where('ownerId').equals(user.id).first()
    return { books: await db.vocabNotebooks.where('ownerId').equals(user.id).count(), ids: card.notebookIds, cardId: card.id, sessionCardId: session.words[0].cardId, studied: (await db.vocabPlans.where('ownerId').equals(user.id).first()).studiedWords }
  }, user)
  assert.equal(restored.books, 2)
  assert.deepEqual(new Set(restored.ids), new Set([bookId, secondId]))
  assert.equal(restored.sessionCardId, restored.cardId)
  assert.deepEqual(restored.studied, ['apple'])

  // A short tap or a scrolling gesture must not open the long-press menu.
  await page.goto(`${origin}/vocab/notebooks?id=${secondId}`)
  const appleRow = page.getByRole('button', { name: '单词apple，长按管理', exact: true })
  await appleRow.click()
  assert.equal(await page.getByRole('dialog', { name: '删除单词', exact: true }).count(), 0)
  await appleRow.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, button: 0, clientX: 20, clientY: 20 })
  await appleRow.dispatchEvent('pointermove', { pointerId: 1, isPrimary: true, clientX: 20, clientY: 65 })
  await page.waitForTimeout(650)
  assert.equal(await page.getByRole('dialog', { name: '删除单词', exact: true }).count(), 0)
  await appleRow.hover(); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up()
  await page.getByRole('dialog', { name: '删除单词', exact: true }).waitFor()
  await page.getByRole('button', { name: '仅移出当前单词本', exact: true }).click()
  await appleRow.waitFor({ state: 'detached' })
  const afterMove = await page.evaluate(async ({ user, secondId }) => {
    const { db } = await import('/src/db/index.ts')
    const card = await db.vocabCards.where('ownerId').equals(user.id).filter(card => card.word === 'apple').first()
    const ids = card.notebookIds
    const logs = await db.reviewLogs.where('ownerId').equals(user.id).count()
    await db.vocabCards.update(card.id, { notebookIds: [...ids, secondId] })
    return { ids, logs }
  }, { user, secondId })
  assert.deepEqual(afterMove.ids, [bookId])
  assert.ok(afterMove.logs > 0)

  // Deleting a book keeps both the shared word and the other book membership.
  await page.goto(`${origin}/vocab/notebooks`)
  await page.getByRole('button', { name: '删除阅读生词', exact: true }).waitFor()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '删除阅读生词', exact: true }).click()
  await page.getByRole('button', { name: '删除阅读生词', exact: true }).waitFor({ state: 'detached' })
  const remaining = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    return db.vocabCards.where('ownerId').equals(user.id).filter(card => card.word === 'apple').first()
  }, user)
  assert.deepEqual(remaining.notebookIds, [secondId])

  // Permanent deletion also cancels stale resumable sessions to avoid resurrection.
  await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const previous = await db.vocabSessions.where('ownerId').equals(user.id).first()
    await db.vocabSessions.add({ ...previous, id: 'delete-test-active', bookId: 'review', status: 'active' })
  }, user)
  await page.goto(`${origin}/vocab/notebooks?id=${secondId}`)
  const deleting = page.getByRole('button', { name: '单词apple，长按管理', exact: true })
  await deleting.hover(); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up()
  await page.getByRole('button', { name: '彻底删除', exact: true }).click()
  await deleting.waitFor({ state: 'detached' })
  const deleted = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    return {
      words: await db.vocabCards.where('ownerId').equals(user.id).filter(card => card.word === 'apple').count(),
      logs: await db.reviewLogs.where('ownerId').equals(user.id).count(),
      attempts: await db.vocabAttempts.where('ownerId').equals(user.id).count(),
      sessionStatus: (await db.vocabSessions.get('delete-test-active')).status,
      otherAccount: await db.vocabCards.where('ownerId').equals(user.id + 1).count(),
    }
  }, user)
  assert.deepEqual(deleted, { words: 0, logs: 0, attempts: 0, sessionStatus: 'abandoned', otherAccount: 1 })
  const apiError = await page.evaluate(async () => {
    const { recognizeVocab } = await import('/src/services/api.ts')
    try { await recognizeVocab('test'); return '' } catch (error) { return error.message }
  })
  assert.match(apiError, /服务器未安装单词拍照识别接口/)
  assert.deepEqual(errors, [])
  console.log('PASS: notebooks, objective study, backup, long press, scroll cancellation, remove-only, permanent deletion, stale sessions, account isolation, OCR route diagnostics')
} finally {
  await context.close()
  await browser.close()
}
