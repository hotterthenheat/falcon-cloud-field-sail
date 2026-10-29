import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { proxyUw } from './server/uwProxy.mjs';
import { proxyTheta } from './server/thetaProxy.mjs';
import { proxyLogo } from './server/logoProxy.mjs';
import { compassMount } from './server/compassApi.mjs';
import { superviseTheta } from './theta/supervisor.mjs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import nodePath from 'node:path';

/* The data proxies (server/) run inside the dev and preview servers; their keys stay in this process.
   Any other /api path answers 404 instead of falling through to the SPA's index.html. */
const dataProxies = (): Plugin => {
  const mount = (use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => void, compass?: ReturnType<typeof compassMount>) => {
    if (compass) use('/api/compass', (req, res) => void compass.handle(req, res));
    use('/api/uw', (req, res) => void proxyUw(req, res));
    use('/api/theta', (req, res) => void proxyTheta(req, res));
    use('/api/logo', (req, res) => void proxyLogo(req, res));
    use('/api', (_req, res) => {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'not found' }));
    });
  };
  return {
    name: 'data-proxies',
    configureServer(server) {
      /* the official Compass engine (src/data/compassServer.ts) runs in this process from the moment it listens */
      const compass = compassMount(() => server.ssrLoadModule('/src/data/compassServer.ts'));
      mount((path, fn) => server.middlewares.use(path, fn), compass);
      server.httpServer?.once('listening', () => void compass.start());
      server.httpServer?.once('close', () => compass.stop());
      /* one ThetaData terminal for local work (theta/supervisor.mjs); THETA_AUTOSTART=0 leaves it to `npm run theta`, and
         a machine that shares the always-on terminal (THETA_RELAY_URL) never starts its own */
      if (process.env.THETA_AUTOSTART !== '0' && !process.env.THETA_RELAY_URL) {
        const stop = superviseTheta();
        if (stop) server.httpServer?.once('close', stop);
      }
    },
    configurePreviewServer(server) {
      const file = pathToFileURL(nodePath.join(process.cwd(), 'src/data/compassServer.ts')).href;
      const compass = compassMount(async () => (await import('tsx/esm/api')).tsImport(file, import.meta.url));
      mount((path, fn) => server.middlewares.use(path, fn), compass);
      server.httpServer?.once('listening', () => void compass.start());
      server.httpServer?.once('close', () => compass.stop());
    },
  };
};

/* server-side settings read from .env files the way the host's environment would provide them */
const SERVER_ENV = [
  'UNUSUAL_WHALES_API_KEY',
  'THETADATA_API_KEY',
  'THETA_RELAY_URL',
  'THETA_RELAY_SECRET',
  'THETA_JAR',
  'THETA_JAVA',
  'THETA_AUTOSTART',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'UW_PROXY_OPEN',
  'PROXY_PLAN_GATE',
  'PROXY_RATE_BURST',
  'PROXY_RATE_PER_SEC',
];

/* Vendor libraries in a few stable chunks: fewer requests on first load, and an app deploy leaves them cached. */
const VENDOR_CHUNKS: [string, RegExp][] = [
  ['vendor-react', /node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//],
  ['vendor-motion', /node_modules\/(framer-motion|motion-dom|motion-utils)\//],
  ['vendor-supabase', /node_modules\/@supabase\//],
  ['vendor-grid', /node_modules\/(ag-grid-community|ag-grid-react)\//],
  ['vendor-charts', /node_modules\/(lightweight-charts|fancy-canvas)\//],
  ['vendor-codemirror', /node_modules\/(@codemirror|@lezer|codemirror|style-mod|w3c-keyname|crelt)\//],
  ['vendor-radix', /node_modules\/(@radix-ui|@floating-ui)\//],
];
const manualChunks = (id: string): string | undefined => VENDOR_CHUNKS.find(([, re]) => re.test(id))?.[0];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const name of SERVER_ENV) {
    if (env[name] && !process.env[name]) process.env[name] = env[name];
  }
  return {
  plugins: [react(), dataProxies()],
  server: {
    host: '0.0.0.0',
    port: 8080,
    strictPort: true,
    /* no HMR socket: a hidden tab dropping it would reload the page */
    hmr: false,
    /* compile the entry and the first rooms at startup, so the first visit does not wait on a cold transform */
    warmup: {
      clientFiles: [
        './src/main.tsx',
        './src/pages/landing/Landing.tsx',
        './src/pages/workspace/Pulse.tsx',
        './src/pages/pinpoint/PinpointLayout.tsx',
        './src/pages/pinpoint/MapDesk.tsx',
        './src/pages/record/RecordLayout.tsx',
        './src/pages/record/News.tsx',
      ],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
        /* merge tiny chunks (skeletons, small helpers) into their neighbours to cut the request waterfall */
        experimentalMinChunkSize: 20_000,
      },
    },
  },
  resolve: {
    /* one React, even when the pre-bundle is regenerated mid-session */
    dedupe: ['react', 'react-dom'],
  },
  define: {
    /* react-draggable reads process.env in the browser. Empty on purpose: the real env would ship the server keys. */
    'process.env': {},
  },
  };
});
