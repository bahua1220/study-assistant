import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App render failed', error, info)
  }

  private retry = () => {
    window.location.reload()
  }

  private resetSession = () => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
    window.location.hash = '#/login'
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-screen bg-white px-6 flex items-center justify-center text-zinc-900">
        <div className="w-full max-w-sm rounded-3xl border border-zinc-200 p-6 shadow-sm text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <h1 className="text-xl font-bold">页面启动失败</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            本地数据没有丢失，可以先重新加载。若仍无法进入，请返回登录页后重试。
          </p>
          <button className="btn-primary w-full mt-6" onClick={this.retry}>
            重新加载
          </button>
          <button className="btn-ghost w-full mt-2" onClick={this.resetSession}>
            返回登录页
          </button>
          <details className="mt-4 text-left text-xs text-zinc-400">
            <summary>错误信息</summary>
            <p className="mt-2 break-all">{this.state.error.message || 'Unknown error'}</p>
          </details>
        </div>
      </div>
    )
  }
}
