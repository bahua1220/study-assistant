import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Camera, Check, ImagePlus, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import { db, getCurrentOwnerId, type VocabCard } from '../db'
import { lookupWord, lookupVocabBatch, recognizeVocab, type LookupResult, type RecognizedVocabWord } from '../services/api'
import { takePhotoFile } from '../utils/camera'
import { VocabNotebookSelect } from '../components/VocabNotebookSelect'
import { MAX_VOCAB_IMPORT, normalizeVocabEntry, parseVocabLines } from '../lib/vocabImport'
import { MAX_VOCAB_PHOTOS, prepareVocabPhoto, type VocabPhoto } from '../lib/vocabPhotos'
import { VocabPager } from '../components/VocabPager'
import { DRAFT_PAGE_SIZE } from '../lib/vocabQueries'

type DraftWord = RecognizedVocabWord & {
  id: string; selected: boolean; duplicate: boolean
  lookupState: 'idle' | 'dirty' | 'loading' | 'error'
  lookupError?: string
  sourcePhotoIds?: string[]
}
const wordKey = normalizeVocabEntry
const pendingLookup = (item: DraftWord) => item.lookupState === 'dirty' || item.lookupState === 'loading'
const hasDefinition = (item: DraftWord) => Boolean(wordKey(item.word) && item.translation.trim()) && !pendingLookup(item)

function lookupFields(result: LookupResult): RecognizedVocabWord {
  const phrase = wordKey(result.word).includes(' ')
  return {
    word: result.word, translation: result.translation,
    phonetic: phrase ? '' : result.phonetic, pos: phrase ? '' : result.posCn || result.pos,
    tags: phrase ? [] : result.tags ?? [], exchange: phrase ? '' : result.exchange ?? '',
    source: result.tags?.length ? 'dictionary' : 'ai',
  }
}
const TAG_LABELS: Record<string, string> = { zk: '中考', gk: '高考', cet4: '四级', cet6: '六级', ky: '考研', ielts: '雅思', toefl: '托福', gre: 'GRE' }

export function VocabAddPage() {
  const navigate = useNavigate()
  const ownerId = getCurrentOwnerId()
  const [params] = useSearchParams()
  const [notebookId, setNotebookId] = useState(params.get('notebookId') ?? '')
  const notebookRef = useRef(notebookId)
  notebookRef.current = notebookId
  const existingCards = useLiveQuery(() => db.vocabCards.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const inputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'manual' | 'batch' | 'scan'>('manual')
  const [photos, setPhotos] = useState<VocabPhoto[]>([])
  const photosRef = useRef<VocabPhoto[]>([])
  const [addingPhotos, setAddingPhotos] = useState(false)
  const addingPhotosRef = useRef(false)
  const [takingPhoto, setTakingPhoto] = useState(false)
  const takingPhotoRef = useRef(false)
  const [recognizing, setRecognizing] = useState(false)
  const recognizingRef = useRef(false)
  const scanVersion = useRef(0)
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftWord[]>([])
  const [batchText, setBatchText] = useState('')
  const [batchDrafts, setBatchDrafts] = useState<DraftWord[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const batchVersion = useRef(0)
  const parsedBatch = useMemo(() => parseVocabLines(batchText), [batchText])
  const activeDrafts = mode === 'batch' ? batchDrafts : drafts
  const setActiveDrafts = mode === 'batch' ? setBatchDrafts : setDrafts
  const [draftPages, setDraftPages] = useState({ scan: 0, batch: 0 })
  const draftMode = mode === 'batch' ? 'batch' : 'scan'
  const draftPage = Math.min(draftPages[draftMode], Math.max(0, Math.ceil(activeDrafts.length / DRAFT_PAGE_SIZE) - 1))
  const setDraftPage = (page: number) => setDraftPages(current => ({ ...current, [draftMode]: Math.max(0, page) }))
  const [word, setWord] = useState('')
  const [manual, setManual] = useState<DraftWord | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const lookupVersions = useRef(new Map<string, number>())
  const manualVersion = useRef(0)
  const mounted = useRef(true)
  const duplicateWords = useRef(new Set<string>())
  duplicateWords.current = useMemo(() => new Set((existingCards ?? []).filter(card => notebookId ? card.notebookIds?.includes(notebookId) : true).map(card => wordKey(card.word))), [existingCards, notebookId])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; lookupVersions.current.clear(); manualVersion.current++; batchVersion.current++; scanVersion.current++ }
  }, [])

  useEffect(() => {
    const update = (item: DraftWord) => { const duplicate = duplicateWords.current.has(wordKey(item.word)); return { ...item, duplicate, selected: duplicate ? false : item.duplicate ? hasDefinition(item) : item.selected } }
    setDrafts(current => current.map(update))
    setBatchDrafts(current => current.map(update))
    setManual(current => current ? update(current) : current)
  }, [notebookId, existingCards])

  const stats = useMemo(() => ({
    total: new Set(activeDrafts.map(item => wordKey(item.word)).filter(Boolean)).size,
    selected: new Set(activeDrafts.filter(item => item.selected && !item.duplicate && hasDefinition(item)).map(item => wordKey(item.word))).size,
    duplicates: activeDrafts.filter(item => item.duplicate).length,
    unresolved: activeDrafts.filter(item => !hasDefinition(item)).length,
    crossPhotoDuplicates: activeDrafts.reduce((count, item) => count + Math.max(0, (item.sourcePhotoIds?.length ?? 0) - 1), 0),
  }), [activeDrafts])
  const scanPending = mode === 'scan' && (recognizing || addingPhotos || takingPhoto || photos.some(photo => ['ready', 'queued', 'processing'].includes(photo.status)))
  const saveDisabled = !stats.selected || saving || batchLoading || activeDrafts.some(pendingLookup) || scanPending
  const saveLabel = saving ? '正在保存...' : scanPending ? '请先完成照片识别' : activeDrafts.some(pendingLookup) ? '请先完成单词查询' : `批量加入单词本（${stats.selected}）`
  const saveButton = (position: 'top' | 'bottom') => <button data-testid={`vocab-save-${position}`} onClick={() => void saveWords(activeDrafts)} disabled={saveDisabled} className="btn-primary w-full disabled:opacity-40">{saveLabel}</button>

  const updateDraft = useCallback((id: string, update: (item: DraftWord) => DraftWord) => {
    setDrafts(current => current.map(item => item.id === id ? update(item) : item))
    setBatchDrafts(current => current.map(item => item.id === id ? update(item) : item))
    setManual(current => current?.id === id ? update(current) : current)
  }, [])

  const editDraft = useCallback((next: DraftWord) => {
    updateDraft(next.id, current => ({ ...next, duplicate: duplicateWords.current.has(wordKey(next.word)),
      selected: duplicateWords.current.has(wordKey(next.word)) ? false : next.selected,
      lookupState: current.lookupState === 'error' ? 'idle' : next.lookupState, lookupError: undefined,
    }))
  }, [updateDraft])

  const changeDraftWord = useCallback((item: DraftWord, value: string) => {
    if (wordKey(value) === wordKey(item.word)) {
      updateDraft(item.id, current => ({ ...current, word: value }))
      return
    }
    lookupVersions.current.set(item.id, (lookupVersions.current.get(item.id) ?? 0) + 1)
    updateDraft(item.id, current => ({ ...current, word: value, phonetic: '', translation: '', pos: '', tags: [], exchange: '',
      source: 'unresolved', selected: false, duplicate: duplicateWords.current.has(wordKey(value)),
      lookupState: wordKey(value) ? 'dirty' : 'idle', lookupError: undefined,
    }))
  }, [updateDraft])

  const refreshDraft = useCallback(async (item: DraftWord) => {
    const requested = wordKey(item.word)
    if (!requested) return
    const version = (lookupVersions.current.get(item.id) ?? 0) + 1
    lookupVersions.current.set(item.id, version)
    const shouldSelect = item.lookupState === 'dirty' || item.selected
    updateDraft(item.id, current => ({ ...current, lookupState: 'loading', lookupError: undefined,
      phonetic: '', translation: '', pos: '', tags: [], exchange: '', source: 'unresolved', selected: false,
    }))
    try {
      const result = await lookupWord(requested, true)
      if (!mounted.current || lookupVersions.current.get(item.id) !== version) return
      if (wordKey(result.word) !== requested) throw new Error('查询结果与输入单词不一致，请核对拼写后重试或手动填写')
      if (!result.translation?.trim()) throw new Error('未查到释义，请核对拼写后重试或手动填写')
      updateDraft(item.id, current => {
        if (wordKey(current.word) !== requested) return current
        const duplicate = duplicateWords.current.has(requested)
        return { ...current, ...lookupFields(result), word: requested, duplicate, selected: shouldSelect && !duplicate,
          lookupState: 'idle', lookupError: undefined }
      })
    } catch (cause) {
      if (!mounted.current || lookupVersions.current.get(item.id) !== version) return
      updateDraft(item.id, current => wordKey(current.word) !== requested ? current : { ...current,
        lookupState: 'error', lookupError: cause instanceof Error ? cause.message : '查询失败',
      })
    }
  }, [updateDraft])

  const deleteDraft = useCallback((id: string) => {
    lookupVersions.current.delete(id)
    setActiveDrafts(current => current.filter(value => value.id !== id))
  }, [setActiveDrafts])

  const updatePhotos = (update: (items: VocabPhoto[]) => VocabPhoto[]) => {
    const next = update(photosRef.current)
    photosRef.current = next
    setPhotos(next)
  }

  const addPhotos = async (files: File[]) => {
    if (addingPhotosRef.current || recognizingRef.current || saving || !files.length) return
    const remaining = MAX_VOCAB_PHOTOS - photosRef.current.length
    if (files.length > remaining) { setError(`每批最多 ${MAX_VOCAB_PHOTOS} 张，还可选择 ${remaining} 张；本次选择未添加，请重新选择。`); return }
    addingPhotosRef.current = true; setAddingPhotos(true); setError('')
    const failures: string[] = []
    try {
      // Read/decode one at a time, keeping preview memory small on phones.
      for (const file of files) {
        try {
          const photo = await prepareVocabPhoto(file)
          if (!mounted.current) return
          updatePhotos(current => [...current, photo])
        } catch (cause) { failures.push(`${file.name}：${cause instanceof Error ? cause.message : '读取失败'}`) }
      }
      if (mounted.current && failures.length) setError(failures.join('；'))
    } finally {
      addingPhotosRef.current = false
      if (mounted.current) setAddingPhotos(false)
    }
  }

  const takePhoto = async () => {
    if (takingPhotoRef.current || recognizingRef.current || addingPhotosRef.current || photosRef.current.length >= MAX_VOCAB_PHOTOS) return
    takingPhotoRef.current = true; setTakingPhoto(true)
    try {
      const file = await takePhotoFile('vocab')
      if (file && mounted.current) await addPhotos([file])
    } catch (cause) { setError(cause instanceof Error ? cause.message : '拍照失败') }
    finally { takingPhotoRef.current = false; if (mounted.current) setTakingPhoto(false) }
  }

  const markDuplicates = async (items: RecognizedVocabWord[]) => {
    const existing = await db.vocabCards.where('ownerId').equals(ownerId).toArray()
    const targetNotebook = notebookRef.current
    const words = new Set(existing.filter(card => targetNotebook ? card.notebookIds?.includes(targetNotebook) : true).map(card => wordKey(card.word)))
    return items.map((item, index) => ({
      ...item,
      id: `${Date.now()}-${index}-${Math.random()}`,
      lookupState: 'idle' as const,
      duplicate: words.has(wordKey(item.word)),
      selected: !words.has(wordKey(item.word)) && Boolean(item.translation.trim()),
    }))
  }

  const runRecognition = async (retryId?: string) => {
    if (recognizingRef.current || addingPhotosRef.current || takingPhotoRef.current || saving) return
    const queue = photosRef.current.filter(photo => retryId ? photo.id === retryId && photo.status === 'error' : photo.status === 'ready')
    if (!queue.length) return
    const version = ++scanVersion.current
    recognizingRef.current = true; setRecognizing(true); setError('')
    const ids = new Set(queue.map(photo => photo.id))
    updatePhotos(current => current.map(photo => ids.has(photo.id) ? { ...photo, status: 'queued', error: undefined } : photo))
    try {
      for (const photo of queue) {
        if (!mounted.current || scanVersion.current !== version) return
        updatePhotos(current => current.map(value => value.id === photo.id ? { ...value, status: 'processing' } : value))
        try {
          const result = await recognizeVocab(photo.base64, photo.mimeType)
          if (!mounted.current || scanVersion.current !== version) return
          if (!result.words.length) throw new Error('没有识别到英文词条，请检查图片后重试或补拍')
          const incoming = await markDuplicates(result.words)
          if (!mounted.current || scanVersion.current !== version) return
          setDrafts(current => {
            const merged = [...current]
            const positions = new Map(merged.map((item, index) => [wordKey(item.word), index]))
            for (const item of incoming) {
              const position = positions.get(wordKey(item.word))
              if (position === undefined) {
                positions.set(wordKey(item.word), merged.length)
                merged.push({ ...item, sourcePhotoIds: [photo.id] })
              } else {
                const previous = merged[position]
                // Keep checked/edited data, only merge provenance for a repeated word.
                merged[position] = { ...previous, sourcePhotoIds: [...new Set([...(previous.sourcePhotoIds ?? []), photo.id])] }
              }
            }
            return merged
          })
          updatePhotos(current => current.map(value => value.id === photo.id ? { ...value, status: 'success', wordCount: incoming.length, limitReached: result.limitReached } : value))
        } catch (cause) {
          if (!mounted.current || scanVersion.current !== version) return
          updatePhotos(current => current.map(value => value.id === photo.id ? { ...value, status: 'error', error: cause instanceof Error ? cause.message : '识别失败' } : value))
        }
      }
    } finally {
      if (mounted.current && scanVersion.current === version) {
        recognizingRef.current = false
        setRecognizing(false)
      }
    }
  }

  const removePhoto = (id: string) => {
    if (recognizingRef.current || addingPhotosRef.current || saving) return
    if (drafts.some(item => item.sourcePhotoIds?.includes(id)) && !window.confirm('移除照片会同时移除仅来自这张照片的未保存词条，是否继续？')) return
    updatePhotos(current => current.filter(photo => photo.id !== id))
    setDrafts(current => current.filter(item => !item.sourcePhotoIds?.includes(id) || item.sourcePhotoIds.length > 1)
      .map(item => ({ ...item, sourcePhotoIds: item.sourcePhotoIds?.filter(source => source !== id) })))
    setPreviewPhoto(null)
  }

  const clearPhotoBatch = () => {
    if (recognizingRef.current || addingPhotosRef.current || saving) return
    if (drafts.length && !window.confirm('清空本批会移除当前照片和未保存的识别结果，是否继续？')) return
    scanVersion.current++
    updatePhotos(() => []); setDrafts([]); setDraftPages(current => ({ ...current, scan: 0 })); setPreviewPhoto(null); setError('')
  }

  const manualLookup = async () => {
    if (!word.trim()) return
    const version = ++manualVersion.current
    setLoading(true); setError('')
    try {
      const result = await lookupWord(word.trim(), true)
      const [draft] = await markDuplicates([lookupFields(result)])
      if (!mounted.current || manualVersion.current !== version) return
      setManual(draft)
    } catch (cause) { if (mounted.current && manualVersion.current === version) setError(cause instanceof Error ? cause.message : '查询失败') }
    finally { if (mounted.current && manualVersion.current === version) setLoading(false) }
  }

  const runBatchLookup = async () => {
    if (!parsedBatch.words.length || parsedBatch.invalid.length || parsedBatch.overLimit || batchLoading) return
    const version = ++batchVersion.current
    const items = parsedBatch.words.map(value => ({ ...emptyDraft(), word: value,
      duplicate: duplicateWords.current.has(value), lookupState: 'loading' as const }))
    setBatchDrafts(items); setDraftPages(current => ({ ...current, batch: 0 })); setBatchLoading(true); setError('')
    try {
      const result = await lookupVocabBatch(parsedBatch.words)
      if (!mounted.current || batchVersion.current !== version) return
      const results = new Map(result.words.map(item => [wordKey(item.word), item]))
      setBatchDrafts(current => current.map(item => {
        const found = results.get(wordKey(item.word))
        const duplicate = duplicateWords.current.has(wordKey(item.word))
        if (!found?.translation.trim()) return { ...item, duplicate, lookupState: 'error', lookupError: '未能获取释义', selected: false }
        const phrase = wordKey(item.word).includes(' ')
        return { ...item, ...found, word: wordKey(item.word), duplicate, selected: !duplicate, lookupState: 'idle',
          phonetic: phrase ? '' : found.phonetic, pos: phrase ? '' : found.pos,
          tags: phrase ? [] : found.tags, exchange: phrase ? '' : found.exchange, lookupError: undefined }
      }))
    } catch (cause) {
      if (!mounted.current || batchVersion.current !== version) return
      const message = cause instanceof Error ? cause.message : '批量查询失败'
      setError(message)
      setBatchDrafts(current => current.map(item => ({ ...item, lookupState: 'error', lookupError: message, selected: false })))
    } finally {
      if (mounted.current && batchVersion.current === version) setBatchLoading(false)
    }
  }

  const saveWords = async (items: DraftWord[]) => {
    if (savingRef.current || items.some(pendingLookup)) return
    if (mode === 'scan' && (recognizingRef.current || addingPhotosRef.current || takingPhotoRef.current || photosRef.current.some(photo => ['ready', 'queued', 'processing'].includes(photo.status)))) return
    const seen = new Set<string>()
    const valid = items.filter(item => {
      const normalized = wordKey(item.word)
      if (!item.selected || item.duplicate || !hasDefinition(item) || seen.has(normalized)) return false
      seen.add(normalized)
      return true
    })
    if (!valid.length) return
    savingRef.current = true; setSaving(true); setError('')
    try {
      await db.transaction('rw', db.vocabCards, db.vocabNotebooks, async () => {
        if (notebookId) {
          const book = await db.vocabNotebooks.get(notebookId)
          if (!book || book.ownerId !== ownerId) throw new Error('单词本不存在，请重新选择')
        }
        const owned = await db.vocabCards.where('ownerId').equals(ownerId).toArray()
        const byWord = new Map(owned.map(card => [wordKey(card.word), card]))
        const additions: VocabCard[] = []
        const memberships: VocabCard[] = []
        for (const item of valid) {
          const existing = byWord.get(wordKey(item.word))
          if (existing) {
            if (notebookId && !existing.notebookIds?.includes(notebookId)) memberships.push({ ...existing, notebookIds: [...(existing.notebookIds ?? []), notebookId] })
          } else additions.push({ ...createCard(ownerId, item), notebookIds: notebookId ? [notebookId] : [] })
        }
        // One atomic batch; never overwrite an existing word's learning progress/definition.
        if (memberships.length) await db.vocabCards.bulkPut(memberships)
        if (additions.length) await db.vocabCards.bulkAdd(additions)
      })
      navigate(notebookId ? `/vocab/notebooks?id=${encodeURIComponent(notebookId)}` : '/vocab', { replace: true })
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败') }
    finally { savingRef.current = false; setSaving(false) }
  }

  return <div data-vocab-page-region className="p-5 space-y-5">
    <div className="flex items-center gap-3"><button onClick={() => navigate('/vocab')} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><ArrowLeft size={20} /></button><div><h1 className="text-lg font-bold">添加单词</h1><p className="text-[10px] text-zinc-400">识别结果保存前均可修改</p></div></div>
    <div className="grid grid-cols-3 gap-2">
      <button onClick={() => setMode('manual')} className={clsx('py-2.5 rounded-xl text-sm font-medium', mode === 'manual' ? 'bg-brand-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500')}>手动添加</button>
      <button onClick={() => setMode('batch')} className={clsx('py-2.5 rounded-xl text-sm font-medium', mode === 'batch' ? 'bg-brand-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500')}>批量粘贴</button>
      <button onClick={() => setMode('scan')} className={clsx('py-2.5 rounded-xl text-sm font-medium', mode === 'scan' ? 'bg-brand-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500')}>拍照识别</button>
    </div>

    {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950 rounded-xl px-3 py-2">{error}</p>}
    <VocabNotebookSelect value={notebookId} onChange={setNotebookId} />

    {mode === 'manual' ? <>
      <div className="card !p-4 space-y-3"><label className="text-xs font-medium text-zinc-500">输入英文单词或短语</label><div className="flex gap-2"><input value={word} onChange={event => { manualVersion.current++; setLoading(false); setWord(event.target.value); setManual(null) }} onKeyDown={event => { if (event.key === 'Enter' && !loading) void manualLookup() }} className="input flex-1" placeholder="例如：abandon / look forward to" autoFocus /><button onClick={() => void manualLookup()} disabled={loading || !word.trim()} className="btn-primary !px-4 flex items-center gap-1 disabled:opacity-40">{loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}查询</button></div></div>
      {manual && <><EditableWord item={manual} onChange={editDraft} onWordChange={value => changeDraftWord(manual, value)} onLookup={() => void refreshDraft(manual)} allowSelect={false} disabled={saving} /><button onClick={() => void saveWords([{ ...manual, selected: true }])} disabled={manual.duplicate || !hasDefinition(manual) || saving} className="btn-primary w-full disabled:opacity-40">{manual.duplicate ? '该单词已在单词本' : saving ? '保存中...' : '加入单词本'}</button></>}
    </> : mode === 'batch' ? <div className="card !p-4 space-y-3">
      <label htmlFor="vocab-batch-input" className="text-sm font-medium">每行一个单词或短语</label>
      <p className="text-xs text-zinc-400">可直接复制粘贴；短语中的空格、sb./sth. 会保留。每批最多 {MAX_VOCAB_IMPORT} 项，空行自动忽略，重复行只保留一次。</p>
      <textarea id="vocab-batch-input" value={batchText} onChange={event => setBatchText(event.target.value)} disabled={batchLoading || saving} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="input min-h-44 text-sm" placeholder={'apple\nbanana\nask sb. to do sth.\nprovide somebody with something'} />
      <p className="text-xs text-zinc-500" role="status">有效 {parsedBatch.words.length} 项 · 重复 {parsedBatch.duplicates} 行 · 需修改 {parsedBatch.invalid.length} 行</p>
      {parsedBatch.invalid.length > 0 && <p role="alert" className="text-xs text-red-500">请修改第 {parsedBatch.invalid.map(item => item.line).slice(0, 10).join('、')} 行：每行仅填英文词条（最多100个字符），中文释义请在解析后填写。</p>}
      {parsedBatch.overLimit && <p role="alert" className="text-xs text-red-500">一次最多 {MAX_VOCAB_IMPORT} 项，请分批添加；不会自动截断你的输入。</p>}
      <button onClick={() => void runBatchLookup()} disabled={batchLoading || saving || !parsedBatch.words.length || Boolean(parsedBatch.invalid.length) || parsedBatch.overLimit} className="btn-primary w-full flex justify-center items-center gap-2 disabled:opacity-40">{batchLoading && <Loader2 size={15} className="animate-spin" />}{batchLoading ? '正在批量查询资料...' : '解析并查询资料'}</button>
      <p className="text-[11px] text-zinc-400">先查本地词库；未收录的词条由原有 AI 补全。核对下方资料后再批量保存。</p>
      {batchDrafts.length > 0 && <p className="text-[11px] text-zinc-400">再次解析会替换下方尚未保存的列表。</p>}
    </div> : <>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={event => { const files = Array.from(event.target.files ?? []); event.currentTarget.value = ''; void addPhotos(files) }} />
      <div className="card !p-4 space-y-3">
        <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">拍摄单词表、课本或笔记</p><span className="text-xs text-zinc-400">已选 {photos.length}/{MAX_VOCAB_PHOTOS} 张</span></div>
        <p className="text-[11px] text-zinc-400">支持连续拍照或相册多选，每批最多3张。逐张识别、合并去重；每张最多80项，达到上限会提醒。</p>
        {photos.length > 0 && <div className="grid grid-cols-3 gap-2">
          {photos.map((photo, index) => <div key={photo.id} data-testid="vocab-photo" className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-1.5 space-y-1.5 min-w-0">
            <div className="relative">
              <button onClick={() => setPreviewPhoto(photo.id)} aria-label={`预览第${index + 1}张照片`} className="block w-full"><img src={photo.preview} alt={`第${index + 1}张待识别照片`} className="w-full h-24 object-contain rounded-lg bg-zinc-100 dark:bg-zinc-800" /></button>
              <span className="absolute top-1 left-1 text-[10px] px-1.5 rounded bg-black/60 text-white pointer-events-none">{index + 1}</span>
              <button onClick={() => removePhoto(photo.id)} aria-label={`移除第${index + 1}张照片`} disabled={recognizing || addingPhotos || takingPhoto || saving} className="absolute -top-2 -right-2 rounded-full bg-zinc-800 text-white p-1 disabled:opacity-30"><X size={12} /></button>
            </div>
            <p className={clsx('text-[10px] text-center', photo.status === 'error' ? 'text-red-500' : photo.status === 'success' ? 'text-emerald-600' : 'text-zinc-400')}>
              {photo.status === 'ready' ? '待识别' : photo.status === 'queued' ? '等待中' : photo.status === 'processing' ? '识别中...' : photo.status === 'success' ? `已识别 ${photo.wordCount} 项` : '识别失败'}
            </p>
            {photo.status === 'error' && <><p role="alert" className="text-[10px] text-red-500 break-words">{photo.error}</p><button onClick={() => void runRecognition(photo.id)} disabled={recognizing || addingPhotos || takingPhoto || saving} aria-label={`重试第${index + 1}张照片`} className="text-[11px] text-brand-600 w-full disabled:opacity-40">重试此张</button></>}
            {photo.limitReached && <p role="alert" className="text-[10px] text-amber-600">已达单图80项上限，可能还有词条未提取，请分段补拍。</p>}
          </div>)}
        </div>}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => void takePhoto()} disabled={recognizing || addingPhotos || takingPhoto || saving || photos.length >= MAX_VOCAB_PHOTOS} className="btn-primary flex items-center justify-center gap-2 disabled:opacity-40"><Camera size={16} />{takingPhoto ? '相机中...' : photos.length ? '继续拍照' : '拍照'}</button>
          <button onClick={() => inputRef.current?.click()} disabled={recognizing || addingPhotos || takingPhoto || saving || photos.length >= MAX_VOCAB_PHOTOS} className="btn-ghost flex items-center justify-center gap-2 disabled:opacity-40"><ImagePlus size={16} />{addingPhotos ? '读取中...' : '相册多选'}</button>
        </div>
        {photos.length > 0 && <>
          <p role="status" className="text-xs text-zinc-500">已处理 {photos.filter(photo => photo.status === 'success' || photo.status === 'error').length}/{photos.length} 张 · 成功 {photos.filter(photo => photo.status === 'success').length} · 失败 {photos.filter(photo => photo.status === 'error').length}</p>
          <button onClick={() => void runRecognition()} disabled={recognizing || addingPhotos || takingPhoto || saving || !photos.some(photo => photo.status === 'ready')} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40">{recognizing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{recognizing ? '识别中...' : '开始识别'}</button>
          <button onClick={clearPhotoBatch} disabled={recognizing || addingPhotos || takingPhoto || saving} className="text-xs text-zinc-400 w-full disabled:opacity-40">清空本批 / 重新选图</button>
        </>}
      </div>

    </>}
    {((mode === 'batch' && activeDrafts.length > 0) || (mode === 'scan' && (photos.length > 0 || activeDrafts.length > 0))) && <div className="space-y-3">
      {activeDrafts.length > 0 && <>
        <div data-testid="vocab-result-stats" className="card !p-3 grid grid-cols-4 gap-1 text-center"><Stat value={stats.total} label={mode === 'scan' ? '去重后词条' : '词条数'} /><Stat value={stats.selected} label="已选可添加" /><Stat value={stats.duplicates} label="本中已有" /><Stat value={stats.unresolved} label="待修改" /></div>
        {mode === 'scan' && <p role="status" className="text-xs text-zinc-500">{stats.crossPhotoDuplicates > 0 ? `跨照片重复已合并 ${stats.crossPhotoDuplicates} 项；` : '跨照片按单词或短语自动去重；'}同一词条只添加一次，本中已有词条不重复添加。</p>}
        {mode === 'scan' && photos.some(photo => photo.status === 'error') && <p className="text-xs text-amber-600">有照片识别失败，可以单独重试；现在保存只会包含已取得的词条。</p>}
        {saveButton('top')}
      </>}
      {activeDrafts.length > 0 && <p className="text-[11px] text-zinc-400">先核对单词和释义，点击“展开详情”修改资料；翻页保留修改和勾选，添加按钮保存全部页面的已选词条。</p>}
      <div data-vocab-list-start />
      <VocabPager page={draftPage} total={activeDrafts.length} size={DRAFT_PAGE_SIZE} onChange={setDraftPage} disabled={saving || recognizing || batchLoading} label="识别结果分页" />
      {activeDrafts.slice(draftPage * DRAFT_PAGE_SIZE, (draftPage + 1) * DRAFT_PAGE_SIZE).map(item => <DraftRow key={item.id} item={item} disabled={saving || (mode === 'batch' && batchLoading) || (mode === 'scan' && recognizing)} sourceLabel={mode === 'scan' && item.sourcePhotoIds?.length ? `来自照片 ${item.sourcePhotoIds.map(id => photos.findIndex(photo => photo.id === id) + 1).filter(index => index > 0).sort((a, b) => a - b).join('、')}` : undefined} onChange={editDraft} onWordChange={changeDraftWord} onLookup={refreshDraft} onDelete={deleteDraft} />)}
      <VocabPager page={draftPage} total={activeDrafts.length} size={DRAFT_PAGE_SIZE} onChange={setDraftPage} disabled={saving || recognizing || batchLoading} label="识别结果分页" />
      <button onClick={() => { setActiveDrafts(current => [...current, emptyDraft()]); setDraftPage(Math.floor(activeDrafts.length / DRAFT_PAGE_SIZE)) }} disabled={loading || saving || batchLoading || recognizing} className="btn-ghost w-full flex items-center justify-center gap-1"><Plus size={15} />手动增加一行</button>
      {activeDrafts.length > 0 && saveButton('bottom')}
    </div>}
    {previewPhoto && photos.some(photo => photo.id === previewPhoto) && <div role="dialog" aria-modal="true" aria-label="照片原图" onClick={() => setPreviewPhoto(null)} onKeyDown={event => { if (event.key === 'Escape') setPreviewPhoto(null) }} className="fixed inset-0 z-[100] bg-black/90 p-4 flex items-center justify-center">
      <button autoFocus aria-label="关闭照片预览" onClick={() => setPreviewPhoto(null)} className="absolute top-5 right-5 p-2 text-white bg-black/60 rounded-full"><X size={24} /></button>
      <img src={`data:${photos.find(photo => photo.id === previewPhoto)!.mimeType};base64,${photos.find(photo => photo.id === previewPhoto)!.base64}`} alt="照片原图" onClick={event => event.stopPropagation()} className="max-w-full max-h-[85vh] object-contain" />
    </div>}
  </div>
}

const DraftRow = memo(function DraftRow({ item, onChange, onWordChange, onLookup, onDelete, disabled, sourceLabel }: {
  item: DraftWord; onChange: (item: DraftWord) => void; onWordChange: (item: DraftWord, value: string) => void
  onLookup: (item: DraftWord) => Promise<void>; onDelete: (id: string) => void; disabled: boolean; sourceLabel?: string
}) {
  return <EditableWord item={item} allowSelect disabled={disabled} sourceLabel={sourceLabel} onChange={onChange}
    onWordChange={value => onWordChange(item, value)} onLookup={() => void onLookup(item)} onDelete={() => onDelete(item.id)} />
})

function EditableWord({ item, onChange, onWordChange, onLookup, onDelete, allowSelect, disabled = false, sourceLabel }: {
  item: DraftWord; onChange: (item: DraftWord) => void; onWordChange: (word: string) => void
  onLookup: () => void; onDelete?: () => void; allowSelect: boolean; disabled?: boolean; sourceLabel?: string
}) {
  const source = item.source === 'dictionary' ? '词库释义' : item.source === 'ai' ? 'AI 补全' : '待修改'
  const isPhrase = item.word.trim().split(/\s+/).length > 1
  const busy = item.lookupState === 'loading'
  const [expanded, setExpanded] = useState(!allowSelect || !item.word)
  useEffect(() => { if (item.lookupError) setExpanded(true) }, [item.lookupError])
  return <div data-testid="vocab-draft" className={clsx('card !p-4 space-y-3', item.duplicate && 'opacity-60')}>
    {sourceLabel && <p className="text-[10px] text-zinc-400">{sourceLabel}</p>}
    <div className="flex items-center gap-2">
      {allowSelect && <button aria-label="选择此单词" aria-pressed={item.selected} onClick={() => onChange({ ...item, selected: !item.selected })} disabled={disabled || item.duplicate || pendingLookup(item)} className={clsx('w-5 h-5 rounded border flex items-center justify-center shrink-0', item.selected ? 'bg-brand-500 border-brand-500 text-white' : 'border-zinc-300')}>{item.selected && <Check size={13} />}</button>}
      <input aria-label="英文单词或短语" value={item.word} disabled={disabled} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        onChange={event => onWordChange(event.target.value)}
        onBlur={event => { if (item.lookupState === 'dirty' && !(event.relatedTarget as HTMLElement | null)?.closest('[data-lookup-retry]')) onLookup() }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur() } }}
        className="input !py-2 font-semibold flex-1 min-w-0" placeholder="英文单词或短语" />
      {onDelete && <button aria-label="删除此行" onClick={onDelete} disabled={disabled} className="p-1.5 text-zinc-400 hover:text-red-500"><Trash2 size={15} /></button>}
    </div>
    <div className="flex items-center justify-between gap-2">
      <span className={clsx('text-[10px] px-2 py-1 rounded-full', item.source === 'dictionary' ? 'bg-emerald-50 text-emerald-600' : item.source === 'ai' ? 'bg-violet-50 text-violet-600' : 'bg-amber-50 text-amber-600')}>{item.duplicate ? '已存在' : isPhrase ? '短语' : source}</span>
      <button data-lookup-retry type="button" onClick={onLookup} disabled={disabled || busy || !item.word.trim()} className="text-xs text-brand-600 flex items-center gap-1 disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}{busy ? '查询中...' : '重新查询'}</button>
    </div>
    {item.lookupState === 'dirty' && <p className="text-[11px] text-zinc-400">改完单词后点击其他位置，将自动更新资料。</p>}
    {item.lookupError && <p role="alert" className="text-xs text-red-500">{item.lookupError}。可重新查询或手动填写资料。</p>}
    {!expanded && <div className="space-y-1"><p className="text-sm text-zinc-600 dark:text-zinc-300 break-words">{item.translation || (busy ? '正在查询释义…' : '暂无释义，请展开补充')}</p>{item.phonetic && !isPhrase && <p className="text-[11px] text-zinc-400">{item.phonetic}</p>}</div>}
    {allowSelect && <button type="button" aria-label={expanded ? '收起单词详情' : '展开单词详情'} aria-expanded={expanded} disabled={disabled} onClick={() => setExpanded(value => !value)} className="text-xs text-brand-600 disabled:opacity-40">{expanded ? '收起详情' : '展开详情 / 编辑'}</button>}
    {expanded && <fieldset disabled={disabled || pendingLookup(item)} className="space-y-3 min-w-0">
    {!isPhrase && <div className="grid grid-cols-2 gap-2"><div><label className="text-[10px] text-zinc-400 block mb-1">音标</label><input value={item.phonetic} onChange={event => onChange({ ...item, phonetic: event.target.value })} className="input !py-2 text-xs" placeholder="音标" /></div><div><label className="text-[10px] text-zinc-400 block mb-1">词性</label><input value={item.pos} onChange={event => onChange({ ...item, pos: event.target.value })} className="input !py-2 text-xs" placeholder="词性" /></div></div>}
    <div><label className="text-[10px] text-zinc-400 block mb-1">{isPhrase ? '短语意思' : '中文释义'}</label><textarea value={item.translation} onChange={event => onChange({ ...item, translation: event.target.value, selected: Boolean(event.target.value.trim()) && !item.duplicate })} className="input min-h-16 text-sm" placeholder={isPhrase ? '请填写短语的中文意思' : '请填写中文释义'} /></div>
    {!isPhrase && <><div><label className="text-[10px] text-zinc-400 block mb-1">标签（空格分隔）</label><input value={item.tags.join(' ')} onChange={event => onChange({ ...item, tags: event.target.value.split(/\s+/).filter(Boolean) })} className="input !py-2 text-xs" placeholder="例如：gk cet4 ielts" /><div className="flex flex-wrap gap-1 mt-1">{item.tags.map(tag => <span key={tag} className="text-[10px] px-2 py-0.5 bg-brand-50 dark:bg-brand-950 text-brand-600 rounded">{TAG_LABELS[tag] ?? tag}</span>)}</div></div><div><label className="text-[10px] text-zinc-400 block mb-1">词形变化</label><input value={item.exchange} onChange={event => onChange({ ...item, exchange: event.target.value })} className="input !py-2 text-xs" placeholder="暂无词形变化" /></div></>}
    </fieldset>}
  </div>
}

function Stat({ value, label }: { value: number; label: string }) { return <div><p className="text-sm font-bold">{value}</p><p className="text-[10px] text-zinc-400">{label}</p></div> }
function emptyDraft(): DraftWord { return { id: `${Date.now()}-${Math.random()}`, word: '', phonetic: '', translation: '', pos: '', source: 'unresolved', tags: [], exchange: '', selected: false, duplicate: false, lookupState: 'idle' } }
function createCard(ownerId: number, item: DraftWord): VocabCard { return { ownerId, word: wordKey(item.word), translation: item.translation.trim(), phonetic: item.phonetic.trim(), partOfSpeech: item.pos.trim(), tags: item.tags, exchange: item.exchange.trim(), source: item.source === 'unresolved' ? 'manual' : item.source, due: new Date(), stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0, createdAt: new Date().toISOString() } }
