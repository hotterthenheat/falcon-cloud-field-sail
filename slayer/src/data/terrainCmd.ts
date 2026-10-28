/** ⌘K on Terrain. The palette cannot reach a pane, so it names the command and
    the desk applies it to whichever pane is active. */
export const TERRAIN_DESK_CMD = 'slayer-terrain-desk';

export type DeskCmd =
  | { op: 'overlay'; key: 'levels' | 'cone' }
  | { op: 'horizon'; horizon: 'session' | 'week' | 'next' };

export function sendDeskCmd(cmd: DeskCmd): void {
  window.dispatchEvent(new CustomEvent(TERRAIN_DESK_CMD, { detail: cmd }));
}
