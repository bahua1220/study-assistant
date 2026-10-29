import { Capacitor, registerPlugin } from '@capacitor/core'

interface FocusLockPlugin {
  start(): Promise<{ active: boolean }>
  stop(): Promise<{ active: boolean }>
}

const NativeFocusLock = registerPlugin<FocusLockPlugin>('FocusLock')

export async function startFocusLock(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try { return (await NativeFocusLock.start()).active } catch { return false }
}

export async function stopFocusLock(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try { await NativeFocusLock.stop() } catch { /* already unlocked */ }
}
