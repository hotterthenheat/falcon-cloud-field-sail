import { useMemo } from 'react';
import { decodeShare } from './share';

const num = (v: number | null | undefined) => (v != null && Number.isFinite(v) && v > 0 ? v.toFixed(2) : '—');

/** A copied desk. No chain, and this page does not start the simulator or write the desk config. */
export default function TerrainShare() {
  const payload = useMemo(() => decodeShare(window.location.hash), []);
  if (!payload) {
    return <p className="p-6 font-mono text-t12 text-textSecondary">This link has no desk in it.</p>;
  }
  const on = Object.entries(payload.overlays).filter(([, v]) => v === true).map(([k]) => k);
  const lv = payload.levels;
  return (
    <div className="p-6 font-mono text-t12 text-textSecondary" data-terrain-share="">
      <p className="text-t13 text-textPrimary">{payload.t} · {payload.tf}</p>
      <p className="mt-2">Shared read. No chain.</p>
      <p className="mt-3">Overlays: {on.length ? on.join(', ') : 'none'}</p>
      {lv ? (
        <ul className="mt-3 space-y-1">
          <li>Spot {num(lv.spot)}</li>
          <li>Flip {num(lv.flip)} · {lv.scope}</li>
          <li>Call wall {num(lv.callWall)}</li>
          <li>Put wall {num(lv.putWall)}</li>
          <li>Supreme {num(lv.supreme)}</li>
        </ul>
      ) : (
        <p className="mt-3">No levels were on the book when this was copied.</p>
      )}
    </div>
  );
}
