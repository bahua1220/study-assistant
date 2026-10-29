import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { photoFixtures } from './photo-fixtures.mjs'

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright')
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--no-proxy-server'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
page.setDefaultTimeout(15000)
await page.route('https://fonts.googleapis.com/**', route => route.abort())
await page.route('https://fonts.gstatic.com/**', route => route.abort())
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5181'
const user = { id: 987004, username: 'photo-test', nickname: '测试', grade: 'highschool' }
const errors = []
let fixtures = []
let calls = []
let active = 0
let maxActive = 0
let large = false
let thirdFails = true
let firstGate
let secondGate
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(user => { localStorage.setItem('auth_token', 'isolated-test'); localStorage.setItem('auth_user', JSON.stringify(user)) }, user)
function gate() { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }
const entry = word => ({ word, translation: `释义-${word}`, phonetic: `ipa-${word}`, pos: 'n.', source: 'dictionary', tags: ['gk'], exchange: `s:${word}s` })
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  if (path === '/api/auth/me') return route.fulfill({ json: user })
  if (path === '/api/vocab/books') return route.fulfill({ json: [] })
  if (path === '/api/vocab/recognize') {
    const body = route.request().postDataJSON()
    const index = fixtures.findIndex(file => file.buffer.toString('base64') === body.image)
    assert.ok(index >= 0)
    assert.equal(body.mimeType, 'image/jpeg')
    calls.push(index); active++; maxActive = Math.max(active, maxActive)
    try {
      if (index === 0 && firstGate) await firstGate.promise
      if (index === 1 && secondGate) await secondGate.promise
      if (index === 2 && thirdFails && !large) return await route.fulfill({ status: 502, json: { detail: '第三张测试失败' } })
      const words = large ? Array.from({ length: 80 }, (_, wordIndex) => String.fromCharCode(97 + index) + 'word' + String.fromCharCode(97 + Math.floor(wordIndex / 26)) + String.fromCharCode(97 + wordIndex % 26)) : [['apple', 'shared'], ['shared', 'banana'], ['cat', 'shared']][index]
      return await route.fulfill({ json: { words: words.map(entry), limitReached: large } })
    } finally { active-- }
  }
  return route.fulfill({ status: 404, json: { detail: 'unexpected test request' } })
})
const photos = () => page.getByTestId('vocab-photo')
const rows = () => page.getByTestId('vocab-draft')
const rowIndex = async word => page.evaluate(word => [...document.querySelectorAll('[data-testid=vocab-draft]')].findIndex(row => row.querySelector('input[aria-label="英文单词或短语"]').value === word), word)
const row = async word => {
  const index = await rowIndex(word); assert.ok(index >= 0, `Missing word row: ${word}`)
  const item = rows().nth(index), expand = item.getByRole('button', { name: '展开单词详情', exact: true })
  if (await expand.count() && await expand.isEnabled()) await expand.click()
  return item
}
async function openScan() {
  await page.goto(`${origin}/vocab/add`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('button', { name: '拍照识别', exact: true }).click()
}
try {
  await openScan()
  console.log('CHECK: scan page loaded')
  fixtures = await photoFixtures(page)
  const input = page.locator('input[type=file]')
  await input.setInputFiles([...fixtures, fixtures[0]])
  await page.getByText(/本次选择未添加/).waitFor()
  assert.equal(await photos().count(), 0)
  await input.setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') })
  await page.getByText(/图片无法读取/).waitFor()
  assert.equal(await photos().count(), 0)
  await input.setInputFiles(fixtures)
  await page.getByText('已选 3/3 张', { exact: true }).waitFor()
  console.log('CHECK: three photo previews loaded')
  assert.equal(await page.getByRole('button', { name: '相册多选', exact: true }).isDisabled(), true)
  const boxes = await Promise.all([0, 1, 2].map(index => photos().nth(index).boundingBox()))
  assert.ok(boxes.every(box => Math.abs(box.y - boxes[0].y) < 2))

  // Remove before OCR, then use the browser camera picker to append another shot.
  await page.getByRole('button', { name: '移除第3张照片', exact: true }).click()
  const chooser = page.waitForEvent('filechooser', { timeout: 15000 })
  await page.getByRole('button', { name: '继续拍照', exact: true }).click()
  await (await chooser).setFiles(fixtures[2])
  await page.getByText('已选 3/3 张', { exact: true }).waitFor()
  console.log('CHECK: continuous camera append passed')
  await page.getByRole('button', { name: '预览第1张照片', exact: true }).click()
  await page.getByRole('dialog', { name: '照片原图' }).waitFor()
  assert.ok((await page.getByRole('img', { name: '照片原图', exact: true }).getAttribute('src')).endsWith(fixtures[0].buffer.toString('base64')))
  await page.getByRole('button', { name: '关闭照片预览', exact: true }).click()

  firstGate = gate(); secondGate = gate()
  await page.getByRole('button', { name: '开始识别', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid=vocab-photo]').textContent.includes('识别中'))
  assert.deepEqual(calls, [0])
  assert.equal(await page.getByRole('button', { name: '移除第1张照片', exact: true }).isDisabled(), true)
  firstGate.release(); firstGate = undefined
  await page.getByRole('status').filter({ hasText: '已处理 1/3 张' }).waitFor()
  assert.equal(await rows().count(), 2)
  assert.equal(await (await row('apple')).getByRole('textbox', { name: '英文单词或短语' }).isEditable(), false)
  secondGate.release(); secondGate = undefined
  await page.getByRole('status').filter({ hasText: '已处理 3/3 张 · 成功 2 · 失败 1' }).waitFor()
  console.log('CHECK: partial failure and sequential processing passed')
  assert.deepEqual(calls, [0, 1, 2])
  assert.equal(maxActive, 1)
  assert.equal(await rows().count(), 3)
  await (await row('shared')).getByText('来自照片 1、2', { exact: true }).waitFor()

  // Retry only the failed photo and preserve user corrections / selection states.
  await (await row('apple')).getByPlaceholder('请填写中文释义').fill('手工核对的苹果')
  await (await row('banana')).getByRole('button', { name: '选择此单词' }).click()
  thirdFails = false
  await page.getByRole('button', { name: '重试第3张照片', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已处理 3/3 张 · 成功 3 · 失败 0' }).waitFor()
  assert.deepEqual(calls, [0, 1, 2, 2])
  assert.equal(await rows().count(), 4)
  assert.equal(await (await row('apple')).getByPlaceholder('请填写中文释义').inputValue(), '手工核对的苹果')
  assert.equal(await (await row('banana')).getByRole('button', { name: '选择此单词' }).getAttribute('aria-pressed'), 'false')
  await (await row('shared')).getByText('来自照片 1、2、3', { exact: true }).waitFor()
  if (process.env.TEST_SCREENSHOT) {
    await page.getByRole('button', { name: '预览第1张照片', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: process.env.TEST_SCREENSHOT })
  }

  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '清空本批 / 重新选图', exact: true }).click()
  assert.equal(await photos().count(), 3)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '移除第2张照片', exact: true }).click()
  assert.equal(await rows().count(), 3)
  await (await row('shared')).getByText('来自照片 1、2', { exact: true }).waitFor()
  await page.getByTestId('vocab-save-top').filter({ hasText: '批量加入单词本（3）' }).click()
  await page.waitForURL(`${origin}/vocab`)
  const saved = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    return db.vocabCards.where('ownerId').equals(user.id).toArray()
  }, user)
  assert.deepEqual(new Set(saved.map(item => item.word)), new Set(['apple', 'shared', 'cat']))
  assert.equal(saved.find(item => item.word === 'apple').translation, '手工核对的苹果')

  // 80 per photo is not an 80-word cap across the entire three-photo batch.
  await openScan(); large = true; calls = []
  await page.locator('input[type=file]').setInputFiles(fixtures)
  await page.getByText('已选 3/3 张', { exact: true }).waitFor()
  await page.getByRole('button', { name: '开始识别', exact: true }).click()
  await page.getByTestId('vocab-save-top').filter({ hasText: '批量加入单词本（240）' }).waitFor({ timeout: 30000 })
  assert.equal(await rows().count(), 30)
  await page.getByRole('navigation', { name: '识别结果分页' }).first().getByText('第 1/8 页 · 共 240 项', { exact: true }).waitFor()
  assert.equal(await page.getByRole('alert').filter({ hasText: '已达单图80项上限' }).count(), 3)
  assert.deepEqual(calls, [0, 1, 2])
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '清空本批 / 重新选图', exact: true }).click()
  assert.equal(await rows().count(), 0)
  assert.equal(await photos().count(), 0)
  // During a slow recognition, duplicate status must follow the latest target book.
  await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const now = new Date().toISOString()
    await db.vocabNotebooks.bulkAdd(['photo-old', 'photo-new'].map(id => ({ id, name: id, ownerId: user.id, createdAt: now, updatedAt: now })))
    const apple = await db.vocabCards.where('ownerId').equals(user.id).filter(item => item.word === 'apple').first()
    await db.vocabCards.update(apple.id, { notebookIds: ['photo-old'] })
  }, user)
  large = false
  await page.getByRole('combobox').selectOption('photo-old')
  await page.locator('input[type=file]').setInputFiles(fixtures[0])
  await page.getByText('已选 1/3 张', { exact: true }).waitFor()
  firstGate = gate()
  await page.getByRole('button', { name: '开始识别', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid=vocab-photo]').textContent.includes('识别中'))
  await page.getByRole('combobox').selectOption('photo-new')
  firstGate.release(); firstGate = undefined
  await page.getByTestId('vocab-save-top').filter({ hasText: '批量加入单词本（2）' }).waitFor()
  assert.equal(await (await row('apple')).getByRole('button', { name: '选择此单词' }).isDisabled(), false)
  assert.deepEqual(errors, [])
  console.log('PASS: 3-photo limit, invalid image, one-row layout, camera append, original preview, sequential progress, partial failure, single-photo retry, provenance/dedup, edits preserved, safe removal/reset, saved data, 240-word batch and explicit per-photo limit warnings')
} finally {
  firstGate?.release(); secondGate?.release()
  await context.close(); await browser.close()
}
