/*
  Loads the factual SPX book once. Terrain is the only desk that reads it.
  Other names are not invented from the simulator.
*/

import { type SpxRead } from './spxFacts';

let read: SpxRead | null = null;

export function spxRead(): SpxRead | null {
  return read;
}

