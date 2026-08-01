import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const levels = ['easy', 'medium', 'hard'];
const rows = [];
for (const level of levels) {
  const data = JSON.parse(fs.readFileSync(`words-${level}.json`, 'utf8'));
  for (const item of data) rows.push([item[0], item[1], level]);
}

const source = fs.readFileSync('generator-v12.js', 'utf8');
const sizes = [9, 11, 13, 15];
const results = [];

function runGenerator(size, seed) {
  let finalMessage = null;
  const messages = [];
  const selfObject = {
    postMessage(message) {
      messages.push(message);
      if (message.type === 'result' || message.type === 'error') finalMessage = message;
    },
    onmessage: null,
  };
  const context = vm.createContext({
    self: selfObject,
    performance,
    console,
    Set,
    Map,
    Math,
    Date,
    String,
    Number,
    Array,
    Object,
    Boolean,
    RegExp,
    Error,
  });
  vm.runInContext(source, context, { filename: 'generator-v12.js' });
  const started = performance.now();
  selfObject.onmessage({
    data: {
      type: 'generate',
      size,
      difficulty: 'medium',
      rows,
      avoidWords: [],
      seed,
    },
  });
  const elapsedMs = performance.now() - started;
  if (!finalMessage) throw new Error(`No final worker message for ${size}x${size}`);
  if (finalMessage.type === 'error') throw new Error(`${size}x${size}: ${finalMessage.message}`);
  return { puzzle: finalMessage.puzzle, elapsedMs, messages };
}

function validate(size, puzzle) {
  if (puzzle.generatorVersion !== 12) throw new Error(`${size}: wrong generator version`);
  if (!Array.isArray(puzzle.cells) || puzzle.cells.length !== size) throw new Error(`${size}: invalid grid rows`);
  if (!puzzle.cells.every(row => Array.isArray(row) && row.length === size)) throw new Error(`${size}: invalid grid columns`);
  if (!Array.isArray(puzzle.entries) || puzzle.entries.length < size) throw new Error(`${size}: too few entries`);
  const words = puzzle.entries.map(entry => entry.word);
  if (new Set(words).size !== words.length) throw new Error(`${size}: duplicate solution words`);

  let answerCells = 0;
  let crossings = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = puzzle.cells[r][c];
      if (!['answer', 'clue'].includes(cell.kind)) throw new Error(`${size}: invalid cell kind`);
      if (cell.kind === 'answer') {
        answerCells++;
        if (!cell.solution || !/^[A-Z]$/.test(cell.solution)) throw new Error(`${size}: missing solution at ${r},${c}`);
        if (!Array.isArray(cell.entries) || cell.entries.length < 1) throw new Error(`${size}: uncovered answer cell at ${r},${c}`);
        if (cell.entries.length > 1) crossings++;
      }
    }
  }

  for (const entry of puzzle.entries) {
    if (!entry.clue || !entry.word || !Array.isArray(entry.answer)) throw new Error(`${size}: malformed entry`);
    const reconstructed = entry.answer.map(point => puzzle.cells[point.r][point.c].solution).join('');
    if (reconstructed !== entry.word) throw new Error(`${size}: word mismatch for ${entry.word}`);
  }

  const rate = answerCells ? crossings / answerCells : 0;
  if (Math.abs(rate - puzzle.crossingRate) > 0.0001) throw new Error(`${size}: crossing rate mismatch`);
  const minimum = size >= 13 ? 0.30 : 0.25;
  if (rate < minimum) throw new Error(`${size}: crossing rate ${(rate * 100).toFixed(1)}% below ${(minimum * 100).toFixed(0)}%`);
  if (puzzle.verticalCount < Math.max(3, Math.floor(size / 2))) throw new Error(`${size}: too few vertical entries`);
  return { answerCells, crossings, crossingRate: rate, verticalCount: puzzle.verticalCount };
}

for (const size of sizes) {
  let best = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const generated = runGenerator(size, 120000 + size * 101 + attempt);
      const metrics = validate(size, generated.puzzle);
      const candidate = {
        size: `${size}x${size}`,
        entries: generated.puzzle.entries.length,
        answerCells: metrics.answerCells,
        crossings: metrics.crossings,
        crossingRatePercent: Number((metrics.crossingRate * 100).toFixed(1)),
        verticalEntries: metrics.verticalCount,
        elapsedMs: Math.round(generated.elapsedMs),
      };
      if (!best || candidate.crossingRatePercent > best.crossingRatePercent) best = candidate;
      if (candidate.crossingRatePercent >= (size >= 13 ? 45 : 40)) break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!best) throw lastError || new Error(`No valid result for ${size}`);
  results.push(best);
  console.log(best);
}

const report = {
  testedAt: new Date().toISOString(),
  wordRows: rows.length,
  uniqueWords: new Set(rows.map(row => row[0])).size,
  generatorVersion: 12,
  results,
};
fs.writeFileSync('generator-test-results.json', JSON.stringify(report, null, 2) + '\n');
