/* DRAWING TEMPLATES (TradingView's "Template" menu in a drawing's settings): a tool's style saved under a name — its
   inks, its weight, its dash, its levels and its inputs — applied to any mark of that tool, and one of them, if the
   reader says so, worn by every new mark of the tool. Kept in the reader's browser; a store of its own (no React) so
   the commit path can read the default without a component. */

import { useSyncExternalStore } from 'react';
import type { Drawing, DrawingKind } from './drawingsPrimitive';

/** What a template carries — the style, never the geometry or the words */
export type TemplateStyle = Pick<Drawing, 'color' | 'textColor' | 'width' | 'style' | 'levels' | 'opts'>;
export interface DrawTemplate {
  kind: DrawingKind;
  name: string;
  style: TemplateStyle;
}
interface TemplateStore {
  list: DrawTemplate[];
  /** the template a tool's new marks wear */
  defaults: Partial<Record<DrawingKind, string>>;
}

const KEY = 'slayer_draw_templates_v1';
const STYLE_KEYS = ['color', 'textColor', 'width', 'style', 'levels', 'opts'] as const;

/** The style part of a mark — what "Save as" keeps. The screen-fixed text's place is geometry, not style. */
export function styleOf(d: Drawing): TemplateStyle {
  const out: TemplateStyle = {};
  for (const k of STYLE_KEYS) if (d[k] !== undefined) (out as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(d[k]));
  if (out.opts) {
    const { fx: _fx, fy: _fy, set: _set, ...rest } = out.opts;
    void _fx;
    void _fy;
    void _set;
    out.opts = Object.keys(rest).length ? rest : undefined;
  }
  return out;
}

const read = (): TemplateStore => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<TemplateStore>;
    const list = Array.isArray(raw.list)
      ? raw.list.filter((t): t is DrawTemplate => !!t && typeof t.name === 'string' && typeof t.kind === 'string' && typeof t.style === 'object' && t.style !== null)
      : [];
    const defaults = raw.defaults && typeof raw.defaults === 'object' ? raw.defaults : {};
    return { list, defaults };
  } catch {
    return { list: [], defaults: {} };
  }
};
let state: TemplateStore = read();
const subs = new Set<() => void>();
const write = (next: TemplateStore) => {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage off — the templates live for the session */
  }
  subs.forEach(fn => fn());
};
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
const snap = () => state;
export const useDrawTemplates = (): TemplateStore => useSyncExternalStore(subscribe, snap, snap);

export const templatesFor = (kind: DrawingKind, s: TemplateStore = state): DrawTemplate[] => s.list.filter(t => t.kind === kind);

/** Save `d`'s style under `name` for its tool (a name already used is overwritten) */
export function saveTemplate(d: Drawing, name: string): void {
  const nm = name.trim().slice(0, 40);
  if (!nm) return;
  const list = state.list.filter(t => !(t.kind === d.kind && t.name === nm));
  write({ ...state, list: [...list, { kind: d.kind, name: nm, style: styleOf(d) }] });
}
export function deleteTemplate(kind: DrawingKind, name: string): void {
  const defaults = { ...state.defaults };
  if (defaults[kind] === name) delete defaults[kind];
  write({ list: state.list.filter(t => !(t.kind === kind && t.name === name)), defaults });
}
/** The template new marks of `kind` wear; null: the chart's own default */
export function setDefaultTemplate(kind: DrawingKind, name: string | null): void {
  const defaults = { ...state.defaults };
  if (name) defaults[kind] = name;
  else delete defaults[kind];
  write({ ...state, defaults });
}

/** `d` wearing template `t`: the template's style, every other field the mark's own */
export function applyTemplate(d: Drawing, t: DrawTemplate): Drawing {
  const keep: Partial<Drawing> = {};
  if (d.opts?.fx !== undefined) keep.opts = { fx: d.opts.fx, fy: d.opts.fy ?? 0 };
  if (d.opts?.set !== undefined) keep.opts = { ...keep.opts, set: d.opts.set };
  const next: Drawing = { ...d };
  for (const k of STYLE_KEYS) delete (next as unknown as Record<string, unknown>)[k];
  const style = JSON.parse(JSON.stringify(t.style)) as TemplateStyle;
  return { ...next, ...style, ...(keep.opts ? { opts: { ...style.opts, ...keep.opts } } : {}) };
}

/** A new mark wearing its tool's default template, if the reader set one */
export function withDefaultTemplate(d: Drawing): Drawing {
  const name = state.defaults[d.kind];
  const t = name ? state.list.find(x => x.kind === d.kind && x.name === name) : undefined;
  return t ? applyTemplate(d, t) : d;
}
