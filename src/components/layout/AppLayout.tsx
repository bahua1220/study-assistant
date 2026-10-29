import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'

export function AppLayout() {
  return (
    <div className="flex flex-col h-full max-w-lg mx-auto">
      {/* Main content area */}
      <main
        className="flex-1 overflow-y-auto safe-top"
        style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <Outlet />
      </main>
      {/* Bottom navigation */}
      <BottomNav />
    </div>
  )
}
