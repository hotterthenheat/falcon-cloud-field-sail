# Slayer

**The app is in [`slayer/`](slayer/). Run every command there**, not in this folder:

```powershell
cd slayer
npm ci
npm run dev        # http://localhost:8080
```

How to set it up (Node 22 or 24, Java 21, the ThetaData v3 terminal and the keys), keep it running and update it:
[`slayer/README.md`](slayer/README.md). Deploying to Vercel (Root Directory `slayer`, branch `main`):
[`slayer/docs/deploy.md`](slayer/docs/deploy.md).

The files at the top level (`package.json`, `src/`, `server/`, `vite.config.ts`, `startup.sh`) belong to the
app-builder workspace this repo was exported from (`app-builder-workspace`), not to Slayer: `npm` commands run here
start that workspace instead of the app.
