import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { proxyUw } from './server/uwProxy.mjs';
import { proxyTheta } from './server/thetaProxy.mjs';

/* The Unusual Whales token stays in UNUSUAL_WHALES_API_KEY. The browser calls
   /api/uw/* and this middleware adds the bearer token. */
const whalesProxy = (): Plugin => ({
  name: 'unusual-whales-proxy',
  configureServer(server) {
    server.middlewares.use('/api/uw', (req, res) => {
      void proxyUw(req, res);
    });
    server.middlewares.use('/api/theta', (req, res) => {
      void proxyTheta(req, res);
    });
    server.middlewares.use('/api/log', (_req, res) => {
      res.statusCode = 204;
      res.end();
    });
    server.middlewares.use('/api/stall', (_req, res) => {
      res.statusCode = process.env.STALL_KEY ? 501 : 404;
      res.end();
    });
  },
  /* the built site, served by `vite preview`, reads the same proxy — so the production bundle can be checked live */
  configurePreviewServer(server) {
    server.middlewares.use('/api/uw', (req, res) => {
      void proxyUw(req, res);
    });
    server.middlewares.use('/api/theta', (req, res) => {
      void proxyTheta(req, res);
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (env.UNUSUAL_WHALES_API_KEY && !process.env.UNUSUAL_WHALES_API_KEY) {
    process.env.UNUSUAL_WHALES_API_KEY = env.UNUSUAL_WHALES_API_KEY;
  }
  if (env.THETADATA_API_KEY && !process.env.THETADATA_API_KEY) {
    process.env.THETADATA_API_KEY = env.THETADATA_API_KEY;
  }
  return {
  plugins: [react(), whalesProxy()],
  server: {
    host: '0.0.0.0',
    port: 8080,
    strictPort: true,
    /* A hidden tab drops this socket. The client then reloads the page. That is the restart. */
    hmr: false,
    /* THE FIRST LOAD AFTER `npm run dev` (Noah, 2026-09-20: "a white screen for about 5-7 seconds"). Measured: the very first
       visit painted at 4.2s, the second at 0.2s — the same page, the same browser. The dev server compiles nothing until it is
       asked: on the first visit every file is transformed on demand, and Tailwind's first pass over the whole source takes
       ~2.3s on its own, during which every other request queues behind it. (A built site has none of this — it is the dev
       server's cold start, not the page.) So the server does that work THE MOMENT IT STARTS instead of when the browser asks:
       the entry and everything it imports (index.css with it), the landing, and the page the landing's doors open. By the
       time a tab is opened it is already warm. */
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
  resolve: {
    // One React, always — guards against mixed pre-bundle generations
    // ("Invalid hook call") when deps are installed mid-flight.
    dedupe: ['react', 'react-dom'],
  },
  define: {
    // react-draggable 4.7 (via react-grid-layout) reads process.env in the
    // browser and throws ReferenceError on every drag without this shim.
    // Empty on purpose. Do not replace this with the process env. A library
    // reads process.env; shipping the real env would put the whale key in the bundle.
    'process.env': {},
  },
  };
});
