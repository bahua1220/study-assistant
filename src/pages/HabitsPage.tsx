import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getCurrentOwnerId, type CheckInLevel, type Habit, type HabitCategory, type HabitLearningMode, type HabitMetricUnit, type HabitTaskType, type WeekDay } from '../db'
import { getToday, getPastDays, getWeekdayName } from '../lib/date'
import { CHECK_IN_LEVELS, evaluateCheckIn, isTargetMet, normalizedLevel } from '../lib/habitEvaluation'
import {
  Plus, Check, Trash2, Edit3, X, Archive, RotateCcw,
} from 'lucide-react'
import clsx from 'clsx'

const CATEGORY_CONFIG: Record<HabitCategory, { label: string; emoji: string }> = {
  study: { label: '学习', emoji: '📚' },
  exercise: { label: '运动', emoji: '💪' },
  reading: { label: '阅读', emoji: '📖' },
  life: { label: '生活', emoji: '🏠' },
  other: { label: '其他', emoji: '📌' },
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16']

const WEEKDAYS: WeekDay[] = [0, 1, 2, 3, 4, 5, 6]
const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '其他']
const UNITS: HabitMetricUnit[] = ['题', '页', '分钟', '单词', '次']
const FIXED_TEMPLATES = [
  { label: '英语完形', name: '英语完形填空', subject: '英语', total: 15, maxErrors: 4 },
  { label: '英语阅读', name: '英语阅读理解', subject: '英语', total: 5, maxErrors: 1 },
  { label: '数学练习', name: '数学每日练习', subject: '数学', total: 20, maxErrors: 4 },
]

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() + days)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function HabitsPage() {
  const ownerId = getCurrentOwnerId()
  const today = getToday()
  const [showForm, setShowForm] = useState(false)
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [selectedDate, setSelectedDate] = useState(today)
  const [streakDays, setStreakDays] = useState(7) // 热力图展示天数

  // 输入实际完成值弹窗
  const [valueModal, setValueModal] = useState<{ habit: Habit; date: string } | null>(null)
  const [inputActualValue, setInputActualValue] = useState(0)
  const [inputCompletionNote, setInputCompletionNote] = useState('')
  const [inputCorrectCount, setInputCorrectCount] = useState(0)

  const habits = useLiveQuery(
    () => db.habits.where('[ownerId+archived]').equals([ownerId, showArchived ? 1 : 0]).sortBy('createdAt'),
    [ownerId, showArchived]
  )

  const checkIns = useLiveQuery(
    () => db.checkIns.where('[ownerId+date]').equals([ownerId, selectedDate]).toArray(),
    [ownerId, selectedDate]
  )

  const yesterday = shiftDate(today, -1)
  const yesterdayCheckIns = useLiveQuery(
    () => db.checkIns.where('[ownerId+date]').equals([ownerId, yesterday]).toArray(),
    [ownerId, yesterday]
  )

  // 近 N 天打卡热力图数据
  const heatmapDays = getPastDays(streakDays)
  const heatmapData = useLiveQuery(async () => {
    const [records, activeHabits] = await Promise.all([
      db.checkIns.where('ownerId').equals(ownerId)
      .filter(record => record.date >= heatmapDays[0] && record.date <= heatmapDays[heatmapDays.length - 1])
      .toArray(),
      db.habits.where('[ownerId+archived]').equals([ownerId, 0]).toArray(),
    ])
    return heatmapDays.map(date => {
      const weekday = new Date(`${date}T12:00:00`).getDay() as WeekDay
      const expected = activeHabits.filter(habit => habit.activeDays.includes(weekday))
      const logMap = new Map(records.filter(record => record.date === date).map(record => [record.habitId, record]))
      const levels = expected.map(habit => normalizedLevel(logMap.get(habit.id!)))
      const excellent = levels.filter(level => level === 'excellent').length
      const standard = levels.filter(level => level === 'standard').length
      const partial = levels.filter(level => level === 'partial').length
      const none = levels.filter(level => level === 'none').length
      const dayLevel: CheckInLevel = levels.length > 0 && excellent === levels.length ? 'excellent'
        : levels.length > 0 && none === 0 && partial === 0 ? 'standard'
          : excellent + standard + partial > 0 ? 'partial' : 'none'
      return { date, level: dayLevel, excellent, standard, partial, none, total: levels.length }
    })
  }, [ownerId, streakDays])

  const checkInMap = new Map(checkIns?.map(c => [c.habitId, c]) ?? [])
  const yesterdayCheckInMap = new Map(yesterdayCheckIns?.map(c => [c.habitId, c]) ?? [])

  const openValueModal = (habit: Habit, date = selectedDate) => {
    const existing = date === yesterday ? yesterdayCheckInMap.get(habit.id!) : checkInMap.get(habit.id!)
    const actualValue = existing?.actualValue || habit.targetCount
    setInputActualValue(actualValue)
    setInputCorrectCount(existing?.correctCount ?? (habit.learningMode === 'fixed' ? actualValue : 0))
    setInputCompletionNote(existing?.note ?? '')
    setValueModal({ habit, date })
  }

  const handleToggle = async (habit: Habit) => {
    const existing = checkInMap.get(habit.id!)

    if (!existing?.completed) {
      // 勾选打卡 → 填写实际完成情况
      openValueModal(habit)
      return
    }

    await db.transaction('rw', db.checkIns, db.coinRecords, db.diamondRecords, async () => {
      await db.checkIns.put({
        id: existing.id,
        ownerId,
        habitId: habit.id!,
        date: selectedDate,
        completed: false,
        actualValue: 0,
        correctCount: undefined,
        accuracy: undefined,
        level: 'none',
        rewardCoins: 0,
        rewardDiamonds: 0,
        note: existing.note ?? '',
        createdAt: new Date().toISOString(),
      })
      await db.coinRecords.where('[habitId+date]').equals([habit.id!, selectedDate])
        .and(r => r.ownerId === ownerId && r.source === 'checkin').delete()
      await db.diamondRecords.where('[habitId+date]').equals([habit.id!, selectedDate])
        .and(r => r.ownerId === ownerId && r.source === 'target_met').delete()
    })
  }

  const handleConfirmValue = async () => {
    if (!valueModal) return
    const { habit, date: recordDate } = valueModal
    const existing = recordDate === yesterday ? yesterdayCheckInMap.get(habit.id!) : checkInMap.get(habit.id!)
    const actualValue = Math.max(0, inputActualValue)
    const correctCount = habit.trackAccuracy ? Math.min(actualValue, Math.max(0, inputCorrectCount)) : undefined
    const evaluation = evaluateCheckIn(habit, actualValue, correctCount)

    await db.transaction('rw', db.checkIns, db.coinRecords, db.diamondRecords, async () => {
      await db.checkIns.put({
        id: existing?.id,
        ownerId,
        habitId: habit.id!,
        date: recordDate,
        completed: evaluation.level !== 'none',
        actualValue,
        correctCount,
        accuracy: evaluation.accuracy,
        level: evaluation.level,
        rewardCoins: evaluation.rewardCoins,
        rewardDiamonds: evaluation.rewardDiamonds,
        carryOverDismissed: false,
        note: inputCompletionNote.trim(),
        createdAt: new Date().toISOString(),
      })
      await db.coinRecords.where('[habitId+date]').equals([habit.id!, recordDate])
        .and(r => r.ownerId === ownerId && r.source === 'checkin').delete()
      await db.diamondRecords.where('[habitId+date]').equals([habit.id!, recordDate])
        .and(r => r.ownerId === ownerId && r.source === 'target_met').delete()
      if (evaluation.rewardCoins > 0) await db.coinRecords.add({
          ownerId,
          amount: evaluation.rewardCoins,
          source: 'checkin',
          habitId: habit.id!,
          date: recordDate,
          description: `${CHECK_IN_LEVELS[evaluation.level].label}：${habit.name}`,
        })
      if (evaluation.rewardDiamonds > 0) {
        await db.diamondRecords.add({
          ownerId,
          amount: evaluation.rewardDiamonds,
          source: 'target_met',
          habitId: habit.id!,
          date: recordDate,
          description: `${CHECK_IN_LEVELS[evaluation.level].label}：${habit.name}（${actualValue}/${habit.targetCount}）`,
        })
      }
    })

    setValueModal(null)
    setInputCompletionNote('')
    setInputCorrectCount(0)
  }

  const handleDelete = async (habit: Habit) => {
    await db.transaction('rw', db.habits, db.checkIns, db.coinRecords, db.diamondRecords, async () => {
      await db.checkIns.where('habitId').equals(habit.id!).and(r => r.ownerId === ownerId).delete()
      await db.coinRecords.where('habitId').equals(habit.id!).and(r => r.ownerId === ownerId).delete()
      await db.diamondRecords.where('habitId').equals(habit.id!).and(r => r.ownerId === ownerId).delete()
      await db.habits.delete(habit.id!)
    })
  }

  const handleArchive = async (habit: Habit) => {
    await db.habits.update(habit.id!, { archived: habit.archived ? 0 : 1 })
  }

  const dismissCarryOver = async (habit: Habit) => {
    const existing = yesterdayCheckInMap.get(habit.id!)
    await db.checkIns.put({
      id: existing?.id,
      ownerId,
      habitId: habit.id!,
      date: yesterday,
      completed: existing?.completed ?? false,
      actualValue: existing?.actualValue ?? 0,
      correctCount: existing?.correctCount,
      accuracy: existing?.accuracy,
      level: existing?.level ?? 'none',
      rewardCoins: existing?.rewardCoins ?? 0,
      rewardDiamonds: existing?.rewardDiamonds ?? 0,
      carryOverDismissed: true,
      note: existing?.note ?? '',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    })
  }

  if (showForm || editingHabit) {
    return (
      <HabitForm
        habit={editingHabit}
        onClose={() => { setShowForm(false); setEditingHabit(null) }}
      />
    )
  }

  const selectedWeekday = new Date(`${selectedDate}T12:00:00`).getDay() as WeekDay
  const selectedHabits = (habits ?? []).filter(habit => showArchived || habit.activeDays.includes(selectedWeekday))
  const yesterdayWeekday = new Date(`${yesterday}T12:00:00`).getDay() as WeekDay
  const carryOverHabits = selectedDate === today && !showArchived
    ? (habits ?? []).filter(habit => {
      if (!habit.carryOver || !habit.activeDays.includes(yesterdayWeekday)) return false
      // 今天刚创建的任务在昨天并不存在，不能被误判为昨日未完成。
      if (new Date(habit.createdAt).getTime() >= new Date(`${today}T00:00:00`).getTime()) return false
      const checkIn = yesterdayCheckInMap.get(habit.id!)
      return !checkIn?.carryOverDismissed && (checkIn?.actualValue ?? 0) < habit.targetCount
    })
    : []
  const selectedLevels = selectedHabits.map(habit => normalizedLevel(checkInMap.get(habit.id!)))
  const selectedSummary = {
    excellent: selectedLevels.filter(level => level === 'excellent').length,
    standard: selectedLevels.filter(level => level === 'standard').length,
    partial: selectedLevels.filter(level => level === 'partial').length,
    none: selectedLevels.filter(level => level === 'none').length,
  }

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">打卡</h1>
          <p className="text-xs text-zinc-400">
            {selectedHabits.filter(h => {
              const ci = checkInMap.get(h.id!)
              return isTargetMet(ci)
            }).length} / {selectedHabits.length} 已达标
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={clsx(
              'btn-ghost text-sm !px-3 !py-2',
              showArchived && 'bg-zinc-100 dark:bg-zinc-800'
            )}
          >
            <Archive size={16} />
          </button>
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm flex items-center gap-1 !px-4 !py-2">
            <Plus size={16} />
            新建
          </button>
        </div>
      </div>

      {/* 日期选择器 */}
      <DateSelector selected={selectedDate} onChange={setSelectedDate} />

      {!showArchived && selectedHabits.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {(['excellent', 'standard', 'partial', 'none'] as const).map(level => (
            <div key={level} className="card !p-2 text-center">
              <div className={clsx('w-2.5 h-2.5 rounded-full mx-auto mb-1', CHECK_IN_LEVELS[level].bg)} />
              <p className="text-base font-bold">{selectedSummary[level]}</p>
              <p className="text-[9px] text-zinc-400">{CHECK_IN_LEVELS[level].label}</p>
            </div>
          ))}
        </div>
      )}

      {/* 打卡热力图 */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-zinc-500">打卡热力图</span>
          <select
            value={streakDays}
            onChange={e => setStreakDays(Number(e.target.value))}
            className="text-xs bg-transparent text-zinc-400"
          >
            <option value={7}>近 7 天</option>
            <option value={14}>近 14 天</option>
            <option value={30}>近 30 天</option>
          </select>
        </div>
        <div className="flex gap-1">
          {heatmapData?.map(d => {
            const dateObj = new Date(d.date)
            const isToday = d.date === today
            return (
              <div
                key={d.date}
                className="flex-1 flex flex-col items-center gap-1"
                title={`${d.date}: 高标准 ${d.excellent}，达标 ${d.standard}，部分 ${d.partial}，未完成 ${d.none}`}
              >
                <div
                  className={clsx(
                    'w-full aspect-square rounded-md transition-colors',
                    isToday && 'ring-2 ring-brand-400 ring-offset-1',
                    CHECK_IN_LEVELS[d.level].bg,
                  )}
                />
                <span className="text-[9px] text-zinc-400">
                  {getWeekdayName(dateObj.getDay()).charAt(1)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 任务列表 */}
      <div className="space-y-2">
        {/* 实际完成值输入弹窗 */}
      {valueModal && (
        <ValueInputModal
          habit={valueModal.habit}
          value={inputActualValue}
          onChange={setInputActualValue}
          note={inputCompletionNote}
          onNoteChange={setInputCompletionNote}
          correctCount={inputCorrectCount}
          onCorrectCountChange={setInputCorrectCount}
          onConfirm={handleConfirmValue}
          onClose={() => setValueModal(null)}
        />
      )}

      {carryOverHabits.length > 0 && (
        <div className="space-y-2 mb-4">
          <div className="flex items-end justify-between px-1">
            <div><h2 className="text-sm font-bold text-amber-600 dark:text-amber-400">待补任务</h2><p className="text-[10px] text-zinc-400">昨天未完成，仅保留到今天</p></div>
          </div>
          {carryOverHabits.map(habit => {
            const record = yesterdayCheckInMap.get(habit.id!)
            const remaining = Math.max(0, habit.targetCount - (record?.actualValue ?? 0))
            return <div key={`carry-${habit.id}`} className="card !p-4 flex items-center gap-3 border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20">
              <span className="text-2xl">{habit.emoji}</span>
              <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{habit.name}</p><p className="text-[10px] text-zinc-500">昨日剩余 {remaining}{habit.unit || '次'}，补做记录仍计入昨日</p></div>
              <button onClick={() => dismissCarryOver(habit)} className="px-2 py-1.5 text-xs text-zinc-400">放弃</button>
              <button onClick={() => openValueModal(habit, yesterday)} className="px-3 py-2 rounded-lg bg-amber-500 text-white text-xs font-medium">补做</button>
            </div>
          })}
        </div>
      )}

      {selectedHabits.length === 0 && carryOverHabits.length === 0 && (
          <div className="card text-center py-10">
            <p className="text-zinc-400 text-sm">
              {showArchived ? '没有已归档的任务' : '还没有任务，点击右上角新建一个吧 🎯'}
            </p>
          </div>
        )}

        {selectedHabits.map(habit => {
          const ci = checkInMap.get(habit.id!)
          const done = ci?.completed ?? false
          const level = normalizedLevel(ci)
          const levelStyle = CHECK_IN_LEVELS[level]

          return (
            <div
              key={habit.id}
              className={clsx(
                'card flex items-center gap-3 transition-all',
                level === 'excellent' && 'border-emerald-400 dark:border-emerald-700',
                level === 'standard' && 'border-green-300 dark:border-green-800',
                level === 'partial' && 'border-amber-300 dark:border-amber-800',
              )}
            >
              {/* 完成按钮 */}
              <button
                onClick={() => handleToggle(habit)}
                className={clsx(
                  'w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all active:scale-90',
                  done
                    ? `${levelStyle.bg} border-transparent text-white`
                    : 'border-zinc-300 dark:border-zinc-600 hover:border-emerald-400'
                )}
              >
                {done && <Check size={14} strokeWidth={3} />}
              </button>

              {/* 内容 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{habit.emoji}</span>
                  <p className="text-sm font-medium truncate">
                    {habit.name}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 ml-8">
                  <span className="text-[10px] text-zinc-400">
                    {habit.taskType === 'learning' ? `${habit.subject || '学习'} · ${habit.unit || '次'}` : CATEGORY_CONFIG[habit.category].label}
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    {habit.learningMode === 'fixed'
                      ? `${habit.targetCount}题 · 达标最多错${habit.standardMaxErrors ?? 0}题 · 高标准最多错${habit.highMaxErrors ?? 0}题`
                      : `标准 ${habit.targetCount}${habit.unit || '次'}${habit.taskType === 'learning' ? ` · 高标准 ${habit.highTargetCount ?? habit.targetCount}` : ''}`}
                  </span>
                  {done && (
                    <button onClick={() => openValueModal(habit)} className={clsx('text-[10px] font-medium hover:underline', levelStyle.color)}>
                      {levelStyle.label} · 实际 {ci?.actualValue ?? 0}{habit.unit || '次'}{habit.learningMode === 'fixed' && ci?.correctCount != null ? ` · 正确${ci.correctCount} · 错${Math.max(0, ci.actualValue - ci.correctCount)}` : ''}{ci?.accuracy != null && ` · 正确率 ${ci.accuracy}%`} · 修改记录
                    </button>
                  )}
                  {ci?.note && (
                    <span className="basis-full text-[10px] text-zinc-500 truncate" title={ci.note}>
                      实际情况：{ci.note}
                    </span>
                  )}
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-0.5">
                <button
                  onClick={() => setEditingHabit(habit)}
                  className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-400"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  onClick={() => handleArchive(habit)}
                  className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-400"
                >
                  {habit.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                </button>
                <button
                  onClick={() => handleDelete(habit)}
                  className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg text-zinc-400 hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 日期选择器 ─────────────────────────────────────────
function DateSelector({ selected, onChange }: { selected: string; onChange: (d: string) => void }) {
  const today = getToday()
  const days: { date: string; label: string; isToday: boolean }[] = []
  for (let offset = -3; offset <= 3; offset++) {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({
      date: dateStr,
      label: offset === 0 ? '今天' : getWeekdayName(d.getDay()),
      isToday: dateStr === today,
    })
  }
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {days.map(d => (
        <button
          key={d.date}
          onClick={() => onChange(d.date)}
          className={clsx(
            'flex flex-col items-center px-3 py-2 rounded-xl text-xs font-medium transition-colors whitespace-nowrap',
            selected === d.date
              ? 'bg-brand-500 text-white'
              : d.isToday
                ? 'bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
          )}
        >
          <span>{d.label}</span>
          <span className="text-[10px] opacity-70">{d.date.slice(5)}</span>
        </button>
      ))}
    </div>
  )
}

// ─── 新建/编辑表单 ──────────────────────────────────────
function HabitForm({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  const ownerId = getCurrentOwnerId()
  const isEdit = habit !== null

  const [name, setName] = useState(habit?.name ?? '')
  const [emoji, setEmoji] = useState(habit?.emoji ?? '📚')
  const [category, setCategory] = useState<HabitCategory>(habit?.category ?? 'study')
  const [activeDays, setActiveDays] = useState<WeekDay[]>(habit?.activeDays ?? [0, 1, 2, 3, 4, 5, 6])
  const [targetCount, setTargetCount] = useState(habit?.targetCount ?? 10)
  const [targetCountInput, setTargetCountInput] = useState(String(habit?.targetCount ?? 10))
  const [taskType, setTaskType] = useState<HabitTaskType>(habit?.taskType ?? (habit ? 'general' : 'learning'))
  const [learningMode, setLearningMode] = useState<HabitLearningMode>(habit?.learningMode ?? (habit ? (habit.trackAccuracy ? 'free' : 'quantity') : 'fixed'))
  const [subject, setSubject] = useState(habit?.subject ?? '数学')
  const [unit, setUnit] = useState<HabitMetricUnit>(habit?.unit ?? '题')
  const [highTargetCount, setHighTargetCount] = useState(habit?.highTargetCount ?? Math.max((habit?.targetCount ?? 10) + 1, Math.ceil((habit?.targetCount ?? 10) * 1.5)))
  const [trackAccuracy, setTrackAccuracy] = useState(habit?.trackAccuracy ?? true)
  const [targetAccuracy, setTargetAccuracy] = useState(habit?.targetAccuracy ?? 80)
  const [highAccuracy, setHighAccuracy] = useState(habit?.highAccuracy ?? 90)
  const [standardMaxErrors, setStandardMaxErrors] = useState(habit?.standardMaxErrors ?? 4)
  const [highMaxErrors, setHighMaxErrors] = useState(habit?.highMaxErrors ?? 0)
  const [color, setColor] = useState(habit?.color ?? '#6366f1')
  const [carryOver, setCarryOver] = useState(habit?.carryOver ?? false)

  const handleSave = async () => {
    if (!name.trim()) return
    if (targetCount <= 0) return
    if (taskType === 'learning' && highTargetCount < targetCount) return
    if (taskType === 'learning' && trackAccuracy && (targetAccuracy < 0 || highAccuracy < targetAccuracy || highAccuracy > 100)) return
    if (taskType === 'learning' && learningMode === 'fixed' && (standardMaxErrors < 0 || standardMaxErrors > targetCount || highMaxErrors < 0 || highMaxErrors > standardMaxErrors)) return

    const data = {
      name: name.trim(),
      emoji,
      category,
      frequency: 'daily' as const,
      activeDays,
      targetCount,
      taskType,
      subject: taskType === 'learning' ? subject : undefined,
      learningMode: taskType === 'learning' ? learningMode : undefined,
      unit: taskType === 'learning' ? (learningMode === 'fixed' ? '题' : unit) : '次',
      highTargetCount: taskType === 'learning' ? (learningMode === 'fixed' ? targetCount : highTargetCount) : targetCount,
      trackAccuracy: taskType === 'learning' ? learningMode !== 'quantity' && (learningMode === 'fixed' || trackAccuracy) : false,
      targetAccuracy: taskType === 'learning' && learningMode === 'free' && trackAccuracy ? targetAccuracy : undefined,
      highAccuracy: taskType === 'learning' && learningMode === 'free' && trackAccuracy ? highAccuracy : undefined,
      standardMaxErrors: taskType === 'learning' && learningMode === 'fixed' ? standardMaxErrors : undefined,
      highMaxErrors: taskType === 'learning' && learningMode === 'fixed' ? highMaxErrors : undefined,
      carryOver,
      color,
      archived: 0,
      createdAt: habit?.createdAt ?? new Date().toISOString(),
    }

    if (isEdit && habit?.id) {
      await db.habits.update(habit.id, data)
    } else {
      await db.habits.add({ ...data, ownerId })
    }
    onClose()
  }

  const toggleDay = (day: WeekDay) => {
    setActiveDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  const commitFixedTargetCount = () => {
    const next = Math.max(1, Number(targetCountInput) || 1)
    setTargetCount(next)
    setTargetCountInput(String(next))
    setHighTargetCount(next)
    setStandardMaxErrors(value => Math.min(value, next))
    setHighMaxErrors(value => Math.min(value, next))
  }

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg">
          <X size={20} />
        </button>
        <h1 className="text-lg font-bold">{isEdit ? '编辑任务' : '新建任务'}</h1>
      </div>

      <label className="card !p-4 flex items-center justify-between gap-3">
        <span><span className="text-sm font-medium">未完成时顺延到第二天</span><span className="block text-[10px] text-zinc-400 mt-0.5">只顺延一天，并作为单独的待补任务显示</span></span>
        <input type="checkbox" checked={carryOver} onChange={event => setCarryOver(event.target.checked)} className="w-5 h-5 accent-brand-500" />
      </label>

      {/* 名称 */}
      <div>
        <label className="text-xs font-medium text-zinc-500 block mb-1.5">任务名称</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="input"
          placeholder="例如：背 50 个单词"
          autoFocus
        />
      </div>

      {/* 图标选择 */}
      <div>
        <label className="text-xs font-medium text-zinc-500 block mb-1.5">图标</label>
        <div className="flex flex-wrap gap-2">
          {['📚', '💪', '📖', '🏃', '🧘', '🎯', '💻', '✍️', '🎨', '🎵', '🌱', '🧠', '📝', '🔬', '💤', '🍎'].map(e => (
            <button
              key={e}
              onClick={() => setEmoji(e)}
              className={clsx(
                'text-xl p-2 rounded-xl transition-colors',
                emoji === e ? 'bg-brand-100 dark:bg-brand-900 ring-2 ring-brand-400' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* 分类 */}
      <div>
        <label className="text-xs font-medium text-zinc-500 block mb-1.5">分类</label>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(CATEGORY_CONFIG) as [HabitCategory, { label: string; emoji: string }][]).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setCategory(key)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                category === key
                  ? 'bg-brand-100 dark:bg-brand-900 text-brand-600 dark:text-brand-400'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              )}
            >
              {cfg.emoji} {cfg.label}
            </button>
          ))}
        </div>
      </div>

      {/* 任务类型 */}
      <div>
        <label className="text-xs font-medium text-zinc-500 block mb-1.5">记录方式</label>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setTaskType('general')} className={clsx('py-2.5 rounded-xl text-sm font-medium', taskType === 'general' ? 'bg-brand-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500')}>普通习惯</button>
          <button onClick={() => setTaskType('learning')} className={clsx('py-2.5 rounded-xl text-sm font-medium', taskType === 'learning' ? 'bg-brand-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500')}>学习任务</button>
        </div>
        <p className="text-[10px] text-zinc-400 mt-1.5">学习任务可设置高标准并统计正确率。</p>
      </div>

      {taskType === 'learning' && (
        <div className="card !p-4 space-y-4 bg-brand-50/40 dark:bg-brand-950/20 border-brand-100 dark:border-brand-900">
          <div>
            <label className="text-xs font-medium text-zinc-500 block mb-1.5">学习任务类型</label>
            <div className="grid grid-cols-3 gap-1.5">
              {([['fixed', '固定题量'], ['free', '自由刷题'], ['quantity', '数量/时长']] as [HabitLearningMode, string][]).map(([key, label]) => <button key={key} onClick={() => setLearningMode(key)} className={clsx('py-2 rounded-lg text-xs font-medium', learningMode === key ? 'bg-brand-500 text-white' : 'bg-white dark:bg-zinc-800 text-zinc-500')}>{label}</button>)}
            </div>
          </div>
          {learningMode === 'fixed' && <div>
            <label className="text-xs font-medium text-zinc-500 block mb-1.5">快捷模板</label>
            <div className="flex flex-wrap gap-2">{FIXED_TEMPLATES.map(template => <button key={template.label} onClick={() => { setName(template.name); setSubject(template.subject); setTargetCount(template.total); setTargetCountInput(String(template.total)); setHighTargetCount(template.total); setStandardMaxErrors(template.maxErrors); setHighMaxErrors(0); setEmoji('📝') }} className="px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-800 text-xs text-zinc-600 dark:text-zinc-300 hover:ring-1 hover:ring-brand-400">{template.label}</button>)}</div>
          </div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-zinc-500 block mb-1.5">科目</label><select value={subject} onChange={e => setSubject(e.target.value)} className="input">{SUBJECTS.map(item => <option key={item}>{item}</option>)}</select></div>
            {learningMode !== 'fixed' && <div><label className="text-xs font-medium text-zinc-500 block mb-1.5">完成量单位</label><select value={unit} onChange={e => setUnit(e.target.value as HabitMetricUnit)} className="input">{UNITS.map(item => <option key={item}>{item}</option>)}</select></div>}
            {learningMode === 'fixed' && <div><label className="text-xs font-medium text-zinc-500 block mb-1.5">每次总题数</label><input type="number" min={1} value={targetCountInput} onChange={e => { const raw = e.target.value; setTargetCountInput(raw); if (raw !== '') { const next = Math.max(1, Number(raw) || 1); setTargetCount(next); setHighTargetCount(next); setStandardMaxErrors(value => Math.min(value, next)); setHighMaxErrors(value => Math.min(value, next)) } }} onBlur={commitFixedTargetCount} className="input" /></div>}
          </div>
          {learningMode === 'fixed' && <>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-zinc-500 block mb-1.5">达标最多错</label><div className="relative"><input type="number" min={0} max={targetCount} value={standardMaxErrors} onChange={e => setStandardMaxErrors(Math.min(targetCount, Math.max(0, Number(e.target.value))))} className="input pr-8" /><span className="absolute right-3 top-2.5 text-xs text-zinc-400">题</span></div></div>
              <div><label className="text-xs font-medium text-zinc-500 block mb-1.5">高标准最多错</label><div className="relative"><input type="number" min={0} max={standardMaxErrors} value={highMaxErrors} onChange={e => setHighMaxErrors(Math.min(standardMaxErrors, Math.max(0, Number(e.target.value))))} className="input pr-8" /><span className="absolute right-3 top-2.5 text-xs text-zinc-400">题</span></div></div>
            </div>
            <p className="text-xs text-zinc-500 bg-white/70 dark:bg-zinc-800/60 rounded-lg p-3">完成 {targetCount} 题，错 ≤{standardMaxErrors} 题算达标；错 ≤{highMaxErrors} 题算高标准。</p>
          </>}
          {learningMode !== 'fixed' && <>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-zinc-500 block mb-1.5">标准完成量</label><input type="number" min={1} value={targetCount} onChange={e => { const next = Math.max(1, Number(e.target.value)); setTargetCount(next); if (highTargetCount < next) setHighTargetCount(Math.ceil(next * 1.5)) }} className="input" /></div>
              <div><label className="text-xs font-medium text-zinc-500 block mb-1.5">高标准完成量</label><input type="number" min={targetCount} value={highTargetCount} onChange={e => setHighTargetCount(Math.max(targetCount, Number(e.target.value)))} className="input" /></div>
            </div>
            {learningMode === 'free' && <><label className="flex items-center justify-between gap-3 text-sm"><span><span className="font-medium">统计正确率</span><span className="block text-[10px] text-zinc-400">填写正确题数并自动计算</span></span><input type="checkbox" checked={trackAccuracy} onChange={e => setTrackAccuracy(e.target.checked)} className="w-5 h-5 accent-brand-500" /></label>
            {trackAccuracy && <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-zinc-500 block mb-1.5">标准正确率</label><div className="relative"><input type="number" min={0} max={100} value={targetAccuracy} onChange={e => { const next = Math.min(100, Math.max(0, Number(e.target.value))); setTargetAccuracy(next); if (highAccuracy < next) setHighAccuracy(next) }} className="input pr-8" /><span className="absolute right-3 top-2.5 text-xs text-zinc-400">%</span></div></div>
              <div><label className="text-xs font-medium text-zinc-500 block mb-1.5">高标准正确率</label><div className="relative"><input type="number" min={targetAccuracy} max={100} value={highAccuracy} onChange={e => setHighAccuracy(Math.min(100, Math.max(targetAccuracy, Number(e.target.value))))} className="input pr-8" /><span className="absolute right-3 top-2.5 text-xs text-zinc-400">%</span></div></div>
            </div>}</>}
          </>}
        </div>
      )}

      {/* 生效日 */}
      <div>
        <label className="text-xs font-medium text-zinc-500 block mb-1.5">打卡日</label>
        <div className="flex gap-1.5">
          {WEEKDAYS.map(d => (
            <button
              key={d}
              onClick={() => toggleDay(d)}
              className={clsx(
                'w-9 h-9 rounded-full text-xs font-medium transition-colors',
                activeDays.includes(d)
                  ? 'bg-brand-500 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              )}
            >
              {getWeekdayName(d).charAt(1)}
            </button>
          ))}
        </div>
      </div>

      {/* 普通习惯目标 */}
      {taskType === 'general' && <div>
        <label className="text-xs font-medium text-zinc-500 block mb-1.5">
          每日目标值
          <span className="text-zinc-400 font-normal ml-1">
            （打卡时输入实际值，≥目标获得 💎）
          </span>
        </label>
        <input
          type="number"
          value={targetCount}
          onChange={e => setTargetCount(Number(e.target.value))}
          className="input"
          min={1}
        />
      </div>}

      {/* 颜色 */}
      <div>
        <label className="text-xs font-medium text-zinc-500 block mb-1.5">标记颜色</label>
        <div className="flex gap-2">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={clsx(
                'w-8 h-8 rounded-full transition-all',
                color === c ? 'ring-2 ring-offset-2 ring-zinc-400 scale-110' : 'hover:scale-105'
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* 保存 */}
      <button onClick={handleSave} className="btn-primary w-full text-sm">
        {isEdit ? '保存修改' : '创建任务'}
      </button>
    </div>
  )
}

// ─── 实际完成值输入弹窗 ─────────────────────────────────
function ValueInputModal({
  habit,
  value,
  onChange,
  note,
  onNoteChange,
  correctCount,
  onCorrectCountChange,
  onConfirm,
  onClose,
}: {
  habit: Habit
  value: number
  onChange: (v: number) => void
  note: string
  onNoteChange: (v: string) => void
  correctCount: number
  onCorrectCountChange: (v: number) => void
  onConfirm: () => void
  onClose: () => void
}) {
  const safeCorrectCount = Math.min(value, Math.max(0, correctCount))
  const isFixed = habit.taskType === 'learning' && habit.learningMode === 'fixed'
  const wrongCount = Math.max(0, value - safeCorrectCount)
  const setWrongCount = (wrong: number) => {
    const safeWrong = Math.min(value, Math.max(0, wrong))
    onCorrectCountChange(value - safeWrong)
  }
  const evaluation = evaluateCheckIn(habit, value, safeCorrectCount)
  const levelStyle = CHECK_IN_LEVELS[evaluation.level]
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-lg mx-auto space-y-4"
        onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold flex items-center gap-2">
          {habit.emoji} {habit.name}
        </h3>

        {isFixed ? <div className="space-y-4">
          <button
            onClick={() => {
              const nextCompleted = value < habit.targetCount
              const nextValue = nextCompleted ? habit.targetCount : Math.max(0, habit.targetCount - 1)
              const keptWrong = Math.min(wrongCount, nextValue)
              onChange(nextValue)
              onCorrectCountChange(nextValue - keptWrong)
            }}
            className={clsx('w-full flex items-center justify-between rounded-xl border px-4 py-3 text-sm', value >= habit.targetCount ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300' : 'border-zinc-200 dark:border-zinc-700')}
          >
            <span>已完成全部 {habit.targetCount} 题</span><span className={clsx('w-5 h-5 rounded-md border flex items-center justify-center', value >= habit.targetCount && 'bg-emerald-500 border-emerald-500 text-white')}>{value >= habit.targetCount && <Check size={14} />}</span>
          </button>

          {value < habit.targetCount && <div>
            <label className="text-xs font-medium text-zinc-500 block mb-1.5">实际完成题数</label>
            <input type="number" min={0} max={habit.targetCount} value={value} onChange={e => { const next = Math.min(habit.targetCount, Math.max(0, Number(e.target.value))); onChange(next); if (correctCount > next) onCorrectCountChange(next) }} className="input text-center text-lg font-bold" />
          </div>}

          <div>
            <label className="text-sm font-semibold block text-center mb-2">今天错了几题？</label>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setWrongCount(wrongCount - 1)} className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-2xl font-bold">−</button>
              <input type="number" min={0} max={value} value={wrongCount} onChange={e => setWrongCount(Number(e.target.value))} className="input !w-24 text-center text-2xl font-bold" autoFocus />
              <button onClick={() => setWrongCount(wrongCount + 1)} className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-2xl font-bold">+</button>
            </div>
            <div className="grid grid-cols-6 gap-1.5 mt-3">{[0, 1, 2, 3, 4, 5].map(number => <button key={number} onClick={() => setWrongCount(number)} disabled={number > value} className={clsx('py-1.5 rounded-lg text-xs font-medium disabled:opacity-30', wrongCount === number ? 'bg-brand-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500')}>{number === 5 ? '5+' : number}</button>)}</div>
            <p className="text-xs text-zinc-400 text-center mt-3">正确 {safeCorrectCount}/{value || 0} 题 · 正确率 {evaluation.accuracy ?? 0}%</p>
          </div>
        </div> : <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">
            实际完成量（标准 {habit.targetCount}{habit.unit || '次'}{habit.taskType === 'learning' ? `，高标准 ${habit.highTargetCount ?? habit.targetCount}${habit.unit || '次'}` : ''}）
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => onChange(Math.max(0, value - 1))}
              className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-lg font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >−</button>
            <input
              type="number"
              value={value}
              onChange={e => {
                const next = Math.max(0, Number(e.target.value))
                onChange(next)
                if (correctCount > next) onCorrectCountChange(next)
              }}
              className="input text-center text-lg font-bold"
              min={0}
              autoFocus
            />
            <button
              onClick={() => onChange(value + 1)}
              className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-lg font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >+</button>
          </div>
        </div>}

        {!isFixed && habit.taskType === 'learning' && habit.trackAccuracy && (
          <div>
            <label className="text-xs font-medium text-zinc-500 block mb-1.5">
              正确数量（标准 ≥{habit.targetAccuracy ?? 80}%，高标准 ≥{habit.highAccuracy ?? 90}%）
            </label>
            <input type="number" min={0} max={value} value={safeCorrectCount} onChange={e => onCorrectCountChange(Math.min(value, Math.max(0, Number(e.target.value))))} className="input" />
            <p className="text-xs text-zinc-400 mt-1">正确率：{evaluation.accuracy ?? 0}%（{safeCorrectCount}/{value || 0}）</p>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">
            实际完成情况 <span className="font-normal text-zinc-400">（选填）</span>
          </label>
          <textarea
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            className="input min-h-[88px] resize-y text-sm"
            maxLength={300}
            placeholder="例如：完成数学练习第 1～3 页，错了 2 题；跑步 25 分钟，约 3 公里"
          />
          <p className="text-[10px] text-zinc-400 text-right mt-1">{note.length}/300</p>
        </div>

        {/* 等级与奖励预览 */}
        <div className="card !p-3 flex items-center gap-3">
          <div className={clsx('w-3 h-3 rounded-full', levelStyle.bg)} />
          <div className="flex-1"><p className={clsx('text-sm font-bold', levelStyle.color)}>{levelStyle.label}</p><p className="text-[10px] text-zinc-400">修改完成数据后，奖励会自动重新计算</p></div>
          <div className="text-right text-xs"><p>+{evaluation.rewardCoins} 💰</p><p>+{evaluation.rewardDiamonds} 💎</p></div>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="btn-ghost flex-1 text-sm">取消</button>
          <button onClick={onConfirm} className="btn-primary flex-1 text-sm">
            确认打卡 ✓
          </button>
        </div>
      </div>
    </div>
  )
}
