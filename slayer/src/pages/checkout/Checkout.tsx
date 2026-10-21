/*
==================================================
  SLAYER TERMINAL - THE CHECKOUT, OURS (pages/checkout/Checkout.tsx)

  Noah, of Stripe's hosted page (2026-10-10): "the
  shapes and spaces are off." Its spaces were
  Stripe's; every knob the hosted page offered was
  turned and the form column stayed white. So the
  checkout is our own page now, in the sign-in
  page's clothes and the landing's type:

    THE ORDER on the left — the plan, its price in
    the landing's big light numerals, the period
    and the door to the other one, a promotion
    code, the session's own figures as dot-leader
    rows (subtotal · promotion · due today).

    THE PAYMENT on the right — Stripe's framed
    fields dressed in our tokens, as tabs: Card
    first, then the wallets this browser can pay
    with (Google Pay, Apple Pay), then the rest;
    the Pay door in the house's foil, and the fine
    print.

  The card is typed into Stripe's frames and never
  reaches us: the session is made by the project's
  stripe-checkout function in Stripe's "elements"
  mode, which hands back a client secret; the page
  mounts Stripe's fields with it. A card completes
  in place and the person lands on Settings ›
  Billing, where Stripe's word arrives a breath
  later; a redirect-based method comes back to the
  same place by the session's return address.

  `/checkout?plan=book|tape|desk&period=month|year`
  Signed out → the sign-in page, then back here.
  Someone already on a plan is sent to the portal.
  In development only, `?cs=<client secret>` mounts
  a session made by hand, so the page can be looked
  at without an account.
==================================================
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { Appearance, StripeCheckoutConfirmResult } from '@stripe/stripe-js';
import { CheckoutElementsProvider, ExpressCheckoutElement, PaymentElement, useCheckoutElements, type StripeCheckoutElementsValue } from '@stripe/react-stripe-js/checkout';
import SlayerMark from '../../brand/SlayerMark';
import Fact from '../../components/ui/Fact';
import { Skeleton } from '../../components/ui/Skeleton';
import { MorphingInfinity, useBusy, useWorking } from '../../components/ui/Working';
import { settleAfterPurchase, useAccount } from '../../data/account';
import { BILLING_ON, confirmUpgrade, fmtDollars, fmtWhen, planKeyOf, planOf, priceOf, takeCheckout, type CheckoutMade, type Period, type PlanKey } from '../../data/billing';
import { stripeLoader } from '../../data/stripeLoader';
import { FONT_SANS } from '../../theme/fonts';
import { readToken, useResolvedTheme, type Theme } from '../../theme/theme';

const SOLD = new Set<PlanKey>(['book', 'tape', 'desk']);
type Upgrade = Extract<CheckoutMade, { kind: 'upgrade' }>;

/** STRIPE'S FRAMES IN OUR TOKENS: the frames cannot read var(), so every colour is read off the document at mount —
    the chip ground and the quiet border of the house's fields, Inter, 10px corners, the silver for the focus and the
    chosen tab, the house's orange for a complaint. Night under dark, Stripe's plain theme under paper. */
const appearanceFor = (theme: Theme): Appearance => ({
  theme: theme === 'dark' ? 'night' : 'stripe',
  labels: 'above',
  variables: {
    fontFamily: FONT_SANS,
    fontSizeBase: '13.5px',
    fontWeightNormal: '400',
    fontWeightMedium: '500',
    borderRadius: '10px',
    spacingUnit: '4px',
    colorPrimary: readToken('--silver'),
    colorBackground: readToken('--chip'),
    colorText: readToken('--text-primary'),
    colorTextSecondary: readToken('--text-secondary'),
    colorTextPlaceholder: readToken('--text-muted'),
    colorIcon: readToken('--text-secondary'),
    colorDanger: readToken('--warn'),
  },
  rules: {
    '.Input': { border: `1px solid ${readToken('--border-subtle')}`, boxShadow: 'none', padding: '12px 14px', fontSize: '13.5px' },
    '.Input:focus': { border: `1px solid ${readToken('--border-muted')}`, boxShadow: 'none', outline: 'none' },
    '.Input--invalid': { boxShadow: 'none' },
    '.Label': { fontSize: '12px', color: readToken('--text-secondary'), marginBottom: '6px' },
    '.Tab': { border: `1px solid ${readToken('--border-subtle')}`, backgroundColor: readToken('--chip'), boxShadow: 'none', padding: '10px 12px' },
    '.Tab:hover': { border: `1px solid ${readToken('--border-muted')}` },
    /* the chosen way keeps the panel ground with the silver on its edge — Stripe's night theme would fill it with the
       primary colour and the label vanished into it */
    '.Tab--selected': { backgroundColor: readToken('--panel'), border: `1px solid ${readToken('--silver', 0.6)}`, boxShadow: 'none', color: readToken('--text-primary') },
    '.Tab--selected:hover': { backgroundColor: readToken('--panel'), border: `1px solid ${readToken('--silver', 0.8)}` },
    '.Tab--selected:focus': { boxShadow: 'none', backgroundColor: readToken('--panel') },
    '.TabIcon--selected': { fill: readToken('--text-primary') },
    '.TabLabel--selected': { color: readToken('--text-primary') },
    '.Block': { backgroundColor: readToken('--panel'), border: `1px solid ${readToken('--border-subtle')}`, boxShadow: 'none' },
    '.AccordionItem': { backgroundColor: readToken('--panel'), border: `1px solid ${readToken('--border-subtle')}`, boxShadow: 'none' },
    '.Error': { fontSize: '12px' },
    '.CheckboxInput': { backgroundColor: readToken('--chip'), border: `1px solid ${readToken('--border-muted')}` },
  },
});
/* the site's own Inter, for the frames — Stripe fetches it from our origin */
const fontsFor = () => [{ family: 'Inter', src: `url(${window.location.origin}/fonts/InterVariable.woff2) format('woff2')`, weight: '100 900' }];

const field = 'h-10 w-full rounded-[10px] border border-borderSubtle bg-chip px-3.5 text-[13.5px] text-textPrimary placeholder:text-textMuted outline-none transition-colors focus:border-borderMuted';
const ghost = 'h-10 shrink-0 px-4 rounded-full border border-borderMuted text-[13px] font-medium text-textPrimary hover:border-textPrimary/70 hover:bg-ink/[0.06] transition-colors disabled:opacity-50';

/** a Stripe amount in the house's figure — whole dollars as the landing prints them, cents only when there are cents */
const money = (a: { minorUnitsAmount: number; amount: string }): string => (a.minorUnitsAmount % 100 === 0 ? fmtDollars(a.minorUnitsAmount / 100) : a.amount);
/** cents from the function, the same way */
const fmtCents = (cents: number): string => (cents % 100 === 0 ? fmtDollars(cents / 100) : `$${(cents / 100).toFixed(2)}`);

/* ── THE UPGRADE ─────────────────────────────────────────────────────────────────────────────────────────────────────
   Someone already on a plan, asking for a higher one (or the same by the year): no card fields — the card on file pays
   the difference today and the plan moves now (Noah, 2026-10-10: the walls "tease the user so they can upgrade their
   plan to the highest one"). One door, the figures beside it in the order column. */
const UpgradeFace = ({ planKey, period, upgrade }: { planKey: PlanKey; period: Period; upgrade: Upgrade }) => {
  const theme = useResolvedTheme();
  const navigate = useNavigate();
  const [busy, run] = useBusy();
  const working = useWorking(busy);
  const [problem, setProblem] = useState<string | null>(null);
  const to = planOf(planKey);
  const from = planOf(upgrade.from);
  const go = () =>
    run(async () => {
      setProblem(null);
      const r = await confirmUpgrade(planKey, period);
      if (!r.ok) return setProblem(r.why);
      if (r.kind !== 'upgraded') return setProblem('Stripe did not move the plan. Nothing was charged.');
      settleAfterPurchase();
      navigate('/start?checkout=success');
    });
  return (
    <section data-checkout-upgrade={`${upgrade.from}>${planKey}`}>
      <div className="rounded-lg border border-borderSubtle bg-panel p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-textMuted">Your plan today</p>
        <p className="mt-1.5 text-[15px] font-semibold text-textPrimary">
          {from.name}, {upgrade.fromPeriod === 'year' ? 'by the year' : 'monthly'}
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-textSecondary">
          Moving to {to.name} happens now: the rooms open the moment you press, and the card you have with us pays {fmtCents(upgrade.dueToday)} today for the rest of this period.
          {upgrade.nextOn ? ` From ${fmtWhen(upgrade.nextOn)} it is ${priceOf(planKey, period).price} ${priceOf(planKey, period).period}.` : ''}
        </p>
      </div>
      {problem && (
        <p role="alert" className="mt-3 text-[12px] text-warn" data-checkout-problem>
          {problem}
        </p>
      )}
      <button
        type="button"
        onClick={go}
        disabled={busy}
        aria-busy={busy || undefined}
        className={`mt-5 h-12 w-full rounded-full inline-flex items-center justify-center gap-2 text-[15px] font-medium transition-opacity disabled:opacity-70 disabled:cursor-progress ${theme === 'dark' ? 'holo-bg text-[#0a0a0a]' : 'galaxy-bg'}`}
        data-checkout-go="upgrade"
      >
        Upgrade to {to.name} — {fmtCents(upgrade.dueToday)} today
        {working && <MorphingInfinity viewBox="4 4 16 16" className="w-4 h-4" />}
      </button>
      <p className="mt-3 text-[11.5px] leading-relaxed text-textMuted" data-checkout-fine>
        Cancel any time from Settings › Billing; the rooms stay open until the period paid for ends. Nothing is typed here; Stripe charges the card it already holds.
      </p>
    </section>
  );
};

/* ── THE ORDER ───────────────────────────────────────────────────────────────────────────────────────────────────── */
const Order = ({ planKey, period, checkout, upgrade = null }: { planKey: PlanKey; period: Period; checkout: StripeCheckoutElementsValue | null; upgrade?: Upgrade | null }) => {
  const plan = planOf(planKey);
  const priced = priceOf(planKey, period);
  const other: Period = period === 'month' ? 'year' : 'month';
  const [code, setCode] = useState('');
  const [codeProblem, setCodeProblem] = useState<string | null>(null);
  const [busy, run] = useBusy();
  const applied = checkout?.discountAmounts?.[0] ?? null;
  const apply = () =>
    run(async () => {
      if (!checkout || !code.trim()) return;
      setCodeProblem(null);
      const r = await checkout.applyPromotionCode(code.trim());
      if (r.type === 'error') setCodeProblem(r.error.message);
      else setCode('');
    });
  const remove = () =>
    run(async () => {
      if (!checkout) return;
      setCodeProblem(null);
      await checkout.removePromotionCode();
    });
  return (
    <section data-checkout-order>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-textMuted">Your plan</p>
      <h1 className="mt-2 text-[28px] font-medium tracking-tight leading-none">{plan.name}</h1>
      <p className="mt-2 max-w-[36ch] text-[14px] leading-snug text-textSecondary">{plan.kicker}</p>
      <p className="mt-6 flex items-baseline gap-2" data-checkout-price>
        <span className="text-[44px] sm:text-[52px] font-light leading-none tracking-[-0.045em] tnum">{priced.price}</span>
        <span className="font-mono text-[11px] text-textMuted">{priced.period}</span>
      </p>
      {priced.aMonth && <p className="mt-1.5 font-mono text-[11px] tnum text-textMuted">{priced.aMonth}</p>}
      <p className="mt-4 text-[12.5px] leading-relaxed text-textSecondary" data-checkout-period={period}>
        {period === 'month' ? 'Billed monthly. ' : 'Billed once a year, two months free. '}
        <Link to={`/checkout?plan=${planKey}&period=${other}`} className="text-textPrimary hover:underline underline-offset-2" data-checkout-other-period>
          {period === 'month' ? 'Pay for a year instead' : 'Pay monthly instead'}
        </Link>
        {period === 'month' ? ' and two months are free.' : '.'}
      </p>

      {/* A PROMOTION CODE — one field and its door; the code applied shows as a line of the figures below (not on an
          upgrade: the card on file pays the difference, and Stripe takes no code on a move) */}
      <div className={upgrade ? 'hidden' : 'mt-8'}>
        {applied ? (
          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-borderSubtle bg-panel px-3.5 h-10" data-checkout-code-applied={applied.promotionCode ?? ''}>
            <span className="text-[12.5px] text-textSecondary">
              Code <span className="font-mono text-textPrimary">{applied.promotionCode ?? applied.displayName}</span> applied
            </span>
            <button type="button" onClick={remove} disabled={busy} className="text-[12px] text-textMuted hover:text-textPrimary transition-colors" data-checkout-code-remove>
              Remove
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <label className="flex-1 min-w-0">
              <span className="sr-only">Promotion code</span>
              <input
                value={code}
                onChange={e => setCode(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') apply();
                }}
                placeholder="Promotion code"
                spellCheck={false}
                autoComplete="off"
                disabled={!checkout}
                className={`${field} disabled:opacity-60`}
                data-checkout-code
              />
            </label>
            <button type="button" onClick={apply} disabled={!checkout || busy || !code.trim()} className={ghost} data-checkout-code-apply>
              Apply
            </button>
          </div>
        )}
        {codeProblem && (
          <p role="alert" className="mt-2 text-[12px] text-warn" data-checkout-code-problem>
            {codeProblem}
          </p>
        )}
      </div>

      {/* THE FIGURES — the session's own, once it stands; until then the plan's price is the whole story. On an upgrade:
          what the card on file pays today (the difference for the rest of the period), and the new price from the day
          the period turns */}
      {upgrade ? (
        <div className="mt-8 flex flex-col gap-1.5 border-t border-borderSubtle pt-4" data-checkout-facts="upgrade">
          <Fact label="Due today" value={fmtCents(upgrade.dueToday)} big />
          <p className="font-mono text-[10px] text-textMuted">the difference for the rest of this period, on the card you have with us</p>
          <Fact label={upgrade.nextOn ? `From ${fmtWhen(upgrade.nextOn)}` : 'Then'} value={`${priced.price} ${priced.period}`} />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-1.5 border-t border-borderSubtle pt-4" data-checkout-facts={checkout ? 'live' : 'plan'}>
          <Fact label="Subtotal" value={checkout ? money(checkout.total.subtotal) : priced.price} />
          {checkout && checkout.total.discount.minorUnitsAmount > 0 && <Fact label="Promotion" value={`− ${money(checkout.total.discount)}`} />}
          {checkout && checkout.total.taxExclusive.minorUnitsAmount > 0 && <Fact label="Tax" value={money(checkout.total.taxExclusive)} />}
          <Fact label="Due today" value={checkout ? money(checkout.total.total) : priced.price} big />
        </div>
      )}
    </section>
  );
};

/* ── THE PAYMENT'S SHAPE ─────────────────────────────────────────────────────────────────────────────────────────────
   What stands in the payment column until Stripe's fields are drawn: the column in its own shape — the four ways, the
   card number, the date and the code side by side, the country, the ZIP, the mandate's two lines, the door, the fine
   print — at their real sizes, so Stripe's fields land where the shape stood and the change is one crossfade (Noah,
   2026-10-10: "the dropdown animation when stripe loads the payment info placeholders is glitchy"). Stripe's own
   loading skeleton is switched off; this is the one that shows. */
const FieldShape = ({ label, className = '' }: { label: number; className?: string }) => (
  <div className={className}>
    <Skeleton line className="h-[10px] mb-[9px]" style={{ width: label }} />
    <Skeleton className="h-10 w-full rounded-[10px]" />
  </div>
);
const PayShape = () => (
  <div aria-hidden className="flex flex-col" data-checkout-shape>
    <div className="grid grid-cols-4 gap-2">
      {[0, 1, 2, 3].map(i => (
        <Skeleton key={i} className="h-[54px] rounded-[10px]" />
      ))}
    </div>
    <FieldShape label={72} className="mt-4" />
    <div className="mt-4 grid grid-cols-2 gap-3">
      <FieldShape label={84} />
      <FieldShape label={78} />
    </div>
    <FieldShape label={46} className="mt-4" />
    <FieldShape label={54} className="mt-4" />
    <div className="mt-5 flex flex-col gap-2">
      <Skeleton line className="h-[10px] w-[88%]" />
      <Skeleton line className="h-[10px] w-[52%]" />
    </div>
    <Skeleton className="mt-5 h-12 w-full rounded-full" />
    <div className="mt-3 flex flex-col gap-2">
      <Skeleton line className="h-[9px] w-[96%]" />
      <Skeleton line className="h-[9px] w-[92%]" />
      <Skeleton line className="h-[9px] w-[40%]" />
    </div>
  </div>
);

/* ── THE PAYMENT ─────────────────────────────────────────────────────────────────────────────────────────────────── */
const Pay = ({ checkout, period }: { checkout: StripeCheckoutElementsValue; period: Period }) => {
  const theme = useResolvedTheme();
  const navigate = useNavigate();
  const [busy, run] = useBusy();
  const working = useWorking(busy);
  const [problem, setProblem] = useState<string | null>(null);
  /* the Apple Pay row above the form — shown once Stripe says the button can draw here */
  const [wallets, setWallets] = useState(false);
  const [email, setEmail] = useState('');
  /* the shape stands until Stripe says its fields are drawn; then the fields fade in over it and it goes */
  const [ready, setReady] = useState(false);
  const [shapeGone, setShapeGone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => setShapeGone(true), 400);
    return () => window.clearTimeout(t);
  }, [ready]);
  /* PAID: the start page — every room a card, pick where to begin (Noah, 2026-10-10: "it should be the 8 page layout
     where the user can choose where they want to go"); the row is read again behind it until Stripe's word lands */
  const done = (r: StripeCheckoutConfirmResult) => {
    if (r.type === 'error') return setProblem(r.error.message);
    settleAfterPurchase();
    navigate('/start?checkout=success');
  };
  const pay = () =>
    run(async () => {
      setProblem(null);
      if (!checkout.email) {
        const e = await checkout.updateEmail(email.trim());
        if (e.type === 'error') return setProblem(e.error.message);
      }
      done(await checkout.confirm({ redirect: 'if_required' }));
    });
  const due = money(checkout.total.total);
  return (
    <section className="relative" data-checkout-pay data-checkout-ready={ready || undefined}>
      {!shapeGone && (
        <div className={`transition-opacity duration-300 ease-out ${ready ? 'absolute inset-x-0 top-0 opacity-0 pointer-events-none' : ''}`}>
          <PayShape />
        </div>
      )}
      <div className={`transition-opacity duration-300 ease-out ${ready ? 'opacity-100' : 'absolute inset-x-0 top-0 opacity-0 pointer-events-none'}`} data-checkout-fields-host>
      {/* APPLE PAY, ON EVERY DESKTOP (Noah, 2026-10-12, with a competitor's Stripe page showing Apple Pay on his Windows
          Chrome): on Chrome, Edge and Firefox Apple Pay exists only as this one-click button, asked for with `always`, and
          it hands the payment to the phone by a code to scan (iOS 18 or later); as a tab in the form below it never
          draws outside Safari. So Apple Pay lives HERE, on every browser, and nowhere else; Google Pay stays a tab in the
          form, where Noah put it. The row opens only when Stripe says the button can draw — never on localhost. */}
      <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: wallets ? '1fr' : '0fr' }} data-checkout-wallets={wallets || undefined}>
        <div className="min-h-0 overflow-hidden">
          <ExpressCheckoutElement
            options={{
              buttonHeight: 44,
              layout: { maxColumns: 1, maxRows: 1, overflow: 'never' },
              buttonTheme: theme === 'dark' ? { applePay: 'white', googlePay: 'white', paypal: 'white' } : { applePay: 'black', googlePay: 'black', paypal: 'black' },
              buttonType: { applePay: 'subscribe' },
              paymentMethodOrder: undefined,
              paymentMethods: { applePay: 'always', googlePay: 'never', link: 'never', paypal: 'never', amazonPay: 'never', klarna: 'never' },
            }}
            onReady={e => setWallets(!!e.availablePaymentMethods?.applePay)}
            onConfirm={e => run(async () => done(await checkout.confirm({ expressCheckoutConfirmEvent: e, redirect: 'if_required' })))}
          />
          <div className="my-5 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-borderSubtle" />
            <span className="text-[11px] text-textMuted">or pay another way</span>
            <span className="h-px flex-1 bg-borderSubtle" />
          </div>
        </div>
      </div>
      {/* the address the receipt goes to — already known from the account; asked only if Stripe has none */}
      {!checkout.email && (
        <label className="block mb-3">
          <span className="block mb-1.5 text-[12px] text-textSecondary">Email</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" spellCheck={false} className={field} data-checkout-email />
        </label>
      )}
      {/* STRIPE'S FRAMES — the card and the other ways, dressed in our tokens, as TABS. GOOGLE PAY IS A TAB (Noah,
          2026-10-11: "i want google pay to be in the position where amazon pay is"): it stands right after Card when the
          browser can pay with it — Chrome with a real card saved in Google Pay — on HTTPS, on an address registered with
          Stripe (Settings → Payment method domains); never on localhost. Apple Pay is NOT a tab: it is the button above,
          on every browser, so a wallet has one place. Link's own sign-up block (an email, a phone, a checkbox) stays out
          of the card form. */}
      <div data-checkout-fields>
        <PaymentElement
          options={{
            layout: { type: 'tabs', defaultCollapsed: false },
            wallets: { link: 'never', applePay: 'never' },
            paymentMethodOrder: ['card', 'google_pay', 'cashapp', 'amazon_pay'],
          }}
          onReady={() => setReady(true)}
        />
      </div>
      {problem && (
        <p role="alert" className="mt-3 text-[12px] text-warn" data-checkout-problem>
          {problem}
        </p>
      )}
      {/* the door stands lit the whole time — a press on an empty form gets Stripe's own word under it, not a dimmed door */}
      <button
        type="button"
        onClick={pay}
        disabled={busy}
        aria-busy={busy || undefined}
        className={`mt-5 h-12 w-full rounded-full inline-flex items-center justify-center gap-2 text-[15px] font-medium transition-opacity disabled:opacity-70 disabled:cursor-progress ${theme === 'dark' ? 'holo-bg text-[#0a0a0a]' : 'galaxy-bg'}`}
        data-checkout-go
      >
        Pay {due} {period === 'year' ? 'a year' : 'a month'}
        {working && <MorphingInfinity viewBox="4 4 16 16" className="w-4 h-4" />}
      </button>
      <p className="mt-3 text-[11.5px] leading-relaxed text-textMuted" data-checkout-fine>
        Cancel any time from Settings › Billing; the rooms stay open until the period paid for ends. The card goes into Stripe’s own fields and never reaches us. By paying you agree to the{' '}
        <Link to="/terms" className="text-textSecondary hover:text-textPrimary hover:underline underline-offset-2">
          Terms
        </Link>
        .
      </p>
      </div>
    </section>
  );
};

/** inside Stripe's provider: the session, once it stands, feeds both columns */
const Live = ({ planKey, period }: { planKey: PlanKey; period: Period }) => {
  const c = useCheckoutElements();
  if (c.type === 'error')
    return (
      <>
        <Order planKey={planKey} period={period} checkout={null} />
        <Problem why={c.error.message} />
      </>
    );
  if (c.type === 'loading')
    return (
      <>
        <Order planKey={planKey} period={period} checkout={null} />
        <Waiting />
      </>
    );
  return (
    <>
      <Order planKey={planKey} period={period} checkout={c.checkout} />
      <Pay checkout={c.checkout} period={period} />
    </>
  );
};

/** the payment column while the session is asked for and while Stripe lays its fields out: the column's own shape */
const Waiting = () => (
  <section data-checkout-waiting>
    <PayShape />
  </section>
);

const Problem = ({ why, onRetry }: { why: string; onRetry?: () => void }) => {
  const theme = useResolvedTheme();
  return (
    <section data-checkout-state="problem">
      <h2 className="text-[17px] font-semibold leading-tight">Stripe did not open</h2>
      <p role="alert" className="mt-1.5 text-[13px] leading-relaxed text-warn" data-checkout-line>
        {why}
      </p>
      <div className="mt-6 flex flex-col gap-2.5">
        {onRetry && (
          <button type="button" onClick={onRetry} className={`h-11 w-full rounded-[10px] inline-flex items-center justify-center text-[13.5px] font-medium ${theme === 'dark' ? 'holo-bg text-[#0a0a0a]' : 'galaxy-bg'}`} data-checkout-retry>
            Try again
          </button>
        )}
        <Link to="/settings/billing" className="h-11 w-full rounded-[10px] border border-borderSubtle bg-panel hover:border-borderMuted inline-flex items-center justify-center text-[13px] text-textPrimary transition-colors" data-checkout-billing>
          Back to Billing
        </Link>
      </div>
    </section>
  );
};

/* ── THE PAGE ────────────────────────────────────────────────────────────────────────────────────────────────────── */
const Checkout = () => {
  const account = useAccount();
  const theme = useResolvedTheme();
  const [params] = useSearchParams();
  const plan = params.get('plan');
  const key = plan ? planKeyOf(plan) : null;
  const period: Period = params.get('period') === 'year' ? 'year' : 'month';
  /* development only: a session made by hand, so the page can be looked at without an account */
  const devSecret = import.meta.env.DEV ? params.get('cs') : null;
  const [clientSecret, setClientSecret] = useState<string | null>(devSecret);
  const [upgrade, setUpgrade] = useState<Upgrade | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const asked = useRef<number>(-1);
  const stripe = useMemo(stripeLoader, []);
  /* Stripe's own loading skeleton is off: the column's shape (PayShape) stands in until the fields are drawn */
  const options = useMemo(() => (clientSecret ? { clientSecret, elementsOptions: { appearance: appearanceFor(theme), fonts: fontsFor(), loader: 'never' as const } } : null), [clientSecret, theme]);

  /* the moment the account is known, ask for the session — once per try */
  useEffect(() => {
    if (devSecret || !BILLING_ON || !key || !SOLD.has(key) || account.status !== 'in' || asked.current === tries) return;
    asked.current = tries;
    setProblem(null);
    setClientSecret(null);
    setUpgrade(null);
    void takeCheckout(key, period).then(r => {
      if (!r.ok) return setProblem(r.why);
      if (r.kind === 'portal') {
        window.location.assign(r.url);
        return;
      }
      if (r.kind === 'upgrade') return setUpgrade(r);
      if (r.kind === 'mount') return setClientSecret(r.clientSecret);
      /* 'upgraded' never comes from a plain ask */
      setProblem('Billing answered out of turn. Try again.');
    });
  }, [account.status, key, period, tries, devSecret]);

  if (!key || !SOLD.has(key)) return <Navigate to="/#pricing" replace />;
  if (account.status === 'out' && !devSecret) return <Navigate to={`/signin?face=up&next=${encodeURIComponent(`/checkout?plan=${key}&period=${period}`)}`} replace />;

  const state = !BILLING_ON ? 'off' : problem ? 'problem' : upgrade ? 'upgrade' : clientSecret ? 'live' : account.status === 'in' || devSecret ? 'asking' : 'account';
  return (
    <div className="min-h-screen bg-canvas text-textPrimary font-sans px-6 py-12 lg:py-16 flex justify-center" data-checkout-page data-checkout-state={state}>
      <div className="w-full max-w-[960px]">
        <Link to="/" className="inline-flex w-fit rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-silver" aria-label="Slayer Terminal, the front page">
          <SlayerMark size={44} label="" />
        </Link>
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] gap-x-20 gap-y-12">
          {!BILLING_ON ? (
            <>
              <Order planKey={key} period={period} checkout={null} />
              <section>
                <h2 className="text-[17px] font-semibold leading-tight">Payments open at launch</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">The plans are on the page; the doors open the day we launch.</p>
              </section>
            </>
          ) : problem ? (
            <>
              <Order planKey={key} period={period} checkout={null} />
              <Problem why={problem} onRetry={() => setTries(t => t + 1)} />
            </>
          ) : upgrade ? (
            <>
              <Order planKey={key} period={period} checkout={null} upgrade={upgrade} />
              <UpgradeFace planKey={key} period={period} upgrade={upgrade} />
            </>
          ) : options ? (
            <CheckoutElementsProvider key={clientSecret ?? ''} stripe={stripe} options={options}>
              <Live planKey={key} period={period} />
            </CheckoutElementsProvider>
          ) : (
            <>
              <Order planKey={key} period={period} checkout={null} />
              <Waiting />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Checkout;
