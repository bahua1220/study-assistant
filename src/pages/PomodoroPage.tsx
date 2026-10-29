import { useState, useRef, useEffect, useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getCurrentOwnerId } from '../db'
import { ArrowLeft, Play, Pause, RotateCcw, Clock, Flame, Coffee, Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getToday } from '../lib/date'

type Mode = 'focus' | 'break'

const COIN_PER_POMODORO = 5

interface SavedTimer {
  focusMin: number
  breakMin: number
  mode: Mode
  running: boolean
  remaining: number
  endTime: number
}

function loadTimer(ownerId: number): SavedTimer {
  const fallback: SavedTimer = { focusMin: 25, breakMin: 5, mode: 'focus', running: false, remaining: 25 * 60, endTime: 0 }
  try {
    const parsed = JSON.parse(localStorage.getItem(`pomodoro_timer_${ownerId}`) || '') as SavedTimer
    if (!parsed || !Number.isFinite(parsed.remaining)) return fallback
    if (parsed.running && parsed.endTime > 0) {
      parsed.remaining = Math.max(0, Math.round((parsed.endTime - Date.now()) / 1000))
    }
    return parsed
  } catch {
    return fallback
  }
}

export function PomodoroPage() {
  const navigate = useNavigate()
  const today = getToday()
  const ownerId = getCurrentOwnerId()
  const initialTimer = useRef<SavedTimer>(loadTimer(ownerId)).current

  // 设置
  const [focusMin, setFocusMin] = useState(initialTimer.focusMin)
  const [breakMin, setBreakMin] = useState(initialTimer.breakMin)

  // 计时状态
  const [mode, setMode] = useState<Mode>(initialTimer.mode)
  const [running, setRunning] = useState(initialTimer.running)
  const [remaining, setRemaining] = useState(initialTimer.remaining)
  const [sessionCount, setSessionCount] = useState(0) // 当前轮完成的番茄数

  const endTimeRef = useRef<number>(initialTimer.endTime)
  const completingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval>>()
  const audioRef = useRef<HTMLAudioElement>()

  // 今日统计
  const todaySessions = useLiveQuery(async () => {
    const startOfDay = new Date(today + 'T00:00:00')
    const endOfDay = new Date(today + 'T23:59:59')
    return db.studySessions
      .where('ownerId').equals(ownerId)
      .filter(s => s.kind === 'pomodoro' && s.startedAt >= startOfDay && s.startedAt <= endOfDay)
      .toArray()
  }, [ownerId, today])

  const todayCount = todaySessions?.length ?? 0
  const todayMinutes = todaySessions?.reduce((sum, s) => sum + s.durationMinutes, 0) ?? 0

  const totalDuration = mode === 'focus' ? focusMin * 60 : breakMin * 60
  const progress = totalDuration > 0 ? remaining / totalDuration : 0

  // 环形进度条参数
  const radius = 100
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - progress)

  // 格式化时间
  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  // 开始 / 继续
  const start = useCallback(() => {
    if (running) return
    endTimeRef.current = Date.now() + remaining * 1000
    setRunning(true)
  }, [running, remaining])

  // 暂停
  const pause = useCallback(() => {
    setRunning(false)
    setRemaining(Math.max(0, Math.round((endTimeRef.current - Date.now()) / 1000)))
    endTimeRef.current = 0
  }, [])

  // 切换模式
  const switchMode = useCallback((m: Mode) => {
    setRunning(false)
    endTimeRef.current = 0
    setMode(m)
    setRemaining(m === 'focus' ? focusMin * 60 : breakMin * 60)
  }, [focusMin, breakMin])

  // 完成一轮
  const handleComplete = useCallback(async () => {
    if (completingRef.current) return
    completingRef.current = true
    setRunning(false)
    endTimeRef.current = 0

    try {
      if (mode === 'focus') {
        await db.transaction('rw', db.studySessions, db.coinRecords, async () => {
          await db.studySessions.add({ ownerId, kind: 'pomodoro', durationMinutes: focusMin, startedAt: new Date() })
          await db.coinRecords.add({
            ownerId,
            amount: COIN_PER_POMODORO,
            source: 'pomodoro',
            date: today,
            description: `完成一个番茄钟（${focusMin} 分钟）`,
          })
        })
        setSessionCount(c => c + 1)

        try { audioRef.current?.play() } catch {}

        setMode('break')
        setRemaining(breakMin * 60)

        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('🍅 番茄钟完成！', {
            body: `专注 ${focusMin} 分钟，+${COIN_PER_POMODORO} 💰，休息一下吧`,
          })
        }
      } else {
        try { audioRef.current?.play() } catch {}
        setMode('focus')
        setRemaining(focusMin * 60)
      }
    } finally {
      completingRef.current = false
    }
  }, [mode, focusMin, breakMin, ownerId, today])

  // 核心 tick：基于绝对时间计算，避免浏览器降频造成漂移
  const tick = useCallback(() => {
    const left = Math.max(0, Math.round((endTimeRef.current - Date.now()) / 1000))
    setRemaining(left)
    if (left <= 0) void handleComplete()
  }, [handleComplete])

  // 重置
  const reset = useCallback(() => {
    setRunning(false)
    endTimeRef.current = 0
    setRemaining(mode === 'focus' ? focusMin * 60 : breakMin * 60)
  }, [mode, focusMin, breakMin])

  const enableNotifications = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
  }

  // 驱动 tick
  useEffect(() => {
    if (running) {
      timerRef.current = setInterval(tick, 200)
      return () => clearInterval(timerRef.current)
    }
  }, [running, tick])

  // 保存设置和运行状态，切页后可以继续恢复
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      localStorage.setItem(`pomodoro_timer_${ownerId}`, JSON.stringify({
        focusMin, breakMin, mode, running, remaining,
        endTime: running ? endTimeRef.current : 0,
      } satisfies SavedTimer))
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [ownerId, focusMin, breakMin, mode, running, remaining])

  return (
    <div className="p-5 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          🍅 番茄钟
        </h1>
      </div>

      {/* 模式切换 */}
      <div className="flex gap-2">
        <button
          onClick={() => switchMode('focus')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            mode === 'focus'
              ? 'bg-red-500 text-white'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
          }`}
        >
          <Flame size={16} />
          专注
        </button>
        <button
          onClick={() => switchMode('break')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            mode === 'break'
              ? 'bg-emerald-500 text-white'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
          }`}
        >
          <Coffee size={16} />
          休息
        </button>
      </div>

      {/* 圆形计时器 */}
      <div className="flex justify-center">
        <div className="relative w-64 h-64">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 240 240">
            {/* 背景圆环 */}
            <circle
              cx="120" cy="120" r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-zinc-100 dark:text-zinc-800"
            />
            {/* 进度圆环 */}
            <circle
              cx="120" cy="120" r={radius}
              fill="none"
              stroke={mode === 'focus' ? '#ef4444' : '#10b981'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-all duration-200"
              style={{ transition: 'stroke-dashoffset 0.2s linear' }}
            />
          </svg>
          {/* 中间时间 */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-5xl font-bold tabular-nums ${mode === 'focus' ? 'text-red-500' : 'text-emerald-500'}`}>
              {fmtTime(remaining)}
            </span>
            <span className="text-sm text-zinc-400 mt-1">
              {mode === 'focus' ? '专注中' : '休息中'}
            </span>
            {running && (
              <span className="text-xs text-zinc-400 mt-0.5">
                第 {sessionCount + 1} 轮
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 控制按钮 */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={reset}
          className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <RotateCcw size={20} className="text-zinc-500" />
        </button>
        <button
          onClick={running ? pause : start}
          className={`w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-95 ${
            mode === 'focus'
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-emerald-500 hover:bg-emerald-600 text-white'
          }`}
        >
          {running ? <Pause size={28} /> : <Play size={28} className="ml-0.5" />}
        </button>
        <div className="w-12" />{/* 占位保持居中 */}
      </div>

      {/* 时长设置 */}
      <div className="card space-y-3">
        <h3 className="text-xs font-medium text-zinc-500 flex items-center gap-1.5">
          <Clock size={14} />
          时长设置（仅在未运行时生效）
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-sm w-20 shrink-0">专注 {focusMin} 分钟</span>
          <input
            type="range"
            min={5}
            max={60}
            step={5}
            value={focusMin}
            onChange={e => {
              if (running) return
              const minutes = Number(e.target.value)
              setFocusMin(minutes)
              if (mode === 'focus') setRemaining(minutes * 60)
            }}
            className="flex-1 accent-red-500"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm w-20 shrink-0">休息 {breakMin} 分钟</span>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={breakMin}
            onChange={e => {
              if (running) return
              const minutes = Number(e.target.value)
              setBreakMin(minutes)
              if (mode === 'break') setRemaining(minutes * 60)
            }}
            className="flex-1 accent-emerald-500"
          />
        </div>
        {'Notification' in window && Notification.permission === 'default' && (
          <button
            onClick={enableNotifications}
            className="btn-ghost w-full text-xs flex items-center justify-center gap-1.5"
          >
            <Bell size={14} />
            开启完成提醒
          </button>
        )}
      </div>

      {/* 今日统计 */}
      <div className="card">
        <h3 className="text-xs font-medium text-zinc-500 mb-3">📊 今日统计</h3>
        <div className="flex items-center justify-around">
          <div className="text-center">
            <p className="text-2xl font-bold text-red-500">{todayCount}</p>
            <p className="text-xs text-zinc-400">完成番茄</p>
          </div>
          <div className="w-px h-10 bg-zinc-200 dark:bg-zinc-700" />
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-500">{todayMinutes}</p>
            <p className="text-xs text-zinc-400">专注分钟</p>
          </div>
          <div className="w-px h-10 bg-zinc-200 dark:bg-zinc-700" />
          <div className="text-center">
            <p className="text-2xl font-bold text-amber-500">+{todayCount * COIN_PER_POMODORO}</p>
            <p className="text-xs text-zinc-400">获得金币</p>
          </div>
        </div>
      </div>

      {/* 提示音（用 Web Audio API 生成一个简单提示音） */}
      <audio ref={audioRef as any} src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACAf39/f4B/f3+AgH9/f3+Af39/gIB/f39/gH9/f4CAf39/f4B/f3+AgH9/f3+Af39/gIB/f39/gH9/f4CAf39/f4B/f3+AgAAA" />
    </div>
  )
}
