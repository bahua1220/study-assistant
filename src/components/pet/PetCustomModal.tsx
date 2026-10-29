import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getCurrentOwnerId } from '../../db'
import { PET_AVATARS, PET_COLORS } from '../../data/shopItems'
import { X } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  onClose: () => void
}

export function PetCustomModal({ onClose }: Props) {
  const ownerId = getCurrentOwnerId()
  const pet = useLiveQuery(() => db.pets.where('ownerId').equals(ownerId).first(), [ownerId])
  const isNew = !pet

  const [name, setName] = useState(pet?.name ?? '')
  const [avatar, setAvatar] = useState(pet?.avatar ?? PET_AVATARS[0])
  const [color, setColor] = useState(pet?.color ?? PET_COLORS[0])

  const handleSave = async () => {
    const petName = name.trim() || '小可爱'
    if (pet?.id) {
      await db.pets.update(pet.id, { name: petName, avatar, color })
    } else {
      await db.pets.add({
        ownerId,
        name: petName,
        avatar,
        color,
        createdAt: new Date().toISOString(),
      })
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-lg mx-auto space-y-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{isNew ? '领养宠物' : '自定义宠物'}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {/* 预览 */}
        <div className="flex justify-center py-4">
          <div
            className="w-28 h-28 rounded-full flex items-center justify-center text-6xl"
            style={{ backgroundColor: `${color}20`, border: `3px solid ${color}` }}
          >
            {avatar}
          </div>
        </div>

        {/* 名字 */}
        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">宠物名字</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="input"
            placeholder="给你的宠物起个名字吧"
            maxLength={10}
            autoFocus
          />
        </div>

        {/* 形象选择 */}
        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">选择形象</label>
          <div className="grid grid-cols-4 gap-2">
            {PET_AVATARS.map(a => (
              <button
                key={a}
                onClick={() => setAvatar(a)}
                className={clsx(
                  'text-3xl py-3 rounded-xl transition-all',
                  avatar === a
                    ? 'bg-brand-100 dark:bg-brand-900 ring-2 ring-brand-400 scale-105'
                    : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                )}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* 颜色选择 */}
        <div>
          <label className="text-xs font-medium text-zinc-500 block mb-1.5">主题颜色</label>
          <div className="flex gap-3">
            {PET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={clsx(
                  'w-10 h-10 rounded-full transition-all flex items-center justify-center',
                  color === c ? 'ring-2 ring-offset-2 ring-zinc-400 scale-110' : 'hover:scale-105'
                )}
                style={{ backgroundColor: c }}
              >
                {color === c && <span className="text-white text-sm">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* 保存 */}
        <button onClick={handleSave} className="btn-primary w-full text-sm">
          {isNew ? '领养 🎉' : '保存修改'}
        </button>
      </div>
    </div>
  )
}
