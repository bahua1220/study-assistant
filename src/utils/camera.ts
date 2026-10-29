import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'

function isCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /cancel|cancelled|canceled|用户取消|OS-PLUG-CAMR-0006/i.test(message)
}

function takePhotoInBrowser(prefix: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.capture = 'environment'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}

/** 调用后置摄像头并把原生照片统一转换为现有上传流程使用的 File。 */
export async function takePhotoFile(prefix = 'photo'): Promise<File | null> {
  if (!Capacitor.isNativePlatform()) return takePhotoInBrowser(prefix)

  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri,
      quality: 90,
      correctOrientation: true,
      saveToGallery: false,
    })
    if (!photo.webPath) throw new Error('相机没有返回照片')

    const response = await fetch(photo.webPath)
    if (!response.ok) throw new Error('读取照片失败')
    const blob = await response.blob()
    const format = photo.format === 'png' ? 'png' : 'jpeg'
    const type = blob.type || `image/${format}`
    return new File([blob], `${prefix}-${Date.now()}.${format === 'jpeg' ? 'jpg' : format}`, { type })
  } catch (error) {
    if (isCancelled(error)) return null
    throw new Error(error instanceof Error ? error.message : '无法打开相机')
  }
}
