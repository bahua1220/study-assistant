import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright')
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--no-proxy-server'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
await page.route('https://fonts.googleapis.com/**', route => route.abort())
await page.route('https://fonts.gstatic.com/**', route => route.abort())
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5181'
const user = { id: 987003, username: 'batch-test', nickname: '测试', grade: 'highschool' }
const bookId = 'batch-import-test-book'
const errors = []
const batches = []
const singleLookups = []
let failBatch = false
const entry = word => ({ word, translation: word === 'badword' ? '' : `释义-${word}`, phonetic: `ipa-${word}`, pos: 'noun', source: word === 'badword' ? 'unresolved' : 'dictionary', tags: ['gk'], exchange: `s:${word}s` })
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(user => { localStorage.setItem('auth_token', 'isolated-test'); localStorage.setItem('auth_user', JSON.stringify(user)) }, user)
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  if (path === '/api/auth/me') return route.fulfill({ json: user })
  if (path === '/api/vocab/books') return route.fulfill({ json: [] })
  if (path === '/api/vocab/lookup-batch') {
    const { words } = route.request().postDataJSON()
    batches.push(words)
    return failBatch ? route.fulfill({ status: 503, json: { detail: '模拟批量查询失败' } }) : route.fulfill({ json: { words: words.map(entry) } })
  }
  if (path === '/api/word-lookup') {
    const body = route.request().postDataJSON()
    singleLookups.push(body.word)
    return route.fulfill({ json: { ...entry(body.word), posCn: '名词', example: '', exampleTranslation: '' } })
  }
  return route.fulfill({ status: 404, json: { detail: 'unexpected test request' } })
})
const rows = () => page.getByTestId('vocab-draft')
async function openBatch() {
  await page.goto(`${origin}/vocab/add?notebookId=${bookId}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('button', { name: '批量粘贴', exact: true }).click()
}
try {
  await page.goto(`${origin}/vocab/add`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.evaluate(async ({ user, bookId }) => {
    const { db } = await import('/src/db/index.ts')
    const now = new Date().toISOString()
    await db.vocabNotebooks.add({ id: bookId, ownerId: user.id, name: '批量测试', createdAt: now, updatedAt: now })
    const base = { tags: [], due: new Date(), stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0, createdAt: now }
    await db.vocabCards.bulkAdd([
      { ...base, ownerId: user.id, word: 'apple', translation: '原有苹果', notebookIds: [bookId] },
      { ...base, ownerId: user.id + 1, word: 'banana', translation: '其他用户', notebookIds: [] },
    ])
  }, { user, bookId })
  const parser = await page.evaluate(async () => {
    const { parseVocabLines } = await import('/src/lib/vocabImport.ts')
    return parseVocabLines("1. Apple\r\n\r\n• banana\napple\nask sb. to do sth.\nDo ONE’S best\n苹果")
  })
  assert.deepEqual(parser.words, ['apple', 'banana', 'ask sb. to do sth.', "do one's best"])
  assert.equal(parser.duplicates, 1)
  assert.equal(parser.invalid[0].line, 7)

  await openBatch()
  const input = page.getByRole('textbox', { name: '每行一个单词或短语' })
  const parse = page.getByRole('button', { name: '解析并查询资料', exact: true })
  await input.fill('apple\n苹果')
  await page.getByRole('alert').filter({ hasText: '第 2 行' }).waitFor()
  assert.equal(await parse.isDisabled(), true)
  const many = Array.from({ length: 81 }, (_, index) => 'word' + String.fromCharCode(97 + Math.floor(index / 26)) + String.fromCharCode(97 + index % 26))
  await input.fill(many.join('\n'))
  await page.getByRole('alert').filter({ hasText: '不会自动截断' }).waitFor()
  assert.equal(await parse.isDisabled(), true)
  assert.equal(batches.length, 0)

  const words = ['apple', 'banana', 'ask sb. to do sth.', 'provide somebody with something', 'badword']
  await input.fill('1. Apple\r\n\r\nbanana\nAPPLE\nask sb. to do sth.\nprovide somebody with something\nbadword')
  await page.getByRole('status').filter({ hasText: '有效 5 项 · 重复 1 行 · 需修改 0 行' }).waitFor()
  await parse.click()
  await page.getByTestId('vocab-save-top').filter({ hasText: '批量加入单词本（3）' }).waitFor()
  assert.deepEqual(batches, [words])
  assert.deepEqual(singleLookups, [])
  assert.equal(await rows().count(), 5)
  assert.equal(await rows().first().getByRole('button', { name: '选择此单词' }).isDisabled(), true)
  await rows().nth(2).getByRole('button', { name: '展开单词详情', exact: true }).click()
  assert.equal(await rows().nth(2).getByPlaceholder('请填写短语的中文意思').inputValue(), '释义-ask sb. to do sth.')
  assert.equal(await rows().nth(2).getByPlaceholder('音标', { exact: true }).count(), 0)
  await rows().nth(4).getByRole('alert').waitFor()
  await rows().nth(4).getByPlaceholder('请填写中文释义').fill('手动补全')
  await rows().nth(1).getByRole('textbox', { name: '英文单词或短语' }).fill('cat')
  await rows().nth(1).getByRole('textbox', { name: '英文单词或短语' }).blur()
  await rows().nth(1).getByRole('button', { name: '展开单词详情', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=vocab-draft] textarea')].some(element => element.value === '释义-cat'))
  assert.deepEqual(singleLookups, ['cat'])

  // Switching input modes preserves the batch, without mixing OCR/manual drafts.
  await page.getByRole('button', { name: '拍照识别', exact: true }).click()
  assert.equal(await rows().count(), 0)
  await page.getByRole('button', { name: '批量粘贴', exact: true }).click()
  assert.equal(await rows().count(), 5)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true)
  if (process.env.TEST_SCREENSHOT) await page.screenshot({ path: process.env.TEST_SCREENSHOT, fullPage: true })
  await page.getByTestId('vocab-save-bottom').filter({ hasText: '批量加入单词本（4）' }).click()
  await page.waitForURL(`${origin}/vocab/notebooks?id=${bookId}`)
  const saved = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    return db.vocabCards.where('ownerId').equals(user.id).toArray()
  }, user)
  assert.equal(saved.length, 5)
  assert.equal(saved.find(item => item.word === 'apple').translation, '原有苹果')
  assert.equal(saved.find(item => item.word === 'badword').translation, '手动补全')
  assert.equal(saved.find(item => item.word === 'cat').phonetic, 'ipa-cat')
  for (const word of ['ask sb. to do sth.', 'provide somebody with something']) {
    const phrase = saved.find(item => item.word === word)
    assert.equal(phrase.phonetic, '')
    assert.equal(phrase.partOfSpeech, '')
    assert.equal(phrase.exchange, '')
    assert.deepEqual(phrase.tags, [])
    assert.deepEqual(phrase.notebookIds, [bookId])
  }

  failBatch = true
  await openBatch()
  await page.getByRole('textbox', { name: '每行一个单词或短语' }).fill('dog\nmouse')
  await page.getByRole('button', { name: '解析并查询资料', exact: true }).click()
  await rows().first().getByRole('alert').waitFor()
  assert.equal(await rows().count(), 2)
  assert.equal(await rows().first().getByPlaceholder('请填写中文释义').isEditable(), true)
  assert.deepEqual(errors, [])
  console.log('PASS: newline paste, numbering/empty lines, deduplication, invalid/oversized input, one batch request, phrase notation, incomplete results, manual correction, notebook duplicates, account isolation, mode separation, saved metadata and recoverable batch failure')
} finally {
  await context.close()
  await browser.close()
}
