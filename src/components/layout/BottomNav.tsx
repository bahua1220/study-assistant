import { useLocation, useNavigate } from 'react-router-dom'
import { CheckCheck, Home, User } from 'lucide-react'
import clsx from 'clsx'

const tabs = [
  { path: '/', icon: Home, label: '首页' },
  { path: '/habits', icon: CheckCheck, label: '打卡' },
  { path: '/profile', icon: User, label: '我的' },
]

export function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg safe-bottom
      bg-white/80 dark:bg-zinc-950/80 backdrop-blur-lg
      border-t border-zinc-200 dark:border-zinc-800
      flex justify-around items-center px-6 py-1 z-40">
      {tabs.map(({ path, icon: Icon, label }) => {
        const active = path === '/'
          ? location.pathname === '/'
          : location.pathname.startsWith(path)
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            className={clsx(
              'flex flex-col items-center gap-0.5 py-1 px-3 rounded-xl transition-colors min-w-0',
              active
                ? 'text-brand-600 dark:text-brand-400'
                : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'
            )}
          >
            <Icon size={22} strokeWidth={active ? 2.5 : 2} />
            <span className={clsx(
              'text-[10px] font-medium',
              active && 'font-semibold'
            )}>
              {label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
