import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, getCurrentOwnerId, type Pet, type OwnedItem, type WeekDay } from '../../db'
import { SHOP_ITEMS } from '../../data/shopItems'
import { getToday } from '../../lib/date'
import { isTargetMet } from '../../lib/habitEvaluation'
import { PetCustomModal } from './PetCustomModal'
import { Sparkles, ShoppingBag, Settings2 } from 'lucide-react'

interface Props {
  compact?: boolean
}

export function PetDisplay({ compact = false }: Props) {
  const ownerId = getCurrentOwnerId()
  const navigate = useNavigate()
  const [showMenu, setShowMenu] = useState(false)
  const [showCustom, setShowCustom] = useState(false)
  const [feedAnim, setFeedAnim] = useState<string | null>(null)

  const pet = useLiveQuery(() => db.pets.where('ownerId').equals(ownerId).first(), [ownerId])
  const ownedItems = useLiveQuery(() => db.ownedItems.where('ownerId').equals(ownerId).toArray(), [ownerId])

  // 余额
  const coins = useLiveQuery(async () => {
    const recs = await db.coinRecords.where('ownerId').equals(ownerId).toArray()
    return recs.reduce((s, r) => s + r.amount, 0)
  })

  const diamonds = useLiveQuery(async () => {
    const recs = await db.diamondRecords.where('ownerId').equals(ownerId).toArray()
    return recs.reduce((s, r) => s + r.amount, 0)
  })

  // 今天打卡情况 → 决定 mood
  const todayDone = useLiveQuery(async () => {
    const today = getToday()
    const weekday = new Date().getDay()
    const habits = (await db.habits.where('[ownerId+archived]').equals([ownerId, 0]).toArray()).filter(habit => habit.activeDays.includes(weekday as WeekDay))
    if (habits.length === 0) return 'idle'
    const checkIns = await db.checkIns.where('[ownerId+date]').equals([ownerId, today]).toArray()
    const allDone = habits.every(h => checkIns.some(c => c.habitId === h.id && isTargetMet(c)))
    const anyDone = checkIns.some(c => c.completed)
    if (allDone) return 'happy'
    if (anyDone) return 'satisfied'
    return 'waiting'
  })

  // 装备的配饰
  const equippedIds = new Set(ownedItems?.filter(i => i.equipped).map(i => i.itemId) ?? [])
  const equippedItems = SHOP_ITEMS.filter(item => equippedIds.has(item.id) && item.type === 'accessory')

  const moodEmoji = todayDone === 'happy' ? '😊' : todayDone === 'satisfied' ? '😌' : '🥺'
  const moodText = todayDone === 'happy' ? '今日全部完成！' : todayDone === 'satisfied' ? '继续加油~' : '快来打卡吧~'

  const handleFeed = (emoji: string) => {
    setFeedAnim(emoji)
    setTimeout(() => setFeedAnim(null), 1000)
  }

  // 喂食动画暴露给外部（Shop 通过 window 事件）
  if (typeof window !== 'undefined') {
    (window as any).__petFeed = handleFeed
  }

  if (!pet) {
    return (
      <div className="card text-center py-6 cursor-pointer" onClick={() => setShowCustom(true)}>
        <div className="text-5xl mb-2">🥚</div>
        <p className="text-sm font-medium text-zinc-500">领养一只宠物吧</p>
        <p className="text-xs text-zinc-400 mt-1">点击开始</p>
        {showCustom && <PetCustomModal onClose={() => setShowCustom(false)} />}
      </div>
    )
  }

  return (
    <div className="relative">
      {/* 宠物卡片 */}
      <div
        className="card cursor-pointer overflow-hidden relative select-none"
        style={{ background: `linear-gradient(135deg, ${pet.color}15, ${pet.color}05)` }}
        onClick={() => setShowMenu(!showMenu)}
      >
        {/* 背景装饰 */}
        <div
          className="absolute top-0 left-0 right-0 h-1.5"
          style={{ backgroundColor: pet.color }}
        />

        <div className="flex items-center gap-4 pt-3">
          {/* 宠物形象 */}
          <div className="relative flex-shrink-0">
            <div className="text-[64px] leading-none animate-pet-breathe select-none">
              {pet.avatar}
            </div>
            {/* 配饰叠加 */}
            {equippedItems.map(item => (
              <span
                key={item.id}
                className="absolute text-xl leading-none pointer-events-none"
                style={{
                  top: item.slot === 'head' ? '-4px' : item.slot === 'face' ? '24px' : '12px',
                  left: item.slot === 'head' ? '50%' : '50%',
                  transform: 'translateX(-50%)',
                }}
              >
                {item.emoji}
              </span>
            ))}
            {/* 喂食动画 */}
            {feedAnim && (
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 animate-feed-float text-2xl pointer-events-none">
                {feedAnim} ❤️
              </span>
            )}
          </div>

          {/* 信息 */}
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold flex items-center gap-1.5">
              {pet.name}
              <span className="text-base animate-bounce">{moodEmoji}</span>
            </p>
            <p className="text-xs text-zinc-400">{moodText}</p>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                💰 {coins ?? 0}
              </span>
              <span className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">
                💎 {diamonds ?? 0}
              </span>
            </div>
          </div>
        </div>

        {/* 操作菜单 */}
        {showMenu && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
            <button
              onClick={(e) => { e.stopPropagation(); setShowCustom(true); setShowMenu(false) }}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              <Settings2 size={14} />
              自定义
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); navigate('/shop'); setShowMenu(false) }}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-xl bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-900 transition-colors"
            >
              <ShoppingBag size={14} />
              商店
            </button>
          </div>
        )}
      </div>

      {/* 自定义弹窗 */}
      {showCustom && <PetCustomModal onClose={() => setShowCustom(false)} />}
    </div>
  )
}
