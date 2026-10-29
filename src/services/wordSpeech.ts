import { Capacitor, registerPlugin } from '@capacitor/core'

const native = registerPlugin<{
  speak(options: { text: string }): Promise<void>
  stop(): Promise<void>
  openSettings(): Promise<void>
}>('WordSpeech')
let generation = 0
let cancelWeb: (() => void) | undefined

export function stopWordSpeech() {
  generation++
  cancelWeb?.(); cancelWeb = undefined
  if (Capacitor.isNativePlatform()) void native.stop().catch(() => {})
  else window.speechSynthesis?.cancel()
}

export async function speakWord(text: string) {
  stopWordSpeech()
  if (!text.trim() || text.length > 200) throw new Error('朗读内容为空或过长')
  const ticket = generation
  if (Capacitor.isNativePlatform()) return native.speak({ text })
  const synth = window.speechSynthesis
  if (!synth || !window.SpeechSynthesisUtterance) throw new Error('此设备不支持系统朗读，请检查英文语音包')
  if (!synth.getVoices().length) await new Promise(resolve => window.setTimeout(resolve, 300))
  if (ticket !== generation) return
  const voice = synth.getVoices().find(item => /^en[-_]/i.test(item.lang) && item.localService)
  if (!voice) throw new Error('缺少本地英文语音，请在系统文字转语音设置安装英文语音包')
  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text)
    let timer: number
    const done = (error?: string) => { window.clearTimeout(timer); if (cancelWeb === cancel) cancelWeb = undefined; error ? reject(new Error(error)) : resolve() }
    const cancel = () => done()
    cancelWeb = cancel
    utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = 0.85
    utterance.onend = () => done()
    utterance.onerror = () => done('朗读失败，请检查系统英文语音设置')
    timer = window.setTimeout(() => { synth.cancel(); done('朗读超时，请检查系统语音设置') }, 30000)
    synth.speak(utterance)
  })
}

export async function openSpeechSettings() {
  if (!Capacitor.isNativePlatform()) throw new Error('请打开设备系统设置，搜索“文字转语音”，安装英文语音包')
  await native.openSettings()
}
