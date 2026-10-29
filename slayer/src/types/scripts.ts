/*
  The shape of a script (the Pine v6 subset users write, save and place on panes), shared by the editor, library,
  runtime and charts. A Script is text plus what its last Save learned (inputs, plots, alerts, overlay) and its
  versions; a ChartScript is one script on one pane with that reader's settings. All storage goes through
  ScriptStore (data/scriptStore.ts in the browser today), so the backing store can change underneath.
*/

/* ---- what a script is ------------------------------------------------------------ */

/** The script's Pine role: indicators now, strategies and libraries as the runtime grows */
export type ScriptKind = 'indicator' | 'strategy' | 'library';

/** Visibility: private, anyone with the link, or the community library */
export type ScriptVisibility = 'private' | 'unlisted' | 'public';

/** Origin: built in, yours, or published by someone */
export type ScriptShelf = 'built-in' | 'mine' | 'community';

/** Overlay on the tape (overlay = true) or a pane of its own */
export type ScriptPane = 'overlay' | 'own';

export type ScriptInputKind = 'int' | 'float' | 'bool' | 'string' | 'color' | 'source' | 'timeframe';
export type ScriptInputValue = number | boolean | string;

/** One declared input (`input.int(9, "Conversion", minval = 1)`), read from the source at save */
export interface ScriptInput {
  /** The variable it is assigned to, unique in the script */
  id: string;
  kind: ScriptInputKind;
  /** The control's label: the input title, or its variable name */
  title: string;
  default: ScriptInputValue;
  min?: number;
  max?: number;
  step?: number;
  /** A string input's options: a dropdown */
  options?: string[];
  /** `group = "..."`: inputs under one settings heading */
  group?: string;
  tooltip?: string;
}

export type ScriptPlotStyle = 'line' | 'stepline' | 'histogram' | 'columns' | 'area' | 'circles' | 'cross';

/** One line, histogram or marker the script draws */
export interface ScriptPlot {
  /** Its position in the script, stable across edits that keep the plot count */
  id: string;
  title: string;
  /** The ink the script asked for (hex); overridable per pane (ChartScript.inks) */
  ink: string;
  style: ScriptPlotStyle;
  width: number;
}

/** One `alertcondition(...)`: a name and message the alert engine can fire */
export interface ScriptAlert {
  id: string;
  title: string;
  message: string;
}

/** What the parser learned at the last Save, kept beside the text so listing never parses */
export interface ScriptMeta {
  /** The declared Pine version; only 6 runs */
  version: 6;
  /** The title in `indicator("...")`, which may differ from the saved title */
  title: string;
  kind: ScriptKind;
  pane: ScriptPane;
  inputs: ScriptInput[];
  plots: ScriptPlot[];
  /** How many `fill(...)` calls */
  fills: number;
  alerts: ScriptAlert[];
  /** Reads terminal data through the `slayer.*` namespace (the one extension beyond Pine) */
  usesSlayer: boolean;
}

/** Why a script does not run: the line and plain words, never a stack */
export interface ScriptError {
  line: number;
  column?: number;
  message: string;
}

export interface Script {
  id: string;
  /** Who owns it; 'slayer' for the built-ins */
  ownerId: string;
  shelf: ScriptShelf;
  /** The library name (editable); the header title lives in meta */
  title: string;
  /** One or two sentences for the library row */
  description: string;
  tags: string[];
  visibility: ScriptVisibility;
  /** The source as saved, uncompiled */
  source: string;
  /** A hash of the source, so identical saves and copies are recognised */
  sourceHash: string;
  /** null when the source has never parsed clean */
  meta: ScriptMeta | null;
  status: 'ok' | 'error';
  error?: ScriptError;
  /** The script this one was copied from, when it was */
  forkedFrom?: string;
  /** The current version; versions start at 1 and every Save adds one */
  version: number;
  /** A built-in cannot be edited in place; make a copy */
  readOnly: boolean;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  /** Soft delete, so a pane that still names it can say so */
  deletedAt?: number;
}

/** One saved state; Save writes one, restore brings one back */
export interface ScriptVersion {
  scriptId: string;
  version: number;
  source: string;
  /** What changed, in the writer's words, when they gave one */
  message?: string;
  createdAt: number;
}

/* ---- a script on a pane ---------------------------------------------------------- */

/** The chart pane id: 'pulse:main', 'terrain:1'..'terrain:4', 'weigher', 'board:0'..'board:3' */
export type PaneId = string;

/** One script placed on one pane, with this reader's settings for it */
export interface ChartScript {
  id: string;
  paneId: PaneId;
  scriptId: string;
  /** 'latest' follows the script as it is edited; a number pins one version */
  version: number | 'latest';
  /** The reader's input values by input id; missing ones take the defaults */
  inputs: Record<string, ScriptInputValue>;
  visible: boolean;
  /** Draw order on the pane, lowest first */
  order: number;
  /** The reader's inks per plot id, over the script's own */
  inks?: Record<string, string>;
}

export interface ScriptFavourite {
  scriptId: string;
  at: number;
}

/* ---- the limits ------------------------------------------------------------------ */

/** The pricing tiers (Book, Tape, Desk; the Seat is off the page, data/billing.ts) */
export type Tier = 'book' | 'tape' | 'desk' | 'seat';

/** What a tier may hold: pane count is the real cost, the rest are guards */
export interface ScriptLimits {
  /** Scripts drawn on one pane at once */
  onPane: number;
  /** Saved scripts of your own; null = no cap */
  saved: number | null;
  /** Publishes a day */
  publishesPerDay: number;
}

/* scripts are sold from Tape up; Book's row is the guard a lower plan still needs */
export const SCRIPT_LIMITS: Record<Tier, ScriptLimits> = {
  book: { onPane: 5, saved: 200, publishesPerDay: 10 },
  tape: { onPane: 15, saved: 1000, publishesPerDay: 10 },
  desk: { onPane: 25, saved: null, publishesPerDay: 10 },
  seat: { onPane: 25, saved: null, publishesPerDay: 10 },
};

/** The caps every script lives under, whoever wrote it */
export const SCRIPT_CAPS = {
  /** Source text, in bytes */
  sourceBytes: 100_000,
  plots: 64,
  inputs: 100,
  alerts: 40,
  /** Versions kept per script; older ones fall off */
  versions: 100,
  /** A recompute over the pane's bars must finish within this, or the script pauses and says so */
  budgetMs: 200,
} as const;

/* ---- the one door ------------------------------------------------------------------- */

/** What a Save carries: a new script when `id` is empty, a new version of one when it is set */
export interface ScriptSave {
  id?: string;
  title: string;
  source: string;
  description?: string;
  tags?: string[];
  message?: string;
}

/** Every storage question the editor, library and charts ask, and nothing else. */
export interface ScriptStore {
  /** The scripts on a shelf, newest edited first; every shelf when none is named */
  list(shelf?: ScriptShelf): Promise<Script[]>;
  get(id: string): Promise<Script | null>;
  /** Parses the source, stores the text and what it learned, writes a version */
  save(input: ScriptSave): Promise<Script>;
  /** A copy of your own: the way to edit a built-in or community script */
  fork(id: string, title?: string): Promise<Script>;
  remove(id: string): Promise<void>;
  versions(id: string): Promise<ScriptVersion[]>;
  restore(id: string, version: number): Promise<Script>;
  setVisibility(id: string, visibility: ScriptVisibility): Promise<Script>;

  favourites(): Promise<ScriptFavourite[]>;
  toggleFavourite(id: string): Promise<boolean>;

  /** The scripts on one pane, in draw order */
  onPane(paneId: PaneId): Promise<ChartScript[]>;
  /** Put a script on a pane with the script's defaults, or the inputs given */
  place(paneId: PaneId, scriptId: string, inputs?: Record<string, ScriptInputValue>): Promise<ChartScript>;
  /** Change a placed script's inputs, inks, order or visibility */
  update(chartScript: ChartScript): Promise<ChartScript>;
  /** Take a script off a pane; the script stays saved */
  lift(chartScriptId: string): Promise<void>;
}
