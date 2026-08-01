'use strict';

const COMMON = 'ETAOINRSULHDGMBFCKWZPVJYXQ';
let cancelled = false;

self.onmessage = event => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (message.type !== 'generate') return;
  cancelled = false;
  try {
    const result = generate(message);
    self.postMessage({ type: 'result', puzzle: result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error && error.message ? error.message : String(error) });
  }
};

function notify(stage, percent, detail = '') {
  self.postMessage({ type: 'progress', stage, percent: Math.max(0, Math.min(100, Math.round(percent))), detail });
}

function clean(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/Ä/g, 'AE')
    .replace(/Ö/g, 'OE')
    .replace(/Ü/g, 'UE')
    .replace(/ẞ|ß/g, 'SS')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z]/g, '');
}

function keyOf(point) {
  return `${point.r},${point.c}`;
}

function shuffle(array, random) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildLexicon(rows, difficulty, avoidWords) {
  const byWord = new Map();
  for (const row of rows || []) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const word = clean(row[0]);
    const clue = String(row[1] || '').trim();
    const level = String(row[2] || 'medium');
    if (word.length < 3 || word.length > 14 || !clue) continue;
    let entry = byWord.get(word);
    if (!entry) {
      entry = { word, clues: [], levels: new Set(), recent: avoidWords.has(word) };
      byWord.set(word, entry);
    }
    if (!entry.clues.includes(clue)) entry.clues.push(clue);
    entry.levels.add(level);
  }
  const words = [...byWord.values()];
  const byLen = new Map();
  const index = new Map();
  for (const entry of words) {
    const len = entry.word.length;
    if (!byLen.has(len)) byLen.set(len, []);
    byLen.get(len).push(entry);
    if (!index.has(len)) index.set(len, Array.from({ length: len }, () => new Map()));
    const positions = index.get(len);
    for (let pos = 0; pos < len; pos++) {
      const char = entry.word[pos];
      if (!positions[pos].has(char)) positions[pos].set(char, []);
      positions[pos].get(char).push(entry);
    }
  }
  for (const list of byLen.values()) {
    list.sort((a, b) => {
      const levelA = a.levels.has(difficulty) ? 0 : 1;
      const levelB = b.levels.has(difficulty) ? 0 : 1;
      return levelA - levelB || Number(a.recent) - Number(b.recent) || a.word.localeCompare(b.word);
    });
  }
  return { words, byLen, index };
}

function partitions(total, lengths, maxParts) {
  const output = [];
  function visit(left, parts) {
    if (parts.length > maxParts) return;
    if (left === 0 && parts.length) {
      output.push(parts.slice());
      return;
    }
    for (const length of lengths) {
      const cost = length + 1;
      if (cost <= left) visit(left - cost, [...parts, length]);
    }
  }
  visit(total, []);
  return output.filter(parts => parts.reduce((sum, length) => sum + length + 1, 0) === total);
}

function buildLayout(N, lexicon, random) {
  const lengths = [...lexicon.byLen.keys()]
    .filter(length => length >= 3 && length <= N - 1 && lexicon.byLen.get(length).length >= Math.max(20, N * 2))
    .sort((a, b) => a - b);
  const maxParts = N >= 13 ? 3 : 2;
  const options = partitions(N, lengths, maxParts);
  if (!options.length) throw new Error('Für diese Rastergröße fehlen passende Wortlängen.');

  const cells = Array.from({ length: N }, () =>
    Array.from({ length: N }, () => ({ kind: 'answer', entries: [], solution: '', fillCount: 0 }))
  );
  const slots = [];
  const usage = new Map(lengths.map(length => [length, 0]));

  for (let r = 0; r < N; r++) {
    const scored = options.map(parts => {
      const diversity = new Set(parts).size;
      const scarcity = parts.reduce((sum, length) => sum + usage.get(length) / Math.max(1, lexicon.byLen.get(length).length), 0);
      const balance = -Math.abs(parts.length - (N >= 13 ? 2.35 : 2));
      return { parts, score: diversity * 4 + balance * 2 - scarcity * 50 + random() * 5 };
    });
    scored.sort((a, b) => b.score - a.score);
    const choice = scored[Math.floor(random() * Math.min(6, scored.length))].parts;
    let c = 0;
    for (const length of choice) {
      cells[r][c] = { kind: 'clue', entries: [] };
      const clueCell = { r, c };
      const answer = [];
      for (let i = 1; i <= length; i++) answer.push({ r, c: c + i });
      slots.push({ dir: 'across', clueCell, answer, length });
      usage.set(length, usage.get(length) + 1);
      c += length + 1;
    }
  }
  return { cells, slots };
}

function buildDenseLayout(N, lexicon, random) {
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

function verticalCandidates(layout, lexicon, N) {
  const output = [];
  for (let r = 0; r < N - 3; r++) {
    for (let c = 0; c < N; c++) {
      if (layout.cells[r][c].kind !== 'clue') continue;
      let length = 0;
      while (r + 1 + length < N && layout.cells[r + 1 + length][c].kind === 'answer') length++;
      if (length >= 3 && lexicon.byLen.has(length) && lexicon.byLen.get(length).length >= 20) {
        output.push({
          dir: 'down',
          clueCell: { r, c },
          answer: Array.from({ length }, (_, i) => ({ r: r + i + 1, c })),
          length,
        });
      }
    }
  }
  return output;
}

function chooseVerticalSlots(layout, candidates, target, difficulty, random) {
  const cellToAcross = new Map();
  layout.slots.forEach((slot, index) => slot.answer.forEach(point => cellToAcross.set(keyOf(point), index)));
  const acrossHits = Array(layout.slots.length).fill(0);
  const occupied = new Set();
  const chosen = [];
  const maxHits = difficulty === 'hard' ? 4 : 3;

  while (chosen.length < target) {
    let best = null;
    for (const slot of candidates) {
      if (chosen.includes(slot) || slot.answer.some(point => occupied.has(keyOf(point)))) continue;
      const affected = [...new Set(slot.answer.map(point => cellToAcross.get(keyOf(point))).filter(Number.isInteger))];
      if (affected.length < 2 || affected.some(index => acrossHits[index] >= maxHits)) continue;
      const fresh = affected.filter(index => acrossHits[index] === 0).length;
      const balanced = affected.filter(index => acrossHits[index] === 1).length;
      const overloaded = affected.filter(index => acrossHits[index] >= 2).length;
      const center = Math.abs(slot.clueCell.c - (layout.cells.length - 1) / 2);
      const score = fresh * 13 + balanced * 6 - overloaded * 4 + slot.length * 2.5 - center * 0.35 + random() * 8;
      if (!best || score > best.score) best = { slot, affected, score };
    }
    if (!best) break;
    chosen.push(best.slot);
    best.slot.answer.forEach(point => occupied.add(keyOf(point)));
    best.affected.forEach(index => acrossHits[index]++);
  }
  return chosen;
}

function prepareIntersections(slots) {
  const membership = new Map();
  slots.forEach((slot, slotIndex) => {
    slot.answer.forEach((point, position) => {
      const key = keyOf(point);
      if (!membership.has(key)) membership.set(key, []);
      membership.get(key).push({ slotIndex, position });
    });
  });
  slots.forEach(slot => {
    slot.degree = 0;
    slot.crossPositions = new Set();
    slot.answer.forEach((point, position) => {
      const count = (membership.get(keyOf(point)) || []).length;
      if (count > 1) {
        slot.degree += count - 1;
        slot.crossPositions.add(position);
      }
    });
  });
}

function solveLayout(layout, verticalSlots, lexicon, difficulty, random, deadline) {
  const slots = [...layout.slots, ...verticalSlots].map((slot, slotId) => ({ ...slot, slotId }));
  prepareIntersections(slots);
  for (const row of layout.cells) {
    for (const cell of row) {
      if (cell.kind === 'answer') {
        cell.solution = '';
        cell.fillCount = 0;
        cell.entries = [];
      } else {
        cell.entries = [];
      }
    }
  }

  const used = new Set();
  const assignments = new Map();
  let steps = 0;

  function patternFor(slot) {
    return slot.answer.map(point => layout.cells[point.r][point.c].solution || '.').join('');
  }

  function candidatePool(slot, pattern) {
    let pool = lexicon.byLen.get(slot.length) || [];
    const positions = lexicon.index.get(slot.length);
    if (positions) {
      for (let pos = 0; pos < pattern.length; pos++) {
        const char = pattern[pos];
        if (char === '.') continue;
        const indexed = positions[pos].get(char) || [];
        if (indexed.length < pool.length) pool = indexed;
      }
    }
    return pool;
  }

  function candidatesFor(slot) {
    const pattern = patternFor(slot);
    const candidates = [];
    for (const entry of candidatePool(slot, pattern)) {
      if (used.has(entry.word)) continue;
      let matches = true;
      for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] !== '.' && pattern[i] !== entry.word[i]) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
      let futureScore = 0;
      for (const position of slot.crossPositions) {
        if (pattern[position] === '.') {
          const rank = COMMON.indexOf(entry.word[position]);
          futureScore += rank < 0 ? 0 : (COMMON.length - rank) / COMMON.length;
        }
      }
      const levelPenalty = entry.levels.has(difficulty) ? 0 : 16;
      const recentPenalty = entry.recent ? 22 : 0;
      candidates.push({ entry, score: levelPenalty + recentPenalty - futureScore * 5 + random() * 3 });
    }
    candidates.sort((a, b) => a.score - b.score);
    const emptyPattern = !pattern.replace(/\./g, '');
    return candidates.slice(0, emptyPattern ? 190 : 145).map(item => item.entry);
  }

  function assign(slot, entry) {
    slot.answer.forEach((point, i) => {
      const cell = layout.cells[point.r][point.c];
      if (!cell.solution) cell.solution = entry.word[i];
      cell.fillCount++;
    });
    used.add(entry.word);
    assignments.set(slot.slotId, entry);
  }

  function undo(slot, entry) {
    slot.answer.forEach(point => {
      const cell = layout.cells[point.r][point.c];
      cell.fillCount--;
      if (cell.fillCount === 0) cell.solution = '';
    });
    used.delete(entry.word);
    assignments.delete(slot.slotId);
  }

  function recurse() {
    steps++;
    if (cancelled || performance.now() > deadline || steps > 180_000) return false;
    if (assignments.size === slots.length) return true;

    let bestSlot = null;
    let bestCandidates = null;
    let bestMetric = Infinity;
    for (const slot of slots) {
      if (assignments.has(slot.slotId)) continue;
      const list = candidatesFor(slot);
      if (!list.length) return false;
      const fixed = slot.answer.reduce((count, point) => count + Number(Boolean(layout.cells[point.r][point.c].solution)), 0);
      const metric = list.length * 10 - fixed * 260 - slot.degree * 95 - (slot.dir === 'down' ? 35 : 0);
      if (metric < bestMetric) {
        bestMetric = metric;
        bestSlot = slot;
        bestCandidates = list;
        if (list.length === 1) break;
      }
    }

    for (const entry of bestCandidates) {
      assign(bestSlot, entry);
      if (recurse()) return true;
      undo(bestSlot, entry);
    }
    return false;
  }

  if (!recurse()) return null;

  const entries = [];
  slots.forEach((slot, id) => {
    const assigned = assignments.get(slot.slotId);
    const clue = assigned.clues[Math.floor(random() * assigned.clues.length)] || assigned.clues[0];
    const entry = {
      id,
      word: assigned.word,
      clue,
      dir: slot.dir,
      clueCell: slot.clueCell,
      answer: slot.answer,
    };
    entries.push(entry);
    layout.cells[slot.clueCell.r][slot.clueCell.c].entries.push(id);
    slot.answer.forEach(point => layout.cells[point.r][point.c].entries.push(id));
  });

  const answerCells = layout.cells.flat().filter(cell => cell.kind === 'answer').length;
  const crossings = layout.cells.flat().filter(cell => cell.kind === 'answer' && cell.entries.length > 1).length;
  return {
    cells: layout.cells,
    entries,
    values: {},
    hints: { letters: 0, words: 0, cells: {} },
    checked: false,
    id: Date.now(),
    generatorVersion: 12,
    crossings,
    crossingRate: answerCells ? crossings / answerCells : 0,
    verticalCount: entries.filter(entry => entry.dir === 'down').length,
    answerCells,
  };
}

function scorePuzzle(puzzle) {
  const dualClues = puzzle.cells.flat().filter(cell => cell.kind === 'clue' && cell.entries.length > 1).length;
  return puzzle.crossings * 18 + puzzle.verticalCount * 12 + dualClues * 7 + puzzle.entries.length * 2 + puzzle.crossingRate * 180;
}

function generate(message) {
  const N = Number(message.size);
  const difficulty = String(message.difficulty || 'medium');
  const seed = Number(message.seed || Date.now());
  const random = mulberry32(seed);
  const avoidWords = new Set((message.avoidWords || []).map(clean));

  notify('Wortschatz', 4, 'Fragen und Begriffe werden nach Wortlänge sortiert');
  const lexicon = buildLexicon(message.rows || [], difficulty, avoidWords);
  if (lexicon.words.length < 500) throw new Error('Der Wortschatz ist zu klein.');

  const totalBudget = N >= 15 ? 15000 : N >= 13 ? 9000 : N >= 11 ? 6500 : 4800;
  const started = performance.now();
  const finalDeadline = started + totalBudget;
  let best = null;
  let bestScore = -Infinity;
  let attempts = 0;
  const maxAttempts = N >= 15 ? 58 : N >= 13 ? 48 : 38;

  notify('Dichtes Grundmuster', 8, 'Waagerechte und senkrechte Wortwege werden gemeinsam geplant');
  while (attempts < maxAttempts && performance.now() < finalDeadline) {
    if (cancelled) throw new Error('Erzeugung abgebrochen.');
    attempts++;
    const elapsed = performance.now() - started;
    const dense = buildDenseLayout(N, lexicon, random);
    if (!dense) continue;
    notify('Kreuzungen', 10 + (elapsed / totalBudget) * 82, `Rastervariante ${attempts} wird mit Wörtern gefüllt`);
    const selectedDown = selectDenseDownSlots(dense.layout, dense.down, N, difficulty, random);
    if (selectedDown.length < Math.max(6, N - 3)) continue;
    const perAttempt = N >= 15 ? 3200 : N >= 13 ? 2300 : N >= 11 ? 1700 : 1200;
    const puzzle = solveLayout(
      dense.layout,
      selectedDown,
      lexicon,
      difficulty,
      random,
      Math.min(finalDeadline, performance.now() + perAttempt)
    );
    if (!puzzle) continue;
    const score = scorePuzzle(puzzle);
    if (score > bestScore) {
      best = puzzle;
      bestScore = score;
      notify('Bestes Raster', 92, `${Math.round(puzzle.crossingRate * 100)} % der Lösungsfelder sind echte Kreuzungen`);
    }
    const targetRate = N >= 13 ? 0.56 : 0.5;
    if (puzzle.crossingRate >= targetRate && puzzle.verticalCount >= Math.max(8, N - 3)) {
      notify('Fertig', 100, `${puzzle.crossings} Kreuzungsfelder und ${puzzle.verticalCount} senkrechte Wörter`);
      return puzzle;
    }
  }

  if (!best) {
    notify('Alternative Anordnung', 93, 'Eine robuste Rastervariante wird aufgebaut');
    const desired = Math.max(6, Math.round(N * 1.05));
    for (let target = desired; target >= 3 && performance.now() < finalDeadline + 2600; target--) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const layout = buildLayout(N, lexicon, random);
        const vertical = chooseVerticalSlots(layout, verticalCandidates(layout, lexicon, N), target, difficulty, random);
        if (vertical.length < Math.min(target, 3)) continue;
        const puzzle = solveLayout(layout, vertical, lexicon, difficulty, random, performance.now() + 900);
        if (!puzzle) continue;
        const score = scorePuzzle(puzzle);
        if (score > bestScore) {
          best = puzzle;
          bestScore = score;
        }
        if (puzzle.crossingRate >= 0.3) break;
      }
      if (best) break;
    }
  }

  if (!best) throw new Error('Es konnte kein gültiges Raster erzeugt werden. Bitte erneut versuchen.');
  notify('Fertig', 100, `${best.crossings} Kreuzungsfelder in der besten Variante`);
  return best;
}
