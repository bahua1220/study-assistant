import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, LogIn, UserPlus, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { useAuth, GRADE_OPTIONS } from '../context/AuthContext'
import { authLogin, authRegister } from '../services/api'

type Mode = 'login' | 'register'

export function LoginPage() {
  const { token, login: doLogin } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('login')

  // 已登录就跳走
  useEffect(() => {
    if (token) navigate('/', { replace: true })
  }, [token, navigate])

  // 表单状态
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [grade, setGrade] = useState('highschool')

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setError('')

    if (!username.trim() || !password.trim()) {
      setError('请填写用户名和密码')
      return
    }

    setLoading(true)
    try {
      const data = mode === 'login'
        ? await authLogin(username.trim(), password)
        : await authRegister(username.trim(), password, nickname.trim(), grade)
      await doLogin(data.token, data.user)
    } catch (e: any) {
      setError(e.message || '请求失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const isRegister = mode === 'register'

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-2xl font-bold mb-1">
            <Sparkles size={28} className="text-brand-500" />
            学习助手
          </div>
          <p className="text-sm text-zinc-400">
            {isRegister ? '创建账号，开始学习之旅' : '欢迎回来'}
          </p>
        </div>

        {/* 卡片 */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
          {/* Tab 切换 */}
          <div className="flex gap-2 mb-1">
            <button
              onClick={() => { setMode('login'); setError('') }}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors',
                !isRegister
                  ? 'bg-brand-500 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
              )}
            >
              <LogIn size={16} />
              登录
            </button>
            <button
              onClick={() => { setMode('register'); setError('') }}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors',
                isRegister
                  ? 'bg-brand-500 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
              )}
            >
              <UserPlus size={16} />
              注册
            </button>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-sm">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}

          {/* 表单 */}
          <div className="space-y-3">
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="input"
              placeholder="用户名"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />

            {isRegister && (
              <input
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                className="input"
                placeholder="昵称（选填，默认同用户名）"
              />
            )}

            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input"
              placeholder="密码"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />

            {/* 年级选择（仅注册） */}
            {isRegister && (
              <div>
                <label className="text-xs font-medium text-zinc-500 block mb-1.5">你的年级</label>
                <div className="grid grid-cols-3 gap-2">
                  {GRADE_OPTIONS.map(g => (
                    <button
                      key={g.value}
                      onClick={() => setGrade(g.value)}
                      className={clsx(
                        'py-2 rounded-lg text-xs font-medium transition-colors',
                        grade === g.value
                          ? 'bg-brand-100 dark:bg-brand-900 text-brand-600 dark:text-brand-400 ring-1 ring-brand-400'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                      )}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="btn-primary w-full text-sm flex items-center justify-center gap-2"
            >
              {loading ? (
                <span>处理中...</span>
              ) : isRegister ? (
                '注册'
              ) : (
                '登录'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
