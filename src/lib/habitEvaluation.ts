import type { CheckInLevel, Habit, HabitCheckIn } from '../db'
import {
  COIN_PER_CHECKIN, DIAMOND_PER_TARGET,
  EXCELLENT_CHECKIN_COINS, EXCELLENT_CHECKIN_DIAMONDS, PARTIAL_CHECKIN_COINS,
} from '../data/shopItems'

export const CHECK_IN_LEVELS: Record<CheckInLevel, { label: string; color: string; bg: string }> = {
  excellent: { label: '高标准', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-600' },
  standard: { label: '已达标', color: 'text-green-700 dark:text-green-300', bg: 'bg-green-400' },
  partial: { label: '部分完成', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-400' },
  none: { label: '未完成', color: 'text-zinc-500', bg: 'bg-zinc-200 dark:bg-zinc-700' },
}

export function normalizedLevel(checkIn?: Pick<HabitCheckIn, 'completed' | 'level'>): CheckInLevel {
  if (!checkIn) return 'none'
  return checkIn.level ?? (checkIn.completed ? 'standard' : 'none')
}

export function isTargetMet(checkIn?: Pick<HabitCheckIn, 'completed' | 'level'>): boolean {
  const level = normalizedLevel(checkIn)
  return level === 'standard' || level === 'excellent'
}

export function evaluateCheckIn(habit: Habit, actualValue: number, correctCount?: number) {
  const accuracy = habit.trackAccuracy && actualValue > 0 && correctCount != null
    ? Math.round((correctCount / actualValue) * 1000) / 10
    : undefined
  let level: CheckInLevel = 'none'

  if (actualValue > 0) {
    if (habit.taskType === 'learning') {
      if (habit.learningMode === 'fixed') {
        const finishedAll = actualValue >= habit.targetCount
        const errors = Math.max(0, actualValue - (correctCount ?? 0))
        if (finishedAll && errors <= (habit.highMaxErrors ?? 0)) level = 'excellent'
        else if (finishedAll && errors <= (habit.standardMaxErrors ?? Math.max(0, Math.floor(habit.targetCount * 0.25)))) level = 'standard'
        else level = 'partial'
      } else {
      const standardQualityMet = !habit.trackAccuracy || (accuracy != null && accuracy >= (habit.targetAccuracy ?? 80))
      const highQualityMet = !habit.trackAccuracy || (accuracy != null && accuracy >= (habit.highAccuracy ?? 90))
      const highQuantityMet = actualValue >= (habit.highTargetCount ?? Math.max(habit.targetCount + 1, Math.ceil(habit.targetCount * 1.5)))
      if (highQuantityMet && highQualityMet) level = 'excellent'
      else if (actualValue >= habit.targetCount && standardQualityMet) level = 'standard'
      else level = 'partial'
      }
    } else {
      level = actualValue >= habit.targetCount ? 'standard' : 'partial'
    }
  }

  const rewardCoins = level === 'excellent' ? EXCELLENT_CHECKIN_COINS
    : level === 'standard' ? COIN_PER_CHECKIN
      : level === 'partial' ? PARTIAL_CHECKIN_COINS : 0
  const rewardDiamonds = level === 'excellent' ? EXCELLENT_CHECKIN_DIAMONDS
    : level === 'standard' ? DIAMOND_PER_TARGET : 0
  return { level, accuracy, rewardCoins, rewardDiamonds }
}
