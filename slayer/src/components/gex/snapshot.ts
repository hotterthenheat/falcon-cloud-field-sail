/* The chart snapshot: a head line (name, interval, price and change, moment) over the library's own takeScreenshot
   (every series, drawing and axis) and the strike rail when there is one; saved as PNG, copied, or opened in a tab. */

import { FONT_SANS } from '../../theme/fonts';
import { readToken } from '../../theme/theme';

interface SnapshotMeta {
  ticker: string;
  /** "15m" */
  timeframe: string;
  /** "502.82" */
  price: string;
  /** "+0.56%" */
  change: string;
  up: boolean;
  /** "Oct 18 · 13:00 ET" */
  when: string;
}

/** The head's height in CSS pixels — the identity row's grammar */
const HEAD_PX = 44;
const DIVIDE_PX = 1;

/** The picture: the head, the chart, the rail beside it when there is one */
export function composeSnapshot(chart: HTMLCanvasElement, panel: HTMLCanvasElement | null, meta: SnapshotMeta, from?: Element | null, grounds?: { chart?: string; panel?: string }): HTMLCanvasElement {
  const dpr = Math.max(1, Math.round(((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1) * 100) / 100);
  const headH = Math.round(HEAD_PX * dpr);
  const divide = Math.round(DIVIDE_PX * dpr);
  const chartW = chart.width;
  const chartH = chart.height;
  const panelW = panel ? panel.width : 0;
  const bodyH = Math.max(chartH, panel ? panel.height : 0);
  const W = chartW + (panel ? divide + panelW : 0);
  const H = headH + bodyH;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  const ink = readToken('--text-primary', undefined, from);
  const muted = readToken('--text-muted', undefined, from);
  const silver = readToken('--silver', undefined, from);
  const bull = readToken('--bull', undefined, from);
  const bear = readToken('--bear', undefined, from);
  const panelGround = readToken('--panel', undefined, from);
  const hairline = readToken('--border-subtle', undefined, from);

  /* the head on the panel's ground */
  ctx.fillStyle = panelGround;
  ctx.fillRect(0, 0, W, headH);
  ctx.fillStyle = hairline;
  ctx.fillRect(0, headH - divide, W, divide);
  /* the chart on its own ground, then the rail on the panel's */
  ctx.fillStyle = grounds?.chart ?? panelGround;
  ctx.fillRect(0, headH, chartW, bodyH);
  ctx.drawImage(chart, 0, headH);
  if (panel) {
    ctx.fillStyle = hairline;
    ctx.fillRect(chartW, headH, divide, bodyH);
    ctx.fillStyle = grounds?.panel ?? panelGround;
    ctx.fillRect(chartW + divide, headH, panelW, bodyH);
    ctx.drawImage(panel, chartW + divide, headH);
  }

  /* the words: the name bold, the interval and the moment muted, the change in its side's ink */
  const px = (n: number) => Math.round(n * dpr);
  const baseline = Math.round(headH * 0.62);
  let x = px(14);
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 ${px(14)}px ${FONT_SANS}`;
  ctx.fillStyle = ink;
  ctx.fillText(meta.ticker, x, baseline);
  x += ctx.measureText(meta.ticker).width + px(8);
  ctx.font = `500 ${px(11)}px ${FONT_SANS}`;
  ctx.fillStyle = muted;
  ctx.fillText(meta.timeframe, x, baseline);
  x += ctx.measureText(meta.timeframe).width + px(14);
  ctx.font = `600 ${px(13)}px ${FONT_SANS}`;
  ctx.fillStyle = ink;
  ctx.fillText(`$${meta.price}`, x, baseline);
  x += ctx.measureText(`$${meta.price}`).width + px(8);
  ctx.font = `600 ${px(12)}px ${FONT_SANS}`;
  ctx.fillStyle = meta.up ? bull : bear;
  ctx.fillText(meta.change, x, baseline);
  /* the moment and the house, at the right */
  ctx.textAlign = 'right';
  ctx.font = `600 ${px(11)}px ${FONT_SANS}`;
  ctx.fillStyle = silver;
  const brand = 'SLAYER TERMINAL';
  ctx.fillText(brand, W - px(14), baseline);
  const brandW = ctx.measureText(brand).width;
  ctx.font = `500 ${px(11)}px ${FONT_SANS}`;
  ctx.fillStyle = muted;
  ctx.fillText(meta.when, W - px(14) - brandW - px(14), baseline);
  ctx.textAlign = 'left';
  return out;
}

export const snapshotBlob = (c: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('no picture'))), 'image/png'));

/** "SPY-15m-2026-10-18-1300.png" */
export const snapshotName = (ticker: string, timeframe: string, now = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${ticker}-${timeframe}-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.png`;
};

export function saveSnapshot(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The clipboard, where the browser allows a picture on it — false where it does not (then the save stands) */
export async function copySnapshot(blob: Blob): Promise<boolean> {
  try {
    const Item = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (!Item || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new Item({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

export function openSnapshot(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
