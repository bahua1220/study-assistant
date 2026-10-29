from __future__ import annotations

import sqlite3
from pathlib import Path
import random

DICTIONARY_PATH = Path(__file__).resolve().parents[1] / "data" / "dictionary.db"

VOCAB_BOOKS = {
    "zk": {"name": "中考核心词汇", "description": "初中阶段常用及中考核心词汇"},
    "gk": {"name": "高考核心词汇", "description": "高中阶段常用及高考核心词汇"},
    "cet4": {"name": "四级核心词汇", "description": "大学英语四级核心词汇"},
    "cet6": {"name": "六级核心词汇", "description": "大学英语六级核心词汇"},
    "ky": {"name": "考研核心词汇", "description": "全国硕士研究生考试核心词汇"},
    "ielts": {"name": "雅思核心词汇", "description": "IELTS 常用核心词汇"},
    "toefl": {"name": "托福核心词汇", "description": "TOEFL 常用核心词汇"},
    "gre": {"name": "GRE核心词汇", "description": "GRE 常用核心词汇"},
}


def _book_where() -> str:
    return "(' ' || tags || ' ') LIKE ?"


def list_vocab_books() -> list[dict[str, object]]:
    if not DICTIONARY_PATH.exists():
        return []
    conn = sqlite3.connect(f"file:{DICTIONARY_PATH}?mode=ro", uri=True)
    try:
        result: list[dict[str, object]] = []
        for book_id, meta in VOCAB_BOOKS.items():
            count = conn.execute(
                f"SELECT COUNT(*) FROM entries WHERE {_book_where()} AND translation <> ''",
                (f"% {book_id} %",),
            ).fetchone()[0]
            result.append({"id": book_id, **meta, "wordCount": int(count)})
        return result
    finally:
        conn.close()


def get_vocab_book_words(book_id: str, offset: int, limit: int, seed: str = "default") -> tuple[list[dict[str, object]], int, bool]:
    """Return a stable shuffled slice so a plan can resume without repeats."""
    if book_id not in VOCAB_BOOKS or not DICTIONARY_PATH.exists():
        return [], offset, True
    conn = sqlite3.connect(f"file:{DICTIONARY_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        # A plan keeps the same seed for its lifetime. This gives it one shuffled order
        # across the whole book while keeping cursor-based resume deterministic.
        rows = conn.execute(
            f"""SELECT word, phonetic, translation, pos, tags, exchange, bnc, frq
                FROM entries
                WHERE {_book_where()} AND translation <> ''
                ORDER BY word""",
            (f"% {book_id} %",),
        ).fetchall()
        rows = list(rows)
        random.Random(f"{book_id}:{seed}").shuffle(rows)
        selected = rows[offset:offset + limit]
        pool = list(rows)
        items: list[dict[str, object]] = []
        for row in selected:
            answer = clean_translation(row["translation"])
            if not answer:
                continue
            row_pos = normalize_pos(row["pos"], row["translation"])
            same_pos = [candidate for candidate in pool if candidate["word"] != row["word"] and normalize_pos(candidate["pos"], candidate["translation"]) == row_pos]
            other_pos = [candidate for candidate in pool if candidate["word"] != row["word"] and normalize_pos(candidate["pos"], candidate["translation"]) != row_pos]
            candidates = same_pos + other_pos
            distractors: list[str] = []
            for candidate in candidates:
                text = clean_translation(candidate["translation"])
                if text and text != answer and text not in distractors:
                    distractors.append(text)
                if len(distractors) == 3:
                    break
            choices = [answer, *distractors]
            random.Random(f"{book_id}:{seed}:{offset}:{row['word']}").shuffle(choices)
            items.append({
                "word": row["word"],
                "phonetic": row["phonetic"],
                "translation": answer,
                "pos": normalize_pos(row["pos"], row["translation"]),
                "tags": row["tags"].split(),
                "exchange": format_exchange(row["exchange"]),
                "choices": choices,
            })
        next_offset = offset + len(selected)
        return items, next_offset, next_offset >= len(rows)
    finally:
        conn.close()


def lookup_words(words: list[str]) -> dict[str, dict[str, object]]:
    normalized = list(dict.fromkeys(word.strip().lower() for word in words if word.strip()))
    if not normalized or not DICTIONARY_PATH.exists():
        return {}
    placeholders = ",".join("?" for _ in normalized)
    conn = sqlite3.connect(f"file:{DICTIONARY_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            f"SELECT word, phonetic, translation, definition, pos, tags, exchange FROM entries WHERE word IN ({placeholders})",
            normalized,
        ).fetchall()
    finally:
        conn.close()
    return {
        row["word"].lower(): {
            "word": row["word"],
            "phonetic": row["phonetic"],
            "translation": clean_translation(row["translation"]),
            "definition": row["definition"],
            "pos": normalize_pos(row["pos"], row["translation"]),
            "tags": row["tags"].split(),
            "exchange": format_exchange(row["exchange"]),
        }
        for row in rows
    }


def format_exchange(value: str) -> str:
    labels = {
        "p": "过去式", "d": "过去分词", "i": "现在分词", "3": "第三人称单数",
        "s": "复数", "r": "比较级", "t": "最高级", "0": "原型", "1": "变形",
    }
    parts: list[str] = []
    for item in value.split("/"):
        if ":" not in item:
            continue
        code, form = item.split(":", 1)
        if form.strip():
            parts.append(f"{labels.get(code, code)}：{form.strip()}")
    return "；".join(parts)
def clean_translation(value: str) -> str:
    lines = [line.strip() for line in value.replace("\\n", "\n").splitlines() if line.strip() and not line.startswith("[网络]")]
    return "；".join(lines[:3])[:500]


def normalize_pos(pos: str, translation: str) -> str:
    if pos:
        best = pos.split("/")[0].split(":")[0]
        return {"n": "noun", "v": "verb", "a": "adjective", "r": "adverb"}.get(best, best)
    prefix = translation.strip().split(".", 1)[0].lower()
    return {
        "n": "noun", "v": "verb", "vt": "verb", "vi": "verb",
        "adj": "adjective", "a": "adjective", "adv": "adverb",
        "prep": "preposition", "conj": "conjunction", "pron": "pronoun",
    }.get(prefix, "")
