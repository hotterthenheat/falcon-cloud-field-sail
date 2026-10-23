(async () => {
  const L = await import('/src/data/levelsFor.ts');
  const U = await window.__imp('/src/data/levelsFor.ts', 'uwBook');
  L.levelsFor('CROX', '0DTE'); L.levelsFor('CROX', 'ALL');
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) { const v = L.levelsFor('CROX', 'ALL'); const w = L.levelsFor('CROX', '0DTE'); if (v?.complete && w?.complete) break; await new Promise(r => setTimeout(r, 1000)); }
  const e = U.peekEntry('CROX');
  return { t: Date.now() - t0, today: L.levelsFor('CROX', '0DTE'), all: L.levelsFor('CROX', 'ALL'), expiries: e.expiries, byDate: Object.fromEntries(Object.entries(e.byDate).map(([k, v]) => [k, v.length])) };
})()
