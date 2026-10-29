import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright')
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--no-proxy-server'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' })
const page = await context.newPage()
page.setDefaultTimeout(15000)
await page.clock.setFixedTime(new Date('2026-10-24T04:00:00Z'))
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5181'
const user = { id: 987007, username: 'multi-plan-test', nickname: '测试', grade: 'highschool' }
const errors = []
let releaseCatalog
const catalog = new Promise(resolve => { releaseCatalog = resolve })
let slowCatalog = true
const remoteRequests = []
const bookA = 'notebook:multi-a', bookB = 'notebook:multi-b'
const planCard = book => page.locator(`[data-testid="vocab-plan-card"][data-book-id="${book}"]`)
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(user => { localStorage.setItem('auth_token', 'isolated-test'); localStorage.setItem('auth_user', JSON.stringify(user)) }, user)
await page.route('https://fonts.googleapis.com/**', route => route.abort())
await page.route('https://fonts.gstatic.com/**', route => route.abort())
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  if (path === '/api/auth/me') return route.fulfill({ json: user })
  if (path === '/api/vocab/books') {
    if (slowCatalog) await catalog
    return route.fulfill({ json: [{ id: 'gk', name: '高考词书', description: '模拟词书', wordCount: 50 }] })
  }
  if (path === '/api/vocab/books/gk/words') {
    const url = new URL(route.request().url())
    const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'))
    remoteRequests.push({ offset, limit, seed: url.searchParams.get('seed') })
    const words = Array.from({ length: Math.min(limit, 50 - offset) }, (_, i) => ({ word: `examword${offset + i}`, translation: `考纲词义${offset + i}`, phonetic: '', pos: 'n.', tags: ['gk'], exchange: '', choices: [`考纲词义${offset + i}`, '干扰一', '干扰二', '干扰三'] }))
    return route.fulfill({ json: { bookId: 'gk', words, nextOffset: offset + words.length, finished: offset + words.length >= 50 } })
  }
  return route.fulfill({ status: 404, json: { detail: 'unexpected test request' } })
})
async function active(bookId) {
  return page.evaluate(async ({ user, bookId }) => {
    const { db } = await import('/src/db/index.ts')
    return db.vocabSessions.where('[ownerId+status]').equals([user.id, 'active']).filter(session => session.bookId === bookId).first()
  }, { user, bookId })
}
async function waitIndex(id, index) {
  await page.waitForFunction(async ({ id, index }) => {
    const { db } = await import('/src/db/index.ts')
    return (await db.vocabSessions.get(id))?.currentIndex === index
  }, { id, index })
}
async function exitStudy() {
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '长按退出', exact: true }).dispatchEvent('pointerdown')
  await page.waitForURL(`${origin}/vocab`)
}

try {
  await page.goto(`${origin}/vocab`)
  await page.getByRole('heading', { name: '背单词', exact: true }).waitFor()
  const oldPlan = await page.evaluate(async ({ user, bookA }) => {
    const { db } = await import('/src/db/index.ts')
    const now = new Date().toISOString()
    const wordsA = ['shared', 'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india']
    const wordsB = ['shared', 'jupiter', 'kilo', 'lemon', 'mango', 'november', 'oscar', 'piano', 'queen', 'river', 'sugar', 'tiger']
    await db.vocabNotebooks.bulkAdd([
      { id: 'multi-a', ownerId: user.id, name: '阅读生词 A', createdAt: now, updatedAt: now },
      { id: 'multi-b', ownerId: user.id, name: '课本生词 B', createdAt: now, updatedAt: now },
      { id: 'multi-private', ownerId: user.id + 1, name: '私有本', createdAt: now, updatedAt: now },
    ])
    const cards = [...new Set([...wordsA, ...wordsB])].map(word => ({ ownerId: user.id, word, translation: `中文-${word}`, tags: [], due: new Date(0), stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0, createdAt: now, notebookIds: [...(wordsA.includes(word) ? ['multi-a'] : []), ...(wordsB.includes(word) ? ['multi-b'] : [])] }))
    await db.vocabCards.bulkAdd(cards)
    const legacy = { id: 'legacy-plan-a', ownerId: user.id, bookId: bookA, bookName: '阅读生词 A', wordCount: 10, batchSize: 5, dailyTarget: 20, testMode: 'choice', focusLock: false, cursor: 3, studiedWords: wordsA.slice(0, 3), shuffleSeed: 'keep-this-seed', active: 0, createdAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z' }
    await db.vocabPlans.bulkAdd([legacy, { ...legacy, id: 'private-plan', ownerId: user.id + 1, bookId: 'notebook:multi-private', bookName: '私有本', active: 1 }])
    return legacy
  }, { user, bookA })
  await planCard(bookA).getByText('累计进度 3/10', { exact: true }).waitFor()
  assert.equal(await page.getByTestId('vocab-plan-card').count(), 1)
  await page.getByRole('button', { name: '添加计划', exact: true }).click()
  await page.getByRole('button', { name: /^课本生词 B/ }).click()
  await page.getByRole('spinbutton', { name: '每轮学习数量' }).fill('5')
  await page.getByRole('spinbutton', { name: '每日检测目标' }).fill('30')
  await page.getByRole('button', { name: /^拼写 根据中文/ }).click()
  await page.getByRole('button', { name: /^专注锁定本轮/ }).click()
  await page.getByRole('button', { name: '保存计划', exact: true }).click()
  await page.waitForURL(`${origin}/vocab`)
  // The local plan was saved even though the catalog API is still pending.
  slowCatalog = false; releaseCatalog()
  await planCard(bookB).getByText('拼写 · 每轮5词 · 每日目标30词', { exact: true }).waitFor()
  const savedPlans = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    return db.vocabPlans.where('ownerId').equals(user.id).toArray()
  }, user)
  assert.equal(savedPlans.length, 2)
  assert.deepEqual(savedPlans.find(plan => plan.id === oldPlan.id), oldPlan)
  const bId = savedPlans.find(plan => plan.bookId === bookB).id
  console.log('PASS: legacy active=0 plan remains visible; adding B while catalog is pending preserves every A field; separate quantities/modes and account isolation')

  await planCard(bookA).getByRole('button', { name: '调整计划', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('input[aria-label="每日检测目标"]')?.value === '20')
  assert.equal(await page.getByRole('spinbutton', { name: '每日检测目标' }).inputValue(), '20')
  assert.equal(await page.getByRole('button', { name: /^英译汉 英文/ }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByRole('button', { name: /^课本生词 B/ }).count(), 0)
  await page.getByText('当前单词本（不可在调整中更换）', { exact: true }).waitFor()
  await page.getByRole('button', { name: '返回背单词', exact: true }).click()

  await planCard(bookA).getByRole('button', { name: '开始背词', exact: true }).click()
  await page.getByText('1 / 5', { exact: true }).waitFor()
  const sessionA = await active(bookA)
  assert.equal(sessionA.testMode, 'choice')
  await page.getByRole('button').filter({ hasText: sessionA.words[0].translation }).first().click()
  await waitIndex(sessionA.id, 1)
  await page.getByRole('button', { name: '下一题', exact: true }).click()
  await exitStudy()
  await planCard(bookB).getByRole('button', { name: '开始背词', exact: true }).click()
  await page.getByText('1 / 5', { exact: true }).waitFor()
  const sessionB = await active(bookB)
  assert.equal(sessionB.testMode, 'spelling')
  await page.getByPlaceholder('输入英文拼写').fill(sessionB.words[0].word)
  await page.getByRole('button', { name: '提交', exact: true }).click()
  await waitIndex(sessionB.id, 1)
  await page.getByRole('button', { name: '下一题', exact: true }).click()
  await exitStudy()
  await planCard(bookA).getByRole('button', { name: '继续本轮', exact: true }).waitFor()
  await planCard(bookB).getByRole('button', { name: '继续本轮', exact: true }).waitFor()
  assert.equal((await active(bookA)).id, sessionA.id)
  assert.equal((await active(bookB)).id, sessionB.id)

  await planCard(bookB).getByRole('button', { name: '调整计划', exact: true }).click()
  await page.getByText(/已有未完成轮次/).waitFor()
  await page.getByRole('spinbutton', { name: '每轮学习数量' }).fill('10')
  await page.getByRole('button', { name: /^混合（推荐）/ }).click()
  await page.getByRole('button', { name: '保存修改并开始背词', exact: true }).click()
  await page.getByText('2 / 5', { exact: true }).waitFor()
  assert.equal((await active(bookB)).id, sessionB.id)
  assert.equal((await active(bookB)).testMode, 'spelling')
  assert.equal((await active(bookA)).currentIndex, 1)
  await exitStudy()
  await planCard(bookA).getByRole('button', { name: '继续本轮', exact: true }).click()
  await page.getByText('2 / 5', { exact: true }).waitFor()
  assert.equal((await active(bookA)).id, sessionA.id)
  await exitStudy()
  console.log('PASS: A/B settings reload independently, simultaneous unfinished rounds resume by exact plan, settings edits preserve old round snapshot and never reset another round')

  // Complete only A through the real completion button; B must stay untouched.
  const bBefore = await page.evaluate(async bId => { const { db } = await import('/src/db/index.ts'); return db.vocabPlans.get(bId) }, bId)
  await page.evaluate(async id => {
    const { db } = await import('/src/db/index.ts')
    const session = await db.vocabSessions.get(id)
    await db.vocabSessions.update(id, { phase: 'learning', currentIndex: 0, words: session.words.map(word => ({ ...word, firstCorrect: true })) })
  }, sessionA.id)
  await planCard(bookA).getByRole('button', { name: '继续本轮', exact: true }).click()
  await page.getByRole('button', { name: '完成本轮', exact: true }).click()
  await page.getByRole('heading', { name: '本轮背词完成', exact: true }).waitFor()
  const completed = await page.evaluate(async ({ bId, aId, user }) => {
    const { db } = await import('/src/db/index.ts')
    return { a: await db.vocabPlans.get(aId), b: await db.vocabPlans.get(bId), cards: await db.vocabCards.where('ownerId').equals(user.id).count(), private: await db.vocabPlans.get('private-plan') }
  }, { bId, aId: oldPlan.id, user })
  assert.equal(completed.a.cursor, 8)
  assert.equal(completed.a.studiedWords.length, 8)
  assert.equal(completed.a.shuffleSeed, oldPlan.shuffleSeed)
  assert.deepEqual(completed.b, bBefore)
  assert.equal(completed.cards, 21)
  assert.equal(completed.private.ownerId, user.id + 1)
  await page.getByRole('button', { name: '返回单词首页', exact: true }).click()
  console.log('PASS: completing A advances only A cursor/studied words; B progress and pending round remain; shared word has one card')

  await page.evaluate(async ({ user, bookA, bookB }) => {
    const { db } = await import('/src/db/index.ts')
    await db.vocabAttempts.where('ownerId').equals(user.id).delete()
    const attempt = (id, bookId, word, correct, createdAt, phase = 'screening', mode = 'choice', ownerId = user.id) => ({ id, ownerId, sessionId: 'stats', bookId, word, correct, createdAt, phase, mode, timedOut: false, elapsedMs: 1000, answer: '' })
    await db.vocabAttempts.bulkAdd([
      attempt('a-start', bookA, 'apple', false, '2026-10-23T16:00:00.000Z'),
      attempt('a-repeat', bookA, ' APPLE ', true, '2026-10-24T01:00:00.000Z'),
      attempt('a-end', bookA, 'banana', true, '2026-10-24T15:59:59.999Z'),
      attempt('a-mid', bookA, 'cat', true, '2026-10-24T04:00:00.000Z'),
      attempt('a-spell-ok', bookA, 'apple', true, '2026-10-24T04:01:00.000Z', 'retest', 'spelling'),
      attempt('a-spell-no', bookA, 'banana', false, '2026-10-24T04:02:00.000Z', 'retest', 'spelling'),
      attempt('b-one', bookB, 'apple', false, '2026-10-24T04:03:00.000Z'),
      attempt('b-two', bookB, 'dog', true, '2026-10-24T04:04:00.000Z'),
      attempt('b-spell', bookB, 'apple', false, '2026-10-24T04:05:00.000Z', 'retest', 'spelling'),
      attempt('old', bookA, 'old', true, '2026-10-23T15:59:59.999Z'),
      attempt('tomorrow', bookA, 'tomorrow', false, '2026-10-24T16:00:00.000Z'),
      attempt('review', 'review:multi-a', 'review', true, '2026-10-24T05:00:00.000Z'),
      attempt('private', bookA, 'private', true, '2026-10-24T05:00:00.000Z', 'screening', 'choice', user.id + 1),
    ])
  }, { user, bookA, bookB })
  await planCard(bookA).getByTestId('plan-today-count').filter({ hasText: '3/20' }).waitFor()
  assert.equal(await planCard(bookA).getByTestId('plan-first-accuracy').textContent(), '67%')
  assert.equal(await planCard(bookA).getByTestId('plan-spelling-accuracy').textContent(), '—')
  await planCard(bookA).getByText('首次复测正确率 50% · 补测不覆盖首测成绩', { exact: true }).waitFor()
  assert.equal(await planCard(bookB).getByTestId('plan-today-count').textContent(), '2/30')
  assert.equal(await planCard(bookB).getByTestId('plan-first-accuracy').textContent(), '50%')
  assert.equal(await planCard(bookB).getByTestId('plan-spelling-accuracy').textContent(), '—')
  await planCard(bookB).getByText('首次复测正确率 0% · 补测不覆盖首测成绩', { exact: true }).waitFor()
  if (process.env.TEST_SCREENSHOT) {
    await page.locator('section[aria-label="我的学习计划"]').evaluate(element => element.scrollIntoView({ block: 'start' }))
    await page.screenshot({ path: process.env.TEST_SCREENSHOT })
  }
  await page.clock.setFixedTime(new Date('2026-10-24T16:01:00Z'))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await planCard(bookA).getByTestId('plan-today-count').filter({ hasText: '1/20' }).waitFor()
  await planCard(bookB).getByTestId('plan-today-count').filter({ hasText: '0/30' }).waitFor()
  console.log('PASS: per-book unique first screening counts/accuracy and spelling retests; UTC/local day boundaries, excluded reviews/other accounts, day rollover refresh')

  await page.getByRole('button', { name: '添加计划', exact: true }).click()
  await page.getByRole('button', { name: /^高考词书/ }).click()
  await page.getByRole('spinbutton', { name: '每轮学习数量' }).fill('5')
  await page.getByRole('spinbutton', { name: '每日检测目标' }).fill('10')
  await page.getByRole('button', { name: /^英译汉 英文/ }).click()
  await page.getByRole('button', { name: /^专注锁定本轮/ }).click()
  await page.getByRole('button', { name: '保存计划', exact: true }).click()
  await page.waitForURL(`${origin}/vocab`)
  await planCard('gk').getByRole('button', { name: '开始背词' }).click()
  await page.getByText('1 / 5', { exact: true }).waitFor()
  const remoteSession = await active('gk')
  assert.equal(remoteSession.words.length, 5)
  assert.deepEqual(remoteRequests.map(({ offset, limit }) => ({ offset, limit })), [{ offset: 0, limit: 5 }])
  assert.ok(remoteRequests[0].seed)
  assert.equal((await active(bookB)).id, sessionB.id)
  await exitStudy()
  await planCard('gk').getByRole('button', { name: '继续本轮', exact: true }).waitFor()
  assert.equal(await page.getByTestId('vocab-plan-card').count(), 3)
  await planCard(bookA).getByText('累计进度 8/10', { exact: true }).waitFor()
  console.log('PASS: remote exam wordbook runs alongside custom notebooks with its own seed/offset/session; existing A/B unaffected')

  const restored = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const { exportCloudBackup, restoreCloudBackup } = await import('/src/lib/cloudBackup.ts')
    const data = await exportCloudBackup()
    const plansBefore = JSON.stringify(data.vocabPlans)
    await restoreCloudBackup(data, user.username)
    const exported = await exportCloudBackup()
    return { plansMatch: plansBefore === JSON.stringify(exported.vocabPlans), plans: exported.vocabPlans.length, sessions: exported.vocabSessions.length, private: await db.vocabPlans.where('ownerId').equals(user.id + 1).count() }
  }, user)
  assert.deepEqual(restored, { plansMatch: true, plans: 3, sessions: 3, private: 1 })
  assert.deepEqual(errors, [])
  console.log('PASS: multi-plan cloud backup/restore preserves both plans, rounds and other-account data')
} finally { releaseCatalog(); await context.close(); await browser.close() }
