import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getCurrentOwnerId } from '../db'
import { createNotebook } from '../lib/vocabNotebooks'

export function VocabNotebookSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const ownerId = getCurrentOwnerId()
  const books = useLiveQuery(() => db.vocabNotebooks.where('ownerId').equals(ownerId).toArray(), [ownerId])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const create = async () => {
    setSaving(true); setError('')
    try { const book = await createNotebook(ownerId, name); onChange(book.id); setCreating(false); setName('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '创建失败') }
    finally { setSaving(false) }
  }
  return <div className="card !p-4 space-y-3">
    <label className="block text-xs font-medium text-zinc-500" htmlFor="target-notebook">保存到单词本</label>
    <div className="flex gap-2"><select id="target-notebook" className="input flex-1 min-w-0" value={value} onChange={e => onChange(e.target.value)}><option value="">未分组</option>{books?.map(book => <option key={book.id} value={book.id}>{book.name}</option>)}</select><button className="btn-ghost shrink-0" onClick={() => setCreating(!creating)}>新建</button></div>
    {creating && <div className="flex gap-2"><input aria-label="新单词本名称" className="input min-w-0 flex-1" placeholder="例如：课本Unit 1" maxLength={40} value={name} onChange={e => setName(e.target.value)} /><button disabled={saving || !name.trim()} className="btn-primary disabled:opacity-50" onClick={() => void create()}>创建</button></div>}
    {error && <p className="text-xs text-red-500">{error}</p>}
  </div>
}
