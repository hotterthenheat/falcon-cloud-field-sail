export interface JsonWire {
  stamp: string;
  json: Buffer;
  gzip: Buffer | null;
}

export function takeWire(key: string, stamp: string, make: () => unknown): JsonWire;

export function writeWire(
  req: { headers: Record<string, string | string[] | undefined> },
  res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string | Buffer) => void },
  status: number,
  wire: JsonWire,
): void;
