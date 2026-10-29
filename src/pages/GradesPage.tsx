import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getCurrentOwnerId, type Course, type GradeEntry, type GradeType, type Habit, type HabitCheckIn } from '../db'
import { Plus, Trash2, Edit3, X, TrendingUp, Target, Award, BookOpenCheck } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import clsx from 'clsx'
import { getPastDays } from '../lib/date'
import { normalizedLevel } from '../lib/habitEvaluation'

const GRADE_TYPE_LABELS: Record<GradeType, string> = {
  exam: '考试',
  homework: '作业',
  quiz: '小测',
  project: '项目',
  other: '其他',
}

export function GradesPage() {
  const ownerId = getCurrentOwnerId()
  const [showForm, setShowForm] = useState(false)
  const [editingEntry, setEditingEntry] = useState<GradeEntry | null>(null)
  const [trendCourseKey, setTrendCourseKey] = useState('')
  const [viewMode, setViewMode] = useState<'grades' | 'accuracy'>('grades')
  const [accuracyDays, setAccuracyDays] = useState(30)

  const entries = useLiveQuery(() =>
    db.gradeEntries.where('ownerId').equals(ownerId).sortBy('date').then(items => items.reverse())
  )
  const courses = useLiveQuery(() => db.courses.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const learningHabits = useLiveQuery(
    () => db.habits.where('ownerId').equals(ownerId).filter(habit => habit.taskType === 'learning').toArray(),
    [ownerId],
  )
  const accuracyStartDate = getPastDays(accuracyDays)[0]
  const learningCheckIns = useLiveQuery(
    () => db.checkIns.where('ownerId').equals(ownerId).filter(checkIn => checkIn.date >= accuracyStartDate).toArray(),
    [ownerId, accuracyStartDate],
  )

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定删除这条成绩记录吗？')) return
    await db.gradeEntries.delete(id)
  }

  // 按课程聚合
  const courseGroups = entries
    ? Object.entries(
        entries.reduce<Record<string, { courseName: string; entries: GradeEntry[]; weightedScore: number }>>((acc, e) => {
          const key = `name:${normalizeCourseName(e.courseName)}`
          if (!acc[key]) {
            acc[key] = { courseName: e.courseName.trim(), entries: [], weightedScore: 0 }
          }
          acc[key].entries.push(e)
          return acc
        }, {})
      ).map(([key, data]) => {
        // 加权平均
        const totalWeight = data.entries.reduce((s, e) => s + e.weight, 0)
        const weightedAvg = totalWeight > 0
          ? data.entries.reduce((s, e) => s + (e.score / e.maxScore) * e.weight * 100, 0) / totalWeight
          : 0
        return { key, ...data, weightedAvg: Math.round(weightedAvg * 10) / 10 }
      })
    : []

  // 图表数据
  const chartData = entries
    ? [...entries].reverse().map(e => ({
        name: `${e.courseName}-${e.name}`,
        score: Math.round(e.score / e.maxScore * 100),
        type: GRADE_TYPE_LABELS[e.type],
      }))
    : []

  const activeTrendGroup = courseGroups.find(group => group.key === trendCourseKey) ?? courseGroups[0]
  const trendData = activeTrendGroup
    ? [...activeTrendGroup.entries].sort((a, b) => a.date.localeCompare(b.date)).map(entry => ({
        name: entry.date.slice(5),
        score: Math.round(entry.score / entry.maxScore * 100),
        assessment: entry.name,
      }))
    : []

  if (showForm || editingEntry) {
    return (
        <GradeForm
          entry={editingEntry}
          courses={courses ?? []}
        onClose={() => { setShowForm(false); setEditingEntry(null) }}
      />
    )
  }

  if (viewMode === 'accuracy') {
    return (
      <div className="p-5 space-y-5">
        <div className="flex items-center justify-between"><h1 className="text-xl font-bold">成绩分析</h1></div>
        <AnalysisTabs value={viewMode} onChange={setViewMode} />
        <LearningAccuracyPanel habits={learningHabits ?? []} checkIns={learningCheckIns ?? []} days={accuracyDays} onDaysChange={setAccuracyDays} />
      </div>
    )
  }

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">成绩分析</h1>
        <button
          onClick={() => setShowForm(true)}
          className="btn-primary text-sm flex items-center gap-1 !px-4 !py-2"
        >
          <Plus size={16} />
          录入成绩
        </button>
      </div>
      <AnalysisTabs value={viewMode} onChange={setViewMode} />

      {/* Course aggregates */}
      {courseGroups.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="card">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp size={16} className="text-emerald-500" />
                <span className="text-xs text-zinc-400">最高均分</span>
              </div>
              <p className="text-xl font-bold text-emerald-600">
                {Math.max(...courseGroups.map(g => g.weightedAvg))}%
              </p>
            </div>
            <div className="card">
              <div className="flex items-center gap-2 mb-1">
                <Target size={16} className="text-brand-500" />
                <span className="text-xs text-zinc-400">平均成绩</span>
              </div>
              <p className="text-xl font-bold text-brand-600">
                {Math.round(courseGroups.reduce((s, g) => s + g.weightedAvg, 0) / courseGroups.length)}%
              </p>
            </div>
          </div>

          {/* Bar chart */}
          {chartData.length > 0 && (
            <div className="card">
              <h3 className="text-xs font-medium text-zinc-500 mb-3">各次成绩走势</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(value: number) => [`${value}%`, '得分率']}
                    />
                    <Bar dataKey="score" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {activeTrendGroup && (
            <div className="card">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-xs font-medium text-zinc-500">单科成绩趋势</h3>
                <select value={activeTrendGroup.key} onChange={e => setTrendCourseKey(e.target.value)} className="input !w-auto !py-1 text-xs">
                  {courseGroups.map(group => <option key={group.key} value={group.key}>{group.courseName}</option>)}
                </select>
              </div>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(value: number) => [`${value}%`, '得分率']} />
                    <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Course breakdown */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-500 mb-2">课程概览</h2>
            <div className="space-y-2">
              {courseGroups.map(g => (
                <div key={g.courseName} className="card space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{g.courseName}</h3>
                    <span className={clsx(
                      'text-sm font-bold',
                      g.weightedAvg >= 85 ? 'text-emerald-500' :
                      g.weightedAvg >= 70 ? 'text-blue-500' :
                      g.weightedAvg >= 60 ? 'text-amber-500' :
                      'text-red-500'
                    )}>
                      {g.weightedAvg}%
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-2">
                    <div
                      className={clsx(
                        'h-2 rounded-full transition-all',
                        g.weightedAvg >= 85 ? 'bg-emerald-500' :
                        g.weightedAvg >= 70 ? 'bg-blue-500' :
                        g.weightedAvg >= 60 ? 'bg-amber-500' :
                        'bg-red-500'
                      )}
                      style={{ width: `${Math.min(g.weightedAvg, 100)}%` }}
                    />
                  </div>
                  {/* Entries */}
                  <div className="space-y-1">
                    {g.entries.map(e => (
                      <div key={e.id} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-400 w-12">{GRADE_TYPE_LABELS[e.type]}</span>
                          <span>{e.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span>{e.score}/{e.maxScore}</span>
                          <span className="text-zinc-400 w-8 text-right">×{e.weight}</span>
                          <button
                            onClick={() => setEditingEntry(e)}
                            className="p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-400"
                          >
                            <Edit3 size={12} />
                          </button>
                          <button
                            onClick={() => handleDelete(e.id!)}
                            className="p-0.5 hover:bg-red-50 dark:hover:bg-red-950 rounded text-zinc-400 hover:text-red-500"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {entries?.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-zinc-400 text-sm">还没有成绩记录，录入第一笔吧 📊</p>
        </div>
      )}
    </div>
  )
}

function AnalysisTabs({ value, onChange }: { value: 'grades' | 'accuracy'; onChange: (value: 'grades' | 'accuracy') => void }) {
  return <div className="grid grid-cols-2 gap-2 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl">
    <button onClick={() => onChange('grades')} className={clsx('py-2 rounded-lg text-sm font-medium transition-colors', value === 'grades' ? 'bg-white dark:bg-zinc-800 shadow-sm text-brand-600' : 'text-zinc-500')}>考试成绩</button>
    <button onClick={() => onChange('accuracy')} className={clsx('py-2 rounded-lg text-sm font-medium transition-colors', value === 'accuracy' ? 'bg-white dark:bg-zinc-800 shadow-sm text-brand-600' : 'text-zinc-500')}>学习正确率</button>
  </div>
}

function LearningAccuracyPanel({ habits, checkIns, days, onDaysChange }: { habits: Habit[]; checkIns: HabitCheckIn[]; days: number; onDaysChange: (days: number) => void }) {
  const habitMap = new Map(habits.map(habit => [habit.id!, habit]))
  const submitted = checkIns.filter(checkIn => checkIn.actualValue > 0 && habitMap.has(checkIn.habitId))
  const accuracyRecords = submitted.filter(checkIn => {
    const habit = habitMap.get(checkIn.habitId)
    return habit?.trackAccuracy && checkIn.correctCount != null
  })
  const totalQuestions = accuracyRecords.reduce((sum, item) => sum + item.actualValue, 0)
  const totalCorrect = accuracyRecords.reduce((sum, item) => sum + (item.correctCount ?? 0), 0)
  const totalAccuracy = totalQuestions > 0 ? Math.round(totalCorrect / totalQuestions * 1000) / 10 : 0
  const targetMet = submitted.filter(item => ['standard', 'excellent'].includes(normalizedLevel(item))).length
  const excellent = submitted.filter(item => normalizedLevel(item) === 'excellent').length
  const attainmentRate = submitted.length > 0 ? Math.round(targetMet / submitted.length * 100) : 0

  const dailyData = getPastDays(days).map(date => {
    const records = accuracyRecords.filter(item => item.date === date)
    const total = records.reduce((sum, item) => sum + item.actualValue, 0)
    const correct = records.reduce((sum, item) => sum + (item.correctCount ?? 0), 0)
    return { name: date.slice(5), accuracy: total > 0 ? Math.round(correct / total * 1000) / 10 : null, questions: total }
  }).filter(item => item.questions > 0)

  const aggregate = (keyOf: (habit: Habit) => string) => {
    const groups = new Map<string, { correct: number; total: number }>()
    for (const item of accuracyRecords) {
      const habit = habitMap.get(item.habitId)!
      const key = keyOf(habit)
      const current = groups.get(key) ?? { correct: 0, total: 0 }
      current.correct += item.correctCount ?? 0
      current.total += item.actualValue
      groups.set(key, current)
    }
    return [...groups.entries()].map(([name, data]) => ({ name, accuracy: data.total > 0 ? Math.round(data.correct / data.total * 1000) / 10 : 0, total: data.total }))
  }
  const subjectData = aggregate(habit => habit.subject || '未分类').sort((a, b) => b.accuracy - a.accuracy)
  const taskData = aggregate(habit => habit.name).sort((a, b) => b.total - a.total)

  return <div className="space-y-5">
    <div className="flex justify-end"><select value={days} onChange={e => onDaysChange(Number(e.target.value))} className="input !w-auto !py-1 text-xs"><option value={7}>近7天</option><option value={30}>近30天</option><option value={90}>近90天</option></select></div>

    <div className="grid grid-cols-2 gap-3">
      <div className="card"><div className="flex items-center gap-2 text-xs text-zinc-400"><Target size={15} className="text-brand-500" />综合正确率</div><p className="text-2xl font-bold text-brand-600 mt-1">{totalQuestions > 0 ? `${totalAccuracy}%` : '-'}</p><p className="text-[10px] text-zinc-400">{totalCorrect}/{totalQuestions} 题</p></div>
      <div className="card"><div className="flex items-center gap-2 text-xs text-zinc-400"><BookOpenCheck size={15} className="text-blue-500" />完成题量</div><p className="text-2xl font-bold text-blue-600 mt-1">{totalQuestions}</p><p className="text-[10px] text-zinc-400">按所有学习记录汇总</p></div>
      <div className="card"><div className="flex items-center gap-2 text-xs text-zinc-400"><TrendingUp size={15} className="text-green-500" />达标率</div><p className="text-2xl font-bold text-green-600 mt-1">{submitted.length ? `${attainmentRate}%` : '-'}</p><p className="text-[10px] text-zinc-400">{targetMet}/{submitted.length} 次记录</p></div>
      <div className="card"><div className="flex items-center gap-2 text-xs text-zinc-400"><Award size={15} className="text-emerald-500" />高标准</div><p className="text-2xl font-bold text-emerald-600 mt-1">{excellent}</p><p className="text-[10px] text-zinc-400">高标准完成次数</p></div>
    </div>

    {dailyData.length > 0 && <div className="card"><h3 className="text-xs font-medium text-zinc-500 mb-3">每日正确率趋势</h3><div className="h-48"><ResponsiveContainer width="100%" height="100%"><LineChart data={dailyData}><CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip formatter={(value: number) => [`${value}%`, '正确率']} /><Line type="monotone" dataKey="accuracy" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} connectNulls /></LineChart></ResponsiveContainer></div></div>}

    {subjectData.length > 0 && <div className="card"><h3 className="text-xs font-medium text-zinc-500 mb-3">各科正确率</h3><div className="h-48"><ResponsiveContainer width="100%" height="100%"><BarChart data={subjectData}><CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip formatter={(value: number) => [`${value}%`, '正确率']} /><Bar dataKey="accuracy" fill="#10b981" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></div>}

    {taskData.length > 0 && <div><h3 className="text-sm font-semibold text-zinc-500 mb-2">任务正确率</h3><div className="space-y-2">{taskData.map(item => <div key={item.name} className="card !p-3 flex items-center gap-3"><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{item.name}</p><p className="text-[10px] text-zinc-400">累计完成 {item.total} 题</p></div><span className={clsx('text-sm font-bold', item.accuracy >= 90 ? 'text-emerald-500' : item.accuracy >= 80 ? 'text-green-500' : item.accuracy >= 60 ? 'text-amber-500' : 'text-red-500')}>{item.accuracy}%</span></div>)}</div></div>}

    {habits.length === 0 && <div className="card text-center py-10"><p className="text-zinc-400 text-sm">还没有学习任务</p><p className="text-xs text-zinc-400 mt-1">请先在“打卡”中创建学习任务并开启正确率统计。</p></div>}
    {habits.length > 0 && submitted.length === 0 && <div className="card text-center py-10"><p className="text-zinc-400 text-sm">所选时间内还没有学习打卡数据</p></div>}
  </div>
}

// ─── 成绩录入表单 ──────────────────────────────────────
function normalizeCourseName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, '')
}

function GradeForm({ entry, courses, onClose }: { entry: GradeEntry | null; courses: Course[]; onClose: () => void }) {
  const ownerId = getCurrentOwnerId()
  const isEdit = entry !== null

  const [courseName, setCourseName] = useState(entry?.courseName ?? '')
  const [courseId, setCourseId] = useState<number | undefined>(entry?.courseId)
  const [type, setType] = useState<GradeType>(entry?.type ?? 'exam')
  const [name, setName] = useState(entry?.name ?? '')
  const [score, setScore] = useState(entry?.score ?? 0)
  const [maxScore, setMaxScore] = useState(entry?.maxScore ?? 100)
  const [weight, setWeight] = useState(entry?.weight ?? 1)
  const [date, setDate] = useState(entry?.date ?? new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState(entry?.note ?? '')
  const [error, setError] = useState('')

  const handleSave = async () => {
    setError('')
    if (!courseName.trim() || !name.trim()) return setError('请填写课程和成绩名称')
    if (!Number.isFinite(maxScore) || maxScore <= 0) return setError('满分必须大于 0')
    if (!Number.isFinite(score) || score < 0 || score > maxScore) return setError('得分必须在 0 到满分之间')
    if (!Number.isFinite(weight) || weight <= 0) return setError('权重必须大于 0')

    const data = {
      courseName: courseName.trim(),
      courseId,
      type,
      name: name.trim(),
      score,
      maxScore,
      weight,
      date,
      note: note.trim() || undefined,
    }

    if (isEdit && entry?.id) {
      await db.gradeEntries.update(entry.id, data)
    } else {
      await db.gradeEntries.add({ ...data, ownerId })
    }
    onClose()
  }

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg">
          <X size={20} />
        </button>
        <h1 className="text-lg font-bold">{isEdit ? '编辑成绩' : '录入成绩'}</h1>
      </div>

      <div>
        <label className="text-xs font-medium text-zinc-500 block mb-1.5">课程名称</label>
        <input
          list="grade-course-options"
          value={courseName}
          onChange={e => {
            const nextName = e.target.value
            setCourseName(nextName)
            setCourseId(courses.find(course => normalizeCourseName(course.name) === normalizeCourseName(nextName))?.id)
          }}
          className="input"
          placeholder="选择课程或手动输入"
          autoFocus
        />
        <datalist id="grade-course-options">{courses.map(course => <option key={course.id} value={course.name} />)}</datalist>
      </div>

      {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">类型</label>
          <select value={type} onChange={e => setType(e.target.value as GradeType)} className="input">
            {Object.entries(GRADE_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">名称</label>
          <input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="期中考试" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">得分</label>
          <input type="number" value={score} onChange={e => setScore(Number(e.target.value))} className="input" min={0} />
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">满分</label>
          <input type="number" value={maxScore} onChange={e => setMaxScore(Number(e.target.value))} className="input" min={1} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">权重</label>
          <input type="number" value={weight} onChange={e => setWeight(Number(e.target.value))} className="input" min={0.1} step={0.1} />
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">日期</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-zinc-500 block mb-1.5">备注（选填）</label>
        <input value={note} onChange={e => setNote(e.target.value)} className="input" placeholder="备注信息" />
      </div>

      {/* 预览 */}
      <div className="card bg-zinc-50 dark:bg-zinc-900 !p-3 text-center">
        <p className="text-xs text-zinc-400">得分率预览</p>
        <p className="text-lg font-bold text-brand-500">
          {maxScore > 0 ? Math.round(score / maxScore * 100) : 0}%
        </p>
      </div>

      <button onClick={handleSave} className="btn-primary w-full text-sm">
        {isEdit ? '保存修改' : '录入'}
      </button>
    </div>
  )
}
