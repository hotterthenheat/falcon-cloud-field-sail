/// <reference types="node" />
/*
  Builds a session's review and study from the record folder: the day's record (calls and would-calls), the scored
  rows, and ThetaData's recorded quotes, read through compassHost. Writes
    <dir>/review/YYYY-MM-DD.json   every trade, reviewed
    <dir>/study/YYYY-MM-DD.json    the movers, the miss reasons, the calibration, the suggestions
    <dir>/labels/YYYY-MM-DD.jsonl  every scored row with what actually happened
  The server engine runs it once a session has settled (data/compassServer.ts); scripts/compass-study.ts runs it for
  any past day.
*/

import fs from 'node:fs';
import path from 'node:path';
import { compassHost } from './compassHost';
import { parseExplainTrees, type ExplainTree } from './lgbmExplain';
import { reviewTrade, runStudy, type Label, type ScoredLine, type StudyResult, type TradeReview } from './compassStudy';
import type { Signal } from './compassLedger';
import type { MarkRow } from './compassScan';

export interface SessionReview {
  day: string;
  builtAt: number;
  /** The build rules it was made under (REVIEW_VERSION); absent on a file from before the stamp */
  version?: number;
  trades: TradeReview[];
}

/** The rules a review and a study are built under. 2: no fees anywhere (a trade's P&L is (exit - fill) x 100). A file
    stamped lower, or not at all, was built under older rules (fees taken from its P&L) and is built again. */
export const REVIEW_VERSION = 2;

const builtMemo = new Map<string, { mtime: number; ok: boolean }>();

/** The review or study file exists and was built under today's rules. */
export function builtCurrent(file: string): boolean {
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return false;
  }
  const hit = builtMemo.get(file);
  if (hit && hit.mtime === mtime) return hit.ok;
  let ok = false;
  try {
    const got = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown };
    ok = typeof got.version === 'number' && got.version >= REVIEW_VERSION;
  } catch {
    ok = false;
  }
  builtMemo.set(file, { mtime, ok });
  return ok;
}

async function trees(file: string): Promise<ExplainTree[] | null> {
  const buf = await compassHost().asset(file);
  return buf ? parseExplainTrees(new TextDecoder().decode(buf)) : null;
}

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export const reviewFile = (dir: string, day: string) => path.join(dir, 'review', `${day}.json`);
export const studyFile = (dir: string, day: string) => path.join(dir, 'study', `${day}.json`);

/** Review every trade and study the session. `record` is the day's file as the engine wrote it. */
export async function buildSession(dir: string, day: string, record: { calls: Signal[]; would?: Signal[]; marks: MarkRow[] }, log: (line: string) => void = () => {}): Promise<{ review: SessionReview; study: StudyResult }> {
  const rowsFile = path.join(dir, 'rows', `${day}.jsonl`);
  const rows: ScoredLine[] = fs.existsSync(rowsFile)
    ? fs.readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as ScoredLine).filter(r => r.d === day)
    : [];
  const entry = await trees('/models/model_entry_all6months.txt');
  const runner = await trees('/models/model_runner_all6months.txt');
  const chains = new Map();
  const deps = { day, rows, entry, runner, chains };
  const calls = record.calls;
  const would = record.would ?? [];
  const trades: TradeReview[] = [];
  for (const sig of [...calls, ...would]) {
    trades.push(await reviewTrade(sig, deps));
  }
  const review: SessionReview = { day, builtAt: Date.now(), version: REVIEW_VERSION, trades };
  log(`[compass] study reads ${day}: ${trades.length} trades`);
  const labels: Label[] = [];
  const study = await runStudy({ ...deps, marks: record.marks, calls, would, reviews: trades, onLabel: l => labels.push(l) });
  writeAtomic(path.join(dir, 'labels', `${day}.jsonl`), labels.map(l => JSON.stringify(l)).join('\n') + '\n');
  writeAtomic(studyFile(dir, day), JSON.stringify({ ...study, trades, version: REVIEW_VERSION }));
  log(`[compass] study ${day}: ${trades.length} trades, ${study.movers.length} movers, ${study.labels} labels`);
  return { review, study: { ...study, trades } };
}
