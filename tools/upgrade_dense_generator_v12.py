#!/usr/bin/env python3
"""Upgrade generator-v12.js to use solvable, density-targeted down slots."""

from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "generator-v12.js"
source = PATH.read_text(encoding="utf-8")

start = source.index("function buildDenseLayout")
end = source.index("function verticalCandidates", start)

replacement = r'''function buildDenseLayout(N, lexicon, random) {
  const candidates = [];
  for (let period = 4; period <= Math.min(7, N - 1); period++) {
    for (let shift = 1; shift < period; shift++) {
      for (let offset = 0; offset < period; offset++) {
        const clue = Array.from({ length: N }, (_, r) =>
          Array.from({ length: N }, (_, c) => c === 0 || (r + shift * c + offset) % period === 0)
        );
        let across = [];
        let down = [];
        let acrossCovered = new Set();
        for (let pass = 0; pass < 10; pass++) {
          across = [];
          down = [];
          acrossCovered = new Set();
          for (let r = 0; r < N; r++) {
            for (let c = 0; c < N; c++) {
              if (!clue[r][c]) continue;
              let answer = [];
              for (let cc = c + 1; cc < N && !clue[r][cc]; cc++) answer.push({ r, c: cc });
              if (answer.length >= 3 && lexicon.byLen.has(answer.length) && lexicon.byLen.get(answer.length).length >= 25) {
                across.push({ dir: 'across', clueCell: { r, c }, answer, length: answer.length });
                answer.forEach(point => acrossCovered.add(keyOf(point)));
              }
              answer = [];
              for (let rr = r + 1; rr < N && !clue[rr][c]; rr++) answer.push({ r: rr, c });
              if (answer.length >= 3 && lexicon.byLen.has(answer.length) && lexicon.byLen.get(answer.length).length >= 25) {
                down.push({ dir: 'down', clueCell: { r, c }, answer, length: answer.length });
              }
            }
          }
          const uncovered = [];
          for (let r = 0; r < N; r++) {
            for (let c = 0; c < N; c++) {
              if (!clue[r][c] && !acrossCovered.has(`${r},${c}`)) uncovered.push({ r, c });
            }
          }
          if (!uncovered.length) break;
          for (const point of uncovered) clue[point.r][point.c] = true;
        }

        const cells = Array.from({ length: N }, (_, r) =>
          Array.from({ length: N }, (_, c) =>
            clue[r][c]
              ? { kind: 'clue', entries: [] }
              : { kind: 'answer', entries: [], solution: '', fillCount: 0 }
          )
        );
        const answerCells = N * N - clue.flat().filter(Boolean).length;
        if (!answerCells || acrossCovered.size !== answerCells) continue;
        const allMembership = new Map();
        for (const slot of [...across, ...down]) {
          for (const point of slot.answer) {
            const key = keyOf(point);
            allMembership.set(key, (allMembership.get(key) || 0) + 1);
          }
        }
        const potentialCrossings = [...allMembership.values()].filter(count => count > 1).length;
        const potentialRate = potentialCrossings / answerCells;
        if (across.length >= Math.max(7, N - 2) && down.length >= Math.max(8, N - 3)) {
          const clueCells = N * N - answerCells;
          const score = potentialRate * 230 + potentialCrossings * 1.15 + (across.length + down.length) * 1.5 - clueCells * 0.12 + random() * 6;
          candidates.push({ layout: { cells, slots: across }, down, score, potentialRate });
        }
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return null;
  return candidates[Math.floor(random() * Math.min(10, candidates.length))];
}

function selectDenseDownSlots(layout, downSlots, N, difficulty, random) {
  const cellToAcross = new Map();
  layout.slots.forEach((slot, index) => slot.answer.forEach(point => cellToAcross.set(keyOf(point), index)));
  const answerCells = layout.cells.flat().filter(cell => cell.kind === 'answer').length;
  const targetRate = N >= 13 ? 0.56 : 0.52;
  const targetCells = Math.ceil(answerCells * targetRate);
  const maximumSlots = Math.max(N, Math.round(N * 2.35));
  const maxHits = difficulty === 'hard' ? 5 : 4;
  const acrossHits = Array(layout.slots.length).fill(0);
  const selected = [];
  const covered = new Set();

  while (selected.length < maximumSlots && covered.size < targetCells) {
    let best = null;
    for (const slot of downSlots) {
      if (selected.includes(slot)) continue;
      const affected = [...new Set(slot.answer.map(point => cellToAcross.get(keyOf(point))).filter(Number.isInteger))];
      if (affected.length < 2 || affected.some(index => acrossHits[index] >= maxHits)) continue;
      const freshCells = slot.answer.filter(point => !covered.has(keyOf(point))).length;
      if (!freshCells) continue;
      const untouched = affected.filter(index => acrossHits[index] === 0).length;
      const balanced = affected.filter(index => acrossHits[index] === 1).length;
      const overloaded = affected.filter(index => acrossHits[index] >= 3).length;
      const score = freshCells * 12 + untouched * 9 + balanced * 4 - overloaded * 7 + slot.length * 1.5 + random() * 5;
      if (!best || score > best.score) best = { slot, affected, score };
    }
    if (!best) break;
    selected.push(best.slot);
    best.slot.answer.forEach(point => covered.add(keyOf(point)));
    best.affected.forEach(index => acrossHits[index]++);
  }
  return selected;
}

'''

source = source[:start] + replacement + source[end:]
source = source.replace(
    "const totalBudget = N >= 15 ? 9000 : N >= 13 ? 7000 : N >= 11 ? 5200 : 4200;",
    "const totalBudget = N >= 15 ? 15000 : N >= 13 ? 9000 : N >= 11 ? 6500 : 4800;",
)
source = source.replace(
    "const maxAttempts = N >= 15 ? 44 : N >= 13 ? 40 : 34;",
    "const maxAttempts = N >= 15 ? 58 : N >= 13 ? 48 : 38;",
)
source = source.replace(
    "const perAttempt = N >= 15 ? 2100 : N >= 13 ? 1750 : N >= 11 ? 1350 : 1050;\n    const puzzle = solveLayout(\n      dense.layout,\n      dense.down,",
    "const selectedDown = selectDenseDownSlots(dense.layout, dense.down, N, difficulty, random);\n    if (selectedDown.length < Math.max(6, N - 3)) continue;\n    const perAttempt = N >= 15 ? 3200 : N >= 13 ? 2300 : N >= 11 ? 1700 : 1200;\n    const puzzle = solveLayout(\n      dense.layout,\n      selectedDown,",
)
source = source.replace(
    "if (puzzle.crossingRate >= targetRate && puzzle.verticalCount >= Math.max(8, N - 2)) {",
    "if (puzzle.crossingRate >= targetRate && puzzle.verticalCount >= Math.max(8, N - 3)) {",
)

PATH.write_text(source, encoding="utf-8")
print("generator-v12.js upgraded")
