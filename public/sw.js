// Service worker：只缓存静态资源，绝不拦截 /api/ 接口请求。
//
// 注意：本文件当前未被注册（main.tsx / index.html 均无 register 调用），
// 保留它是为了将来启用 PWA 时直接可用。策略说明：
//   - 页面导航：网络优先，断网时回退缓存（避免陈旧页面）
//   - 静态资源：缓存优先 + 后台更新（stale-while-revalidate）
//   - /api/* 与跨域请求一律直连网络，不读缓存、不写缓存，
//     防止鉴权接口返回陈旧数据或跨账号串数据。
const CACHE_NAME = 'study-app-static-v2'

const PRECACHE_URLS = [
  '/',
  '/index.html',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // 后端接口永不缓存。
  if (url.pathname.startsWith('/api/')) return

  // 页面导航：网络优先，失败回退缓存（最终回退到 index.html）。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        const copy = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        return response
      }).catch(() =>
        caches.match(request).then((cached) => cached || caches.match('/index.html'))
      )
    )
    return
  }

  // 静态资源：缓存优先，后台拉新。
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      }).catch(() => cached)
      return cached || network
    })
  )
})
