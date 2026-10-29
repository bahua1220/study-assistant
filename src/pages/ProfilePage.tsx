import { useEffect, useState } from 'react'
import { useAuth, gradeLabel } from '../context/AuthContext'
import { User, GraduationCap, LogOut, ShieldAlert, CloudUpload, CloudDownload, Loader2, Database } from 'lucide-react'
import { downloadCloudBackup, getBackupStatus, uploadCloudBackup, type CloudBackupStatus } from '../services/api'
import { exportCloudBackup, restoreCloudBackup } from '../lib/cloudBackup'

export function ProfilePage() {
  const { user, logout } = useAuth()
  const [backup, setBackup] = useState<CloudBackupStatus | null>(null)
  const [backupLoading, setBackupLoading] = useState<'status' | 'upload' | 'restore' | null>('status')
  const [backupMessage, setBackupMessage] = useState('')

  useEffect(() => {
    getBackupStatus().then(setBackup).catch(error => setBackupMessage(error instanceof Error ? error.message : '读取云备份状态失败')).finally(() => setBackupLoading(null))
  }, [])

  if (!user) return null

  const createBackup = async () => {
    if (backup?.exists && !window.confirm('新备份会覆盖当前云端备份，确定继续吗？')) return
    setBackupLoading('upload'); setBackupMessage('')
    try {
      const data = await exportCloudBackup()
      const result = await uploadCloudBackup(data)
      setBackup(result); setBackupMessage(`备份成功，共 ${result.itemCount} 条记录`)
    } catch (error) { setBackupMessage(error instanceof Error ? error.message : '备份失败') }
    finally { setBackupLoading(null) }
  }

  const restoreBackup = async () => {
    if (!backup?.exists) return
    if (!window.confirm('恢复会替换此账号在本机的现有学习数据，且不包含试卷原图和错题截图。确定继续吗？')) return
    setBackupLoading('restore'); setBackupMessage('')
    try {
      const result = await downloadCloudBackup()
      if (!result.data) throw new Error('云端备份为空')
      await restoreCloudBackup(result.data, user.username)
      setBackupMessage(`恢复成功，共恢复 ${result.itemCount} 条记录`)
    } catch (error) { setBackupMessage(error instanceof Error ? error.message : '恢复失败，本机数据未改变') }
    finally { setBackupLoading(null) }
  }

  return (
    <div className="p-5 space-y-5">
      <h1 className="text-xl font-bold">我的</h1>

      {/* 用户信息卡片 */}
      <div className="card !p-5 space-y-4">
        {/* 头像 + 用户名 */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-900 flex items-center justify-center text-2xl font-bold text-brand-600 dark:text-brand-400">
            {user.nickname.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-lg font-bold">{user.nickname}</p>
            <p className="text-xs text-zinc-400">@{user.username}</p>
          </div>
        </div>

        {/* 信息列表 */}
        <div className="space-y-1 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-3 py-2.5">
            <User size={18} className="text-zinc-400 shrink-0" />
            <span className="text-sm text-zinc-500">用户名</span>
            <span className="text-sm ml-auto">{user.username}</span>
          </div>
          <div className="flex items-center gap-3 py-2.5">
            <GraduationCap size={18} className="text-zinc-400 shrink-0" />
            <span className="text-sm text-zinc-500">年级</span>
            <span className="text-sm ml-auto font-medium text-brand-600 dark:text-brand-400">
              {gradeLabel(user.grade)}
            </span>
          </div>
        </div>
      </div>

      <div className="card !p-4 space-y-4">
        <div className="flex items-start gap-3">
          <Database size={19} className="text-brand-500 shrink-0 mt-0.5" />
          <div className="flex-1"><p className="text-sm font-semibold">云备份与恢复</p><p className="text-xs text-zinc-400 mt-1">备份打卡、单词、成绩、课程、番茄钟、错题分析文字记录和账户内学习数据。</p></div>
        </div>
        <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2.5">
          {backupLoading === 'status' ? <p className="text-xs text-zinc-400 flex items-center gap-2"><Loader2 size={13} className="animate-spin" />正在读取云端状态</p> : backup?.exists ? <><p className="text-xs font-medium">最近备份：{formatBackupTime(backup.updatedAt)}</p><p className="text-[10px] text-zinc-400 mt-0.5">共 {backup.itemCount} 条记录</p></> : <p className="text-xs text-zinc-400">还没有云端备份</p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => void createBackup()} disabled={Boolean(backupLoading)} className="btn-primary flex items-center justify-center gap-2 disabled:opacity-50">{backupLoading === 'upload' ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />}备份到云端</button>
          <button onClick={() => void restoreBackup()} disabled={Boolean(backupLoading) || !backup?.exists} className="btn-ghost flex items-center justify-center gap-2 disabled:opacity-40">{backupLoading === 'restore' ? <Loader2 size={15} className="animate-spin" /> : <CloudDownload size={15} />}从云端恢复</button>
        </div>
        <p className="text-[10px] text-amber-600 dark:text-amber-400">试卷原图、错题截图暂不上传；恢复操作使用数据库事务，失败时不会清空本机数据。</p>
        {backupMessage && <p className="text-xs text-center text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/40 rounded-lg px-3 py-2">{backupMessage}</p>}
      </div>

      {/* 说明 */}
      <div className="card !p-4 bg-brand-50 dark:bg-brand-950/30 border-brand-200 dark:border-brand-900">
        <div className="flex items-start gap-3">
          <ShieldAlert size={18} className="text-brand-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-brand-700 dark:text-brand-300">年级有什么用？</p>
            <p className="text-xs text-brand-500/70 mt-1">
              你的年级信息会影响作文批改的评分标准，确保反馈适合你的学习阶段。
            </p>
          </div>
        </div>
      </div>

      {/* 退出登录 */}
      <button
        onClick={logout}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 font-medium text-sm hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
      >
        <LogOut size={16} />
        退出登录
      </button>
    </div>
  )
}

function formatBackupTime(value?: string) {
  if (!value) return '未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}
