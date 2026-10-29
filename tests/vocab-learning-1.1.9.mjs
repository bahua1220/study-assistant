import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright')
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--no-proxy-server'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' })
const page = await context.newPage()
page.setDefaultTimeout(15000)
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5181'
const user = { id: 987009, username: 'learning-rules-test', nickname: '测试', grade: 'highschool' }
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(user => {
  localStorage.setItem('auth_token', 'isolated-test'); localStorage.setItem('auth_user', JSON.stringify(user))
  window.__spoken = []
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => [{ lang: 'en-US', localService: true }], cancel: () => {},
    speak: utterance => { window.__spoken.push(utterance.text); setTimeout(() => utterance.onend?.(), 10) },
  } })
}, user)
await page.route('https://fonts.googleapis.com/**', route => route.abort())
await page.route('https://fonts.gstatic.com/**', route => route.abort())
await page.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/auth/me' ? user : [] }))
const state = () => page.evaluate(async user => {
  const { db } = await import('/src/db/index.ts')
  return { sessions: await db.vocabSessions.where('ownerId').equals(user.id).toArray(), attempts: await db.vocabAttempts.where('ownerId').equals(user.id).toArray(), coins: await db.coinRecords.where('ownerId').equals(user.id).count(), logs: await db.reviewLogs.where('ownerId').equals(user.id).count() }
}, user)
async function advance() { await page.getByRole('button', { name: /^(下一题|查看结果)$/ }).click() }
async function answer(word, correct) {
  const input = page.getByPlaceholder('输入英文拼写')
  if (await input.count()) {
    await input.fill(correct ? word.word : 'not-the-answer')
    await page.getByRole('button', { name: '提交', exact: true }).click()
  } else {
    const choice = correct ? word.translation : word.choices.find(value => value !== word.translation)
    await page.getByRole('button').filter({ hasText: choice }).first().click()
  }
  await page.getByRole('button', { name: /^(下一题|查看结果)$/ }).waitFor()
}
try {
  await page.goto(`${origin}/vocab`)
  await page.getByRole('heading', { name: '背单词', exact: true }).waitFor()
  const modes = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const { assignQuestionModes } = await import('/src/lib/vocabLearning.ts')
    const sample = Array.from({ length: 30 }, (_, i) => ({ word: `word${i}`, translation: `含义${i}`, phonetic: '', pos: '', tags: [], exchange: '', choices: [`含义${i}`, '干扰一', '干扰二', '干扰三'] }))
    for (let run = 0; run < 40; run++) {
      const assigned = assignQuestionModes(sample, 'mixed')
      if (assigned.filter(item => item.firstMode === 'choice').length !== 15) throw new Error('unbalanced modes')
      for (let i = 0; i < 30; i += 2) if (assigned[i].firstMode === assigned[i + 1].firstMode) throw new Error('blocked modes')
      if (new Set(assigned.map(item => item.word)).size !== 30) throw new Error('duplicate words')
    }
    const small = assignQuestionModes(sample.slice(0, 5).map((word, index) => index < 4 ? { ...word, choices: [] } : word), 'mixed')
    const now = new Date().toISOString()
    await db.vocabNotebooks.add({ id: 'rules', ownerId: user.id, name: '混合测试本', createdAt: now, updatedAt: now })
    const names = ['apple', 'banana', 'cat', 'desk', 'elephant', 'find somebody']
    await db.vocabCards.bulkAdd(names.map((word, index) => ({ ownerId: user.id, word, translation: `释义${index}`, phonetic: 'test', partOfSpeech: 'n.', tags: [], notebookIds: ['rules'], due: new Date(0), stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0, createdAt: now })))
    await db.vocabPlans.add({ id: 'rules-plan', ownerId: user.id, bookId: 'notebook:rules', bookName: '混合测试本', wordCount: 6, batchSize: 6, dailyTarget: 6, testMode: 'mixed', focusLock: false, cursor: 0, shuffleSeed: 'seed', active: 1, createdAt: now, updatedAt: now })
    return small.map(item => item.firstMode)
  }, user)
  assert.equal(modes.filter(mode => mode === 'choice').length, 1)
  console.log('PASS: 40 randomized balanced/interleaved mixed assignments; no duplicated words; choice shortages safely use spelling')

  await page.goto(`${origin}/vocab/study?planId=rules-plan`)
  await page.getByText('1 / 6', { exact: true }).waitFor()
  const original = (await state()).sessions[0]
  assert.equal(original.rulesVersion, 2)
  assert.equal(original.words.filter(word => word.firstMode === 'choice').length, 3)
  assert.equal(await page.getByRole('button', { name: /^朗读 / }).count(), 0)
  await answer(original.words[0], false)
  const savedFirst = await state()
  assert.equal(savedFirst.attempts.length, 1); assert.equal(savedFirst.logs, 1)
  assert.equal(savedFirst.sessions[0].currentIndex, 1)
  await page.getByRole('button', { name: `朗读 ${original.words[0].word}`, exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.__spoken), [original.words[0].word])
  // Reload while viewing feedback: answer and next position were already committed.
  await page.reload()
  await page.getByText('2 / 6', { exact: true }).waitFor()
  assert.deepEqual((await state()).sessions[0].words.map(word => [word.word, word.firstMode]), original.words.map(word => [word.word, word.firstMode]))
  for (let i = 1; i < 6; i++) { await answer(original.words[i], i >= 2); await advance() }
  await page.getByText('集中学习薄弱词', { exact: true }).waitFor()
  assert.equal((await state()).attempts.length, 6)
  await page.getByRole('checkbox', { name: /学习时自动朗读/ }).check()
  await page.waitForFunction(() => window.__spoken.length >= 1)
  const beforeNextWord = await page.evaluate(() => window.__spoken.length)
  await page.getByRole('button', { name: '下一个词', exact: true }).click()
  await page.waitForFunction(count => window.__spoken.length > count, beforeNextWord)
  await page.getByRole('checkbox', { name: /学习时自动朗读/ }).uncheck()
  await page.getByRole('button', { name: '开始拼写复测（2词）', exact: true }).click()
  await page.getByText('1 / 2', { exact: true }).waitFor()
  await answer(original.words[0], false); await advance()
  await page.getByText('2 / 2', { exact: true }).waitFor()
  assert.equal((await state()).sessions[0].retestQueue.length, 2)
  await answer(original.words[1], true); await advance()
  await page.getByText('补测前再巩固一下', { exact: true }).waitFor()
  await page.getByRole('button', { name: '开始集中补测（1词）', exact: true }).click()
  await page.getByText('1 / 1', { exact: true }).waitFor()
  await answer(original.words[0], false); await advance()
  await page.getByRole('heading', { name: '本轮背词完成', exact: true }).waitFor()
  await page.getByText(/1词仍需巩固/).waitFor()
  const completed = await state()
  assert.equal(completed.attempts.length, 9)
  assert.equal(completed.sessions[0].status, 'completed')
  assert.equal(completed.sessions[0].words[0].retestAttempts, 2)
  assert.equal(completed.sessions[0].words[1].retestAttempts, 1)
  assert.equal(completed.coins, 1)
  console.log('PASS: saved mixed question order survives reload; answer evidence/progress saved before leaving; manual/audio feedback; two bounded passes finish with unresolved words and one reward')

  await page.getByRole('button', { name: '查看错词本', exact: true }).click()
  await page.getByRole('heading', { name: '错词本', exact: true }).waitFor()
  assert.equal(await page.getByTestId('mistake-word').count(), 2)
  const first = page.getByTestId('mistake-word').filter({ hasText: original.words[0].word })
  await first.getByText(/累计错3次/).waitFor()
  await first.getByRole('button', { name: '查看错误记录', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '单词错误记录', exact: true })
  await dialog.getByText('你的答案：not-the-answer', { exact: true }).first().waitFor()
  await dialog.getByText(`正确答案：${original.words[0].word}`, { exact: true }).first().waitFor()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.reload()
  await first.getByText(/累计错3次/).waitFor()
  await page.getByLabel('错词来源', { exact: true }).selectOption('notebook:rules')
  assert.equal(await page.getByTestId('mistake-word').count(), 2)
  await page.screenshot({ path: '.tools/vocab-mistakes-1.1.9.png' })
  const mastery = await page.evaluate(async ({ user, word }) => {
    const { db } = await import('/src/db/index.ts')
    const { summarizeMistakes } = await import('/src/lib/vocabMistakes.ts')
    const { summarizeBookAttempts } = await import('/src/lib/vocabPlans.ts')
    const base = Date.now() + 10000
    const attempt = (id, sessionId, phase, correct, offset, ownerId = user.id) => ({ id, sessionId, phase, correct, ownerId, word, bookId: 'notebook:rules', mode: 'spelling', timedOut: false, elapsedMs: 100, answer: word, translation: '历史释义', createdAt: new Date(base + offset).toISOString() })
    await db.vocabAttempts.bulkAdd([attempt('mastery-a', 'later-a', 'screening', true, 1), attempt('mastery-a-repeat', 'later-a', 'screening', true, 2), attempt('mastery-retest', 'later-a', 'retest', true, 3), attempt('other-owner', 'private', 'screening', false, 4, user.id + 1)])
    const read = async () => summarizeMistakes(await db.vocabAttempts.where('ownerId').equals(user.id).toArray()).get(word)
    const one = await read()
    await db.vocabAttempts.add(attempt('mastery-b', 'later-b', 'screening', true, 5))
    const two = await read()
    await db.vocabAttempts.add(attempt('mastery-wrong', 'later-c', 'screening', false, 6))
    const reset = await read()
    const stats = summarizeBookAttempts(await db.vocabAttempts.where('ownerId').equals(user.id).toArray()).get('notebook:rules')
    return { one: { rounds: one.correctRounds, mastered: one.mastered, errors: one.errors }, two: { rounds: two.correctRounds, mastered: two.mastered, errors: two.errors }, reset: { rounds: reset.correctRounds, mastered: reset.mastered, errors: reset.errors }, stats }
  }, { user, word: original.words[0].word })
  assert.deepEqual(mastery.one, { rounds: 1, mastered: false, errors: 3 })
  assert.deepEqual(mastery.two, { rounds: 2, mastered: true, errors: 3 })
  assert.deepEqual(mastery.reset, { rounds: 0, mastered: false, errors: 4 })
  assert.equal(mastery.stats.tested, 6)
  assert.equal(mastery.stats.correct, 4)
  assert.equal(mastery.stats.spelling, 3)
  assert.equal(mastery.stats.spellingCorrect, 2)
  console.log('PASS: persistent deduplicated wrong-word list/details/filters; exact cumulative errors; retests do not fake mastery; two distinct screening rounds master, new error reopens; first-test accuracy unchanged')

  await page.getByRole('button', { name: /^只练这些错词/ }).click()
  await page.getByText('错词专项巩固', { exact: true }).waitFor()
  const practice = (await state()).sessions.find(session => session.bookId === 'mistakes')
  assert.equal(practice.words.length, 2)
  for (const word of practice.words) { await answer(word, true); await advance() }
  await page.getByRole('button', { name: '完成本轮', exact: true }).click()
  await page.getByRole('heading', { name: '本轮背词完成', exact: true }).waitFor()
  assert.equal((await state()).coins, 1)

  const atomic = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const { commitStudyAnswer } = await import('/src/lib/vocabStudyRecords.ts')
    const seed = (await db.vocabSessions.where('ownerId').equals(user.id).first())
    const round = { ...seed, id: 'atomic', planId: undefined, status: 'active', phase: 'screening', words: seed.words.slice(0, 1), currentIndex: 0, answerRevision: 0 }
    await db.vocabSessions.put(round)
    const before = JSON.stringify([await db.vocabCards.toArray(), await db.reviewLogs.toArray(), await db.vocabAttempts.toArray()])
    const savedAdd = db.vocabAttempts.add
    db.vocabAttempts.add = () => Promise.reject(new Error('simulated storage failure'))
    try { await commitStudyAnswer(round, user.id, 'wrong', false, false, 100, 10000) } catch {}
    db.vocabAttempts.add = savedAdd
    const rolledBack = before === JSON.stringify([await db.vocabCards.toArray(), await db.reviewLogs.toArray(), await db.vocabAttempts.toArray()])
    const other = await commitStudyAnswer(round, user.id + 1, 'wrong', false, false, 100, 10000).then(() => false, () => true)
    await Promise.allSettled([commitStudyAnswer(round, user.id, 'wrong', false, false, 100, 10000), commitStudyAnswer(round, user.id, 'wrong', false, false, 100, 10000)])
    return { rolledBack, other, attempts: await db.vocabAttempts.where('sessionId').equals('atomic').count(), revision: (await db.vocabSessions.get('atomic')).answerRevision }
  }, user)
  assert.deepEqual(atomic, { rolledBack: true, other: true, attempts: 1, revision: 1 })
  const restored = await page.evaluate(async user => {
    const { db } = await import('/src/db/index.ts')
    const { exportCloudBackup, restoreCloudBackup } = await import('/src/lib/cloudBackup.ts')
    const { summarizeMistakes } = await import('/src/lib/vocabMistakes.ts')
    const data = await exportCloudBackup()
    const before = JSON.stringify([...summarizeMistakes(data.vocabAttempts)])
    await restoreCloudBackup(data, user.username)
    const after = await exportCloudBackup()
    return { same: before === JSON.stringify([...summarizeMistakes(after.vocabAttempts)]), rules: after.vocabSessions.every(session => session.rulesVersion === 2), private: await db.vocabAttempts.where('ownerId').equals(user.id + 1).count() }
  }, user)
  assert.deepEqual(restored, { same: true, rules: true, private: 1 })
  console.log('PASS: wrong-word scoped practice, no extra reward; forced storage error rolls back FSRS/attempt/progress; concurrent submits count once; owner isolation; cloud restore retains all evidence and rules')

  await page.goto(`${origin}/vocab/mistakes`)
  await page.getByRole('heading', { name: '错词本', exact: true }).waitFor()
  await page.evaluate(() => Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [], cancel: () => {} } }))
  await page.getByRole('button', { name: /^朗读 / }).first().click()
  const speech = page.getByRole('dialog', { name: '朗读提示', exact: true })
  await speech.getByText(/缺少本地英文语音/).waitFor()
  await speech.getByRole('button', { name: '关闭朗读提示', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log('PASS: absent English voice produces actionable settings prompt; no online speech fallback or real AI calls; no browser errors')
} finally { await context.close(); await browser.close() }
