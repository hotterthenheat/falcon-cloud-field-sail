/* Where the Compass engine reads from. The same modules run in the browser (Weigher's live score, the pages) and in
   the Node process that serves the app (the official scan, data/compassServer.ts). The browser reads ThetaData
   through /api/theta and the model files over HTTP; the server installs a host that asks the hub in-process and
   reads the files from disk. */

import { thetaCall } from './theta';
import { econReleases } from './monthCalendar';

export interface ThetaAnswer {
  status: number;
  data: unknown;
  error: string | null;
}

export interface EconRow {
  /** The release's New York wall date and time, held in the Date's local fields */
  date: Date;
  /** 'HH:MM' New York */
  time: string;
  title: string;
}

export interface CompassHost {
  /** The official engine: it scans, settles and keeps the record. The browser only reads it. */
  server: boolean;
  theta: (path: string, jump?: boolean) => Promise<ThetaAnswer>;
  /** A file the app ships (public/), by its path from the site root, or null */
  asset: (path: string) => Promise<ArrayBuffer | null>;
  /** The week's economic releases */
  econ: () => readonly EconRow[];
}

const browserHost: CompassHost = {
  server: false,
  theta: (path, jump) => thetaCall(path, jump),
  asset: async path => {
    const res = await fetch(path);
    return res.ok ? res.arrayBuffer() : null;
  },
  econ: () => econReleases(),
};

let host: CompassHost = browserHost;

export function setCompassHost(next: CompassHost): void {
  host = next;
}

export function compassHost(): CompassHost {
  return host;
}

/** The official engine runs in this process. */
export const onServer = (): boolean => host.server;
