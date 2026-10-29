/* The inside half of the landing's embedded window (embed.ts): takes "open this page" and "wear this theme", reports ready, routes and Escape;
   same origin, own parent only. */

import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { EMBEDDED, type FromEmbed, type ToEmbed } from '../../embed';
import { getResolvedTheme, setThemeChoice, type Theme } from '../../theme/theme';

const say = (type: FromEmbed['type']) => {
  const msg: FromEmbed = { slayer: 'embed', type, path: window.location.pathname };
  window.parent.postMessage(msg, window.location.origin);
};

/** The theme changes as one page crossfade where supported (index.css times it), at once otherwise or under reduced
    motion. A timer (not a frame callback, which never fires while the browser holds rendering) holds a beat so the
    re-inked charts are in the new picture. */
const wear = (theme: Theme) => {
  if (getResolvedTheme() === theme) return;
  const run = () => flushSync(() => setThemeChoice(theme));
  const doc = document as Document & { startViewTransition?: (cb: () => void | Promise<void>) => unknown };
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || calm) return run();
  doc.startViewTransition(
    () =>
      new Promise<void>(done => {
        run();
        window.setTimeout(done, 60);
      })
  );
};

const EmbedBridge = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!EMBEDDED) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || e.origin !== window.location.origin) return;
      const msg = e.data as ToEmbed | null;
      if (!msg || msg.slayer !== 'landing') return;
      if (msg.type === 'go' && typeof msg.path === 'string' && msg.path.startsWith('/') && msg.path !== window.location.pathname) navigate(msg.path, { replace: true });
      if (msg.type === 'theme' && (msg.theme === 'dark' || msg.theme === 'light')) wear(msg.theme);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') say('escape');
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    say('ready');
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey);
    };
  }, [navigate]);

  useEffect(() => {
    if (EMBEDDED) say('route');
  }, [pathname]);

  return null;
};

export default EmbedBridge;
