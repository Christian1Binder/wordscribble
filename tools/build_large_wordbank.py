#!/usr/bin/env python3
"""Build the 15,000-entry German WordScribble question bank.

The existing editorial WordScribble questions are preserved. Additional
question-answer combinations are created from synonym groups in the current
OpenThesaurus text export and ranked with the FrequencyWords German list.
Both data sources are openly licensed and documented in DATA_SOURCES.md.
"""

from __future__ import annotations

import io
import json
import re
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ("easy", "medium", "hard")
TARGET_COMBINATIONS = 15_000
TARGET_UNIQUE = 12_000
OPENTHESAURUS_URL = "https://www.openthesaurus.de/export/OpenThesaurus-Textversion.zip"
FREQUENCY_URL = (
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/"
    "master/content/2018/de/de_50k.txt"
)
USER_AGENT = "WordScribble/0.12 (word-bank builder; GitHub Pages project)"
SPACE = re.compile(r"\s+")
TRAILING_TAG = re.compile(r"\s+(?:\([^)]{1,35}\)|\[[^]]{1,35}\])\s*$")
LEADING_ARTICLE = re.compile(r"^\s*\((?:der|die|das)\)\s*", re.IGNORECASE)
INVALID_TERM = re.compile(r"[\s\-–—/'’.:,;!?+&@0-9]")


def request(url: str):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=120
    )


def normalize_word(value: object) -> str:
    text = str(value or "").strip().upper()
    text = (
        text.replace("Ä", "AE")
        .replace("Ö", "OE")
        .replace("Ü", "UE")
        .replace("ẞ", "SS")
        .replace("ß", "SS")
    )
    return re.sub(r"[^A-Z]", "", text)


def clean_surface(value: object) -> str:
    text = str(value or "").replace("_", " ").strip()
    text = LEADING_ARTICLE.sub("", text)
    while True:
        cleaned = TRAILING_TAG.sub("", text).strip()
        if cleaned == text:
            break
        text = cleaned
    text = SPACE.sub(" ", text).strip(" .")
    if not text or INVALID_TERM.search(text):
        return ""
    word = normalize_word(text)
    if not 3 <= len(word) <= 14:
        return ""
    # Reject strings whose normalization removed more than umlaut/ß expansion.
    letters = re.sub(r"[^A-Za-zÄÖÜäöüßẞ]", "", text)
    if not letters or abs(len(word) - len(letters)) > 3:
        return ""
    return text


def read_curated() -> tuple[dict[str, list[list[str]]], set[tuple[str, str]], set[str]]:
    output: dict[str, list[list[str]]] = {level: [] for level in LEVELS}
    seen_pairs: set[tuple[str, str]] = set()
    words: set[str] = set()
    for level in LEVELS:
        path = ROOT / f"words-{level}.json"
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for item in data:
            if not isinstance(item, list) or len(item) < 2:
                continue
            word = normalize_word(item[0])
            clue = SPACE.sub(" ", str(item[1]).strip())
            pair = (word, clue)
            if 3 <= len(word) <= 14 and clue and pair not in seen_pairs:
                output[level].append([word, clue])
                seen_pairs.add(pair)
                words.add(word)
    return output, seen_pairs, words


def load_frequency() -> dict[str, int]:
    ranks: dict[str, int] = {}
    with request(FREQUENCY_URL) as response:
        for rank, raw in enumerate(response, start=1):
            try:
                surface = raw.decode("utf-8").split(" ", 1)[0].strip()
            except UnicodeDecodeError:
                continue
            cleaned = clean_surface(surface)
            if not cleaned:
                continue
            ranks.setdefault(normalize_word(cleaned), rank)
    if len(ranks) < 20_000:
        raise RuntimeError(f"Frequency list unexpectedly small: {len(ranks)}")
    return ranks


def load_synonym_groups() -> list[list[tuple[str, str]]]:
    with request(OPENTHESAURUS_URL) as response:
        payload = response.read()
    if len(payload) < 500_000:
        raise RuntimeError("OpenThesaurus download is unexpectedly small")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".txt")]
        if not names:
            raise RuntimeError("No text file found in OpenThesaurus archive")
        raw = archive.read(names[0])
    text = raw.decode("utf-8-sig", errors="replace")
    groups: list[list[tuple[str, str]]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        terms: list[tuple[str, str]] = []
        seen: set[str] = set()
        for raw_term in line.split(";"):
            surface = clean_surface(raw_term)
            if not surface:
                continue
            word = normalize_word(surface)
            if word in seen:
                continue
            seen.add(word)
            terms.append((word, surface))
        if len(terms) >= 2:
            groups.append(terms)
    if len(groups) < 10_000:
        raise RuntimeError(f"Too few usable synonym groups: {len(groups)}")
    return groups


def classify(word: str, clue_word: str, ranks: dict[str, int]) -> str:
    rank = ranks.get(word, 999_999)
    clue_rank = ranks.get(clue_word, 999_999)
    length = len(word)
    if rank <= 12_000 and clue_rank <= 20_000 and length <= 8:
        return "easy"
    if rank <= 45_000 and length <= 11:
        return "medium"
    return "hard"


def question_for(surface: str, variant: int) -> str:
    if variant == 0:
        return f"Anderes Wort für „{surface}“?"
    if variant == 1:
        return f"Welcher Ausdruck bedeutet auch „{surface}“?"
    return f"Synonym zu „{surface}“?"


def build() -> tuple[dict[str, list[list[str]]], dict[str, int]]:
    output, seen_pairs, selected_words = read_curated()
    ranks = load_frequency()
    groups = load_synonym_groups()

    candidates: dict[str, list[tuple[str, str, int]]] = defaultdict(list)
    for group in groups:
        ordered = sorted(group, key=lambda item: (ranks.get(item[0], 999_999), len(item[0]), item[0]))
        for answer_word, _answer_surface in ordered:
            for synonym_word, synonym_surface in ordered:
                if synonym_word == answer_word:
                    continue
                if all(existing[0] != synonym_word for existing in candidates[answer_word]):
                    candidates[answer_word].append((synonym_word, synonym_surface, ranks.get(synonym_word, 999_999)))
                if len(candidates[answer_word]) >= 8:
                    break

    ranked_answers = sorted(
        candidates,
        key=lambda word: (
            word in selected_words,
            ranks.get(word, 999_999),
            len(word),
            word,
        ),
    )

    additions: list[tuple[str, list[str], int, int]] = []

    # First pass: maximize the number of distinct answer words.
    for answer_word in ranked_answers:
        if len(selected_words) >= TARGET_UNIQUE:
            break
        if answer_word in selected_words or not candidates[answer_word]:
            continue
        synonym_word, synonym_surface, synonym_rank = candidates[answer_word][0]
        clue = question_for(synonym_surface, 0)
        pair = (answer_word, clue)
        if pair in seen_pairs:
            continue
        level = classify(answer_word, synonym_word, ranks)
        additions.append((level, [answer_word, clue], ranks.get(answer_word, 999_999), synonym_rank))
        seen_pairs.add(pair)
        selected_words.add(answer_word)

    if len(selected_words) < TARGET_UNIQUE:
        raise RuntimeError(
            f"Only {len(selected_words)} distinct answer words could be built; "
            f"required {TARGET_UNIQUE}"
        )

    # Second pass: add alternative synonym clues until exactly 15,000 pairs exist.
    for variant in (0, 1, 2):
        if len(seen_pairs) >= TARGET_COMBINATIONS:
            break
        for answer_word in ranked_answers:
            if len(seen_pairs) >= TARGET_COMBINATIONS:
                break
            for synonym_word, synonym_surface, synonym_rank in candidates[answer_word][1 if variant == 0 else 0 :]:
                clue = question_for(synonym_surface, variant)
                pair = (answer_word, clue)
                if pair in seen_pairs:
                    continue
                level = classify(answer_word, synonym_word, ranks)
                additions.append((level, [answer_word, clue], ranks.get(answer_word, 999_999), synonym_rank))
                seen_pairs.add(pair)
                if len(seen_pairs) >= TARGET_COMBINATIONS:
                    break

    if len(seen_pairs) < TARGET_COMBINATIONS:
        raise RuntimeError(
            f"Only {len(seen_pairs)} question-answer combinations could be built; "
            f"required {TARGET_COMBINATIONS}"
        )

    # Keep the original entries and select the strongest additions deterministically.
    original_count = sum(len(entries) for entries in output.values())
    budget = TARGET_COMBINATIONS - original_count
    additions.sort(key=lambda item: (item[2], item[3], len(item[1][0]), item[1][0], item[1][1]))
    for level, pair, _rank, _synonym_rank in additions[:budget]:
        output[level].append(pair)

    for level in LEVELS:
        output[level].sort(key=lambda item: (len(item[0]), item[0], item[1]))

    combinations = sum(len(entries) for entries in output.values())
    unique_words = {item[0] for entries in output.values() for item in entries}
    if combinations != TARGET_COMBINATIONS:
        raise RuntimeError(f"Generated {combinations} combinations instead of {TARGET_COMBINATIONS}")

    stats = {
        "combinations": combinations,
        "unique_words": len(unique_words),
        "easy_combinations": len(output["easy"]),
        "medium_combinations": len(output["medium"]),
        "hard_combinations": len(output["hard"]),
        "source": "WordScribble + OpenThesaurus + FrequencyWords",
    }
    return output, stats


def main() -> None:
    output, stats = build()
    for level in LEVELS:
        (ROOT / f"words-{level}.json").write_text(
            json.dumps(output[level], ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
    (ROOT / "wordlist-stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Word-bank build failed: {exc}", file=sys.stderr)
        raise
