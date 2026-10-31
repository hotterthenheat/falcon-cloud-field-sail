## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- `graphify` is installed with `uv tool install graphifyy`. If it is not on PATH, call it from where `uv tool install` put it (`uv tool dir --bin` prints that folder; usually `~/.local/bin`, `graphify.exe` on Windows). The graph lives in `graphify-out/`, which is git-ignored.

## data sources

What the Unusual Whales and ThetaData keys actually give us — and the rule that **Pinpoint and Dossier read Unusual
Whales only** — lives in `docs/DATA_SOURCES.md`. Read it before adding or changing any data call. Every UW route the
browser uses must also be on the allowlist in `server/uwProxy.mjs`.
