// Production-build benchmark. Isolated browser storage and mocked API; no real user data.
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright')
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--no-proxy-server'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
page.setDefaultTimeout(30000)
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5182'
const user = { id: 998901, username: 'isolated-perf', nickname: 'perf', grade: 'highschool' }
await page.addInitScript(user => { localStorage.setItem('auth_user', JSON.stringify(user)); localStorage.setItem('auth_token', 'isolated') }, user)
await page.route('https://fonts.googleapis.com/**', route => route.abort())
await page.route('https://fonts.gstatic.com/**', route => route.abort())
await page.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/auth/me' ? user : [] }))
try {
  await page.goto(`${origin}/vocab`)
  await page.getByText('这一天还没有添加单词', { exact: true }).waitFor()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  for (const count of [100, 1000, 3000]) {
    await page.goto(`${origin}/`)
    await page.getByText('学习助手 👋', { exact: true }).waitFor()
    const database = await page.evaluate(async ({ count, user }) => {
      const opened = await new Promise((resolve, reject) => {
        const request = indexedDB.open('StudyAppDB')
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
      const tx = opened.transaction(['vocabCards', 'vocabNotebooks'], 'readwrite')
      const cards = tx.objectStore('vocabCards'), books = tx.objectStore('vocabNotebooks')
      cards.clear(); books.clear()
      const now = new Date()
      for (let i = 0; i < 10; i++) books.put({ id: `perf-book-${i}`, name: `词本${i}`, ownerId: user.id, createdAt: now.toISOString(), updatedAt: now.toISOString() })
      for (let i = 0; i < count; i++) cards.add({ ownerId: user.id, word: `perfword${i}`, translation: `n. 单词释义；隔离性能测试中文释义 ${i}`, phonetic: 'pɜːf', partOfSpeech: '名词', tags: ['gk', 'cet4', 'cet6', 'ky'], exchange: 's:examples/p:exampled/d:exampled/i:exampling', due: now, stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0, createdAt: now.toISOString(), notebookIds: [`perf-book-${i % 10}`] })
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
      const start = performance.now()
      const request = opened.transaction('vocabCards', 'readonly').objectStore('vocabCards').index('ownerId').getAll(user.id)
      await new Promise((resolve, reject) => { request.onsuccess = resolve; request.onerror = () => reject(request.error) })
      opened.close()
      return { readAllMs: Math.round(performance.now() - start) }
    }, { count, user })
    // Raw fixture writes bypass Dexie's cache notifications. Reload before measurement.
    await page.reload()
    await page.getByText('学习助手 👋', { exact: true }).waitFor()
    const mount = await page.evaluate(async count => {
      const tasks = []
      const observer = new PerformanceObserver(list => tasks.push(...list.getEntries()))
      observer.observe({ type: 'longtask' })
      const start = performance.now()
      history.pushState({}, '', '/vocab'); dispatchEvent(new PopStateEvent('popstate'))
      const expected = Math.min(count, 50)
      while (document.querySelectorAll('[aria-label^="单词perfword"]').length !== expected) {
        await new Promise(requestAnimationFrame)
        if (performance.now() - start > 20000) throw new Error('List render timeout')
      }
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
      observer.disconnect()
      return { renderMs: Math.round(performance.now() - start), rows: document.querySelectorAll('[aria-label^="单词perfword"]').length, domNodes: document.querySelectorAll('*').length, maxLongTaskMs: Math.round(Math.max(0, ...tasks.filter(task => task.startTime >= start).map(task => task.duration))) }
    }, count)
    const openEditMs = await page.evaluate(async () => {
      const start = performance.now()
      document.querySelector('[aria-label="编辑单词"]').click()
      while (!document.querySelector('input[placeholder="输入英文单词"]')) await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
      return Math.round(performance.now() - start)
    })
    assert.equal(mount.rows, 50)
    assert.ok(mount.domNodes < 1500)
    console.log(JSON.stringify({ count, ...database, ...mount, openEditMs, cpuThrottle: 4 }))
  }
} finally { await context.close(); await browser.close() }
