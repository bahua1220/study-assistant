import { db } from '../db'

const PRUNE_MARKER = 'study_app_image_prune_date'

/**
 * 清理超过指定天数的答疑消息图片（base64 存 IndexedDB 会持续占用空间）。
 * 只删除图片数据、保留文字内容，并在消息上标记 imagesPruned 供 UI 提示。
 * 通过 localStorage 标记每天最多执行一次，避免每次启动全表扫描。
 */
export async function pruneOldQAImages(days = 30): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  if (localStorage.getItem(PRUNE_MARKER) === today) return 0

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  let pruned = 0

  const oldMessages = await db.qaMessages
    .where('createdAt')
    .below(cutoff)
    .filter(message => Boolean(message.imagesBase64?.length || message.imageBase64))
    .toArray()

  for (const message of oldMessages) {
    if (!message.id) continue
    await db.qaMessages.update(message.id, {
      imagesBase64: undefined,
      imageBase64: undefined,
      imagesPruned: true,
    })
    pruned += 1
  }

  localStorage.setItem(PRUNE_MARKER, today)
  return pruned
}
