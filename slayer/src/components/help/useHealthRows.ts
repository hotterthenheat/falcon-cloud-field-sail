/* The status rows, live: the clients' own reads (data/pathHealth.ts), the Compass feed and, with `probe`, one light ask
   of each path every 15 s while the tab is visible — the same asks Settings › Data makes (the session calendar, SPY's
   state), plus the recorder's /api/exposure/status. The asks go through the ordinary clients, so what they hear lands
   in the same reads the banner watches. Without `probe` (the bug report's snapshot) nothing is asked. */

import { useEffect, useState } from 'react';
import { thetaCall } from '../../data/theta';
import { uwCall } from '../../data/whales';
import { feedHeaders } from '../../data/feedGate';
import { notePathDown, notePathUp, usePathReads } from '../../data/pathHealth';
import { holdCompassFeed, useCompassFeed } from '../../data/compassFeed';
import { scanMeta } from '../../data/compassScan';
import { compassRow, pathRow, recorderRow, type RecorderProbe, type StatusRow } from '../../data/statusModel';
import { useBeat } from '../ui/Freshness';
import { phaseAt } from '../../core/session';

const PROBE_MS = 15_000;

async function askRecorder(): Promise<RecorderProbe> {
  const auth = await feedHeaders();
  if (!auth.ok) return { kind: 'refused' };
  try {
    const res = await fetch('/api/exposure/status', { headers: auth.headers });
    notePathUp('server');
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status === 401 || res.status === 402 || res.status === 403) return { kind: 'refused' };
    if (!res.ok || !body) return { kind: 'none', code: typeof body?.code === 'string' ? body.code : '', status: res.status };
    const last = body.last && typeof body.last === 'object' ? (body.last as Record<string, unknown>) : null;
    return {
      kind: 'ok',
      recording: body.recording === true,
      why: typeof body.why === 'string' ? body.why : '',
      lastAt: Number(last?.startedAt) || 0,
      took: Number(last?.took) || 0,
      fault: typeof last?.fault === 'string' ? last.fault : null,
      backoffUntil: Number(body.backoffUntil) || 0,
      names: Array.isArray(body.names) ? body.names.length : 0,
    };
  } catch {
    notePathDown('server', 'unreachable');
    return { kind: 'unreachable' };
  }
}

export function useHealthRows(probe: boolean): StatusRow[] {
  const paths = usePathReads();
  const feed = useCompassFeed();
  const now = useBeat();
  const [recorder, setRecorder] = useState<RecorderProbe>({ kind: 'asking' });

  useEffect(() => {
    if (!probe) return;
    const release = holdCompassFeed();
    let dead = false;
    const ask = () => {
      if (document.visibilityState === 'hidden') return;
      void thetaCall('/calendar/today?format=json', true);
      void uwCall('/stock/SPY/stock-state');
      void askRecorder().then(r => {
        if (!dead) setRecorder(r);
      });
    };
    ask();
    const id = window.setInterval(ask, PROBE_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') ask();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      dead = true;
      release();
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [probe]);

  const meta = scanMeta();
  const lastMark = feed.marks.reduce((m, r) => Math.max(m, r.at), 0);
  const t = Math.max(now, Date.now() - 1000);
  const rows: StatusRow[] = [
    pathRow('quotes', paths.quotes, t, meta.feed),
    pathRow('flow', paths.flow, t),
    compassRow(
      {
        status: feed.status,
        heardAt: feed.heardAt,
        at: feed.at,
        error: feed.error,
        engine: feed.engine,
        lastMark,
        quotes: meta.theta,
        quotesDownSince: meta.downSince,
        options: meta.feed,
        markDue: phaseAt(t) === 'regular',
      },
      t,
    ),
  ];
  if (probe) rows.push(recorderRow(recorder, t));
  rows.push(pathRow('server', paths.server, t));
  return rows;
}
