#!/usr/bin/env python3
"""Merge supplemental WordScribble word lists into the three runtime JSON files."""

from __future__ import annotations

import base64
import gzip
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ("easy", "medium", "hard")


def normalize(word: object) -> str:
    text = str(word or "").upper()
    text = text.replace("Ä", "AE").replace("Ö", "OE").replace("Ü", "UE").replace("ß", "SS")
    return re.sub(r"[^A-Z]", "", text)


def normalize_entries(data: object) -> list[list[str]]:
    entries: list[list[str]] = []
    if not isinstance(data, list):
        return entries
    for item in data:
        if not isinstance(item, list) or len(item) < 2:
            continue
        word = normalize(item[0])
        clue = str(item[1]).strip()
        if 3 <= len(word) <= 14 and clue:
            entries.append([word, clue])
    return entries


def read_entries(path: Path) -> list[list[str]]:
    if not path.exists():
        return []
    return normalize_entries(json.loads(path.read_text(encoding="utf-8")))


def read_compressed_entries(level: str) -> list[list[str]]:
    path = ROOT / "tools" / f"words-{level}-extra.json.gz.b64"
    if not path.exists():
        return []
    encoded = "".join(path.read_text(encoding="ascii").split())
    raw = gzip.decompress(base64.b64decode(encoded)).decode("utf-8")
    return normalize_entries(json.loads(raw))


def merge_level(level: str) -> tuple[int, int]:
    destination = ROOT / f"words-{level}.json"
    sources = [destination, *sorted(ROOT.glob(f"words-{level}-extra*.json"))]
    merged: list[list[str]] = []
    seen: set[str] = set()

    for source in sources:
        for word, clue in read_entries(source):
            if word in seen:
                continue
            seen.add(word)
            merged.append([word, clue])

    for word, clue in read_compressed_entries(level):
        if word in seen:
            continue
        seen.add(word)
        merged.append([word, clue])

    merged.sort(key=lambda item: (len(item[0]), item[0]))
    before = len(read_entries(destination))
    destination.write_text(
        json.dumps(merged, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return before, len(merged)


def main() -> None:
    counts: dict[str, int] = {}
    for level in LEVELS:
        before, after = merge_level(level)
        counts[level] = after
        print(f"{level}: {before} -> {after}")

    stats = {
        "easy": counts["easy"],
        "medium": counts["medium"],
        "hard": counts["hard"],
        "total": sum(counts.values()),
    }
    (ROOT / "wordlist-stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
