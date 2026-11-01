/*
==================================================
  SLAYER TERMINAL - DESKS BY FIELD (pages/terrain/deskPresets.ts)

  A desk by field is four names that belong together, opened as a four-pane desk in one press from the desks door on
  the desk bar (DesksDoor.tsx; ported from the partner tree, 2026-10-31). The reader's own saved desks (the layout
  door's shelf, layouts.ts) stand above these in the same menu; a field recalled can be saved under a name of the
  reader's own from the layout door, as any desk can. Static lists: the names, never a number.
==================================================
*/

export interface DeskPreset {
  /** the field, as the door prints it */
  name: string;
  /** one short line under the name */
  line: string;
  /** the four names, in pane order */
  names: readonly string[];
}

export const DESK_PRESETS: readonly DeskPreset[] = [
  { name: 'Indices', line: 'the market in four funds', names: ['SPY', 'QQQ', 'IWM', 'DIA'] },
  { name: 'Megacaps', line: 'the four largest names', names: ['AAPL', 'MSFT', 'AMZN', 'GOOGL'] },
  { name: 'Technology', line: 'hardware and platforms', names: ['AAPL', 'MSFT', 'NVDA', 'AVGO'] },
  { name: 'Semiconductors', line: 'the chip makers', names: ['NVDA', 'AMD', 'AVGO', 'MU'] },
  { name: 'Software', line: 'the cloud and the enterprise', names: ['CRM', 'ORCL', 'ADBE', 'NOW'] },
  { name: 'Banks', line: 'the money-centre banks', names: ['JPM', 'BAC', 'GS', 'WFC'] },
  { name: 'Energy', line: 'oil and gas', names: ['XOM', 'CVX', 'COP', 'OXY'] },
  { name: 'Health', line: 'insurers and pharma', names: ['UNH', 'LLY', 'JNJ', 'PFE'] },
  { name: 'Consumer', line: 'where the spending goes', names: ['TSLA', 'AMZN', 'WMT', 'COST'] },
];
