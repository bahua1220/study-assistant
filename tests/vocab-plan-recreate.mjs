import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright')
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--no-proxy-server'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' })
const page = await context.newPage()
page.setDefaultTimeout(15000)
const origin = 'http://127.0.0.1:5181'
const user = { id: 987011, username: 'recreate-plan-test', grade: 'highschool' }
const oldId = `${user.id}:notebook:restart`
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(user => { localStorage.setItem('auth_token', 'isolated'); localStorage.setItem('auth_user', JSON.stringify(user)) }, user)
await page.route('https://fonts.googleapis.com/**', route => route.abort())
await page.route('https://fonts.gstatic.com/**', route => route.abort())
await page.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/auth/me' ? user : [] }))
const card = () => page.locator('[data-testid="vocab-plan-card"][data-book-id="notebook:restart"]')
const plans = () => page.evaluate(async user => { const { db } = await import('/src/db/index.ts'); return db.vocabPlans.where('ownerId').equals(user.id).toArray() }, user)
async function remove() {
  await card().getByRole('button', { name: '管理计划：重新开始本', exact: true }).click()
  await page.getByRole('button', { name: '删除计划', exact: true }).click()
  await page.getByRole('button', { name: '确认删除计划', exact: true }).click()
  await card().waitFor({ state: 'detached' })
}
try {
  await page.goto(`${origin}/vocab`)
  await page.getByRole('heading', { name: '背单词', exact: true }).waitFor()
  const original = await page.evaluate(async ({ user, oldId }) => {
    const { db } = await import('/src/db/index.ts')
    const now = new Date().toISOString()
    await db.vocabNotebooks.add({ id: 'restart', name: '重新开始本', ownerId: user.id, createdAt: now, updatedAt: now })
    await db.vocabCards.bulkAdd(Array.from({ length: 8 }, (_, index) => ({ ownerId: user.id, word: `word${index}`, translation: `释义${index}`, tags: [], notebookIds: ['restart'], due: new Date(0), state: 0, reps: 0, lapses: 0, stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, createdAt: now })))
    const old = { id: oldId, ownerId: user.id, bookId: 'notebook:restart', bookName: '重新开始本', wordCount: 8, batchSize: 5, dailyTarget: 15, testMode: 'spelling', focusLock: false, cursor: 4, studiedWords: ['word0', 'word1', 'word2', 'word3'], shuffleSeed: 'historical-seed', active: 1, createdAt: now, updatedAt: now }
    await db.vocabPlans.add(old)
    await db.vocabSessions.add({ id: 'old-round', ownerId: user.id, planId: oldId, bookId: old.bookId, bookName: old.bookName, testMode: old.testMode, focusLock: false, phase: 'learning', status: 'active', words: [], currentIndex: 0, interruptions: 0, sourceOffset: 4, nextOffset: 5, startedAt: now, updatedAt: now })
    return old
  }, { user, oldId })
  await remove()
  const deleted = (await plans()).find(plan => plan.id === oldId)
  await page.getByRole('button', { name: '添加计划', exact: true }).click()
  const tile = page.getByRole('button', { name: /^重新开始本/ })
  assert.equal(await tile.getByText(/已建计划/).count(), 0)
  await tile.click()
  await page.getByRole('heading', { name: '选择学习计划', exact: true }).waitFor()
  await page.getByText(/当前没有学习计划，可重新创建/).waitFor()
  await page.getByRole('spinbutton', { name: '每轮学习数量' }).fill('5')
  await page.getByRole('spinbutton', { name: '每日检测目标' }).fill('10')
  await page.getByRole('button', { name: '保存计划', exact: true }).click()
  await page.waitForURL(`${origin}/vocab`)
  await card().waitFor()
  const after = await plans()
  const current = after.find(plan => plan.status !== 'deleted')
  assert.equal(after.length, 2); assert.notEqual(current.id, oldId)
  assert.equal(current.cursor, 0); assert.equal(current.studiedWords, undefined); assert.equal(current.testMode, 'mixed')
  assert.equal(current.dailyTarget, 10); assert.notEqual(current.shuffleSeed, original.shuffleSeed)
  assert.deepEqual(after.find(plan => plan.id === oldId), deleted)
  const blocked = await page.evaluate(async ({ user, oldId }) => {
    const api = await import('/src/lib/vocabPlans.ts')
    try { await api.restoreVocabPlan(user.id, oldId); return '' } catch (error) { return error.message }
  }, { user, oldId })
  assert.match(blocked, /已有新计划/)
  await page.getByRole('button', { name: '添加计划', exact: true }).click()
  assert.equal(await tile.getByText('已建计划 · 可调整', { exact: true }).count(), 1)
  await tile.click()
  await page.getByRole('heading', { name: '调整学习计划', exact: true }).waitFor()
  assert.match(page.url(), new RegExp(`planId=${encodeURIComponent(current.id)}`))
  await page.getByRole('button', { name: '返回背单词', exact: true }).click()
  await remove()
  // Restoring old history is now permitted, without reviving its abandoned round.
  const restored = await page.evaluate(async ({ user, oldId }) => {
    const { db } = await import('/src/db/index.ts')
    const api = await import('/src/lib/vocabPlans.ts')
    await api.restoreVocabPlan(user.id, oldId)
    const old = await db.vocabPlans.get(oldId)
    // A paused current plan still occupies the book; it must not duplicate.
    await api.pauseVocabPlan(user.id, oldId, true)
    const same = await api.saveVocabPlan(user.id, { bookId: old.bookId, bookName: old.bookName, wordCount: 8, batchSize: 5, dailyTarget: 20, testMode: 'mixed', focusLock: false })
    return { old, sameId: same.id, paused: same.status, round: (await db.vocabSessions.get('old-round')).status, currentCount: (await db.vocabPlans.where('ownerId').equals(user.id).toArray()).filter(plan => plan.status !== 'deleted').length }
  }, { user, oldId })
  assert.equal(restored.old.cursor, 4); assert.deepEqual(restored.old.studiedWords, original.studiedWords)
  assert.equal(restored.round, 'abandoned'); assert.equal(restored.currentCount, 1); assert.equal(restored.sameId, oldId); assert.equal(restored.paused, 'paused')
  console.log('PASS: delete→picker no existing label→fresh ID/settings/progress; old archive/round unchanged; current plan found past archive; restore conflict blocked; old progress restore and paused-plan uniqueness')
  const offline = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const api = await import('/src/lib/vocabPlans.ts')
    const input = { bookId: 'gk', bookName: '离线高考词书', wordCount: 3000, batchSize: 5, dailyTarget: 10, testMode: 'mixed', focusLock: false }
    const a = await api.saveVocabPlan(user.id, input); await api.deleteVocabPlan(user.id, a.id)
    const b = await api.saveVocabPlan(user.id, input); await api.deleteVocabPlan(user.id, b.id)
    return [a.id, b.id]
  }, user)
  assert.notEqual(offline[0], offline[1])
  await page.goto(`${origin}/vocab/plan?new=1`)
  const exam = page.getByRole('button', { name: /^离线高考词书/ })
  await exam.waitFor()
  assert.equal(await exam.count(), 1); assert.equal(await exam.getByText(/已建计划/).count(), 0)
  await exam.click(); await page.getByRole('button', { name: '保存计划', exact: true }).click()
  await page.waitForURL(`${origin}/vocab`)
  const backup = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const { exportCloudBackup, restoreCloudBackup } = await import('/src/lib/cloudBackup.ts')
    const data = await exportCloudBackup(); await restoreCloudBackup(data, user.username)
    const after = await exportCloudBackup()
    return { same: JSON.stringify(data.vocabPlans) === JSON.stringify(after.vocabPlans), current: (await db.vocabPlans.where('ownerId').equals(user.id).toArray()).filter(plan => plan.status !== 'deleted').length }
  }, user)
  assert.deepEqual(backup, { same: true, current: 2 }); assert.deepEqual(errors, [])
  await page.goto(`${origin}/vocab/plan?new=1`)
  await page.getByRole('button', { name: /^离线高考词书/ }).waitFor()
  await page.screenshot({ path: '.tools/vocab-plan-recreate-1.1.10.png' })
  console.log('PASS: repeated deletion/recreation, offline exam catalog deduplicated, active-only badges, backup/restore preserves all historical and current plans')
} finally { await context.close(); await browser.close() }
