import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { photoFixtures } from './photo-fixtures.mjs'

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-proxy-server'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
await page.route('https://fonts.googleapis.com/**', route => route.abort())
await page.route('https://fonts.gstatic.com/**', route => route.abort())
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5181'
const user = { id: 987002, username: 'draft-test', nickname: '测试', grade: 'highschool' }
const errors = []
const requests = []
const held = new Map()
const definitions = {
  apple: ['苹果', 'apple-ipa', '名词', ['gk'], 's:apples'],
  banana: ['香蕉', 'banana-ipa', '名词', ['cet4'], 's:bananas'],
  cat: ['猫', 'cat-ipa', '名词', ['zk'], 's:cats'],
  dog: ['狗', 'dog-ipa', '名词', ['gk'], 's:dogs'],
  'look after': ['照顾', 'must-clear', 'must-clear', ['must-clear'], 'must-clear'],
}
const result = word => {
  const [translation, phonetic, posCn, tags, exchange] = definitions[word] ?? ['测试释义', 'ipa', '名词', [], '']
  return { word, translation, phonetic, posCn, pos: 'noun', tags, exchange, example: '', exampleTranslation: '' }
}
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(user => {
  localStorage.setItem('auth_token', 'isolated-test')
  localStorage.setItem('auth_user', JSON.stringify(user))
}, user)
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  if (path === '/api/auth/me') return route.fulfill({ json: user })
  if (path === '/api/vocab/books') return route.fulfill({ json: [] })
  if (path === '/api/vocab/recognize') return route.fulfill({ json: { words: [{ ...result('apple'), pos: '名词', source: 'dictionary' }] } })
  if (path === '/api/word-lookup') {
    const body = route.request().postDataJSON()
    requests.push(body)
    if (body.word === 'badword') return route.fulfill({ status: 502, json: { detail: '查询失败测试' } })
    if (held.has(body.word)) await held.get(body.word).promise
    return route.fulfill({ json: result(body.word) })
  }
  return route.fulfill({ status: 404, json: { detail: 'unexpected test request' } })
})
function hold(word) {
  let release
  const promise = new Promise(resolve => { release = resolve })
  held.set(word, { promise, release })
  return release
}
async function waitValue(locator, expected) {
  await locator.evaluate((element, expected) => new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => element.value === expected ? resolve() : Date.now() - start > 5000 ? reject(new Error(`Expected ${expected}, got ${element.value}`)) : setTimeout(check, 25)
    check()
  }), expected)
}
const rows = () => page.getByTestId('vocab-draft')
const spelling = row => row.getByRole('textbox', { name: '英文单词或短语', exact: true })
const meaning = row => row.getByPlaceholder('请填写中文释义')
async function edit(row, word) { await spelling(row).fill(word); await spelling(row).blur() }

try {
  await page.goto(`${origin}/vocab/add`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '拍照识别', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles((await photoFixtures(page))[0])
  await page.getByText('已选 1/3 张', { exact: true }).waitFor()
  await page.getByRole('button', { name: '开始识别', exact: true }).click()
  const row = rows().first()
  await row.getByRole('button', { name: '展开单词详情', exact: true }).click()
  await waitValue(meaning(row), '苹果')

  const releaseBanana = hold('banana')
  await edit(row, 'banana')
  await row.getByRole('button', { name: '查询中...', exact: true }).waitFor()
  assert.equal(await meaning(row).inputValue(), '')
  assert.equal(await row.getByPlaceholder('音标', { exact: true }).inputValue(), '')
  assert.equal(await page.getByTestId('vocab-save-top').filter({ hasText: '请先完成单词查询' }).isDisabled(), true)
  assert.equal(await page.getByTestId('vocab-save-bottom').filter({ hasText: '请先完成单词查询' }).isDisabled(), true)
  releaseBanana(); held.delete('banana')
  await waitValue(meaning(row), '香蕉')
  assert.equal(await row.getByPlaceholder('音标', { exact: true }).inputValue(), 'banana-ipa')
  assert.equal(await row.getByPlaceholder('词性', { exact: true }).inputValue(), '名词')
  assert.equal(await row.getByPlaceholder('例如：gk cet4 ielts').inputValue(), 'cet4')
  assert.equal(await row.getByPlaceholder('暂无词形变化').inputValue(), 's:bananas')

  // Requery while spelling input is focused must make exactly one request.
  await spelling(row).fill('cat')
  const before = requests.length
  await row.getByRole('button', { name: '重新查询', exact: true }).click()
  await waitValue(meaning(row), '猫')
  assert.equal(requests.length, before + 1)

  // A late response for an old spelling cannot overwrite a more recent result.
  const releaseApple = hold('apple')
  await edit(row, 'apple')
  await row.getByRole('button', { name: '查询中...', exact: true }).waitFor()
  await edit(row, 'dog')
  await waitValue(meaning(row), '狗')
  releaseApple(); held.delete('apple')
  await page.waitForTimeout(150)
  assert.equal(await spelling(row).inputValue(), 'dog')
  assert.equal(await meaning(row).inputValue(), '狗')

  // A phrase has only a meaning, and clears word-specific metadata.
  await edit(row, 'look after')
  await waitValue(row.getByPlaceholder('请填写短语的中文意思'), '照顾')
  assert.equal(await row.getByPlaceholder('音标', { exact: true }).count(), 0)

  // Missing words can be appended and automatically looked up.
  await page.getByRole('button', { name: '手动增加一行', exact: true }).click()
  await edit(rows().nth(1), 'banana')
  await waitValue(meaning(rows().nth(1)), '香蕉')

  // Failures never retain the previous word's meaning; manual entry is possible.
  await edit(rows().nth(1), 'badword')
  await rows().nth(1).getByRole('alert').waitFor()
  assert.equal(await meaning(rows().nth(1)).inputValue(), '')
  await meaning(rows().nth(1)).fill('手动释义')

  // Deleting a row during a request cannot recreate it or change an adjacent row.
  await page.getByRole('button', { name: '手动增加一行', exact: true }).click()
  const releaseCat = hold('cat')
  await edit(rows().nth(2), 'cat')
  await rows().nth(2).getByRole('button', { name: '查询中...', exact: true }).waitFor()
  await rows().nth(2).getByRole('button', { name: '删除此行', exact: true }).click()
  releaseCat(); held.delete('cat')
  await page.waitForTimeout(150)
  assert.equal(await rows().count(), 2)
  await page.getByTestId('vocab-save-top').filter({ hasText: '批量加入单词本（2）' }).click()
  await page.waitForURL(`${origin}/vocab`)
  const saved = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    return db.vocabCards.where('ownerId').equals(user.id).toArray()
  }, user)
  assert.equal(saved.length, 2)
  const phrase = saved.find(item => item.word === 'look after')
  assert.equal(phrase.translation, '照顾')
  assert.equal(phrase.phonetic, '')
  assert.equal(phrase.partOfSpeech, '')
  assert.deepEqual(phrase.tags, [])
  assert.equal(phrase.exchange, '')
  assert.equal(saved.find(item => item.word === 'badword').translation, '手动释义')

  // The same editor behavior applies to the manual-add lookup result.
  await page.goto(`${origin}/vocab/add`)
  await page.getByPlaceholder('例如：abandon / look forward to').fill('apple')
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await waitValue(meaning(rows().first()), '苹果')
  await edit(rows().first(), 'banana')
  await waitValue(meaning(rows().first()), '香蕉')
  await page.getByRole('button', { name: '加入单词本', exact: true }).click()
  await page.waitForURL(`${origin}/vocab`)
  assert.ok(requests.every(item => item.preferDictionary === true))
  assert.deepEqual(errors, [])
  console.log('PASS: OCR correction, all metadata, manual retry, stale responses, phrases, omitted words, failed lookup/manual entry, deletion in flight, saved data, manual-add editor')
} finally {
  for (const value of held.values()) value.release()
  await context.close()
  await browser.close()
}
