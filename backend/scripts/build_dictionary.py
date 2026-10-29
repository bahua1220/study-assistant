"""Build a compact read-only SQLite dictionary from ECDICT's CSV export."""
from __future__ import annotations

import csv
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "dictionary_source" / "ecdict.csv"
TARGET = ROOT / "data" / "dictionary.db"
WORD_RE = re.compile(r"^[A-Za-z][A-Za-z' -]{0,59}$")
EXAM_TAGS = {"zk", "gk", "cet4", "cet6", "ky", "ielts", "toefl", "gre"}
FREQUENCY_LIMIT = 45_000


def should_keep(row: dict[str, str]) -> bool:
    word = (row.get("word") or "").strip()
    translation = (row.get("translation") or "").strip()
    if not translation or not WORD_RE.fullmatch(word):
        return False
    tags = set((row.get("tag") or "").split())
    try:
        bnc = int(row.get("bnc") or 0)
    except ValueError:
        bnc = 0
    try:
        frq = int(row.get("frq") or 0)
    except ValueError:
        frq = 0
    return bool(tags & EXAM_TAGS) or 0 < bnc <= FREQUENCY_LIMIT or 0 < frq <= FREQUENCY_LIMIT


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source file: {SOURCE}")
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.unlink(missing_ok=True)
    conn = sqlite3.connect(TARGET)
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("""
        CREATE TABLE entries (
          word TEXT PRIMARY KEY COLLATE NOCASE,
          phonetic TEXT NOT NULL DEFAULT '',
          translation TEXT NOT NULL DEFAULT '',
          definition TEXT NOT NULL DEFAULT '',
          pos TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '',
          exchange TEXT NOT NULL DEFAULT '',
          bnc INTEGER NOT NULL DEFAULT 0,
          frq INTEGER NOT NULL DEFAULT 0
        ) WITHOUT ROWID
    """)
    kept = 0
    with SOURCE.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        batch: list[tuple[object, ...]] = []
        for row in reader:
            if not should_keep(row):
                continue
            batch.append((
                row["word"].strip().lower(),
                (row.get("phonetic") or "").strip(),
                (row.get("translation") or "").strip(),
                (row.get("definition") or "").strip(),
                (row.get("pos") or "").strip(),
                (row.get("tag") or "").strip(),
                (row.get("exchange") or "").strip(),
                int(row.get("bnc") or 0),
                int(row.get("frq") or 0),
            ))
            if len(batch) >= 2_000:
                conn.executemany("INSERT OR IGNORE INTO entries VALUES (?,?,?,?,?,?,?,?,?)", batch)
                kept += len(batch)
                batch.clear()
        if batch:
            conn.executemany("INSERT OR IGNORE INTO entries VALUES (?,?,?,?,?,?,?,?,?)", batch)
            kept += len(batch)
    conn.execute("CREATE INDEX entries_bnc ON entries(bnc)")
    conn.execute("ANALYZE")
    conn.commit()
    actual = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
    conn.close()
    print(f"Selected {kept:,} rows; wrote {actual:,} unique entries to {TARGET}")


if __name__ == "__main__":
    main()
