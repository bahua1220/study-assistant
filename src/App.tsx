import { BrowserRouter, HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { AppLayout } from './components/layout/AppLayout'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { AuthProvider, useAuth } from './context/AuthContext'
import { registerUnauthorizedHandler } from './lib/authRedirect'

// 按路由懒加载重页面（KaTeX、recharts 与大文件页），减小移动端首屏 bundle。
const HabitsPage = lazy(() => import('./pages/HabitsPage').then(m => ({ default: m.HabitsPage })))
const VocabPage = lazy(() => import('./pages/VocabPage').then(m => ({ default: m.VocabPage })))
const VocabAddPage = lazy(() => import('./pages/VocabAddPage').then(m => ({ default: m.VocabAddPage })))
const VocabPlanPage = lazy(() => import('./pages/VocabPlanPage').then(m => ({ default: m.VocabPlanPage })))
const VocabStudyPage = lazy(() => import('./pages/VocabStudyPage').then(m => ({ default: m.VocabStudyPage })))
const VocabNotebooksPage = lazy(() => import('./pages/VocabNotebooksPage').then(m => ({ default: m.VocabNotebooksPage })))
const VocabMistakesPage = lazy(() => import('./pages/VocabMistakesPage').then(m => ({ default: m.VocabMistakesPage })))
const SchedulePage = lazy(() => import('./pages/SchedulePage').then(m => ({ default: m.SchedulePage })))
const GradesPage = lazy(() => import('./pages/GradesPage').then(m => ({ default: m.GradesPage })))
const ShopPage = lazy(() => import('./pages/ShopPage').then(m => ({ default: m.ShopPage })))
const PomodoroPage = lazy(() => import('./pages/PomodoroPage').then(m => ({ default: m.PomodoroPage })))
const EssayPage = lazy(() => import('./pages/EssayPage').then(m => ({ default: m.EssayPage })))
const QAPage = lazy(() => import('./pages/QAPage').then(m => ({ default: m.QAPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })))
const ExamAnalysisPage = lazy(() => import('./pages/ExamAnalysisPage').then(m => ({ default: m.ExamAnalysisPage })))
const WrongBookPage = lazy(() => import('./pages/WrongBookPage').then(m => ({ default: m.WrongBookPage })))

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
    </div>
  )
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!token) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

// 让 api.ts 的 401 处理通过 Router 跳转登录页（兼容 HashRouter 的 Android 端）。
function UnauthorizedRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    registerUnauthorizedHandler(() => navigate('/login', { replace: true }))
    return () => registerUnauthorizedHandler(null)
  }, [navigate])
  return null
}

export default function App() {
  // Android WebView 进程被系统回收后可能恢复到非根路径；HashRouter 不依赖
  // WebView 的 history/path 状态，原生端启动和恢复都更稳定。
  const Router = Capacitor.isNativePlatform() ? HashRouter : BrowserRouter

  return (
    <AuthProvider>
      <Router>
        <UnauthorizedRedirect />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <AuthGuard>
                  <AppLayout />
                </AuthGuard>
              }
            >
              <Route path="/" element={<HomePage />} />
              <Route path="/habits" element={<HabitsPage />} />
              <Route path="/vocab" element={<VocabPage />} />
              <Route path="/vocab/add" element={<VocabAddPage />} />
              <Route path="/vocab/plan" element={<VocabPlanPage />} />
              <Route path="/vocab/notebooks" element={<VocabNotebooksPage />} />
              <Route path="/vocab/mistakes" element={<VocabMistakesPage />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="/grades" element={<GradesPage />} />
              <Route path="/shop" element={<ShopPage />} />
              <Route path="/pomodoro" element={<PomodoroPage />} />
              <Route path="/essay" element={<EssayPage />} />
              <Route path="/qa" element={<QAPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/exam-analysis" element={<ExamAnalysisPage />} />
              <Route path="/wrong-book" element={<WrongBookPage />} />
            </Route>
            <Route path="/vocab/study" element={<AuthGuard><VocabStudyPage /></AuthGuard>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
  )
}
