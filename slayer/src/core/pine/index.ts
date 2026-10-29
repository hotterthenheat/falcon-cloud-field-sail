/* The runtime's door: `compile(source)` returns the ScriptMeta or throws a PineError with the line; `run(compiled, bars, options)` returns
   lines, fills, marks and alerts. A Pine v6 subset (v5 reads); no strategies, drawings, arrays or request.security. Never eval; time-budgeted. */

import type { ScriptMeta } from '../../types/scripts';
import { analyze, markIntDivision, planOutputs, type OutputPlan } from './analyze';
import type { Program } from './ast';
import { Runner } from './interpreter';
import { parse } from './parser';
import { PineError, type Bar, type RunOptions, type RunResult } from './types';

export interface Compiled {
  program: Program;
  meta: ScriptMeta;
  plan: OutputPlan;
  source: string;
}

/** Read the script; throws a PineError naming the line when it cannot */
export function compile(source: string): Compiled {
  const program = parse(source);
  markIntDivision(program);
  const plan = planOutputs(program);
  const meta = analyze(program, plan);
  return { program, meta, plan, source };
}

/** Draw a compiled script over the bars */
export function run(compiled: Compiled, bars: Bar[], options: RunOptions = {}): RunResult {
  return new Runner(compiled.program, bars, options, compiled.plan).run();
}

/** Read and draw in one step */
export function runSource(source: string, bars: Bar[], options: RunOptions = {}): RunResult {
  return run(compile(source), bars, options);
}

/** A plain sentence for any failure, with the line when there is one */
export function explain(err: unknown): { line: number; message: string } {
  if (err instanceof PineError) return { line: err.line, message: err.message };
  if (err instanceof Error) return { line: 0, message: err.message };
  return { line: 0, message: String(err) };
}

export type { Bar, RunResult, PlotOut, ShapeOut,  } from './types';
