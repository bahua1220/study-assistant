import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { photoFixtures } from './photo-fixtures.mjs'

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright')
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--no-proxy-server'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
page.setDefaultTimeout(15000)
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5181'
const user = { id: 987005, username: 'dedup-test', nickname: '测试', grade: 'highschool' }
const errors = []
let fixtures = []
let calls = []
let releaseSecond
const secondGate = new Promise(resolve => { releaseSecond = resolve })
const wordsA = Array.from({ length: 59 }, (_, n) => 'aword' + String.fromCharCode(97 + Math.floor(n / 26), 97 + n % 26)).concat("do one's best")
const wordsB = Array.from({ length: 59 }, (_, n) => 'bword' + String.fromCharCode(97 + Math.floor(n / 26), 97 + n % 26)).concat('ask sb. to do sth.')
const entry = word => ({ word, translation: `释义-${word}`, phonetic: '', pos: 'n.', source: 'dictionary', tags: [], exchange: '' })
const top = () => page.getByTestId('vocab-save-top')
const bottom = () => page.getByTestId('vocab-save-bottom')
const rows = () => page.getByTestId('vocab-draft')
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(user => { localStorage.setItem('auth_token', 'isolated-test'); localStorage.setItem('auth_user', JSON.stringify(user)) }, user)
await page.route('https://fonts.googleapis.com/**', route => route.abort())
await page.route('https://fonts.gstatic.com/**', route => route.abort())
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  if (path === '/api/auth/me') return route.fulfill({ json: user })
  if (path === '/api/vocab/books') return route.fulfill({ json: [] })
  if (path === '/api/word-lookup') return route.fulfill({ json: entry(route.request().postDataJSON().word) })
  if (path === '/api/vocab/recognize') {
    const image = route.request().postDataJSON().image
    const index = fixtures.findIndex(file => file.buffer.toString('base64') === image)
    calls.push(index)
    if (calls.length === 2) await secondGate
    const words = index === 0 ? wordsA : wordsB
    // The second upload is byte-identical, but OCR may differ in case/spacing/quotes.
    const result = calls.length === 2 ? words.map(word => `  ${word.toUpperCase().replace(/'/g, '’')}  `) : words
    return route.fulfill({ json: { words: result.map(entry), limitReached: false } })
  }
  return route.fulfill({ status: 404, json: { detail: 'unexpected test request' } })
})

async function scan() {
  await page.goto(`${origin}/vocab/add`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('button', { name: '拍照识别', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles([fixtures[0], { ...fixtures[0], name: 'same-photo-again.jpg' }, fixtures[2]])
  await page.getByText('已选 3/3 张', { exact: true }).waitFor()
  await page.getByRole('button', { name: '开始识别', exact: true }).click()
}
async function checkCount(count) {
  for (const action of [top(), bottom()]) {
    await action.filter({ hasText: `批量加入单词本（${count}）` }).waitFor()
    assert.equal(await action.isEnabled(), count > 0)
  }
}
try {
  await page.goto(`${origin}/vocab/add`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  fixtures = await photoFixtures(page)
  await scan()
  await top().filter({ hasText: '请先完成照片识别' }).waitFor()
  assert.equal(await top().isDisabled(), true)
  assert.equal(await bottom().isDisabled(), true)
  assert.equal(await rows().count(), 30)
  releaseSecond()
  await page.getByRole('status').filter({ hasText: '已处理 3/3 张 · 成功 3 · 失败 0' }).waitFor()
  assert.deepEqual(calls, [0, 0, 2])
  assert.equal(await rows().count(), 30)
  await page.getByRole('navigation', { name: '识别结果分页' }).first().getByText('第 1/4 页 · 共 120 项', { exact: true }).waitFor()
  await checkCount(120)
  await page.getByRole('status').filter({ hasText: '跨照片重复已合并 60 项' }).waitFor()
  await rows().first().getByText('来自照片 1、2', { exact: true }).waitFor()
  const order = await page.evaluate(() => {
    const stats = document.querySelector('[data-testid=vocab-result-stats]')
    const top = document.querySelector('[data-testid=vocab-save-top]')
    const rows = [...document.querySelectorAll('[data-testid=vocab-draft]')]
    const bottom = document.querySelector('[data-testid=vocab-save-bottom]')
    const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    return before(stats, top) && before(top, rows[0]) && before(rows.at(-1), bottom)
  })
  assert.equal(order, true)
  await top().scrollIntoViewIfNeeded()
  await top().evaluate(element => element.scrollIntoView({ block: 'center' }))
  if (process.env.TEST_SCREENSHOT) await page.screenshot({ path: process.env.TEST_SCREENSHOT })
  await rows().first().getByRole('button', { name: '选择此单词' }).click()
  await checkCount(119)
  await rows().first().getByRole('button', { name: '选择此单词' }).click()
  await checkCount(120)
  await top().click()
  await page.waitForURL(`${origin}/vocab`)
  const savedWords = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    return (await db.vocabCards.where('ownerId').equals(user.id).toArray()).map(item => item.word)
  }, user)
  assert.equal(savedWords.length, 120)
  assert.deepEqual(new Set(savedWords), new Set([...wordsA, ...wordsB]))
  console.log('PASS: byte-identical photos with 60+60+60 results merge to 120, normalized phrase/case dedup, selected counts, action placement and top-button save')

  // Existing words are not re-added; moving into another notebook only adds membership.
  await scan()
  await page.getByRole('status').filter({ hasText: '已处理 3/3 张 · 成功 3 · 失败 0' }).waitFor()
  await checkCount(0)
  await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const now = new Date().toISOString()
    await db.vocabNotebooks.add({ id: 'dedup-new', ownerId: user.id, name: '新单词本', createdAt: now, updatedAt: now })
  }, user)
  await page.getByRole('combobox').selectOption('dedup-new')
  await checkCount(120)
  // Editing a word into another existing draft must not inflate the add count.
  for (let i = 0; i < 2; i++) await page.getByRole('navigation', { name: '识别结果分页' }).first().getByRole('button', { name: '下一页' }).click()
  const edit = rows().first().getByRole('textbox', { name: '英文单词或短语' })
  await edit.fill(wordsA[0]); await edit.blur()
  await checkCount(119)
  await bottom().click()
  await page.waitForURL(`${origin}/vocab/notebooks?id=dedup-new`)
  const saved = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const cards = await db.vocabCards.where('ownerId').equals(user.id).toArray()
    return { total: cards.length, inBook: cards.filter(card => card.notebookIds?.includes('dedup-new')).length }
  }, user)
  assert.deepEqual(saved, { total: 120, inBook: 119 })
  assert.deepEqual(errors, [])
  console.log('PASS: existing-word exclusion, notebook switch, manual edits creating duplicates, accurate counts and bottom-button save without duplicate cards')
} finally {
  releaseSecond()
  await context.close(); await browser.close()
}
