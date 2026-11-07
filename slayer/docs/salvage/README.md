# Salvaged work (2026-11-07)

Uncommitted edits found in old agent worktrees when they were cleaned up. Everything else in those worktrees was
already on main. These two pieces were not, so they are kept here as patches (not applied):

- `2026-11-07-palette-name-hover-card.patch`: the command palette (⌘K) shows a name's card beside the list when a
  ticker row is highlighted (`NameHoverCard.tsx` + `CommandPalette.tsx` changes). Main later shipped the name card in
  Terrain's search instead (`src/data/nameCard.ts`, `/api/name-card`); this palette version was never merged.
  The patch was made against an older CommandPalette.tsx and will need a manual merge.
- `2026-11-07-nodes-star-clear.patch`: the heatmap nodes' crown star is not drawn under the labels' column at the
  right edge (`STAR_CLEAR`, 3 lines in `gexNodesPrimitive.ts`).

Apply with `git apply --3way <patch>` from the repo root, then run the proofs.
