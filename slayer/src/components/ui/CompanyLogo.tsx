import { useEffect, useState } from 'react';
import { HAS_LOGO, PHOTO_LOGOS } from '../../data/logoFiles';

interface CompanyLogoProps {
  ticker: string;
  /** Square edge in px */
  size?: number;
  className?: string;
}

/* A company mark for any ticker: public/logos/{TICKER}.svg, else a monogram tile, both in one fixed box
   with no in-flow text so swapping faces never shifts the baseline. */
/* names without a file are remembered for the session, so the letters draw at once and the request is not repeated */
/* symbols the remote logo source has no mark for, remembered across visits so a miss costs one request, not one per page */
const MISS_KEY = 'slayer_logo_miss_v1';
const NO_LOGO = new Set<string>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(MISS_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  })(),
);
const rememberMiss = (sym: string) => {
  NO_LOGO.add(sym);
  try {
    localStorage.setItem(MISS_KEY, JSON.stringify([...NO_LOGO].slice(-2000)));
  } catch {
    /* storage full or blocked: the in-memory set still holds it for this visit */
  }
};
/* class shares, warrants and units (BRK.B, MOG.A, AACT.WS) have no remote mark */
const remoteable = (sym: string) => /^[A-Z]{1,5}$/.test(sym);

/* Marks that must answer to the ground are drawn as a CSS mask (the file gives the shape, the page the colour):
   ink marks (black brands) take --text-primary; deep marks (navies that sink on black) take their brand colour on
   light grounds and the page ink on dark (--logo-flip). A listed name must have a file: a mask has no onError. */
/* only single-colour files belong in these lists: a mask discards colour */
const INK_MARKS = new Set(['AAPL', 'NKE', 'PLTR', 'UBER', 'UPS', 'RBLX', 'LCID', 'RIVN']);
const DEEP_MARKS: Record<string, string> = {
  BAC: '#012169',
  BA: '#1D439C',
  ABBV: '#071D49',
  V: '#1A1F71',
  F: '#00274E',
  DAL: '#003366',
  SMCI: '#151F6D',
  FDX: '#4D148C',
  MDLZ: '#4F2170',
};

/* Funds have no company mark: the ticker is the mark, as a solid ink tile with the letters cut out, never fetched. */
/* A fund has no company. The ticker is the mark — a solid tile, not a gray "missing" one, and never a request.
   The first eight are the indexes and the big ETFs even when a file exists (the issuer's wordmark is the wrong mark).
   The rest are the other products on the Compass list: a letter tile until a file is actually there. */
const CORE_FUNDS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'SPX', 'NDX', 'RUT', 'VIX']);
const FUND_EXTRA = new Set([
  'SPXW', 'XSP', 'RUTW', 'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'SPXL', 'SPXU', 'SPXS', 'UPRO', 'TNA', 'TZA',
  'UVXY', 'UVIX', 'VXX', 'SVIX', 'SVXY', 'TMF', 'TBT', 'TLT', 'LABU', 'BOIL', 'KOLD', 'NUGT', 'JNUG', 'NAIL',
  'FAS', 'DPST', 'AGQ', 'YINN', 'BITO', 'BITX', 'ARKK', 'ARKG', 'SMH', 'SOXX', 'GDX', 'GDXJ', 'XBI', 'XHB',
  'XRT', 'XOP', 'XLE', 'XLF', 'XLK', 'XLI', 'XLV', 'XLY', 'XLP', 'XLU', 'XLC', 'KRE', 'KWEB', 'EWZ', 'EWW',
  'EEM', 'EFA', 'FXI', 'GLD', 'SLV', 'USO', 'UNG', 'VOO', 'NVDL', 'TSLL', 'IBB', 'OIH', 'URA', 'URNM', 'MSOS',
  'TAN', 'UCO', 'SSO', 'RSP',
]);

/* Many files are favicons wrapped in SVG. Each is read once off screen: a flat one falls back to the letters, an opaque
   one is shown as a picture rather than masked. */
type Probe = 'flat' | 'opaque' | 'dark' | 'ok';
const PROBED = new Map<string, Probe>();
const PROBING = new Map<string, Promise<Probe>>();
const probeLogo = (sym: string): Promise<Probe> => {
  const had = PROBED.get(sym);
  if (had) return Promise.resolve(had);
  const busy = PROBING.get(sym);
  if (busy) return busy;
  const run = new Promise<Probe>(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const n = 24;
        const c = document.createElement('canvas');
        c.width = n;
        c.height = n;
        const g = c.getContext('2d', { willReadFrequently: true });
        if (!g) return resolve('ok');
        g.drawImage(img, 0, 0, n, n);
        const d = g.getImageData(0, 0, n, n).data;
        let seen = 0;
        let opaque = 0;
        let lo = 765;
        let hi = 0;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 24) continue;
          seen++;
          if (d[i + 3] > 250) opaque++;
          const v = d[i] + d[i + 1] + d[i + 2];
          /* the brightest channel is what shows on black: a red T is plain to see, a navy shield is not */
          sum += Math.max(d[i], d[i + 1], d[i + 2]);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const total = n * n;
        if (seen === 0 || (seen > total * 0.9 && hi - lo < 18)) return resolve('flat');
        if (opaque > total * 0.97) return resolve('opaque');
        /* a navy or near-black mark on a clear ground (GE, LMT, PM, LRCX) sinks into the dark terminal: it is seated on
           a pale tile, the way a brand sits on its own app icon */
        resolve(sum / seen < 150 ? 'dark' : 'ok');
      } catch {
        resolve('ok');
      }
    };
    img.onerror = () => resolve('flat');
    img.src = `/logos/${sym}.svg`;
  }).then(r => {
    PROBED.set(sym, r);
    PROBING.delete(sym);
    return r;
  });
  PROBING.set(sym, run);
  return run;
};

const CompanyLogo = ({ ticker, size = 20, className = '' }: CompanyLogoProps) => {
  const sym = ticker.toUpperCase();
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [remoteMiss, setRemoteMiss] = useState<string | null>(null);
  const local = HAS_LOGO.has(sym);
  /* A fund's mark is the ticker. A file we curated stays. Everything else asks the public mark once; a 404 is the letter tile, remembered so the row does not ask again. */
  const fund = CORE_FUNDS.has(sym) || (FUND_EXTRA.has(sym) && !local);
  const remoteOff = fund || local || !remoteable(sym) || NO_LOGO.has(sym) || remoteMiss === sym;
  const photo = PHOTO_LOGOS.has(sym);
  const [probe, setProbe] = useState<Probe | undefined>(() => PROBED.get(sym));
  useEffect(() => {
    if (fund || !local || photo || NO_LOGO.has(sym)) return;
    let live = true;
    const known = PROBED.get(sym);
    if (known) setProbe(known);
    else void probeLogo(sym).then(r => live && setProbe(r));
    return () => {
      live = false;
    };
  }, [sym, fund, local, photo]);
  const localFailed = local && (failedFor === sym || NO_LOGO.has(sym) || probe === 'flat');
  const failed = fund || localFailed || (!local && remoteOff);
  const deep = DEEP_MARKS[sym];
  const masked = local && (deep !== undefined || INK_MARKS.has(sym)) && probe !== 'opaque';
  const shape = `url(/logos/${sym}.svg) center / contain no-repeat`;

  return (
    <span
      aria-hidden
      /* overflow-hidden pins the inline-block baseline to its bottom edge, so glyph and tile align identically */
      className={`relative inline-block align-middle shrink-0 select-none overflow-hidden ${className}`}
      style={{ width: size, height: size }}
    >
      {failed ? (
        <span
          className={`absolute inset-0 flex items-center justify-center rounded-[5px] font-mono font-bold leading-none ${fund ? 'bg-textPrimary text-canvas' : 'border border-borderMuted bg-ink/[0.05] text-textPrimary'}`}
          data-logo-mark={fund ? 'fund' : undefined}
          style={{
            fontSize: Math.max(6, Math.round(size * (sym.length > 4 ? 0.21 : sym.length > 3 ? 0.26 : 0.34))),
            letterSpacing: '-0.02em',
          }}
        >
          {/* the whole symbol, up to five letters */}
          {sym.length <= 5 ? sym : sym.slice(0, 4)}
        </span>
      ) : !local ? (
        <img
          src={`https://assets.parqet.com/logos/symbol/${encodeURIComponent(sym)}`}
          alt=""
          draggable={false}
          onError={() => {
            rememberMiss(sym);
            setRemoteMiss(sym);
          }}
          className="block h-full w-full rounded-[4px] object-contain"
        />
      ) : photo ? (
        <img
          src={`/logos/${sym}.svg`}
          alt=""
          draggable={false}
          onError={() => {
            NO_LOGO.add(sym);
            setFailedFor(sym);
          }}
          className="block h-full w-full rounded-[4px]"
        />
      ) : probe === undefined ? (
        /* no <img> before the probe answers: a missing file would show the broken-image icon (the dev server answers with
           HTML). The box stays empty, then shows the mark or the letters. */
        <span className="block h-full w-full" />
      ) : masked && probe === undefined ? (
        /* a mask waits for its file to be read — drawn early, an opaque file flashes as a solid square */
        <span className="block h-full w-full" />
      ) : masked ? (
        <span
          className="block h-full w-full"
          style={{
            WebkitMask: shape,
            mask: shape,
            background: deep ? `color-mix(in srgb, rgb(var(--text-primary)) calc(var(--logo-flip, 1) * 100%), ${deep})` : 'rgb(var(--text-primary))',
          }}
          data-logo-mark={deep ? 'deep' : 'ink'}
        />
      ) : (
        <img
          src={`/logos/${sym}.svg`}
          alt=""
          draggable={false}
          onError={() => {
            NO_LOGO.add(sym);
            setFailedFor(sym);
          }}
          className={`block h-full w-full ${probe === 'opaque' ? 'rounded-[4px]' : probe === 'dark' ? 'rounded-[4px] bg-paper p-[1.5px]' : ''}`}
        />
      )}
    </span>
  );
};

export default CompanyLogo;
