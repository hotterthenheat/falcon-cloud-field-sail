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
  thin: "Too thin to be a trapdoor (or a wall): dealers lean one way here, but with under a third of the heaviest strike's net gamma — too little hedging to slow or speed a move by itself",
  flip: 'Flip: the price where the net dealer gamma, re-priced at that price, crosses zero — on one side their hedging absorbs moves (long gamma), on the other it amplifies them (short gamma)',
  charm: 'Charm: how the dealers’ delta drifts as time passes with price standing still — near the close of an expiring contract it forces hedging trades on its own, often the late-day drift',
  nope: 'NOPE (net options pricing effect): the net delta of the day’s option trades divided by the shares of stock traded, as the vendor prints it. 0 is balanced; +2 means the option flow carries twice the stock’s own volume in bullish delta, −2 the same in bearish — the further from 0, the harder options lean on the stock',
  dex: 'DEX (delta exposure): the shares dealers hold to hedge their delta — the stock they own (+) or are short (−) right now',
  vex: 'VEX (vega exposure): how much the dealers’ book gains or loses when implied volatility moves one point',
  vanna: 'Vanna: how the dealers’ delta changes when implied volatility moves — a drop in vol makes them buy or sell stock without price moving',
  maxPain: 'Max pain: the strike where the most option value would expire worthless — a settlement idea, not a forecast. The likeliest close is ours: the strike the 4:00 print most likely lands on, from the expected move left',
  likeliestClose: 'Likeliest close: the strike the 4:00 print most likely lands on, from the expected move left — named only when one strike reaches 15%. Not max pain, which is where the most option value would expire worthless',
} as const;

/** The words a newcomer meets on Pinpoint, in the order they matter — the "First time here?" card reads this */
export const FIRST_TIME: { term: string; says: string }[] = [
  { term: 'Long / short gamma', says: 'Long gamma: dealers trade against the move (buy dips, sell rips), so moves tend to be absorbed and price tends to pin. Short gamma: they trade with it, so moves tend to run.' },
  { term: 'Flip', says: GLOSSARY.flip.replace(/^Flip: /, '') },
  { term: 'Supreme', says: GLOSSARY.supreme.replace(/^Supreme: /, '') },
  { term: 'Call wall', says: GLOSSARY.callWall.replace(/^Call wall: /, '') },
  { term: 'Put wall', says: GLOSSARY.putWall.replace(/^Put wall: /, '') },
  { term: 'Shelf', says: GLOSSARY.shelf.replace(/^Shelf: /, '') },
  { term: 'Trapdoor', says: GLOSSARY.trapdoor.replace(/^Trapdoor: /, '') },
  { term: 'Too thin to be a trapdoor', says: GLOSSARY.thin.replace(/^Too thin to be a trapdoor \(or a wall\): /, '') },
  { term: 'Charm', says: GLOSSARY.charm.replace(/^Charm: /, '') },
  { term: 'NOPE', says: GLOSSARY.nope.replace(/^NOPE \(net options pricing effect\): /, '') },
  { term: 'DEX · VEX · vanna', says: `${GLOSSARY.dex.replace(/^DEX \(delta exposure\): /, 'DEX: ')} ${GLOSSARY.vex.replace(/^VEX \(vega exposure\): /, 'VEX: ')} ${GLOSSARY.vanna}` },
  { term: 'Max pain vs likeliest close', says: GLOSSARY.maxPain.replace(/^Max pain: /, 'Max pain: ') },
];

/** The definition for a strike's kind word, as the Agenda and the Board print it */
export const kindTip = (kind: string | null | undefined): string | undefined =>
  kind === 'supreme' ? GLOSSARY.supreme : kind === 'trapdoor' ? GLOSSARY.trapdoor : kind === 'shelf' ? GLOSSARY.shelf : kind === 'call wall' ? GLOSSARY.callWall : kind === 'put wall' ? GLOSSARY.putWall : kind === 'thin' ? GLOSSARY.thin : kind === 'flip' ? GLOSSARY.flip : undefined;
