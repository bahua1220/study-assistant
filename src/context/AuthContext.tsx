import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { claimLegacyData } from '../db'
import { apiUrl } from '../services/api'
import { pruneOldQAImages } from '../lib/maintenance'

export interface UserInfo {
  id: number
  username: string
  nickname: string
  grade: string
}

interface AuthState {
  token: string | null
  user: UserInfo | null
  login: (token: string, user: UserInfo) => Promise<void>
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthState>({
  token: null,
  user: null,
  login: async () => {},
  logout: () => {},
  isLoading: true,
})

const GRADE_LABELS: Record<string, string> = {
  elementary: '小学',
  middle: '初中',
  highschool: '高中',
  college: '大学',
  ielts: '雅思/托福',
}

export function gradeLabel(grade: string): string {
  return GRADE_LABELS[grade] || grade
}

export const GRADE_OPTIONS = [
  { value: 'elementary', label: '小学' },
  { value: 'middle', label: '初中' },
  { value: 'highschool', label: '高中' },
  { value: 'college', label: '大学' },
  { value: 'ielts', label: '雅思/托福' },
]

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<UserInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // 启动时从 localStorage 恢复
  useEffect(() => {
    let active = true

    const restoreSession = async () => {
      const savedToken = localStorage.getItem('auth_token')
      const savedUser = localStorage.getItem('auth_user')
      if (!savedToken || !savedUser) {
        if (active) setIsLoading(false)
        return
      }

      try {
        let parsedUser = JSON.parse(savedUser) as UserInfo
        try {
          const response = await fetch(apiUrl('/api/auth/me'), {
            headers: { Authorization: `Bearer ${savedToken}` },
          })
          if (response.status === 401) throw new Error('SESSION_EXPIRED')
          if (response.ok) parsedUser = await response.json()
        } catch (error) {
          if (error instanceof Error && error.message === 'SESSION_EXPIRED') throw error
          // 网络暂不可用时继续使用本地会话，待 API 返回 401 时统一退出。
        }
        localStorage.setItem('auth_user', JSON.stringify(parsedUser))
        await claimLegacyData(parsedUser.id, parsedUser.username)
        // 空间维护：每天最多执行一次，失败不影响登录流程。
        void pruneOldQAImages().catch(() => {})
        if (!active) return
        setToken(savedToken)
        setUser(parsedUser)
      } catch {
        localStorage.removeItem('auth_token')
        localStorage.removeItem('auth_user')
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void restoreSession()
    return () => { active = false }
  }, [])

  const login = async (newToken: string, newUser: UserInfo) => {
    localStorage.setItem('auth_token', newToken)
    localStorage.setItem('auth_user', JSON.stringify(newUser))
    await claimLegacyData(newUser.id, newUser.username)
    void pruneOldQAImages().catch(() => {})
    setToken(newToken)
    setUser(newUser)
  }

  const logout = () => {
    setToken(null)
    setUser(null)
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
