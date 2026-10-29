import { sessionBook } from '../../data/sessionChain';
import { sessionMeta, useDeskSession } from '../../data/deskSession';

/*
  The session the head is set to, as a book. Regular hours stay on the
  page's own chain. Premarket, after hours and overnight replace that
  silence with the roots that actually print, and the quote beside them.
*/

const num = (n: number) => n.toLocaleString('en-US');

const SessionChain = ({ ticker }: { ticker: string }) => {
  const session = useDeskSession();
  const book = sessionBook(session, ticker || 'SPY');
  const meta = sessionMeta(session);
  if (session === 'rth') return null;
  return (
    <section className="border border-borderSubtle rounded-md bg-panel" data-session-chain={session} data-session-covered={book.covered}>
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-t15 font-semibold text-textPrimary">{meta.label} book</h3>
            <span className="font-mono text-t8 uppercase tracking-widest text-warn">sample</span>
          </div>
          <p className="mt-0.5 text-t11 text-textMuted">{book.note}</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-t10 text-textMuted">{book.quote.root}</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary">{book.quote.last.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted">Bid · ask</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary whitespace-nowrap">
              {book.quote.bid.toFixed(2)} · {book.quote.ask.toFixed(2)}
            </dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted">Session volume</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary">{num(book.quote.volume)}</dd>
          </div>
        </dl>
      </div>
      <div className="overflow-x-auto border-t border-borderSubtle/60">
        <div className="min-w-[640px]">
          <div className="px-5 h-[22px] grid items-center gap-x-3 text-t9 uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: '64px 88px 72px 36px 64px 64px 52px 52px 72px 64px' }}>
            <span>Root</span>
            <span>Expiry</span>
            <span className="text-right">Strike</span>
            <span>Right</span>
            <span className="text-right">Bid</span>
            <span className="text-right">Ask</span>
            <span className="text-right">IV</span>
            <span className="text-right">Delta</span>
            <span className="text-right">OI</span>
            <span className="text-right">Vol</span>
          </div>
          {book.prints.map(p => (
            <div key={p.id} className="px-5 h-[32px] grid items-center gap-x-3 border-t border-borderSubtle/40 font-mono text-t11 tnum" style={{ gridTemplateColumns: '64px 88px 72px 36px 64px 64px 52px 52px 72px 64px' }} data-session-print={p.id}>
              <span className="font-bold text-textPrimary">{p.root}</span>
              <span className="text-textMuted">{p.expiry.slice(5)}</span>
              <span className="text-right text-textPrimary">{p.strike.toLocaleString('en-US')}</span>
              <span className={p.right === 'C' ? 'text-bull' : 'text-bear'}>{p.right === 'C' ? 'Call' : 'Put'}</span>
              <span className="text-right text-textPrimary">{p.bid.toFixed(2)}</span>
              <span className="text-right text-textPrimary">{p.ask.toFixed(2)}</span>
              <span className="text-right text-textSecondary">{p.iv.toFixed(1)}</span>
              <span className={`text-right ${p.delta >= 0 ? 'text-bull' : 'text-bear'}`}>{p.delta.toFixed(2)}</span>
              <span className="text-right text-textSecondary">{num(p.oi)}</span>
              <span className="text-right text-textSecondary">{num(p.volume)}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="px-5 py-3 text-t11 text-textMuted">The map and the tape under this stay the regular-hours book. This strip is the session the head is set to.</p>
    </section>
  );
};

export default SessionChain;
