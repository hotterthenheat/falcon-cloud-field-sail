/*
==================================================
  SLAYER TERMINAL - THE SIGN-IN PAGE (pages/signin/SignIn.tsx)

  Noah, with a picture (2026-10-03): "i like this
  type of one with the holo silver and gravity
  accents as our log in section and the google and
  apple being the colored icons, the with our logo
  at the top." So: one column in the middle of an
  empty page — the mark on its tile, a title and a
  line, the email and the password with its eye,
  one solid door in the house's foil (the holo foil
  on black, the galaxy ink on paper), "or continue
  with" Google and Apple in their own marks, and
  the two small lines under it. Three faces of the
  same column: sign in, create an account, a reset
  link; a fourth, the new password, when the reset
  link lands here.

  The doors are data/account.ts's; a signed-in
  reader is sent on to `?next=`, else to where the
  launch door lands (data/openDoor.ts).
==================================================
*/

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import SlayerMark from '../../brand/SlayerMark';
import { AppleMark, GoogleMark } from '../../brand/providerMarks';
import { MorphingInfinity, useBusy, useWorking } from '../../components/ui/Working';
import { checkPassword, providersOn, sendReset, setPassword, signIn, signInWithProvider, signUp, useAccount, type Provider } from '../../data/account';
import { doorTo } from '../../data/openDoor';
import { ACCOUNTS_ON } from '../../data/supabase';
import { useResolvedTheme } from '../../theme/theme';

type Face = 'in' | 'up' | 'reset';

const checkEmail = (v: string): string | null => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : 'That is not an email address.');

/** A field the column's width, on the chip ground; the password carries its eye */
const Field = ({ label, type, value, onChange, autoComplete, testId, onEnter, eye }: { label: string; type: 'email' | 'password' | 'text'; value: string; onChange: (v: string) => void; autoComplete?: string; testId: string; onEnter?: () => void; eye?: boolean }) => {
  const [shown, setShown] = useState(false);
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <input
        type={eye && shown ? 'text' : type}
        value={value}
        placeholder={label}
        autoComplete={autoComplete}
        spellCheck={false}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && onEnter) onEnter();
        }}
        className={`h-11 w-full rounded-[10px] border border-borderSubtle bg-chip text-[13.5px] text-textPrimary placeholder:text-textMuted outline-none transition-colors focus:border-borderMuted ${eye ? 'pl-3.5 pr-11' : 'px-3.5'}`}
        data-signin-field={testId}
      />
      {eye && (
        <button
          type="button"
          onClick={() => setShown(s => !s)}
          aria-label={shown ? 'Hide the password' : 'Show the password'}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center rounded-md text-textMuted hover:text-textPrimary transition-colors"
          data-signin-eye
        >
          {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      )}
    </label>
  );
};

/** The one solid door — the house's foil on black, the galaxy ink on paper */
const Solid = ({ children, onClick, busy, testId }: { children: ReactNode; onClick: () => void; busy: boolean; testId: string }) => {
  const theme = useResolvedTheme();
  const working = useWorking(busy);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      className={`h-11 w-full rounded-[10px] inline-flex items-center justify-center gap-2 text-[13.5px] font-medium transition-opacity disabled:cursor-progress ${theme === 'dark' ? 'holo-bg text-[#0a0a0a]' : 'galaxy-bg'}`}
      data-signin-go={testId}
    >
      {children}
      {working && <MorphingInfinity viewBox="4 4 16 16" className="w-3.5 h-3.5" />}
    </button>
  );
};

/** A provider's door — its own mark, the house's quiet border */
const ProviderDoor = ({ provider, children, onClick, testId }: { provider: Provider; children: ReactNode; onClick: () => void; testId: string }) => (
  <button
    type="button"
    onClick={onClick}
    className="h-11 flex-1 rounded-[10px] border border-borderSubtle bg-panel hover:border-borderMuted inline-flex items-center justify-center gap-2 text-[13px] text-textPrimary transition-colors"
    data-signin-provider={testId}
  >
    {provider === 'google' ? <GoogleMark size={16} /> : <AppleMark size={15} className="-mt-px" />}
    {children}
  </button>
);

const quiet = 'text-[12.5px] text-textSecondary';
const act = 'text-textPrimary hover:underline underline-offset-2 transition-colors';

const SignIn = () => {
  const account = useAccount();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const [face, setFace] = useState<Face>(params.get('face') === 'up' ? 'up' : 'in');
  const [email, setEmail] = useState('');
  const [password, setPw] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, run] = useBusy();
  /* ONLY THE DOORS THAT OPEN (2026-10-10): the providers the project has switched on, asked once; until the answer no
     door is drawn — a door drawn and then taken away is worse than one that arrives a beat later. Apple stays hidden
     until Apple is set up. */
  const [doors, setDoors] = useState<Record<Provider, boolean> | null>(null);
  useEffect(() => {
    let live = true;
    providersOn().then(d => live && setDoors(d));
    return () => {
      live = false;
    };
  }, []);
  const open: Provider[] = doors ? (['google', 'apple'] as Provider[]).filter(p => doors[p]) : [];

  /* signed in, and not here to choose a new password: on to the page */
  useEffect(() => {
    if (account.status === 'in' && !account.recovering) navigate(next && next.startsWith('/') ? next : doorTo(), { replace: true });
  }, [account.status, account.recovering, navigate, next]);

  /* a provider that sent the browser back with a complaint (in the address, as the service puts it) says so in plain words */
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const said = params.get('error_description') ?? hash.get('error_description');
    if (!said) return;
    const m = said.toLowerCase();
    setProblem(m.includes('not enabled') || m.includes('unsupported provider') ? 'That sign-in is not switched on yet.' : said);
  }, [params]);

  const turn = (f: Face) => {
    setFace(f);
    setProblem(null);
    setNote(null);
  };

  const go = () =>
    run(async () => {
      setProblem(null);
      setNote(null);
      if (account.recovering) {
        const why = checkPassword(password);
        if (why) return setProblem(why);
        const r = await setPassword(password);
        if (!r.ok) setProblem(r.why);
        return;
      }
      const e = email.trim();
      const whyEmail = !e ? 'Your email address first.' : checkEmail(e);
      if (whyEmail) return setProblem(whyEmail);
      if (face === 'reset') {
        const r = await sendReset(e);
        return r.ok ? setNote(`A reset link is on its way to ${e}. Open it and choose a new password.`) : setProblem(r.why);
      }
      const whyPw = !password ? 'A password too.' : face === 'up' ? checkPassword(password) : null;
      if (whyPw) return setProblem(whyPw);
      if (face === 'up') {
        const r = await signUp(e, password, name.trim());
        if (!r.ok) return setProblem(r.why);
        if (r.confirm) setNote(`One more step: we sent a link to ${e}. Open it and you are in.`);
        return;
      }
      const r = await signIn(e, password);
      if (!r.ok) setProblem(r.why);
    });

  const provider = (p: Provider) =>
    run(async () => {
      setProblem(null);
      const r = await signInWithProvider(p, next);
      if (!r.ok) setProblem(r.why);
    });

  const recovering = account.recovering;
  const title = recovering ? 'Choose a new password' : face === 'up' ? 'Create your account' : face === 'reset' ? 'Reset your password' : 'Sign in to Slayer';
  const line = recovering
    ? 'You opened the reset link. Pick the new one and you are back in.'
    : face === 'up'
      ? 'Your picture, name and handle, kept with you between machines.'
      : face === 'reset'
        ? 'Tell us the address and a link goes to its inbox.'
        : 'The desk, the book and the tape, on your own account.';

  return (
    <div className="min-h-screen bg-canvas text-textPrimary flex items-center justify-center px-6 py-16 font-sans" data-signin-page data-signin-face={recovering ? 'new-password' : face}>
      <div className="w-full max-w-[340px] flex flex-col">
        {/* THE MARK on its tile, the door home */}
        <Link to="/" className="inline-flex w-fit rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-silver" aria-label="Slayer Terminal, the front page">
          <SlayerMark size={44} label="" />
        </Link>
        <h1 className="mt-6 text-[17px] font-semibold leading-tight">{title}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">{line}</p>

        {!ACCOUNTS_ON ? (
          <p className="mt-6 text-[12.5px] text-textMuted" data-signin-off>
            The account service is not set up on this build.
          </p>
        ) : (
          <>
            <div className="mt-7 flex flex-col gap-2.5">
              {!recovering && face === 'up' && <Field label="Name" type="text" value={name} onChange={setName} autoComplete="name" testId="name" />}
              {!recovering && <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" testId="email" onEnter={go} />}
              {(recovering || face !== 'reset') && (
                <Field label={recovering ? 'New password' : 'Password'} type="password" value={password} onChange={setPw} autoComplete={face === 'in' && !recovering ? 'current-password' : 'new-password'} testId="password" onEnter={go} eye />
              )}
              {problem && (
                <p role="alert" className="text-[12px] text-warn" data-signin-problem>
                  {problem}
                </p>
              )}
              {note && !problem && (
                <p className="text-[12px] text-textSecondary" data-signin-note>
                  {note}
                </p>
              )}
              <Solid onClick={go} busy={busy} testId={recovering ? 'new-password' : face}>
                {recovering ? 'Keep it' : face === 'up' ? 'Create the account' : face === 'reset' ? 'Send the link' : 'Sign in'}
              </Solid>
            </div>
            {/* the agreement, named where the account is made (2026-10-05) */}
            {face === 'up' && !recovering && (
              <p className={`${quiet} mt-3 text-center text-[11.5px] text-textMuted`} data-signin-agree>
                Creating the account means you agree to the{' '}
                <Link to="/terms" className={act}>
                  Terms
                </Link>{' '}
                and the{' '}
                <Link to="/privacy" className={act}>
                  Privacy Policy
                </Link>
                .
              </p>
            )}

            {!recovering && face !== 'reset' && open.length > 0 && (
              <>
                {/* OR CONTINUE WITH — their marks, the house's doors; only the providers the project has switched on */}
                <div className="mt-6 flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-borderSubtle" />
                  <span className="text-[11px] text-textMuted">or continue with</span>
                  <span className="h-px flex-1 bg-borderSubtle" />
                </div>
                <div className="mt-4 flex items-center gap-2.5 animate-soft-in" data-signin-doors={open.join(',')}>
                  {open.map(p => (
                    <ProviderDoor key={p} provider={p} onClick={() => provider(p)} testId={p}>
                      {p === 'google' ? 'Google' : 'Apple'}
                    </ProviderDoor>
                  ))}
                </div>
              </>
            )}

            {/* THE TWO SMALL LINES */}
            <div className="mt-7 flex flex-col gap-1.5">
              {!recovering && face === 'in' && (
                <>
                  <button type="button" onClick={() => turn('reset')} className={`${quiet} ${act} w-fit`} data-signin-forgot>
                    Forgot your password?
                  </button>
                  <p className={quiet}>
                    No account yet?{' '}
                    <button type="button" onClick={() => turn('up')} className={act} data-signin-to-up>
                      Create one
                    </button>
                  </p>
                </>
              )}
              {!recovering && face === 'up' && (
                <p className={quiet}>
                  Have an account?{' '}
                  <button type="button" onClick={() => turn('in')} className={act} data-signin-to-in>
                    Sign in
                  </button>
                </p>
              )}
              {!recovering && face === 'reset' && (
                <button type="button" onClick={() => turn('in')} className={`${quiet} ${act} w-fit`} data-signin-back>
                  Back to sign in
                </button>
              )}
              <p className="mt-2 text-[11.5px] text-textMuted">The terminal stays open without an account.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SignIn;
