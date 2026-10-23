/*
  PINPOINT'S WORDS, DEFINED ONCE (the retail test, 2026-10-22: "supreme", "trapdoor", "shelf" and "the book" printed
  with no word on what they mean). Every place one of them stands on Pinpoint carries the line below on hover.
*/
export const GLOSSARY = {
  supreme: 'Supreme: the single strike with the most dealer gamma on it (either sign), on the contracts the Levels card reads — usually the strongest level on the chart',
  trapdoor: 'Trapdoor: a strike where dealers are short gamma — their hedging speeds a move through it instead of slowing it',
  shelf: 'Shelf: a strike where dealers are long gamma and that holds at least a third of the biggest wall — their hedging slows price there',
  book: 'The book: every open option contract on the name, and the dealer hedging it implies, strike by strike and expiry by expiry',
  callWall: 'Call wall: the strike with the most call gamma — while dealers are long gamma there it tends to slow a rise; once price is through it, it can act as support',
  putWall: 'Put wall: the strike with the most put gamma — below price it is support while it holds (dealers are short gamma there, so a break can accelerate); above price it is overhead put hedging, not a floor — a rally into it can speed up selling, or it can act as a magnet',
} as const;

/** The definition for a strike's kind word, as the Agenda and the Board print it */
export const kindTip = (kind: string | null | undefined): string | undefined =>
  kind === 'supreme' ? GLOSSARY.supreme : kind === 'trapdoor' ? GLOSSARY.trapdoor : kind === 'shelf' ? GLOSSARY.shelf : kind === 'call wall' ? GLOSSARY.callWall : kind === 'put wall' ? GLOSSARY.putWall : kind === 'thin' ? 'Too thin to be a wall: dealers are long gamma here, but it holds under a third of the biggest wall' : undefined;
