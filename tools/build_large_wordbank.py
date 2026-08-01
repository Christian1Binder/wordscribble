#!/usr/bin/env python3
"""Build a large German crossword bank from curated lists and open data.

The script keeps the hand-written WordScribble entries, ranks additional
lemmas with the FrequencyWords German corpus and obtains German definitions
from the German Wiktionary extract published by kaikki.org.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import shutil
import sys
import tempfile
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ("easy", "medium", "hard")
TARGET_COMBINATIONS = 15_000
TARGET_UNIQUE = 12_000
FREQUENCY_URL = (
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/"
    "master/content/2018/de/de_50k.txt"
)
WIKTIONARY_URL = "https://kaikki.org/dewiktionary/raw-wiktextract-data.jsonl.gz"
USER_AGENT = "WordScribble word-bank builder/1.0"
ALLOWED_POS = {"noun", "verb", "adj", "adv"}
REJECT_TAGS = {
    "abbreviation",
    "archaic",
    "dated",
    "derogatory",
    "form-of",
    "historical",
    "inflection-template",
    "nonstandard",
    "obsolete",
    "offensive",
    "rare",
    "vulgar",
}
REJECT_GLOSS = re.compile(
    r"\b(?:Akkusativ|Dativ|Flexionsform|Genitiv|Konjugierte Form|"
    r"Nominativ|Partizip|Plural|Schreibvariante|Singular|Steigerungsform|"
    r"Worttrennung)\b",
    re.IGNORECASE,
)
MARKUP = re.compile(r"\{\{.*?\}\}|\[\[|\]\]|<[^>]+>|''+")
SPACE = re.compile(r"\s+")


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


def valid_surface_word(value: object) -> bool:
    text = str(value or "").strip()
    if not text or re.search(r"[\s\-–—/'’.0-9]", text):
        return False
    normalized = normalize_word(text)
    return 3 <= len(normalized) <= 14 and len(normalized) >= len(text) - 2


def clean_gloss(value: object) -> str:
    text = str(value or "").strip()
    text = MARKUP.sub("", text)
    text = re.sub(r"^\s*\[[0-9, .–-]+\]\s*", "", text)
    text = re.sub(r"\s*\([^)]*(?:Beispiel|Grammatik|Herkunft)[^)]*\)\s*", " ", text)
    text = SPACE.sub(" ", text).strip(" .;:-")
    if REJECT_GLOSS.search(text):
        return ""
    if len(text) < 12 or len(text) > 180:
        return ""
    if text.count(":") > 2 or "→" in text or "siehe " in text.lower():
        return ""
    return text


def lower_first(text: str) -> str:
    if not text:
        return text
    if len(text) > 1 and text[:2].isupper():
        return text
    return text[0].lower() + text[1:]


def make_question(gloss: str, pos: str, variant: int = 0) -> str:
    gloss = gloss.rstrip(".?!")
    if variant == 1:
        return f"Welcher Ausdruck passt zu dieser Bedeutung: {gloss}?"
    if pos == "verb":
        return f"Welches Verb bedeutet: {gloss}?"
    if pos == "adj":
        return f"Welches Adjektiv bedeutet: {gloss}?"
    if pos == "adv":
        return f"Welches Adverb bedeutet: {gloss}?"
    return f"Wie nennt man {lower_first(gloss)}?"


def request(url: str):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=90
    )


def read_curated() -> tuple[dict[str, list[tuple[str, str]]], set[tuple[str, str]]]:
    by_level: dict[str, list[tuple[str, str]]] = {level: [] for level in LEVELS}
    seen_pairs: set[tuple[str, str]] = set()
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
                by_level[level].append(pair)
                seen_pairs.add(pair)
    return by_level, seen_pairs


def load_frequency() -> dict[str, int]:
    ranks: dict[str, int] = {}
    with request(FREQUENCY_URL) as response:
        for rank, raw in enumerate(response, start=1):
            try:
                surface = raw.decode("utf-8").split(" ", 1)[0].strip()
            except UnicodeDecodeError:
                continue
            if not valid_surface_word(surface):
                continue
            word = normalize_word(surface)
            ranks.setdefault(word, rank)
    if len(ranks) < 20_000:
        raise RuntimeError(f"Frequency list unexpectedly small: {len(ranks)}")
    return ranks


def collect_wiktionary(ranks: dict[str, int]) -> dict[str, dict[str, object]]:
    wanted = set(ranks)
    records: dict[str, dict[str, object]] = {}
    with tempfile.NamedTemporaryFile(suffix=".jsonl.gz", delete=False) as tmp:
        temp_path = Path(tmp.name)
        with request(WIKTIONARY_URL) as response:
            shutil.copyfileobj(response, tmp, length=1024 * 1024)
    try:
        with gzip.open(temp_path, "rt", encoding="utf-8", errors="replace") as stream:
            for line_number, line in enumerate(stream, start=1):
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("lang_code") != "de" or obj.get("pos") not in ALLOWED_POS:
                    continue
                surface = obj.get("word", "")
                if not valid_surface_word(surface):
                    continue
                word = normalize_word(surface)
                if word not in wanted:
                    continue
                pos = str(obj.get("pos"))
                glosses: list[str] = []
                for sense in obj.get("senses") or []:
                    tags = set(sense.get("tags") or [])
                    if tags & REJECT_TAGS or sense.get("form_of") or sense.get("alt_of"):
                        continue
                    candidates = sense.get("glosses") or sense.get("raw_glosses") or []
                    for raw_gloss in candidates:
                        gloss = clean_gloss(raw_gloss)
                        if gloss and gloss not in glosses:
                            glosses.append(gloss)
                        if len(glosses) >= 3:
                            break
                    if len(glosses) >= 3:
                        break
                if not glosses:
                    continue
                record = records.setdefault(
                    word,
                    {"rank": ranks[word], "pos": pos, "glosses": []},
                )
                existing = record["glosses"]
                assert isinstance(existing, list)
                for gloss in glosses:
                    if gloss not in existing:
                        existing.append(gloss)
    finally:
        temp_path.unlink(missing_ok=True)
    return records


def classify(word: str, rank: int, pos: str) -> str:
    length = len(word)
    if rank <= 7_500 and length <= 8 and pos in {"noun", "verb", "adj"}:
        return "easy"
    if rank <= 28_000 and length <= 11:
        return "medium"
    return "hard"


def stable_tiebreak(word: str) -> str:
    return hashlib.sha1(word.encode("utf-8")).hexdigest()


def build() -> tuple[dict[str, list[list[str]]], dict[str, int]]:
    curated, seen_pairs = read_curated()
    ranks = load_frequency()
    records = collect_wiktionary(ranks)

    curated_words = {word for entries in curated.values() for word, _ in entries}
    ordered = sorted(
        records.items(),
        key=lambda item: (int(item[1]["rank"]), stable_tiebreak(item[0])),
    )

    selected: dict[str, tuple[str, dict[str, object]]] = {}
    level_counts = defaultdict(int)
    level_targets = {"easy": 3_500, "medium": 5_000, "hard": 3_500}

    for word, record in ordered:
        if word in curated_words:
            continue
        level = classify(word, int(record["rank"]), str(record["pos"]))
        if level_counts[level] >= level_targets[level]:
            continue
        selected[word] = (level, record)
        level_counts[level] += 1
        if len(selected) + len(curated_words) >= TARGET_UNIQUE:
            break

    # Fill any gaps with the best remaining records, independent of level target.
    if len(selected) + len(curated_words) < TARGET_UNIQUE:
        for word, record in ordered:
            if word in curated_words or word in selected:
                continue
            level = classify(word, int(record["rank"]), str(record["pos"]))
            selected[word] = (level, record)
            if len(selected) + len(curated_words) >= TARGET_UNIQUE:
                break

    output: dict[str, list[list[str]]] = {
        level: [[word, clue] for word, clue in curated[level]] for level in LEVELS
    }
    pairs = set(seen_pairs)

    # One primary question per new lemma maximizes the number of unique answers.
    for word, (level, record) in selected.items():
        glosses = record["glosses"]
        assert isinstance(glosses, list) and glosses
        clue = make_question(str(glosses[0]), str(record["pos"]), 0)
        pair = (word, clue)
        if pair not in pairs:
            output[level].append([word, clue])
            pairs.add(pair)

    # Add genuine additional senses first.
    for word, (level, record) in selected.items():
        glosses = record["glosses"]
        assert isinstance(glosses, list)
        for gloss in glosses[1:]:
            clue = make_question(str(gloss), str(record["pos"]), 0)
            pair = (word, clue)
            if pair not in pairs:
                output[level].append([word, clue])
                pairs.add(pair)
            if len(pairs) >= TARGET_COMBINATIONS:
                break
        if len(pairs) >= TARGET_COMBINATIONS:
            break

    # If Wiktionary exposes only one suitable sense, create a clearly different
    # question form while keeping the same definition.
    if len(pairs) < TARGET_COMBINATIONS:
        for word, (level, record) in selected.items():
            glosses = record["glosses"]
            assert isinstance(glosses, list) and glosses
            clue = make_question(str(glosses[0]), str(record["pos"]), 1)
            pair = (word, clue)
            if pair not in pairs:
                output[level].append([word, clue])
                pairs.add(pair)
            if len(pairs) >= TARGET_COMBINATIONS:
                break

    if len(pairs) < TARGET_COMBINATIONS:
        raise RuntimeError(
            f"Only {len(pairs)} question-answer combinations could be built"
        )

    # Keep exactly the requested number while never removing curated entries.
    curated_pair_count = sum(len(entries) for entries in curated.values())
    remaining_budget = TARGET_COMBINATIONS - curated_pair_count
    trimmed: dict[str, list[list[str]]] = {level: list(output[level][: len(curated[level])]) for level in LEVELS}
    additions = []
    for level in LEVELS:
        additions.extend((level, pair) for pair in output[level][len(curated[level]) :])
    additions.sort(key=lambda item: (len(item[1][0]), item[1][0], item[1][1]))
    for level, pair in additions[:remaining_budget]:
        trimmed[level].append(pair)

    for level in LEVELS:
        trimmed[level].sort(key=lambda item: (len(item[0]), item[0], item[1]))

    unique_words = {item[0] for entries in trimmed.values() for item in entries}
    stats = {
        "combinations": sum(len(entries) for entries in trimmed.values()),
        "unique_words": len(unique_words),
        "easy_combinations": len(trimmed["easy"]),
        "medium_combinations": len(trimmed["medium"]),
        "hard_combinations": len(trimmed["hard"]),
    }
    return trimmed, stats


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
    except Exception as exc:  # Make workflow failures explicit and readable.
        print(f"Word-bank build failed: {exc}", file=sys.stderr)
        raise
