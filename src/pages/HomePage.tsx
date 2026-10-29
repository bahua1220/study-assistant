import { useLiveQuery } from 'dexie-react-hooks'
import { db, getCurrentOwnerId, type Habit, type WeekDay } from '../db'
import { useNavigate } from 'react-router-dom'
import {
  Flame, Target, TrendingUp, ArrowRight,
  CheckCheck, BookOpen, Calendar, BarChart3,
} from 'lucide-react'
import { getToday, getWeekRange, formatDateCN, getStreak } from '../lib/date'
import { PetDisplay } from '../components/pet/PetDisplay'
import { COIN_PER_CHECKIN } from '../data/shopItems'
import { isTargetMet } from '../lib/habitEvaluation'
import { vocabDueQuery } from '../lib/vocabQueries'

export function HomePage() {
  const navigate = useNavigate()
  const today = getToday()
  const ownerId = getCurrentOwnerId()

  // 今日打卡完成率
  const todayStats = useLiveQuery(async () => {
    const weekday = new Date().getDay()
    const habits = (await db.habits.where('[ownerId+archived]').equals([ownerId, 0]).toArray()).filter(habit => habit.activeDays.includes(weekday as WeekDay))
    const checkIns = await db.checkIns.where('[ownerId+date]').equals([ownerId, today]).toArray()
    const total = habits.length
    const done = checkIns.filter(c => isTargetMet(c)).length

    return { total, done, habits, checkIns }
  })

  // 本周打卡统计
  const weekStats = useLiveQuery(async () => {
    const [start, end] = getWeekRange()
    const logs = await db.checkIns
      .where('ownerId').equals(ownerId)
      .filter(log => log.date >= start && log.date <= end)
      .toArray()
    const days = new Set(logs.filter(l => isTargetMet(l)).map(l => l.date)).size
    return { total: 7, done: days, logs }
  })

  // 金币 & 钻石总额
  const totalCoins = useLiveQuery(async () => {
    const recs = await db.coinRecords.where('ownerId').equals(ownerId).toArray()
    return recs.reduce((sum, r) => sum + r.amount, 0)
  })
  const totalDiamonds = useLiveQuery(async () => {
    const recs = await db.diamondRecords.where('ownerId').equals(ownerId).toArray()
    return recs.reduce((sum, r) => sum + r.amount, 0)
  })

  // 待复习单词数
  const dueCards = useLiveQuery(async () => {
    return vocabDueQuery(ownerId).count()
  })

  // 连续打卡天数
  const streakDays = useLiveQuery(async () => {
    return getStreak(await db.checkIns.where('ownerId').equals(ownerId).toArray())
  })

  // 快捷入口
  const quickActions = [
    { icon: CheckCheck, label: '今日打卡', path: '/habits', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950' },
    { icon: BookOpen, label: '背单词', path: '/vocab', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950' },
    { icon: Calendar, label: '课程表', path: '/schedule', color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-950' },
    { icon: BarChart3, label: '成绩分析', path: '/grades', color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950' },
    { icon: () => <span className="text-lg">🍅</span>, label: '番茄钟', path: '/pomodoro', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950' },
    { icon: () => <span className="text-lg">✍️</span>, label: '作文批改', path: '/essay', color: 'text-cyan-500', bg: 'bg-cyan-50 dark:bg-cyan-950' },
    { icon: () => <span className="text-lg">🤖</span>, label: '答疑助手', path: '/qa', color: 'text-indigo-500', bg: 'bg-indigo-50 dark:bg-indigo-950' },
    { icon: () => <span className="text-lg">📝</span>, label: '试卷分析', path: '/exam-analysis', color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-950' },
    { icon: () => <span className="text-lg">📕</span>, label: '错题本', path: '/wrong-book', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950' },
  ]

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm text-zinc-500 dark:text-zinc-400">
            {formatDateCN(new Date())}
          </h1>
          <p className="text-xl font-bold">学习助手 👋</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-2.5 py-1.5 rounded-full">
            💰 {totalCoins ?? 0}
          </span>
          <span className="text-xs font-semibold text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950 px-2.5 py-1.5 rounded-full">
            💎 {totalDiamonds ?? 0}
          </span>
        </div>
      </div>

      {/* 宠物卡片 */}
      <PetDisplay />

      {/* 连续打卡 */}
      {streakDays != null && streakDays > 0 && (
        <div className="card flex items-center gap-3 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/50 dark:to-orange-950/50 border-amber-200 dark:border-amber-900">
          <div className="bg-amber-100 dark:bg-amber-900 p-2.5 rounded-full">
            <Flame size={24} className="text-amber-500" />
          </div>
          <div>
            <p className="text-lg font-bold text-amber-700 dark:text-amber-300">
              连续 {streakDays} 天 🔥
            </p>
            <p className="text-xs text-amber-600/70 dark:text-amber-400/70">
              坚持就是胜利！
            </p>
          </div>
        </div>
      )}

      {/* 今日概览 */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          icon={<Target size={18} />}
          label="今日打卡"
          value={todayStats ? `${todayStats.done}/${todayStats.total}` : '-'}
          color="text-emerald-500"
        />
        <StatCard
          icon={<TrendingUp size={18} />}
          label="本周完成"
          value={weekStats ? `${weekStats.done}/7` : '-'}
          color="text-blue-500"
        />
        <StatCard
          icon={<BookOpen size={18} />}
          label="待复习"
          value={dueCards != null ? `${dueCards}` : '-'}
          color="text-purple-500"
        />
      </div>

      {/* 快捷入口 */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-3">
          快捷入口
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {quickActions.map(a => (
            <button
              key={a.path}
              onClick={() => navigate(a.path)}
              className="card flex items-center gap-3 hover:shadow-md transition-shadow text-left"
            >
              <div className={`${a.bg} p-2.5 rounded-xl`}>
                <a.icon size={22} className={a.color} />
              </div>
              <span className="font-medium text-sm">{a.label}</span>
              <ArrowRight size={14} className="ml-auto text-zinc-300 dark:text-zinc-600" />
            </button>
          ))}
        </div>
      </div>

      {/* 今日任务预览 */}
      {todayStats && todayStats.habits.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              今日任务
            </h2>
            <button
              onClick={() => navigate('/habits')}
              className="text-xs text-brand-500 font-medium"
            >
              查看全部 →
            </button>
          </div>
          <div className="space-y-2">
            {todayStats.habits.slice(0, 5).map((h: Habit) => {
              const checkIn = todayStats.checkIns.find(c => c.habitId === h.id)
              const done = isTargetMet(checkIn)
              return (
                <div
                  key={h.id}
                  className={done ? 'opacity-50' : ''}
                >
                  <div className="card flex items-center gap-3 !p-3">
                    <span className="text-lg">{h.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${done ? 'line-through' : ''}`}>{h.name}</p>
                      <p className="text-[10px] text-zinc-400">
                        {done ? `+${checkIn?.rewardCoins ?? COIN_PER_CHECKIN} 💰` : '按完成等级奖励'}
                      </p>
                    </div>
                    {done ? (
                      <span className="text-xs bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full font-medium">
                        已完成
                      </span>
                    ) : (
                      <span className="text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">
                        未完成
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode
  label: string
  value: string
  color: string
}) {
  return (
    <div className="card flex flex-col items-center gap-1 text-center !p-4">
      <div className={color}>{icon}</div>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[10px] text-zinc-400">{label}</p>
    </div>
  )
}
