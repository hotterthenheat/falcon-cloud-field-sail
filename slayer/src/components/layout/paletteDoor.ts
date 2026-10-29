/* A page that offers the command palette as a button dispatches this event rather than faking Ctrl+K; AppShell
   listens. */
export const OPEN_PALETTE_EVENT = 'slayer:open-palette';
export const openPalette = (): void => {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
};
