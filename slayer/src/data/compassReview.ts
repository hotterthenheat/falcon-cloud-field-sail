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
  trades: TradeReview[];
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
  const trades: TradeReview[] = [];
  for (const sig of [...record.calls, ...(record.would ?? [])]) {
    trades.push(await reviewTrade(sig, deps));
  }
  const review: SessionReview = { day, builtAt: Date.now(), trades };
  writeAtomic(reviewFile(dir, day), JSON.stringify(review));
  log(`[compass] review ${day}: ${trades.length} trades`);
  const labels: Label[] = [];
  const study = await runStudy({ ...deps, marks: record.marks, calls: record.calls, would: record.would ?? [], reviews: trades, onLabel: l => labels.push(l) });
  writeAtomic(path.join(dir, 'labels', `${day}.jsonl`), labels.map(l => JSON.stringify(l)).join('\n') + '\n');
  writeAtomic(studyFile(dir, day), JSON.stringify(study));
  log(`[compass] study ${day}: ${study.movers.length} movers, ${study.labels} labels`);
  return { review, study };
}
