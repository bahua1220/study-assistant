// 统一的"登录态失效 → 回到登录页"处理。
//
// 应用同时支持 BrowserRouter（Web 开发）与 HashRouter（Android WebView，
// 见 App.tsx）。直接 window.location.assign('/login') 在原生 WebView 会跳到
// capacitor://localhost/login 这类不存在的路径导致白屏，因此这里通过注册
// 回调让 Router 使用 navigate 完成跳转；没有路由上下文时兜底用 hash 导航。
type UnauthorizedHandler = () => void

let handler: UnauthorizedHandler | null = null

export function registerUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  handler = fn
}

export function redirectToLogin(): void {
  localStorage.removeItem('auth_token')
  localStorage.removeItem('auth_user')
  if (handler) {
    handler()
  } else {
    // 兜底：兼容 HashRouter（Android 端）的登录页地址。
    window.location.hash = '#/login'
  }
}
