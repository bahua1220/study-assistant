export const MAX_VOCAB_PHOTOS = 3
export type VocabPhoto = {
  id: string
  preview: string
  base64: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  status: 'ready' | 'queued' | 'processing' | 'success' | 'error'
  error?: string
  wordCount?: number
  limitReached?: boolean
}

export async function prepareVocabPhoto(file: File): Promise<VocabPhoto> {
  const mimeType = file.type === 'image/jpg' ? 'image/jpeg' : file.type
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new Error('请选择 JPG、PNG 或 WebP 图片')
  if (file.size > 10 * 1024 * 1024) throw new Error('每张图片不能超过 10MB')
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败，请重新选择'))
    reader.readAsDataURL(file)
  })
  const preview = await new Promise<string>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        // Only downsize the preview. Preserve full original resolution for OCR.
        const scale = Math.min(1, 480 / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法生成图片预览')
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
        canvas.width = canvas.height = 0
      } catch (cause) { reject(cause) }
      finally { image.src = '' }
    }
    image.onerror = () => reject(new Error('图片无法读取，请重新拍摄或选择其他图片'))
    image.src = original
  })
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    preview, base64: original.slice(original.indexOf(',') + 1),
    mimeType: mimeType as VocabPhoto['mimeType'], status: 'ready',
  }
}
