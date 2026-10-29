/* Add or change one position in a popover from the button that asked (PopoverCard): one row of labelled fields,
   like TradingView's strategy builder writes a leg. */

import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CARD } from '../ui/DropdownSelect';
import { CalendarDays } from 'lucide-react';
import { DateBoard } from '../ui/ExpiryPicker';
import { addPosition, updatePosition, todayExpiry, type Position, type Right, type Side } from '../../data/positions';
import { entryRange } from '../../data/weigherDesk';
import { nyIsoDate } from '../../core/nyTime';

const SILVER_FILL = 'rgb(var(--silver-fill))'; /* the silver as a SURFACE — a filled pill with the dark word on it, the holo flat form on either ground */

interface Draft {
  strike: string;
  right: Right;
  side: Side;
  contracts: string;
  expiry: string;
  enteredOn: string;
  entry: string;
}

const draftOf = (p: Partial<Position> | undefined, defaults: { strike: number }): Draft => ({
  strike: String(p?.strike ?? defaults.strike),
  right: p?.right ?? 'C',
  side: p?.side ?? 'long',
  contracts: String(p?.contracts ?? 1),
  expiry: p?.expiry ?? todayExpiry(),
  enteredOn: p?.enteredOn ?? (p?.addedAt ? nyIsoDate(p.addedAt) : nyIsoDate()),
  entry: p?.entry != null ? String(p.entry) : '',
});

const Field = ({ label, children, width }: { label: string; children: ReactNode; width?: number }) => (
  <label className="flex flex-col gap-1 min-w-0" style={{ width }}>
    <span className="text-t10 text-textMuted">{label}</span>
    {children}
  </label>
);

const inputCls = 'h-8 px-2 rounded-md border border-borderSubtle bg-panel font-mono text-t12 tnum text-textPrimary outline-none focus:border-silver/60 transition-colors';

/* A pill that is a side of the market wears it on hover (call green, put red); the picked pill stays silver. */
const PILL_HOVER = { plain: 'hover:text-textPrimary hover:bg-ink/[0.05]', bull: 'hover:text-bull hover:bg-bull/[0.12]', bear: 'hover:text-bear hover:bg-bear/[0.12]' } as const;
const Pills = <T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; tone?: 'bull' | 'bear' }[]; onChange: (v: T) => void; label: string }) => (
  <span role="group" aria-label={label} className="inline-flex h-8 rounded-md border border-borderSubtle p-[2px] gap-[2px]">
    {options.map(o => (
      <button
        key={o.value}
        type="button"
        aria-pressed={o.value === value}
        onClick={() => onChange(o.value)}
        data-tone={o.tone}
        className={`px-2.5 rounded-[4px] text-t11 font-medium transition-colors ${o.value === value ? '' : `text-textSecondary ${PILL_HOVER[o.tone ?? 'plain']}`}`}
        style={o.value === value ? { background: SILVER_FILL, color: '#0a0a0a' } : undefined}
      >
        {o.label}
      </button>
    ))}
  </span>
);

const dateFace = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return 'Pick a date';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const DateFace = ({ value, on, onClick, testId }: { value: string; on: boolean; onClick: () => void; testId: string }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    data-field={testId}
    className={`h-8 w-full px-2 rounded-md border bg-panel font-mono text-t12 tnum text-textPrimary text-left inline-flex items-center gap-2 outline-none transition-colors ${on ? 'border-silver/60' : 'border-borderSubtle hover:border-borderMuted'}`}
  >
    <span className="flex-1 min-w-0 truncate">{dateFace(value)}</span>
    <CalendarDays className="w-3.5 h-3.5 text-textMuted shrink-0" />
  </button>
);

interface PositionFormProps {
  ticker: string;
  /** Absent = a new position */
  position?: Position;
  /** The strike a new position starts on */
  defaultStrike: number;
  trigger: ReactNode;
  align?: 'start' | 'end' | 'center';
  /** The chain's quote for this strike. `listed: false` means that expiry does not have it. */
  quoteFor?: (strike: number, right: Right, expiry: string) => { listed: boolean; low: number | null; high: number | null; mark?: number | null } | null;
}

const PositionForm = ({ ticker, position, defaultStrike, trigger, align = 'end', quoteFor }: PositionFormProps) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(position, { strike: defaultStrike }));
  const [fault, setFault] = useState('');
  const [which, setWhich] = useState<'entered' | 'expiry'>('entered');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }));

  const strike = Number(draft.strike);
  const contracts = Math.round(Number(draft.contracts));
  const entry = draft.entry.trim() === '' ? undefined : Number(draft.entry);
  const today = nyIsoDate();
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(draft.enteredOn) && draft.enteredOn <= today && draft.enteredOn <= draft.expiry;
  const valid = Number.isFinite(strike) && strike > 0 && Number.isFinite(contracts) && contracts >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(draft.expiry) && dateOk && (entry === undefined || (Number.isFinite(entry) && entry >= 0));

  const save = async () => {
    if (!valid || !dateOk) return;
    setFault('');
    if (entry !== undefined) {
      const range = await entryRange(ticker, draft.expiry, strike, draft.right, draft.enteredOn);
      if (!range) {
        setFault("That day's range is not in. Leave the price blank.");
        return;
      }
      if (entry + 1e-4 < range.low) {
        setFault(`The low that day was $${range.low.toFixed(2)}. $${entry.toFixed(2)} did not trade.`);
        return;
      }
      if (entry - 1e-4 > range.high) {
        setFault(`The high that day was $${range.high.toFixed(2)}. $${entry.toFixed(2)} did not trade.`);
        return;
      }
    }
    const looked = quoteFor?.(strike, draft.right, draft.expiry);
    const fields = { strike, right: draft.right, side: draft.side, contracts, expiry: draft.expiry, entry, enteredOn: draft.enteredOn, addedMark: entry ?? (looked?.mark != null && looked.mark > 0 ? looked.mark : undefined) };
    if (position) updatePosition(position.id, fields);
    else addPosition({ ticker, ...fields });
    setOpen(false);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={o => {
        if (o) {
          setDraft(draftOf(position, { strike: defaultStrike }));
          setFault('');
          setWhich('entered');
        }
        setOpen(o);
      }}
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={6} collisionPadding={12} className={`${CARD} p-0 outline-none`} style={{ width: 560 }} data-position-form>
          <div className="px-4 pt-3 pb-2 border-b border-borderSubtle/70 flex items-baseline gap-2">
            <span className="text-t13 font-semibold text-textPrimary">{position ? 'Change this position' : `New position on ${ticker}`}</span>
            <span className="ml-auto text-t10 text-textMuted">premium in points per share, as your broker shows it</span>
          </div>
          <form
            className="px-4 py-3 flex flex-wrap items-end gap-3"
            onSubmit={e => {
              e.preventDefault();
              save();
            }}
          >
            <Field label="Strike" width={88}>
              <input className={inputCls} inputMode="decimal" value={draft.strike} onChange={e => set('strike', e.target.value)} data-field="strike" autoFocus />
            </Field>
            <Field label="Call or put">
              <Pills label="Call or put" value={draft.right} options={[{ value: 'C', label: 'Call', tone: 'bull' }, { value: 'P', label: 'Put', tone: 'bear' }]} onChange={v => set('right', v)} />
            </Field>
            <Field label="Own or sold">
              <Pills label="Own or sold" value={draft.side} options={[{ value: 'long', label: 'You own' }, { value: 'short', label: 'You sold' }]} onChange={v => set('side', v)} />
            </Field>
            <Field label="Contracts" width={72}>
              <input className={inputCls} inputMode="numeric" value={draft.contracts} onChange={e => set('contracts', e.target.value)} data-field="contracts" />
            </Field>
            <Field label="Entered" width={168}>
              <DateFace value={draft.enteredOn} on={which === 'entered'} onClick={() => setWhich('entered')} testId="entered" />
            </Field>
            <Field label="Expires" width={168}>
              <DateFace value={draft.expiry} on={which === 'expiry'} onClick={() => setWhich('expiry')} testId="expiry" />
            </Field>
            <Field label="What you paid (optional)" width={140}>
              <input className={inputCls} inputMode="decimal" placeholder="e.g. 2.10" title="Leave it blank and the position is marked at this tick's price — its return reads from there" value={draft.entry} onChange={e => set('entry', e.target.value)} data-field="entry" />
            </Field>
            <div className="basis-full rounded-md border border-borderSubtle bg-panel px-3 py-2" data-position-dates={which}>
              <DateBoard
                mode={which}
                value={which === 'entered' ? draft.enteredOn : draft.expiry}
                floor={which === 'expiry' ? draft.enteredOn : undefined}
                ceiling={which === 'entered' ? draft.expiry : undefined}
                onChange={iso => set(which === 'entered' ? 'enteredOn' : 'expiry', iso)}
              />
            </div>
            <div className="basis-full flex items-center justify-end gap-2 pt-1">
              {(fault || !dateOk) && (
                <span className="mr-auto text-t11 text-bear" data-entry-fault>
                  {fault || 'Entered has to be today or earlier, and not after the expiry.'}
                </span>
              )}
              <Popover.Close asChild>
                <button type="button" className="h-8 px-3 rounded-full border border-borderSubtle text-t12 text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors">
                  Cancel
                </button>
              </Popover.Close>
              <button type="submit" disabled={!valid} data-save-position className="h-8 px-4 rounded-full text-t12 font-semibold disabled:opacity-40 transition-opacity" style={{ background: SILVER_FILL, color: '#0a0a0a' }}>
                {position ? 'Save' : 'Add'}
              </button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default PositionForm;
