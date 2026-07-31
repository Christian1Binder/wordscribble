#!/usr/bin/env python3
"""Merge supplemental WordScribble word lists into the three runtime JSON files."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ("easy", "medium", "hard")


def normalize(word: object) -> str:
    text = str(word or "").upper()
    text = text.replace("Ä", "AE").replace("Ö", "OE").replace("Ü", "UE").replace("ß", "SS")
    return re.sub(r"[^A-Z]", "", text)


def read_entries(path: Path) -> list[list[str]]:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    entries: list[list[str]] = []
    for item in data:
        if not isinstance(item, list) or len(item) < 2:
            continue
        word = normalize(item[0])
        clue = str(item[1]).strip()
        if 3 <= len(word) <= 14 and clue:
            entries.append([word, clue])
    return entries


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

    merged.sort(key=lambda item: (len(item[0]), item[0]))
    before = len(read_entries(destination))
    destination.write_text(
        json.dumps(merged, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return before, len(merged)


def main() -> None:
    for level in LEVELS:
        before, after = merge_level(level)
        print(f"{level}: {before} -> {after}")


if __name__ == "__main__":
    main()
