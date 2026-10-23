import { newsFromWhales } from '../src/data/whalesMap';
const hs = ['EUROZONE OCTOBER COMPOSITE PMI DROPS TO 51.9, LOWER THAN EXPECTED FORECAST OF 52.4','Apple raises full-year outlook','US jobless claims fall to 210K, below forecast','NVDA beats estimates in Q3'];
const rows = hs.map((h, i) => ({ created_at: new Date().toISOString(), headline: h, is_major: false, sentiment: 'neutral', source: 'x', tags: [], tickers: i === 1 ? ['AAPL'] : i === 3 ? ['NVDA'] : [] }));
for (const n of newsFromWhales(rows as never)) console.log(n.category, '|', n.headline);
