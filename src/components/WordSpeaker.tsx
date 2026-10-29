import { useEffect, useRef, useState } from 'react'
import { Volume2, Loader2, X } from 'lucide-react'
import { openSpeechSettings, speakWord, stopWordSpeech } from '../services/wordSpeech'

export function WordSpeaker({ word, auto = false }: { word: string; auto?: boolean }) {
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const active = useRef(false)
  const play = async () => {
    active.current = true; setPlaying(true); setError('')
    try { await speakWord(word) } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '系统语音不可用') }
    finally { active.current = false; if (mounted.current) setPlaying(false) }
  }
  useEffect(() => {
    mounted.current = true
    if (auto) void play()
    return () => { mounted.current = false; if (active.current) stopWordSpeech() }
  }, [word, auto])
  return <>
    <button type="button" aria-label={`朗读 ${word}`} disabled={playing} onClick={event => { event.stopPropagation(); void play() }} className="p-2 rounded-lg text-brand-500 disabled:opacity-50 shrink-0">{playing ? <Loader2 size={17} className="animate-spin" /> : <Volume2 size={17} />}</button>
    {error && <div role="dialog" aria-label="朗读提示" className="fixed inset-0 z-[100] bg-black/40 p-6 flex items-center justify-center" onClick={event => event.stopPropagation()}><div className="card w-full max-w-sm space-y-3"><div className="flex justify-between items-center"><p className="font-semibold">朗读提示</p><button aria-label="关闭朗读提示" onClick={() => setError('')}><X size={20} /></button></div><p className="text-sm">{error}</p><p className="text-xs text-zinc-400">只使用设备本地英文语音，不使用付费模型；安装英文语音包后可再试。</p><button className="btn-primary w-full" onClick={() => void openSpeechSettings().catch(cause => setError(cause.message))}>打开系统语音设置</button></div></div>}
  </>
}
