import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { photoFixtures } from './photo-fixtures.mjs'

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright')
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--no-proxy-server'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
page.setDefaultTimeout(15000)
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5181'
const user = { id: 987006, username: 'pagination-test', nickname: '测试', grade: 'highschool' }
const errors = []
let photoNumber = 0
const entry = word => ({ word, translation: `释义-${word}`, phonetic: '', pos: 'n.', source: 'dictionary', tags: [], exchange: '' })
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(user => { localStorage.setItem('auth_token', 'isolated-test'); localStorage.setItem('auth_user', JSON.stringify(user)) }, user)
await page.route('https://fonts.googleapis.com/**', route => route.abort())
await page.route('https://fonts.gstatic.com/**', route => route.abort())
await page.route('**/api/**', route => {
  const path = new URL(route.request().url()).pathname
  if (path === '/api/auth/me') return route.fulfill({ json: user })
  if (path === '/api/vocab/books') return route.fulfill({ json: [] })
  if (path === '/api/vocab/recognize') {
    const prefix = String.fromCharCode(97 + photoNumber++)
    return route.fulfill({ json: { words: Array.from({ length: 80 }, (_, i) => entry(prefix + 'word' + String.fromCharCode(97 + Math.floor(i / 26), 97 + i % 26))) } })
  }
  return route.fulfill({ status: 404, json: { detail: 'unexpected test request' } })
})
const list = () => page.locator('[aria-label^="单词seed"]')
const pager = () => page.getByRole('navigation', { name: '单词列表分页', exact: true }).first()
const draftPager = () => page.getByRole('navigation', { name: '识别结果分页', exact: true }).first()
async function waitCount(locator, count) { await page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length === count, { selector: locator, count }) }

try {
  await page.goto(`${origin}/vocab`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '背单词', exact: true }).waitFor()
  const seed = await page.evaluate(async user => {
    const { db, StudyDB } = await import('/src/db/index.ts')
    const { default: Dexie } = await import('/node_modules/dexie/dist/modern/dexie.mjs')
    // Exercise the actual v13 -> latest index-only upgrades on a separate database.
    const name = 'IsolatedVocabMigrationTest'
    const probe = new StudyDB(name)
    const schema = Object.fromEntries(probe.tables.map(table => [table.name, [table.schema.primKey.src, ...table.schema.indexes.filter(index => index.name !== '[ownerId+createdAt]').map(index => index.src)].join(',')]))
    probe.close()
    const old = new Dexie(name); old.version(13).stores(schema)
    const now = new Date(), stamp = now.toISOString()
    const legacy = { id: 7, ownerId: user.id, word: 'legacy', translation: '旧数据', tags: ['gk'], notebookIds: ['a'], due: new Date(0), state: 2, reps: 17, stability: 4, difficulty: 3, elapsedDays: 1, scheduledDays: 5, createdAt: stamp }
    await old.table('vocabCards').bulkAdd([legacy, { ...legacy, id: 8, ownerId: user.id + 1 }])
    await old.table('reviewLogs').add({ id: 3, ownerId: user.id, cardId: 7, rating: 3, reviewedAt: now })
    const before = JSON.stringify([await old.table('vocabCards').toArray(), await old.table('reviewLogs').toArray()]); old.close()
    const upgraded = new StudyDB(name); await upgraded.open()
    const after = JSON.stringify([await upgraded.vocabCards.toArray(), await upgraded.reviewLogs.toArray()])
    if (before !== after) throw new Error('Migration altered legacy records')
    if (await upgraded.vocabCards.where('[ownerId+createdAt]').equals([user.id, stamp]).count() !== 1) throw new Error('New date index missing')
    await upgraded.delete()

    const today = new Date(); today.setHours(12, 0, 0, 0)
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    const books = ['a', 'b'].map(id => ({ id, ownerId: user.id, name: `本子${id}`, createdAt: stamp, updatedAt: stamp }))
    await db.vocabNotebooks.bulkAdd(books)
    const cards = Array.from({ length: 123 }, (_, i) => ({ ...legacy, id: undefined, word: `seed${String(i).padStart(3, '0')}`, createdAt: new Date((i < 80 ? today : yesterday).getTime() + i).toISOString(), notebookIds: [i % 2 === 0 ? 'a' : 'b'] }))
    await db.vocabCards.bulkAdd([...cards, { ...legacy, id: undefined, ownerId: user.id + 1, word: 'secret', notebookIds: ['a'] }])
    return { today: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}` }
  }, user)
  await pager().getByText('第 1/2 页 · 共 80 项', { exact: true }).waitFor()
  assert.equal(await list().count(), 50)
  const first = await list().evaluateAll(items => items.map(item => item.getAttribute('aria-label')))
  await pager().getByRole('button', { name: '下一页' }).click()
  await pager().getByText('第 2/2 页 · 共 80 项', { exact: true }).waitFor()
  await waitCount('[aria-label^="单词seed"]', 30)
  const last = await list().evaluateAll(items => items.map(item => item.getAttribute('aria-label')))
  assert.equal(new Set([...first, ...last]).size, 80)
  await page.getByRole('button', { name: '全部', exact: true }).click()
  await pager().getByText('第 1/3 页 · 共 123 项', { exact: true }).waitFor()
  await page.getByRole('combobox', { name: '筛选单词本' }).selectOption('a')
  await pager().getByText('第 1/2 页 · 共 62 项', { exact: true }).waitFor()
  await pager().getByRole('button', { name: '下一页' }).click()
  await waitCount('[aria-label^="单词seed"]', 12)
  // Deleting the last page must clamp to the prior page, not show an empty screen.
  await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const cards = await db.vocabCards.where('ownerId').equals(user.id).toArray()
    await db.vocabCards.bulkDelete(cards.filter(card => card.notebookIds.includes('a') && Number(card.word.slice(4)) < 24).map(card => card.id))
  }, user)
  await page.getByRole('navigation', { name: '单词列表分页', exact: true }).first().waitFor({ state: 'detached' })
  await waitCount('[aria-label^="单词seed"]', 50)
  console.log('PASS: migration preserves cards/progress/reviews/accounts; indexed local-date filter, 50-row pages, complete totals, no overlap, filter reset and deletion clamping')

  // The selection editor must preserve memberships not mounted on the current page.
  await page.goto(`${origin}/vocab/notebooks?id=b`)
  await page.getByText('61个单词 · 按本背诵和复习', { exact: true }).waitFor()
  await page.getByRole('button', { name: '管理收录 / 添加已有单词', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '管理收录单词' })
  await dialog.getByRole('heading', { name: '收录已有单词（61）', exact: true }).waitFor()
  assert.equal(await dialog.getByRole('checkbox').count(), 50)
  const selected = dialog.getByRole('checkbox').filter({ visible: true })
  const firstSelected = await selected.evaluateAll(items => items.findIndex(item => item.checked))
  await selected.nth(firstSelected).uncheck()
  await dialog.getByRole('button', { name: '下一页' }).click()
  await dialog.getByText('第 2/3 页 · 共 111 项', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '保存收录', exact: true }).click()
  await page.getByText('60个单词 · 按本背诵和复习', { exact: true }).waitFor()
  const checked = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    return { total: await db.vocabCards.where('ownerId').equals(user.id).count(), other: await db.vocabCards.where('ownerId').equals(user.id + 1).count(), changedProgress: await db.vocabCards.where('ownerId').equals(user.id).filter(card => card.reps !== 17).count() }
  }, user)
  assert.deepEqual(checked, { total: 111, other: 1, changedProgress: 0 })
  console.log('PASS: paged notebook selection preserves offscreen memberships, learning progress and account isolation')

  await page.goto(`${origin}/vocab/add`)
  await page.getByRole('button', { name: '拍照识别', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(await photoFixtures(page))
  await page.getByText('已选 3/3 张', { exact: true }).waitFor()
  await page.getByRole('button', { name: '开始识别', exact: true }).click()
  await page.getByTestId('vocab-save-top').filter({ hasText: '批量加入单词本（240）' }).waitFor()
  assert.equal(await page.getByTestId('vocab-draft').count(), 30)
  assert.equal(await page.locator('[data-testid=vocab-draft] textarea').count(), 0)
  await page.getByTestId('vocab-draft').first().getByRole('button', { name: '展开单词详情' }).click()
  await page.getByTestId('vocab-draft').first().getByPlaceholder('请填写中文释义').fill('修改后释义')
  await page.getByTestId('vocab-draft').nth(1).getByRole('button', { name: '选择此单词' }).click()
  await draftPager().getByRole('button', { name: '下一页' }).click()
  await page.getByTestId('vocab-draft').first().getByRole('button', { name: '选择此单词' }).click()
  await draftPager().getByRole('button', { name: '上一页' }).click()
  await page.getByTestId('vocab-draft').first().getByText('修改后释义', { exact: true }).waitFor()
  assert.equal(await page.getByTestId('vocab-draft').nth(1).getByRole('button', { name: '选择此单词' }).getAttribute('aria-pressed'), 'false')
  if (process.env.TEST_SCREENSHOT) await page.screenshot({ path: process.env.TEST_SCREENSHOT })
  await page.getByTestId('vocab-save-top').filter({ hasText: '批量加入单词本（238）' }).click()
  await page.waitForURL(`${origin}/vocab`)
  const saved = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const cards = await db.vocabCards.where('ownerId').equals(user.id).toArray()
    return { total: cards.length, imported: cards.filter(card => card.reps === 0).length, edits: cards.filter(card => card.translation === '修改后释义').length }
  }, user)
  assert.deepEqual(saved, { total: 349, imported: 238, edits: 1 })
  const sampled = await page.evaluate(async () => {
    const { sessionWords } = await import('/src/lib/vocabNotebooks.ts')
    const pool = Array.from({ length: 3000 }, (_, i) => ({ word: `test${i}`, translation: `释义${i}`, tags: [] }))
    return Array.from({ length: 30 }, () => sessionWords(pool.slice(0, 100), pool)).flat().every(item => item.choices.length === 4 && new Set(item.choices).size === 4 && item.choices.includes(item.translation))
  })
  assert.equal(sampled, true)
  assert.deepEqual(errors, [])
  console.log('PASS: 240 compact drafts mount 30 rows/no hidden edit forms; page changes preserve edits/selection; bulk save includes all 238 selected words across 8 pages; choice sampling remains valid')
} finally { await context.close(); await browser.close() }
