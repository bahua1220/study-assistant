/** Date utility functions */

/** Get today as 'YYYY-MM-DD' */
export function getToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Get this week's Monday and Sunday as 'YYYY-MM-DD' */
export function getWeekRange(): [string, string] {
  const now = new Date()
  const day = now.getDay() // 0=周日
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return [dateToStr(monday), dateToStr(sunday)]
}

/** Get dates in the past N days */
export function getPastDays(n: number): string[] {
  const result: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    result.push(dateToStr(d))
  }
  return result
}

/** Calculate consecutive check-in streak (ending at today) */
export async function getStreak(
  checkIns: { date: string; completed: boolean; level?: string }[]
): Promise<number> {
  const doneSet = new Set(
    checkIns.filter(c => c.level ? c.level === 'standard' || c.level === 'excellent' : c.completed).map(c => c.date)
  )
  let streak = 0
  const d = new Date()
  while (true) {
    const dateStr = dateToStr(d)
    if (doneSet.has(dateStr)) {
      streak++
      d.setDate(d.getDate() - 1)
    } else {
      // 允许今天还没打卡（不中断 streak 计数）
      if (dateStr === getToday() && streak === 0) {
        d.setDate(d.getDate() - 1)
        continue
      }
      break
    }
  }
  return streak
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Format date for Chinese display */
export function formatDateCN(d: Date): string {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${weekdays[d.getDay()]}`
}

/** Get day-of-week name */
export function getWeekdayName(day: number): string {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return names[day] ?? ''
}
