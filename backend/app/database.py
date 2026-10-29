"""SQLite 数据库初始化 — 用户表"""
import sqlite3
import os
from datetime import datetime, timedelta, timezone

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "users.db")


def get_db() -> sqlite3.Connection:
    """获取数据库连接"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    """创建用户表（如果不存在）"""
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            username   TEXT UNIQUE NOT NULL,
            password   TEXT NOT NULL,
            nickname   TEXT DEFAULT '',
            grade      TEXT NOT NULL DEFAULT 'highschool',
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cloud_backups (
            user_id     INTEGER PRIMARY KEY,
            version     INTEGER NOT NULL,
            payload     BLOB NOT NULL,
            item_count  INTEGER NOT NULL DEFAULT 0,
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS qa_jobs (
            id           TEXT PRIMARY KEY,
            user_id      INTEGER NOT NULL,
            status       TEXT NOT NULL DEFAULT 'pending',
            request_json TEXT NOT NULL,
            result       TEXT DEFAULT '',
            error        TEXT DEFAULT '',
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_qa_jobs_user_status ON qa_jobs(user_id, status)")
    # 进程异常退出时正在执行的任务无法继续，将它们恢复为待处理状态。
    conn.execute("UPDATE qa_jobs SET status='pending', updated_at=datetime('now') WHERE status='running'")
    # 清理已完成/失败超过 7 天的答疑任务，防止 qa_jobs 表无限膨胀。
    # updated_at 是 Python 生成的 UTC ISO 字符串，按同格式字符串比较即可。
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    conn.execute("DELETE FROM qa_jobs WHERE status IN ('completed','failed') AND updated_at < ?", (cutoff,))
    conn.commit()
    conn.close()


# 启动时自动初始化
init_db()
