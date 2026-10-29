import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, getCurrentOwnerId, type CustomDiamondReward } from '../db'
import { SHOP_ITEMS, type ShopItem, type ItemType } from '../data/shopItems'
import { ShoppingBag, ArrowLeft, Check, Shirt, Coffee, Gem, Plus, Edit3, Trash2, X } from 'lucide-react'
import clsx from 'clsx'

type ShopTab = ItemType | 'diamond'

export function ShopPage() {
  const ownerId = getCurrentOwnerId()
  const navigate = useNavigate()
  const [tab, setTab] = useState<ShopTab>('accessory')
  const [editingReward, setEditingReward] = useState<CustomDiamondReward | null | undefined>(undefined)
  const [feedAnim, setFeedAnim] = useState<string | null>(null)

  const coins = useLiveQuery(async () => {
    const recs = await db.coinRecords.where('ownerId').equals(ownerId).toArray()
    return recs.reduce((sum, record) => sum + record.amount, 0)
  }, [ownerId])
  const diamonds = useLiveQuery(async () => {
    const recs = await db.diamondRecords.where('ownerId').equals(ownerId).toArray()
    return recs.reduce((sum, record) => sum + record.amount, 0)
  }, [ownerId])
  const ownedItems = useLiveQuery(() => db.ownedItems.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const rewards = useLiveQuery(
    () => db.customDiamondRewards.where('ownerId').equals(ownerId).sortBy('createdAt'),
    [ownerId]
  )

  const ownedIds = new Set(ownedItems?.map(item => item.itemId) ?? [])
  const equippedIds = new Set(ownedItems?.filter(item => item.equipped).map(item => item.itemId) ?? [])
  const items = SHOP_ITEMS.filter(item => item.type === tab)

  const handleAccessoryBuy = async (item: ShopItem) => {
    if ((coins ?? 0) < item.price) return
    await db.transaction('rw', db.coinRecords, db.ownedItems, async () => {
      const existing = await db.ownedItems.where('[ownerId+itemId]').equals([ownerId, item.id]).first()
      if (existing) return
      const records = await db.coinRecords.where('ownerId').equals(ownerId).toArray()
      if (records.reduce((sum, record) => sum + record.amount, 0) < item.price) return
      await db.coinRecords.add({ ownerId, amount: -item.price, source: 'shop_purchase', date: today(), description: `购买配饰：${item.name}` })
      await db.ownedItems.add({ ownerId, itemId: item.id, equipped: 1 })
    })
  }

  const handleAccessoryToggle = async (item: ShopItem) => {
    const owned = ownedItems?.find(record => record.itemId === item.id)
    if (owned) await db.ownedItems.update(owned.id!, { equipped: owned.equipped ? 0 : 1 })
  }

  const handleFoodBuy = async (item: ShopItem) => {
    if ((coins ?? 0) < item.price) return
    let purchased = false
    await db.transaction('rw', db.coinRecords, async () => {
      const records = await db.coinRecords.where('ownerId').equals(ownerId).toArray()
      if (records.reduce((sum, record) => sum + record.amount, 0) < item.price) return
      await db.coinRecords.add({ ownerId, amount: -item.price, source: 'shop_purchase', date: today(), description: `购买食物：${item.name}` })
      purchased = true
    })
    if (!purchased) return
    const win = window as Window & { __petFeed?: (emoji: string) => void }
    win.__petFeed?.(item.emoji)
    setFeedAnim(item.emoji)
    window.setTimeout(() => setFeedAnim(null), 1000)
  }

  const redeemReward = async (reward: CustomDiamondReward) => {
    if ((diamonds ?? 0) < reward.price) return
    if (!window.confirm(`花费 ${reward.price} 枚钻石兑换“${reward.name}”？`)) return
    await db.transaction('rw', db.diamondRecords, async () => {
      const records = await db.diamondRecords.where('ownerId').equals(ownerId).toArray()
      if (records.reduce((sum, record) => sum + record.amount, 0) < reward.price) return
      await db.diamondRecords.add({
        ownerId,
        amount: -reward.price,
        source: 'reward_redeem',
        customRewardId: reward.id,
        date: today(),
        description: `兑换奖励：${reward.name}`,
      })
    })
  }

  const deleteReward = async (reward: CustomDiamondReward) => {
    if (window.confirm(`删除自定义奖励“${reward.name}”？`)) await db.customDiamondRewards.delete(reward.id!)
  }

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"><ArrowLeft size={20} /></button>
          <h1 className="text-xl font-bold flex items-center gap-2"><ShoppingBag size={22} />宠物商店</h1>
        </div>
        {tab === 'diamond' && <button onClick={() => setEditingReward(null)} className="btn-primary !px-3 !py-2 text-xs flex items-center gap-1"><Plus size={15} />添加</button>}
      </div>

      <div className="card flex items-center justify-around !py-3">
        <div className="text-center"><p className="text-xs text-zinc-400">🪙 金币</p><p className="text-lg font-bold text-amber-600 dark:text-amber-400">{coins ?? 0}</p></div>
        <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-700" />
        <div className="text-center"><p className="text-xs text-zinc-400">💎 钻石</p><p className="text-lg font-bold text-cyan-600 dark:text-cyan-400">{diamonds ?? 0}</p></div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {([['accessory', Shirt, '配饰'], ['food', Coffee, '食物'], ['diamond', Gem, '钻石奖励']] as const).map(([key, Icon, label]) => (
          <button key={key} onClick={() => setTab(key)} className={clsx('flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-colors', tab === key ? 'bg-brand-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500')}><Icon size={15} />{label}</button>
        ))}
      </div>

      {tab === 'diamond' ? (
        <div className="space-y-3">
          {!rewards?.length && <div className="card text-center py-10"><Gem className="mx-auto mb-2 text-cyan-400" /><p className="text-sm font-medium">添加一个想兑换的奖励吧</p><p className="text-xs text-zinc-400 mt-1">例如：玩游戏 30 分钟、喝一杯奶茶</p></div>}
          {rewards?.map(reward => {
            const canAfford = (diamonds ?? 0) >= reward.price
            return <div key={reward.id} className="card flex items-center gap-3 !p-4">
              <span className="text-3xl">{reward.emoji}</span>
              <div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{reward.name}</p>{reward.description && <p className="text-xs text-zinc-400 truncate">{reward.description}</p>}<p className="text-xs font-semibold text-cyan-600 mt-1">💎 {reward.price}</p></div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditingReward(reward)} className="p-2 text-zinc-400 hover:text-brand-500"><Edit3 size={15} /></button>
                <button onClick={() => deleteReward(reward)} className="p-2 text-zinc-400 hover:text-red-500"><Trash2 size={15} /></button>
                <button onClick={() => redeemReward(reward)} disabled={!canAfford} className="px-3 py-2 rounded-lg bg-cyan-500 text-white text-xs font-medium disabled:opacity-40">兑换</button>
              </div>
            </div>
          })}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {items.map(item => {
            const owned = tab === 'accessory' && ownedIds.has(item.id)
            const equipped = tab === 'accessory' && equippedIds.has(item.id)
            const canAfford = (coins ?? 0) >= item.price
            return <div key={item.id} className={clsx('card flex flex-col items-center text-center !p-3 relative transition-all', equipped && 'ring-2 ring-brand-400 border-brand-300', !canAfford && !owned && 'opacity-50')}>
              {owned && <div className="absolute top-2 right-2 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center"><Check size={12} className="text-white" strokeWidth={3} /></div>}
              <span className="text-3xl mb-1.5">{item.emoji}</span><p className="text-xs font-medium truncate w-full">{item.name}</p><p className="text-[10px] text-amber-600 font-semibold mt-0.5">🪙 {item.price}</p>
              {tab === 'accessory' ? owned ? <button onClick={() => handleAccessoryToggle(item)} className="mt-2 w-full text-xs py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800">{equipped ? '卸下' : '装备'}</button> : <button onClick={() => handleAccessoryBuy(item)} disabled={!canAfford} className="mt-2 w-full text-xs py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-600 disabled:opacity-40">购买</button> : <button onClick={() => handleFoodBuy(item)} disabled={!canAfford} className="mt-2 w-full text-xs py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-600 disabled:opacity-40">投喂</button>}
            </div>
          })}
        </div>
      )}

      {feedAnim && <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-50 text-7xl animate-bounce">{feedAnim}</div>}
      {editingReward !== undefined && <RewardForm reward={editingReward} ownerId={ownerId} onClose={() => setEditingReward(undefined)} />}
    </div>
  )
}

function RewardForm({ reward, ownerId, onClose }: { reward: CustomDiamondReward | null; ownerId: number; onClose: () => void }) {
  const [name, setName] = useState(reward?.name ?? '')
  const [emoji, setEmoji] = useState(reward?.emoji ?? '🎮')
  const [price, setPrice] = useState(reward?.price ?? 10)
  const [description, setDescription] = useState(reward?.description ?? '')
  const save = async () => {
    if (!name.trim() || price <= 0) return
    const data = { name: name.trim(), emoji: emoji.trim() || '🎁', price: Math.round(price), description: description.trim(), createdAt: reward?.createdAt ?? new Date().toISOString() }
    if (reward?.id) await db.customDiamondRewards.update(reward.id, data)
    else await db.customDiamondRewards.add({ ...data, ownerId })
    onClose()
  }
  return <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
    <div className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-lg space-y-4 safe-bottom" onClick={event => event.stopPropagation()}>
      <div className="flex items-center justify-between"><h3 className="text-lg font-bold">{reward ? '编辑钻石奖励' : '添加钻石奖励'}</h3><button onClick={onClose}><X size={20} /></button></div>
      <div className="grid grid-cols-[80px_1fr] gap-3"><div><label className="text-xs text-zinc-500 block mb-1.5">图标</label><input value={emoji} onChange={event => setEmoji(event.target.value)} className="input text-center text-xl" maxLength={4} /></div><div><label className="text-xs text-zinc-500 block mb-1.5">奖励名称</label><input value={name} onChange={event => setName(event.target.value)} className="input" placeholder="例如：玩游戏 30 分钟" /></div></div>
      <div><label className="text-xs text-zinc-500 block mb-1.5">需要钻石</label><input type="number" min={1} value={price} onChange={event => setPrice(Math.max(1, Number(event.target.value)))} className="input" /></div>
      <div><label className="text-xs text-zinc-500 block mb-1.5">说明（可选）</label><input value={description} onChange={event => setDescription(event.target.value)} className="input" placeholder="给自己一个明确的兑换约定" /></div>
      <button onClick={save} disabled={!name.trim()} className="btn-primary w-full disabled:opacity-40">保存</button>
    </div>
  </div>
}

function today() {
  const date = new Date()
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}
