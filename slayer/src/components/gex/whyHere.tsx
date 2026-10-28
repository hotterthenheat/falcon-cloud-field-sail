import { useEffect, useState } from 'react';

/** A sentence from the stall, or none. The button stays off until the server says a key exists. This never writes a sentence of its own. */
export function WhyHere({ ticker, level }: { ticker: string; level: string }) {
  const [on, setOn] = useState(false);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 8000);
    fetch('/api/stall', { method: 'POST', signal: ac.signal })
      .then(r => { if (!dead) setOn(r.status !== 404); })
      .catch(() => { if (!dead) setOn(false); })
      .finally(() => window.clearTimeout(timer));
    return () => { dead = true; ac.abort(); };
  }, []);
  if (!on) return null;
  return (
    <span className="col-span-2 mt-1 flex flex-col items-start gap-1">
      <button
        type="button"
        className="font-mono text-[10px] uppercase tracking-wider text-textMuted hover:text-textPrimary"
        onClick={() => {
          setText(null);
          const ac = new AbortController();
          const timer = window.setTimeout(() => ac.abort(), 8000);
          void fetch('/api/stall', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ticker, level }),
            signal: ac.signal,
          }).then(async r => {
            if (r.status === 404) { setOn(false); return; }
            const body = (await r.text()).trim();
            setText(r.ok && body ? body : 'No sentence.');
          }).catch(() => setText('No sentence.')).finally(() => window.clearTimeout(timer));
        }}
      >
        Why here
      </button>
      {text && <span className="text-textSecondary leading-snug">{text}</span>}
    </span>
  );
}
