/* The keyboard shortcuts: Settings › Keyboard and the "?" help sheet print this one list. */

/* Every key the terminal answers to, grouped by where it works, each read off the handler that owns it; `alt` marks alternatives
   ("1 / 2 / 3 / 4") rather than a chord. */
export type Shortcut = { keys: string[]; does: string; alt?: boolean };
/** `page`: the address the group's keys work on (the help sheet puts the page in view's groups first) */
export type ShortcutGroup = { where: string; page?: string; keys: Shortcut[] };
export const KEY_GROUPS: ShortcutGroup[] = [
  {
    where: 'Everywhere',
    keys: [
      { keys: ['Ctrl', 'K'], does: 'Search a name or a page from anywhere' },
      { keys: ['↑', '↓'], alt: true, does: "Walk the search's results" },
      { keys: ['Enter'], does: 'Open the result under the mark' },
      { keys: ['?'], does: 'This help: the keys and a short guide to the page you are on (not while typing in a field)' },
      { keys: ['Esc'], does: 'Close what is open — a menu, the alerts, the watchlist, the ladder (from inside it), fullscreen, a replay, the calendar’s focus' },
    ],
  },
  {
    where: 'Terrain · the desk',
    page: '/terrain',
    keys: [
      { keys: ['1', '2', '3', '4'], alt: true, does: 'How many charts — one to four' },
      { keys: ['[', ']'], alt: true, does: 'Walk the charts — the one before, the one after' },
      { keys: ['Shift', 'R'], does: 'The strike rail beside every chart — on or off' },
    ],
  },
  {
    where: 'Terrain · the active chart',
    page: '/terrain',
    keys: [
      { keys: ['F'], does: 'Expand it to the full screen, and back' },
      { keys: ['S'], does: 'Pick its symbol' },
      { keys: ['C'], does: 'Compare — cross another name onto it' },
      { keys: ['↑', '↓'], alt: true, does: 'Flip its name through the watchlist' },
      { keys: ['−', '='], alt: true, does: 'Step its timeframe down, up' },
      { keys: ['P'], does: 'Replay — pick a bar, then play' },
      { keys: ['D'], does: 'Draw mode — the tools in hand' },
      { keys: ['R'], does: 'Its strike rail — on or off' },
      { keys: ['Alt', 'R'], does: 'Reset its view — with the pointer over the chart' },
    ],
  },
  {
    where: 'Review · the backtest desk',
    page: '/practice/backtest',
    keys: [
      { keys: ['Space'], does: 'Play the clock, and pause it' },
      { keys: ['←', '→'], alt: true, does: 'Step a minute back, a minute on — never back past your last order' },
      { keys: ['Shift', '→'], does: 'Five minutes on (Shift ← for five back)' },
      { keys: ['End'], does: 'Run to the bell — a futures session: to 17:00' },
      { keys: ['9'], does: 'A futures session: run to 09:30, the stock market’s open' },
      { keys: ['N'], does: 'Ring the bell and open the next day' },
      { keys: ['F'], does: 'The chart to the full screen, and back' },
      { keys: ['D'], does: 'Draw mode on the chart in hand' },
      { keys: ['T'], does: 'To the order — its size, ready to type' },
      { keys: ['1', '2'], alt: true, does: 'Put the first name on the desk, or the second' },
      { keys: ['\\'], does: 'In the full screen: fold the chain away, and back' },
    ],
  },
  {
    where: 'Review · a trade in the journal',
    page: '/practice/journal',
    keys: [
      { keys: ['←', '→'], alt: true, does: 'The trade closed after this one, or the one before — the journal’s own order' },
      { keys: ['Esc'], does: 'Back to the journal, as you left it' },
    ],
  },
  {
    where: 'The script editor',
    keys: [
      { keys: ['Ctrl', 'S'], does: 'Save the script' },
      { keys: ['Ctrl', 'Enter'], does: 'Run it on its chart' },
    ],
  },
];
