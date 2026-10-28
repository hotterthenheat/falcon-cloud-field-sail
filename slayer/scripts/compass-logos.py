"""Shrink raster marks already in public/logos, fetch the Compass names that have none, write src/data/logoFiles.ts.

Does not overwrite a hand-drawn / vector SVG. A fund with no file is left for the letter badge.
"""
from __future__ import annotations

import base64
import io
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image

ROOT = Path('/workspace/slayer')
LOGOS = ROOT / 'public/logos'
RAW = (ROOT / 'src/data/compassUniverse.ts').read_text()
TICKERS = list(dict.fromkeys(re.search(r'`([^`]+)`', RAW).group(1).split()))

# Indexes, ETFs, and leveraged products. The ticker is the mark (CompanyLogo).
FUNDS = {
    'SPY', 'QQQ', 'IWM', 'DIA', 'SPX', 'NDX', 'RUT', 'VIX', 'SPXW', 'XSP', 'RUTW',
    'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'SPXL', 'SPXU', 'SPXS', 'UPRO', 'TNA', 'TZA',
    'UVXY', 'UVIX', 'VXX', 'SVIX', 'SVXY', 'TMF', 'TBT', 'TLT', 'LABU', 'BOIL', 'KOLD',
    'NUGT', 'JNUG', 'NAIL', 'FAS', 'DPST', 'AGQ', 'YINN', 'BITO', 'BITX', 'ARKK', 'ARKG',
    'SMH', 'SOXX', 'GDX', 'GDXJ', 'XBI', 'XHB', 'XRT', 'XOP', 'XLE', 'XLF', 'XLK', 'XLI',
    'XLV', 'XLY', 'XLP', 'XLU', 'XLC', 'KRE', 'KWEB', 'EWZ', 'EWW', 'EEM', 'EFA', 'FXI',
    'GLD', 'SLV', 'USO', 'UNG', 'VOO', 'NVDL', 'TSLL', 'IBB', 'OIH', 'URA', 'URNM', 'MSOS',
    'TAN', 'UCO', 'SSO', 'RSP',
}

ALIASES = {
    'BRKB': ['BRK.B', 'BRK-B'],
    'GOLD': ['ABX'],
}

TEMPLATES = [
    'https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/{s}.png',
    'https://financialmodelingprep.com/image-stock/{s}.png',
    'https://assets.parqet.com/logos/symbol/{s}',
    'https://eodhd.com/img/logos/US/{s}.png',
    'https://companiesmarketcap.com/img/company-logos/64/{s}.png',
]
UA = {'User-Agent': 'Mozilla/5.0'}
DATA = re.compile(r'data:image/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)', re.I)


def to_svg(im: Image.Image) -> str:
    im = im.convert('RGBA')
    w, h = im.size
    side = max(w, h)
    if side > 64:
        scale = 64 / side
        im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)
        w, h = im.size
    buf = io.BytesIO()
    im.save(buf, format='PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"><image href="data:image/png;base64,{b64}" width="{w}" height="{h}"/></svg>\n'


def usable(data: bytes) -> Image.Image | None:
    if len(data) < 400 or data[:1] == b'<' or b'<html' in data[:200].lower():
        return None
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception:
        return None
    if min(im.size) < 8:
        return None
    sample = im.convert('RGBA').resize((16, 16))
    colors = sample.getcolors(256) or []
    if len(colors) < 3:
        return None
    opaque = sum(1 for px in sample.getdata() if px[3] > 24)
    if opaque < 20:
        return None
    return im


def shrink_existing() -> tuple[int, int]:
    n = saved = 0
    for p in LOGOS.glob('*.svg'):
        text = p.read_text(errors='ignore')
        m = DATA.search(text)
        if not m:
            continue
        try:
            im = Image.open(io.BytesIO(base64.b64decode(m.group(1))))
            im.load()
        except Exception:
            continue
        if max(im.size) <= 64 and p.stat().st_size < 12000:
            continue
        svg = to_svg(im)
        before = p.stat().st_size
        if len(svg) < before:
            p.write_text(svg)
            n += 1
            saved += before - len(svg)
    return n, saved


def fetch(sym: str) -> tuple[str, str | None]:
    symbols = [sym, *ALIASES.get(sym, [])]
    for s in symbols:
        for tmpl in TEMPLATES:
            url = tmpl.format(s=s)
            try:
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=12) as r:
                    data = r.read(1_500_000)
            except Exception:
                continue
            im = usable(data)
            if im is None:
                continue
            (LOGOS / f'{sym}.svg').write_text(to_svg(im))
            return sym, url
    return sym, None


def write_index() -> None:
    has, photo = [], []
    for p in sorted(LOGOS.glob('*.svg')):
        sym = p.stem.upper()
        has.append(sym)
        head = p.read_text(errors='ignore')[:240]
        if 'data:image' in head or '<image' in head:
            photo.append(sym)
    def body(names: list[str]) -> str:
        lines = []
        for i in range(0, len(names), 12):
            lines.append('  ' + ', '.join(f"'{n}'" for n in names[i:i + 12]) + ',')
        return '\n'.join(lines)
    text = (
        '/* Tickers with a file in public/logos. Photo marks are raster tiles — drawn as the picture, not probed. */\n'
        'export const HAS_LOGO: ReadonlySet<string> = new Set([\n' + body(has) + '\n]);\n\n'
        'export const PHOTO_LOGOS: ReadonlySet<string> = new Set([\n' + body(photo) + '\n]);\n'
    )
    (ROOT / 'src/data/logoFiles.ts').write_text(text)


def main() -> None:
    n, saved = shrink_existing()
    print(f'shrunk {n} files, freed {saved} bytes')
    have = {p.stem.upper() for p in LOGOS.glob('*.svg')}
    need = [t for t in TICKERS if t not in have and t not in FUNDS]
    print(f'compass {len(TICKERS)} have {len(have & set(TICKERS))} fetch {len(need)} fund-badges {sum(1 for t in TICKERS if t not in have and t in FUNDS)}')
    got, missed = [], []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futs = [pool.submit(fetch, t) for t in need]
        for f in as_completed(futs):
            sym, url = f.result()
            if url:
                got.append(sym)
            else:
                missed.append(sym)
    print('got', len(got), ' '.join(sorted(got)))
    print('missed', len(missed), ' '.join(sorted(missed)))
    write_index()


if __name__ == '__main__':
    main()
