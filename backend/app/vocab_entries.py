"""Normalize vocabulary notation without dropping somebody/something patterns."""
import re
import unicodedata


def normalize_vocab_entry(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).translate(str.maketrans({
        "’": "'", "‘": "'", "ʼ": "'", "–": "-", "—": "-", "…": "...",
    }))
    return re.sub(r"\s+", " ", value).strip().lower()


def valid_vocab_entry(value: str) -> bool:
    # Dots in sb./sth., apostrophes, optional (not)/(be), and alternatives sb./sth.
    # are vocabulary notation, not a reason to silently drop the entire phrase.
    return bool(re.fullmatch(r"[a-z(][a-z' .()/\-]{0,99}", value) and re.search(r"[a-z]", value))


def clean_vocab_entries(values: list, limit: int = 80) -> list[str]:
    output = []
    seen = set()
    for value in values[:100]:
        if not isinstance(value, str):
            continue
        entry = normalize_vocab_entry(value)
        if valid_vocab_entry(entry) and entry not in seen:
            output.append(entry)
            seen.add(entry)
        if len(output) >= limit:
            break
    return output
