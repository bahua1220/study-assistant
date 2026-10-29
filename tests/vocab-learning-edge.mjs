import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright')
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--no-proxy-server'] })
const context = await browser.newContext({ viewport: { width: 390, height: 740 }, timezoneId: 'Asia/Shanghai' })
const page = await context.newPage()
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5181'
const user = { id: 987010, username: 'vocab-edge-test', grade: 'highschool' }
await page.addInitScript(user => { localStorage.setItem('auth_token', 'isolated'); localStorage.setItem('auth_user', JSON.stringify(user)) }, user)
await page.route('https://fonts.googleapis.com/**', route => route.abort())
await page.route('https://fonts.gstatic.com/**', route => route.abort())
await page.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/auth/me' ? user : [] }))
try {
  await page.goto(`${origin}/vocab`)
  await page.getByRole('heading', { name: '背单词', exact: true }).waitFor()
  const migrated = await page.evaluate(async user => {
    const { StudyDB } = await import('/src/db/index.ts')
    const { default: Dexie } = await import('/node_modules/dexie/dist/modern/dexie.mjs')
    const name = 'IsolatedVocabV15Migration'
    const probe = new StudyDB(name)
    const schema = Object.fromEntries(probe.tables.map(table => [table.name, [table.schema.primKey.src, ...table.schema.indexes.filter(index => table.name !== 'vocabAttempts' || index.name !== '[ownerId+word]').map(index => index.src)].join(',')]))
    probe.close()
    const old = new Dexie(name); old.version(14).stores(schema)
    const stamp = '2026-10-01T00:00:00Z'
    const legacy = { id: 'legacy-evidence', ownerId: user.id, sessionId: 'old', bookId: 'gk', word: 'Apple', correct: false, timedOut: true, answer: '', phase: 'screening', mode: 'spelling', createdAt: stamp, elapsedMs: 10000 }
    await old.table('vocabAttempts').bulkAdd([legacy, { ...legacy, id: 'private', ownerId: user.id + 1 }]); old.close()
    const current = new StudyDB(name); await current.open()
    const attempts = await current.vocabAttempts.where('[ownerId+word]').equals([user.id, 'Apple']).toArray()
    const same = JSON.stringify(attempts) === JSON.stringify([legacy])
    const version = current.verno; await current.delete()
    return { same, version }
  }, user)
  assert.deepEqual(migrated, { same: true, version: 15 })
  await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const now = new Date().toISOString()
    const word = { word: 'apple', translation: '苹果', phonetic: '', pos: '', tags: [], exchange: '', choices: ['苹果', '梨', '桃', '瓜'], firstMode: 'choice' }
    await db.vocabSessions.add({ id: 'timeout-round', ownerId: user.id, bookId: 'gk', bookName: '超时测试', testMode: 'mixed', rulesVersion: 2, focusLock: false, phase: 'screening', status: 'active', words: [word], currentIndex: 0, interruptions: 0, sourceOffset: 0, nextOffset: 1, startedAt: now, updatedAt: now })
  }, user)
  await page.clock.install()
  await page.goto(`${origin}/vocab/study?sessionId=timeout-round`)
  await page.getByText('1 / 1', { exact: true }).waitFor()
  await page.clock.fastForward(6100)
  await page.getByText(/超时，正确答案：苹果/).waitFor()
  await page.clock.fastForward(60000)
  const timeout = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    return db.vocabAttempts.where('ownerId').equals(user.id).toArray()
  }, user)
  assert.equal(timeout.length, 1); assert.equal(timeout[0].timedOut, true); assert.equal(timeout[0].answer, '')
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
  await page.getByRole('button', { name: '开始拼写复测（1词）', exact: true }).click()
  await page.getByRole('button', { name: '不会，直接下一个', exact: true }).click()
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
  await page.getByRole('button', { name: '开始集中补测（1词）', exact: true }).click()
  await page.getByRole('button', { name: '不会，直接下一个', exact: true }).click()
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
  await page.getByText(/1词仍需巩固/).waitFor()
  const checks = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const { nextAnswerSession, questionMode } = await import('/src/lib/vocabLearning.ts')
    const old = await db.vocabSessions.get('timeout-round')
    const legacy = { ...old, id: 'legacy', rulesVersion: undefined, phase: 'retest', status: 'active', retestQueue: ['apple'], retestRound: undefined, currentIndex: 0 }
    const continued = nextAnswerSession(legacy, 1, false, false, 100, 'bad')
    const initial = { ...legacy, phase: 'screening', testMode: 'mixed', words: legacy.words.map(word => ({ ...word, firstMode: undefined })) }
    const stamp = new Date().toISOString()
    await db.vocabAttempts.bulkAdd(Array.from({ length: 36 }, (_, i) => ({ id: `extra-${i}`, ownerId: user.id, sessionId: 'historical-round', bookId: 'gk', word: `extra${i}`, phase: 'screening', mode: 'choice', correct: false, timedOut: false, elapsedMs: 10, answer: '梨', createdAt: stamp })))
    await db.vocabSessions.add({ ...old, id: 'historical-round', words: [{ word: 'extra0', translation: '旧记录正确含义' }] })
    return { attempts: await db.vocabAttempts.where('sessionId').equals('timeout-round').count(), legacyQueue: continued.retestQueue.length, legacyPhase: continued.phase, legacyMode: questionMode(initial, initial.words[0]) }
  }, user)
  assert.deepEqual(checks, { attempts: 3, legacyQueue: 2, legacyPhase: 'retest', legacyMode: 'choice' })
  await page.getByRole('button', { name: '查看错词本', exact: true }).click()
  await page.getByRole('heading', { name: '错词本', exact: true }).waitFor()
  assert.equal(await page.getByTestId('mistake-word').count(), 30)
  const first = await page.getByTestId('mistake-word').allTextContents()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  assert.equal(await page.getByTestId('mistake-word').count(), 7)
  const next = await page.getByTestId('mistake-word').allTextContents()
  assert.equal(new Set([...first, ...next]).size, 37)
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  const historical = page.getByTestId('mistake-word').filter({ has: page.getByText('extra0', { exact: true }) })
  if (await historical.count() === 0) await page.getByRole('button', { name: '下一页', exact: true }).click()
  await historical.getByRole('button', { name: '查看错误记录', exact: true }).click()
  await page.getByRole('dialog', { name: '单词错误记录' }).getByText('正确答案：旧记录正确含义', { exact: true }).waitFor()
  console.log('PASS: actual v14→v15 evidence-preserving indexed migration; real timeout counted once; skip counts; legacy mode/queue preserved; 37-word pagination without overlap; old answer context restored from session')
} finally { await context.close(); await browser.close() }
