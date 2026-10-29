/** 商店商品目录 */

export type ItemType = 'accessory' | 'food'
export type AccessorySlot = 'head' | 'face' | 'neck'

export interface ShopItem {
  id: string
  name: string
  emoji: string
  price: number
  type: ItemType
  slot?: AccessorySlot
}

export const SHOP_ITEMS: ShopItem[] = [
  // ─── 配饰（可装备） ──────────────────────
  { id: 'hat_top',     name: '小礼帽',  emoji: '🎩',  price: 30, type: 'accessory', slot: 'head' },
  { id: 'crown',       name: '皇冠',    emoji: '👑',  price: 100, type: 'accessory', slot: 'head' },
  { id: 'ribbon',      name: '蝴蝶结',  emoji: '🎀',  price: 30, type: 'accessory', slot: 'head' },
  { id: 'glasses_round', name: '圆眼镜',  emoji: '👓',  price: 30, type: 'accessory', slot: 'face' },
  { id: 'sunglasses',  name: '墨镜',    emoji: '🕶️',  price: 50, type: 'accessory', slot: 'face' },
  { id: 'headphones',  name: '耳机',    emoji: '🎧',  price: 50, type: 'accessory', slot: 'head' },
  { id: 'cap',         name: '棒球帽',  emoji: '🧢',  price: 30, type: 'accessory', slot: 'head' },
  { id: 'scarf',       name: '围巾',    emoji: '🧣',  price: 25, type: 'accessory', slot: 'neck' },

  // ─── 食物（一次性） ──────────────────────
  { id: 'apple',       name: '苹果',    emoji: '🍎',  price: 5,  type: 'food' },
  { id: 'cake',        name: '蛋糕',    emoji: '🍰',  price: 15, type: 'food' },
  { id: 'donut',       name: '甜甜圈',  emoji: '🍩',  price: 10, type: 'food' },
  { id: 'pizza',       name: '披萨',    emoji: '🍕',  price: 20, type: 'food' },
  { id: 'boba',        name: '奶茶',    emoji: '🧋',  price: 10, type: 'food' },
  { id: 'taco',        name: '墨西哥卷', emoji: '🌮',  price: 15, type: 'food' },
]

/** 宠物可选头像 */
export const PET_AVATARS = ['🐱', '🐶', '🐰', '🐼', '🦊', '🐸', '🐻', '🐧']

/** 宠物可选颜色 */
export const PET_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

/** 打卡奖励常量 */
export const COIN_PER_CHECKIN = 10
export const DIAMOND_PER_TARGET = 1
export const EXCELLENT_CHECKIN_COINS = 15
export const EXCELLENT_CHECKIN_DIAMONDS = 2
export const PARTIAL_CHECKIN_COINS = 3
