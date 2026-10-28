# Terrain vs OpenMarket

Developer brief for the `/terrain` chart desk: how it is built, how it compares with OpenMarket, and what to change first.

- `Terrain-vs-OpenMarket.pdf` — the brief
- `index.html` — source of that PDF
- `Terrain-Part2-Everything-Missed.pdf` — measured performance, the contrast pass, and work that is not in the first brief
- `Terrain-Part3-Exposure-Nodes.pdf` — how the exposure beads work, against QuantData’s Interval Map, including signed flow
- `Terrain-FINAL-Master.pdf` — one read of all three briefs plus the institutional research, with the ranked roadmap
- `part2.html` — source of the companion
- `screenshots/` — renders from the dev server, plus the companion’s mocks
- `capture.mjs` — the Playwright harness that took the first shots
- `perf-capture.mjs`, `perf-pass2.mjs`, `perf/` — frame times, the CPU profiles, and the production open
- `mocks/` — the before/after strips printed into the companion

The app source was not modified. The synthetic screenshots need no Unusual Whales key; they answer `/api/uw` inside the browser. The no-key shot is the page as it stands.
