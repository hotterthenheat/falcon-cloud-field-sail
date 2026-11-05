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

/** The rules a review and a study are built under. 2: no fees anywhere (a trade's P&L is (exit - fill) x 100). 3: the
    labels' stop and target minutes judged on their 1-second quotes (unresolved when one is not read), each row from
    its own mark's instant to its own session's flat, an early close's flats. A file stamped lower, or not at all, was
    built under older rules and is built again. */
export const REVIEW_VERSION = 3;

const builtMemo = new Map<string, { mtime: number; ok: boolean; open: number }>();

/** Calls of a record not settled yet (open, waiting, or never read). */
export const openCalls = (record: { calls: readonly Signal[]; would?: readonly Signal[] }): number =>
  [...record.calls, ...(record.would ?? [])].filter(c => !c.outcome || c.outcome.status === 'open' || c.outcome.status === 'waiting').length;

function builtStamp(file: string): { ok: boolean; open: number } {
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return { ok: false, open: 0 };
  }
  const hit = builtMemo.get(file);
  if (hit && hit.mtime === mtime) return hit;
  let ok = false;
  let open = 0;
  try {
    const got = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown; openCalls?: unknown };
    ok = typeof got.version === 'number' && got.version >= REVIEW_VERSION;
    open = typeof got.openCalls === 'number' ? got.openCalls : 0;
  } catch {
    ok = false;
  }
  const stamp = { mtime, ok, open };
  builtMemo.set(file, stamp);
  return stamp;
}

/** How many of the record's calls were still open when this study was built (0 for a file from before the count). A
    study built while calls were open is built again once they settle. */
export function builtOpenCalls(file: string): number {
  return builtStamp(file).open;
}

/** The review or study file exists and was built under today's rules. */
export function builtCurrent(file: string): boolean {
  return builtStamp(file).ok;
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
export async function buildSession(dir: string, day: string, record: { calls: Signal[]; would?: Signal[]; marks: MarkRow[]; close?: number | null }, log: (line: string) => void = () => {}): Promise<{ review: SessionReview; study: StudyResult }> {
  const rowsFile = path.join(dir, 'rows', `${day}.jsonl`);
  const rows: ScoredLine[] = fs.existsSync(rowsFile)
    ? fs.readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as ScoredLine).filter(r => r.d === day)
    : [];
  const entry = await trees('/models/model_entry_all6months.txt');
  const runner = await trees('/models/model_runner_all6months.txt');
  const chains = new Map();
  /* the session's early close moves the flats of its reviews and labels */
  const deps = { day, rows, entry, runner, chains, close: record.close ?? null };
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
  writeAtomic(studyFile(dir, day), JSON.stringify({ ...study, trades, version: REVIEW_VERSION, openCalls: openCalls(record) }));
  log(`[compass] study ${day}: ${trades.length} trades, ${study.movers.length} movers, ${study.labels} labels`);
  return { review, study: { ...study, trades } };
}
