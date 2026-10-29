import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getCurrentOwnerId, type Course, type Semester } from '../db'
import { Plus, Trash2, Edit3, X, Settings2, Clock3 } from 'lucide-react'
import { getWeekdayName } from '../lib/date'
import clsx from 'clsx'

const COURSE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16']

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] // 周一~周日
export function SchedulePage() {
  const ownerId = getCurrentOwnerId()
  const [showForm, setShowForm] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [showSemesterForm, setShowSemesterForm] = useState(false)

  const courses = useLiveQuery(() => db.courses.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const currentSemester = useLiveQuery(() =>
    db.semesters.where('ownerId').equals(ownerId).filter(semester => semester.isCurrent).first(),
    [ownerId]
  )

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定删除这门课程吗？')) return
    await db.courses.delete(id)
  }

  const currentWeek = currentSemester ? getCurrentWeek(currentSemester.startDate) : null
  const semesterCourses = (courses ?? []).filter(course => {
    if (currentSemester?.id && course.semesterId && course.semesterId !== currentSemester.id) return false
    return true
  })
  const visibleCourses = semesterCourses.filter(course => {
    if (currentWeek == null) return true
    return currentWeek >= course.weekRange[0] && currentWeek <= course.weekRange[1]
  })
  const todayCourses = visibleCourses
    .filter(course => course.dayOfWeek === new Date().getDay())
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  if (showSemesterForm) {
    return <SemesterForm semester={currentSemester ?? null} onClose={() => setShowSemesterForm(false)} />
  }

  if (showForm || editingCourse) {
    return (
      <CourseForm
        course={editingCourse}
        semesterId={currentSemester?.id}
        onClose={() => { setShowForm(false); setEditingCourse(null) }}
      />
    )
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">课程表</h1>
          <p className="text-xs text-zinc-400">
            {currentSemester?.name ?? '未设置学期'}{currentWeek != null ? ` · 第 ${currentWeek} 周` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowSemesterForm(true)} className="btn-ghost !px-2.5" aria-label="设置学期">
            <Settings2 size={17} />
          </button>
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm flex items-center gap-1 !px-3 !py-2">
            <Plus size={16} /> 添加课程
          </button>
        </div>
      </div>

      {/* 今日课程 */}
      <div className="card">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2"><Clock3 size={16} />今日课程</h2>
        {todayCourses.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-3">今天没有课程 🎉</p>
        ) : todayCourses.map(course => (
          <button key={course.id} onClick={() => setEditingCourse(course)} className="w-full flex items-center gap-3 py-2 text-left">
            <span className="w-1 h-10 rounded-full" style={{ backgroundColor: course.color }} />
            <span className="text-xs text-zinc-400 w-24">{course.startTime}-{course.endTime}</span>
            <span className="flex-1 min-w-0"><span className="text-sm font-medium block truncate">{course.name}</span><span className="text-[10px] text-zinc-400">{course.classroom || '未设置教室'}</span></span>
          </button>
        ))}
      </div>

      {/* 每周课程：按真实时间显示，支持半点课程 */}
      <div className="overflow-x-auto pb-1">
        <div className="grid grid-cols-7 gap-2 min-w-[700px]">
          {WEEKDAYS.map(day => {
            const dayCourses = visibleCourses.filter(course => course.dayOfWeek === day).sort((a, b) => a.startTime.localeCompare(b.startTime))
            return <div key={day} className="card !p-2 min-h-28">
              <p className="text-xs font-semibold text-center text-zinc-500 mb-2">{getWeekdayName(day)}</p>
              <div className="space-y-1.5">{dayCourses.map(course => (
                <button key={course.id} onClick={() => setEditingCourse(course)} className="w-full rounded-lg p-2 text-left text-white" style={{ backgroundColor: course.color }}>
                  <p className="text-xs font-semibold truncate">{course.name}</p>
                  <p className="text-[10px] opacity-85">{course.startTime}-{course.endTime}</p>
                  {course.classroom && <p className="text-[10px] opacity-75 truncate">{course.classroom}</p>}
                </button>
              ))}</div>
            </div>
          })}
        </div>
      </div>

      {/* Course list */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-500 mb-2">课程列表</h2>
        <div className="space-y-1.5">
          {semesterCourses.length === 0 && (
            <p className="text-sm text-zinc-400 text-center py-6">
              还没有课程，点击右上角添加吧 📅
            </p>
          )}
          {semesterCourses.map(course => (
            <div key={course.id} className="card flex items-center gap-3 !p-3">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: course.color }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{course.name}</p>
                <p className="text-[10px] text-zinc-400">
                  {getWeekdayName(course.dayOfWeek)} {course.startTime}-{course.endTime}
                  {course.teacher ? ` · ${course.teacher}` : ''}
                  {course.classroom ? ` @${course.classroom}` : ''}
                </p>
              </div>
              <button
                onClick={() => setEditingCourse(course)}
                className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-400"
              >
                <Edit3 size={14} />
              </button>
              <button
                onClick={() => handleDelete(course.id!)}
                className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg text-zinc-400 hover:text-red-500"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function getCurrentWeek(startDate: string): number {
  const start = new Date(`${startDate}T00:00:00`)
  const diffDays = Math.floor((Date.now() - start.getTime()) / 86_400_000)
  return Math.max(1, Math.floor(diffDays / 7) + 1)
}

// ─── 课程表单 ───────────────────────────────────────────
function CourseForm({ course, semesterId, onClose }: { course: Course | null; semesterId?: number; onClose: () => void }) {
  const ownerId = getCurrentOwnerId()
  const isEdit = course !== null

  const [name, setName] = useState(course?.name ?? '')
  const [teacher, setTeacher] = useState(course?.teacher ?? '')
  const [classroom, setClassroom] = useState(course?.classroom ?? '')
  const [dayOfWeek, setDayOfWeek] = useState(course?.dayOfWeek ?? 1)
  const [startTime, setStartTime] = useState(course?.startTime ?? '08:00')
  const [endTime, setEndTime] = useState(course?.endTime ?? '09:40')
  const [weekStart, setWeekStart] = useState(course?.weekRange?.[0] ?? 1)
  const [weekEnd, setWeekEnd] = useState(course?.weekRange?.[1] ?? 16)
  const [color, setColor] = useState(course?.color ?? '#6366f1')
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!name.trim()) return
    if (endTime <= startTime) {
      setError('下课时间必须晚于上课时间')
      return
    }
    if (weekEnd < weekStart) {
      setError('结束周不能早于开始周')
      return
    }

    const conflict = await db.courses.where('ownerId').equals(ownerId).filter(existing =>
      existing.id !== course?.id &&
      existing.dayOfWeek === dayOfWeek &&
      (!semesterId || !existing.semesterId || existing.semesterId === semesterId) &&
      existing.startTime < endTime && existing.endTime > startTime &&
      existing.weekRange[0] <= weekEnd && existing.weekRange[1] >= weekStart
    ).first()
    if (conflict) {
      setError(`与“${conflict.name}”的上课时间冲突`)
      return
    }

    const data = {
      name: name.trim(),
      teacher: teacher.trim() || undefined,
      classroom: classroom.trim() || undefined,
      dayOfWeek,
      startTime,
      endTime,
      weekRange: [weekStart, weekEnd] as [number, number],
      color,
      semesterId,
    }

    if (isEdit && course?.id) {
      await db.courses.update(course.id, data)
    } else {
      await db.courses.add({ ...data, ownerId })
    }
    onClose()
  }

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg">
          <X size={20} />
        </button>
        <h1 className="text-lg font-bold">{isEdit ? '编辑课程' : '添加课程'}</h1>
      </div>

      <div>
        <label className="text-xs font-medium text-zinc-500 block mb-1.5">课程名称</label>
        <input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="例如：高等数学" autoFocus />
      </div>

      {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">教师</label>
          <input value={teacher} onChange={e => setTeacher(e.target.value)} className="input" placeholder="选填" />
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">教室</label>
          <input value={classroom} onChange={e => setClassroom(e.target.value)} className="input" placeholder="选填" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-zinc-500 block mb-1.5">上课时间</label>
        <div className="flex items-center gap-2">
          <select
            value={dayOfWeek}
            onChange={e => setDayOfWeek(Number(e.target.value))}
            className="input flex-1"
          >
            {WEEKDAYS.map(d => (
              <option key={d} value={d}>{getWeekdayName(d)}</option>
            ))}
          </select>
          <input
            type="time"
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
            className="input w-24"
          />
          <span className="text-zinc-400">-</span>
          <input
            type="time"
            value={endTime}
            onChange={e => setEndTime(e.target.value)}
            className="input w-24"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">开始周</label>
          <input type="number" value={weekStart} onChange={e => setWeekStart(Number(e.target.value))} className="input" min={1} max={20} />
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">结束周</label>
          <input type="number" value={weekEnd} onChange={e => setWeekEnd(Number(e.target.value))} className="input" min={1} max={20} />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-zinc-500 block mb-1.5">颜色</label>
        <div className="flex gap-2">
          {COURSE_COLORS.map(c => (
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

      <button onClick={handleSave} className="btn-primary w-full text-sm">
        {isEdit ? '保存修改' : '添加课程'}
      </button>
    </div>
  )
}

function SemesterForm({ semester, onClose }: { semester: Semester | null; onClose: () => void }) {
  const ownerId = getCurrentOwnerId()
  const [name, setName] = useState(semester?.name ?? `${new Date().getFullYear()} 学年`)
  const [startDate, setStartDate] = useState(semester?.startDate ?? new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(semester?.endDate ?? new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10))
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!name.trim()) return setError('请填写学期名称')
    if (endDate < startDate) return setError('结束日期不能早于开始日期')
    await db.transaction('rw', db.semesters, async () => {
      await db.semesters.where('ownerId').equals(ownerId).modify({ isCurrent: false })
      if (semester?.id) await db.semesters.update(semester.id, { name: name.trim(), startDate, endDate, isCurrent: true })
      else await db.semesters.add({ ownerId, name: name.trim(), startDate, endDate, isCurrent: true })
    })
    onClose()
  }

  return <div className="p-5 space-y-5">
    <div className="flex items-center gap-3"><button onClick={onClose} className="p-1.5"><X size={20} /></button><h1 className="text-lg font-bold">设置当前学期</h1></div>
    <div><label className="text-xs font-medium text-zinc-500 block mb-1.5">学期名称</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="例如：2026 秋季学期" /></div>
    <div className="grid grid-cols-2 gap-3">
      <div><label className="text-xs font-medium text-zinc-500 block mb-1.5">开始日期</label><input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
      <div><label className="text-xs font-medium text-zinc-500 block mb-1.5">结束日期</label><input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
    </div>
    {error && <p className="text-xs text-red-500">{error}</p>}
    <button onClick={() => void handleSave()} className="btn-primary w-full">保存学期</button>
  </div>
}
