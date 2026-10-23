(async () => {
  const L = await import('/src/data/levelsFor.ts');
  const U = await window.__imp('/src/data/levelsFor.ts', 'uwBook');
  const tickers = (window.__T || 'SPY,QQQ,NVDA,TSLA,AAPL,CROX,SOFI').split(',');
  const out = {};
  for (const t of tickers) { L.levelsFor(t, '0DTE'); L.levelsFor(t, 'ALL'); }
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    let done = true;
    for (const t of tickers) for (const s of ['0DTE', 'ALL']) {
      const v = L.levelsFor(t, s);
      if (!v || !v.complete || !U.peekEntry(t)?.frontFacts && !U.peekEntry(t)?.full) done = false;
    }
    if (done) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  for (const t of tickers) for (const s of ['0DTE', 'ALL']) {
    const v = L.levelsFor(t, s);
    out[t + ' ' + s] = v && { spot: v.spot, net: (v.netGex / 1e6).toFixed(1) + 'M', sup: v.supreme, cw: v.callWall, pw: v.putWall, flip: v.flip && +v.flip.toFixed(2), complete: v.complete, label: v.scopeLabel, priced: U.peekGammaPriced(t, v.date) };
  }
  out.elapsed = Date.now() - t0;
  return out;
})()
