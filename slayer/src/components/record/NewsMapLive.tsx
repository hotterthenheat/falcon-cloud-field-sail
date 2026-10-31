/* The wire map (MapLibre on the public-domain country atlas, fetched once by URL): no tile server, no key. Water is
   the background, so zooming out never opens a black frame. Loaded only when the News page shows its map.
   The coarse atlas draws first; the finer one (1:50m) replaces it once in hand, so a flight to a city lands on a clean
   coast. Countries are shaded by how many stories on the cut come from them; pins sit on the cities, coloured by how
   the named stock moved when its story crossed; the open story's lines run to the markets its sector trades through. */
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(maplibreWorkerUrl);
import { feature } from 'topojson-client';
import { geoArea, geoBounds, geoCentroid, geoContains } from 'd3-geo';
import coarseUrl from 'world-atlas/countries-110m.json?url';
import fineUrl from 'world-atlas/countries-50m.json?url';
import cities from '../../data/cities.json';
import { useResolvedTheme } from '../../theme/theme';
import type { CityPing, GeoZone } from '../../data/newsroom';
import { MAP_INK, pinTone, type HeatPoint, type MapProps, type Reach, type SessionDef } from './NewsMap';

type Tone = 'dark' | 'light';

/* The dateline: the atlas cuts rings at ±180°, which the map draws as a line across the world, so any step longer than
   half the world is carried on past 180° and the polygon stays whole. */
const unwrapRing = (ring: GeoJSON.Position[]): GeoJSON.Position[] => {
  let shift = 0;
  return ring.map((pt, i) => {
    if (i > 0) {
      const d = pt[0] - ring[i - 1][0];
      if (d > 180) shift -= 360;
      else if (d < -180) shift += 360;
    }
    return [pt[0] + shift, pt[1]];
  });
};
const unwrapFeature = (f: GeoJSON.Feature): GeoJSON.Feature => {
  const g = f.geometry;
  if (g.type === 'Polygon') return { ...f, geometry: { ...g, coordinates: g.coordinates.map(unwrapRing) } };
  if (g.type === 'MultiPolygon') return { ...f, geometry: { ...g, coordinates: g.coordinates.map(poly => poly.map(unwrapRing)) } };
  return f;
};

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
type Atlas = Parameters<typeof feature>[0] & { objects: { countries: Parameters<typeof feature>[1] } };
type Country = { f: GeoJSON.Feature; west: number; east: number; south: number; north: number };
let land: GeoJSON.FeatureCollection | null = null;
let countries: Country[] = [];
/** 0 none, 1 coarse, 2 fine */
let atlasLevel = 0;
const readAtlas = (url: string, level: number): Promise<void> =>
  fetch(url)
    .then(r => r.json() as Promise<Atlas>)
    .then(topo => {
      if (atlasLevel >= level) return;
      const fc = feature(topo, topo.objects.countries) as unknown as GeoJSON.FeatureCollection;
      /* Antarctica is left off: no story lands there */
      const fs = fc.features.filter(f => String(f.id) !== '010' && f.geometry && (f.properties as { name?: string } | null)?.name !== 'Antarctica');
      countries = fs.map(f => {
        const [[west, south], [east, north]] = geoBounds(f);
        return { f, west, east, south, north };
      });
      land = { type: 'FeatureCollection', features: fs.map(unwrapFeature) };
      atlasLevel = level;
      holders.clear();
      countryLabels = null;
    });
let coarseAsk: Promise<void> | null = null;
let fineAsk: Promise<void> | null = null;
const loadCoarse = () => (coarseAsk ??= readAtlas(coarseUrl, 1));
const loadFine = () => (fineAsk ??= readAtlas(fineUrl, 2).catch(() => undefined));
const landCollection = (): GeoJSON.FeatureCollection => land ?? EMPTY;

type GazCity = { n: string; lat: number; lng: number; pop: number; z: number; c: string };
const GAZETTEER = cities as GazCity[];
/** Natural Earth's rank, restated as the zoom on this map where a quiet city's name may appear */
const appearAt = (neZoom: number) => (neZoom <= 2.1 ? 3 : neZoom <= 3 ? 3.4 : neZoom <= 4 ? 4.1 : neZoom <= 5.1 ? 4.8 : 5.5);
const COUNTRY_NAME: Record<string, string> = {
  'United States of America': 'United States',
  'Dem. Rep. Congo': 'DR Congo',
  'Dominican Rep.': 'Dominican Rep.',
  'Central African Rep.': 'Central African Rep.',
  'Bosnia and Herz.': 'Bosnia',
};
type CountryLabel = { name: string; area: number; lng: number; lat: number };
let countryLabels: CountryLabel[] | null = null;
const countriesLabeled = () => {
  if (!countryLabels) {
    countryLabels = countries
      .map(({ f }) => {
        const c = geoCentroid(f);
        const raw = String((f.properties as { name?: string } | null)?.name ?? '');
        return { name: COUNTRY_NAME[raw] ?? raw, area: geoArea(f), lng: c[0], lat: c[1] };
      })
      .filter(c => c.name && Number.isFinite(c.lng) && Number.isFinite(c.lat))
      .sort((a, b) => b.area - a.area);
  }
  return countryLabels;
};

/* Which countries hold a point, kept per point for the atlas in hand: the cut's cities come back on every pick, filter
   and refresh. A box test first, so the spherical test runs on a country or two. */
const holders = new Map<string, number[]>();
const inBox = (c: Country, lng: number, lat: number) =>
  lat >= c.south - 0.5 && lat <= c.north + 0.5 && (c.west <= c.east ? lng >= c.west - 0.5 && lng <= c.east + 0.5 : lng >= c.west - 0.5 || lng <= c.east + 0.5);
const countriesHolding = (lng: number, lat: number): number[] => {
  const key = `${lng},${lat}`;
  let hit = holders.get(key);
  if (!hit) {
    hit = [];
    for (let i = 0; i < countries.length; i++) if (inBox(countries[i], lng, lat) && geoContains(countries[i].f, [lng, lat])) hit.push(i);
    if (countries.length) holders.set(key, hit);
  }
  return hit;
};

/** The land overlay: each country a story comes from, shaded in four steps by its count (log scale), and the open
    story's own country outlined. */
const landData = (heat: HeatPoint[], reach: Reach | null): GeoJSON.FeatureCollection => {
  const w = new Float64Array(countries.length);
  for (const h of heat) for (const i of countriesHolding(h.lng, h.lat)) w[i] += h.w;
  let max = 0;
  for (let i = 0; i < w.length; i++) max = Math.max(max, w[i]);
  const open = new Set(reach && reach.city ? countriesHolding(reach.lng, reach.lat) : []);
  const fs = landCollection().features;
  const out: GeoJSON.Feature[] = [];
  for (let i = 0; i < countries.length; i++) {
    const isOpen = open.has(i);
    if (!w[i] && !isOpen) continue;
    const t = max > 0 ? Math.log1p(w[i]) / Math.log1p(max) : 0;
    const lvl = w[i] <= 0 ? 0 : t >= 0.8 ? 4 : t >= 0.55 ? 3 : t >= 0.3 ? 2 : 1;
    out.push({ type: 'Feature', id: i, geometry: fs[i].geometry, properties: { lvl, open: isOpen ? 1 : 0 } });
  }
  return { type: 'FeatureCollection', features: out };
};

/** The open story's lines: a gentle arc from its city to each market its sector trades through, the short way round */
const nearLng = (lng: number, from: number) => {
  let x = lng;
  while (x - from > 180) x -= 360;
  while (from - x > 180) x += 360;
  return x;
};
const reachEnds = (reach: Reach | null): GeoZone[] => {
  if (!reach || !reach.city) return [];
  return reach.zones
    .map(z => ({ ...z, lng: nearLng(z.lng, reach.lng) }))
    .filter(z => Math.hypot(z.lat - reach.lat, z.lng - reach.lng) > 1.5);
};
const reachData = (reach: Reach | null): GeoJSON.FeatureCollection => {
  if (!reach) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: reachEnds(reach).map(z => {
      const dx = z.lng - reach.lng;
      const dy = z.lat - reach.lat;
      const len = Math.hypot(dx, dy);
      /* bow the line to the pole side of the straight path, more for a longer one */
      const bow = Math.min(18, len * 0.18);
      const nx = -dy / len;
      const ny = dx / len;
      const side = ny >= 0 ? 1 : -1;
      const cx = (reach.lng + z.lng) / 2 + nx * bow * side;
      const cy = Math.min(80, (reach.lat + z.lat) / 2 + ny * bow * side);
      const pts: [number, number][] = [];
      for (let k = 0; k <= 32; k++) {
        const t = k / 32;
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        const c = t * t;
        pts.push([a * reach.lng + b * cx + c * z.lng, a * reach.lat + b * cy + c * z.lat]);
      }
      return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } };
    }),
  };
};

/** A cash session's longitudes as a band over the inhabited latitudes */
const band = (west: number, east: number): GeoJSON.Feature => {
  const ring: [number, number][] = [];
  for (let x = east; x > west; x -= 4) ring.push([x, -56]);
  ring.push([west, -56]);
  for (let x = west; x < east; x += 4) ring.push([x, 76]);
  ring.push([east, 76], [east, -56]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
};
const sessionData = (sessions: SessionDef[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: sessions.map(s => band(s.west, s.east)) });

const setSource = (map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) => {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
};

/** Every colour on the map for a theme — set once at build and again on a theme switch, so no layer is ever dropped */
const paintMap = (map: maplibregl.Map, tone: Tone) => {
  const k = MAP_INK[tone];
  const set = (layer: string, prop: Parameters<maplibregl.Map["setPaintProperty"]>[1], value: Parameters<maplibregl.Map["setPaintProperty"]>[2]) => {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value);
  };
  set('background', 'background-color', k.sea);
  set('land', 'fill-color', k.land);
  set('land-line', 'line-color', k.edge);
  set('news-session', 'fill-color', k.session);
  set('news-session', 'fill-opacity', k.sessionOpacity);
  set('news-session-edge', 'line-color', k.session);
  set('news-land-fill', 'fill-color', k.heat);
  /* the shade is a world view: zoomed to a region, where one country fills the frame, it steps back */
  const steps = (f: number): maplibregl.ExpressionSpecification => ['match', ['get', 'lvl'], 4, k.heatSteps[3] * f, 3, k.heatSteps[2] * f, 2, k.heatSteps[1] * f, 1, k.heatSteps[0] * f, 0];
  set('news-land-fill', 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 2.5, steps(1), 4, steps(0.45)]);
  set('news-land-open', 'line-color', k.open);
  set('news-reach', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], 0, k.reachFrom, 1, k.reachTo]);
};

const baseStyle = (tone: Tone): maplibregl.StyleSpecification => ({
  version: 8,
  sources: { land: { type: 'geojson', data: landCollection() } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': MAP_INK[tone].sea } },
    { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': MAP_INK[tone].land } },
    { id: 'land-line', type: 'line', source: 'land', paint: { 'line-color': MAP_INK[tone].edge, 'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.3, 1.5, 0.55, 5, 1] } },
  ],
});

const addOverlays = (map: maplibregl.Map) => {
  if (map.getSource('news-land')) return;
  map.addSource('news-session', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'news-session', type: 'fill', source: 'news-session', paint: {} }, 'land-line');
  map.addLayer({ id: 'news-session-edge', type: 'line', source: 'news-session', paint: { 'line-width': 1, 'line-opacity': 0.35, 'line-dasharray': [2, 3] } });
  map.addSource('news-land', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'news-land-fill', type: 'fill', source: 'news-land', paint: {} }, 'land-line');
  map.addLayer({ id: 'news-land-open', type: 'line', source: 'news-land', filter: ['==', ['get', 'open'], 1], paint: { 'line-width': 1.1, 'line-opacity': 0.7 } });
  map.addSource('news-reach', { type: 'geojson', data: EMPTY, lineMetrics: true });
  map.addLayer({ id: 'news-reach', type: 'line', source: 'news-reach', layout: { 'line-cap': 'round' }, paint: { 'line-width': 1.6 } });
};

/** The zoom that shows the inhabited world (56°S to 76°N, every longitude) whole in a box */
const BAND = (Math.log(Math.tan(Math.PI / 4 + (76 * Math.PI) / 360)) - Math.log(Math.tan(Math.PI / 4 - (56 * Math.PI) / 360))) / (2 * Math.PI);
const WORLD_CENTER: [number, number] = [14, 22];
const worldZoom = (w: number, h: number) => Math.max(-1.5, Math.min(Math.log2(Math.max(w, 64) / 512), Math.log2(Math.max(h, 64) / (512 * BAND))) - 0.02);

/* The pins are laid out once per half step of zoom, at the bucket's own zoom: zooming in inside a bucket only spreads
   them, so nothing laid out apart ever overlaps. */
const bucketOf = (z: number) => Math.floor(z * 2) / 2;

type Cluster = { head: CityPing; members: CityPing[]; n: number; up: number; down: number; majors: number; x: number; y: number };

interface Props extends MapProps {
  /** Called when the WebGL map cannot draw (no WebGL, a worker that never answers, a failed style) */
  onFail?: () => void;
}

const el = (tag: string, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const LiveMap = ({ pins, selectedCity, onPick, onHover, heat, reach, flyTo = null, sessions, note = null, className = '', onFail }: Props) => {
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;
  const theme = useResolvedTheme();
  const tone: Tone = theme === 'light' ? 'light' : 'dark';
  const host = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const floorRef = useRef(0);
  const moved = useRef(false);
  const flying = useRef(false);
  const flightRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [bucket, setBucket] = useState(0);
  const [atlasRev, setAtlasRev] = useState(atlasLevel);
  const [viewRev, setViewRev] = useState(0);
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const onPickRef = useRef(onPick);
  const onHoverRef = useRef(onHover);
  onPickRef.current = onPick;
  onHoverRef.current = onHover;
  const toneRef = useRef(tone);
  toneRef.current = tone;
  const fineReady = useRef(atlasLevel >= 2);
  /* What the pins draw, as text: a re-read that hands over the same pins (a new array, the same stories) neither rebuilds
     the markers nor starts a new glide. Only the fields the markers, their titles and the fit read are in it. */
  const pinsKey = pins.map(p => `${p.city}|${p.lng}|${p.lat}|${p.n}|${p.up}|${p.down}|${p.majors}|${p.maxSeverity}|${p.topId}`).join(';');
  /** Where the last fit aimed: an animated fit to the same place again is skipped (it would only redraw for 650 ms) */
  const lastFit = useRef('');

  /** The whole inhabited world, or the cut's pins when they sit in one region */
  const fit = (map: maplibregl.Map, animate: boolean) => {
    const box = map.getContainer();
    const z = worldZoom(box.clientWidth, box.clientHeight);
    const pts = pinsRef.current;
    if (pts.length) {
      const lngs = pts.map(p => p.lng);
      const lats = pts.map(p => p.lat);
      const spanLng = Math.max(...lngs) - Math.min(...lngs);
      const spanLat = Math.max(...lats) - Math.min(...lats);
      if (spanLng < 70 && spanLat < 45) {
        const b = new maplibregl.LngLatBounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]);
        const aim = `${b.toArray().flat().join(',')}@${box.clientWidth}x${box.clientHeight}`;
        if (animate && aim === lastFit.current) return;
        lastFit.current = aim;
        map.fitBounds(b, { padding: 56, duration: animate ? 650 : 0, maxZoom: 4 });
        return;
      }
    }
    const aim = `world@${box.clientWidth}x${box.clientHeight}`;
    if (animate && aim === lastFit.current) return;
    lastFit.current = aim;
    if (animate) map.easeTo({ center: WORLD_CENTER, zoom: z, duration: 650 });
    else map.jumpTo({ center: WORLD_CENTER, zoom: z });
  };

  useEffect(() => {
    const box = host.current;
    if (!box) return;
    const z = worldZoom(box.clientWidth, box.clientHeight);
    floorRef.current = z - 0.35;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: box,
        style: baseStyle(toneRef.current),
        center: WORLD_CENTER,
        zoom: z,
        minZoom: z - 0.35,
        maxZoom: 6,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: true,
        maxPitch: 0,
        fadeDuration: 0,
      });
    } catch {
      onFailRef.current?.();
      return;
    }
    /* the land must draw within a few seconds, or the box is an empty rectangle — the flat note stands in */
    let loaded = false;
    const failTimer = window.setTimeout(() => {
      if (!loaded) onFailRef.current?.();
    }, 7000);
    map.on('error', () => {
      if (!loaded) onFailRef.current?.();
    });
    map.touchZoomRotate.disableRotation();
    map.scrollZoom.setWheelZoomRate(1 / 240);
    const hold = () => {
      if (flying.current) return;
      const next = worldZoom(box.clientWidth, box.clientHeight) - 0.35;
      floorRef.current = next;
      map.setMinZoom(next);
    };
    map.on('load', () => {
      loaded = true;
      window.clearTimeout(failTimer);
      addOverlays(map);
      paintMap(map, toneRef.current);
      hold();
      fit(map, false);
      setBucket(bucketOf(map.getZoom()));
      setReady(true);
      /* the finer coast, once the first frame is up */
      loadFine().then(() => {
        if (!mapRef.current || atlasLevel < 2) return;
        fineReady.current = true;
        setSource(map, 'land', landCollection());
        setAtlasRev(atlasLevel);
      });
    });
    map.on('movestart', (e: maplibregl.MapLibreEvent) => {
      if (e.originalEvent) moved.current = true;
    });
    const onWheel = () => {
      moved.current = true;
    };
    box.addEventListener('wheel', onWheel, { passive: true });
    map.on('zoomend', () => setBucket(b => (bucketOf(map.getZoom()) === b ? b : bucketOf(map.getZoom()))));
    map.on('moveend', () => setViewRev(n => n + 1));
    const ro = new ResizeObserver(() => {
      map.resize();
      hold();
      if (!flying.current && !moved.current) fit(map, false);
    });
    ro.observe(box);
    mapRef.current = map;
    return () => {
      window.clearTimeout(failTimer);
      ro.disconnect();
      box.removeEventListener('wheel', onWheel);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // the theme and the data are applied below so the map is not rebuilt on every parent render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* a theme switch repaints the layers in place: the overlays stay */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    paintMap(map, tone);
  }, [tone, ready]);

  const sessionKey = sessions.map(s => s.key).join(' ');
  /* the shading and the lines are rebuilt only when what they show changes, not on every new array from a re-read */
  const shadeKey = `${JSON.stringify(heat)}#${JSON.stringify(reach)}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSource(map, 'news-land', landData(heat, reach));
    setSource(map, 'news-reach', reachData(reach));
    setSource(map, 'news-session', sessionData(sessions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shadeKey, sessionKey, atlasRev]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || moved.current) return;
    fit(map, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pinsKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !flyTo) return;
    const flight = ++flightRef.current;
    moved.current = true;
    const here = map.getCenter();
    const destLng = nearLng(flyTo.lng, here.lng);
    const dlng = Math.abs(destLng - here.lng);
    const dlat = Math.abs(flyTo.lat - here.lat);
    const deg = Math.hypot(dlng * Math.cos((((here.lat + flyTo.lat) / 2) * Math.PI) / 180), dlat);
    /* the coarse atlas is jagged past country scale; the fine one holds to a region */
    const arrive = fineReady.current ? 4 : 3.5;
    flying.current = true;
    map.stop();
    map.setMinZoom(Math.max(-2, floorRef.current - 2));
    const duration = deg < 2.5 ? 700 : Math.round(Math.min(2200, Math.max(1100, 650 + deg * 9)));
    const arm = requestAnimationFrame(() => {
      if (flightRef.current !== flight) return;
      if (deg < 2.5) {
        map.easeTo({ center: [destLng, flyTo.lat], zoom: Math.max(map.getZoom(), arrive), duration, essential: true, easing: (t: number) => 1 - Math.pow(1 - t, 3) });
      } else {
        map.flyTo({ center: [destLng, flyTo.lat], zoom: arrive, duration, curve: 1.42, essential: true });
      }
    });
    const onEnd = () => {
      if (flightRef.current !== flight) {
        map.off('moveend', onEnd);
        return;
      }
      if (map.isMoving()) return;
      map.off('moveend', onEnd);
      flying.current = false;
      const c = map.getCenter();
      const wrapped = ((((c.lng + 540) % 360) + 360) % 360) - 180;
      if (Math.abs(wrapped - c.lng) > 1) map.jumpTo({ center: [wrapped, c.lat], zoom: map.getZoom() });
      map.setMinZoom(floorRef.current);
    };
    map.on('moveend', onEnd);
    return () => {
      cancelAnimationFrame(arm);
      map.off('moveend', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.key, ready]);

  /* The pins and the country names: laid out once per zoom bucket (and when the cut, the open story or the atlas
     changes), never on a pan or a hover. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const markers: maplibregl.Marker[] = [];
    const scale = Math.pow(2, bucket - map.getZoom());
    const at = (lng: number, lat: number) => {
      const p = map.project([lng, lat]);
      return { x: p.x * scale, y: p.y * scale };
    };
    type Box = { x0: number; x1: number; y0: number; y1: number };
    const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const taken: Box[] = [];

    /* pins gather into the busiest pin within reach (the open story's city heads its own group, so nothing hides under
       it); at the closest zoom only pins nearly on top of each other gather */
    const reachPx = bucket >= 5 ? 12 : 26;
    const sorted = [...pins].sort((a, b) => (a.city === selectedCity ? -1 : b.city === selectedCity ? 1 : b.n - a.n || b.maxSeverity - a.maxSeverity));
    const clusters: Cluster[] = [];
    for (const p of sorted) {
      const pt = at(p.lng, p.lat);
      const host = clusters.find(c => Math.hypot(c.x - pt.x, c.y - pt.y) < reachPx);
      if (host) {
        host.members.push(p);
        host.n += p.n;
        host.up += p.up;
        host.down += p.down;
        host.majors += p.majors;
      } else clusters.push({ head: p, members: [p], n: p.n, up: p.up, down: p.down, majors: p.majors, x: pt.x, y: pt.y });
    }
    const maxN = Math.max(1, ...clusters.map(c => c.n));
    /* a phone's whole world is small: the pins and the names shrink with it */
    const small = bucket < 0.5 ? 0.62 : bucket < 1.5 ? 0.85 : 1;
    const sizeOf = (n: number) => Math.round((8 + 14 * Math.sqrt(n / maxN)) * small);
    /* the names: the open city first, then busiest first while they fit; zoomed out, the dozen busiest at most */
    const nameCap = bucket < 0.5 ? 6 : bucket < 1.5 ? 12 : bucket < 2.5 ? 22 : 99;
    let named = 0;
    clusters.forEach(c => {
      const size = sizeOf(c.n);
      const open = c.head.city === selectedCity;
      const near = c.members.length - 1;
      const label = near > 0 ? `${c.head.city} +${near}` : c.head.city;
      const w = (label.length + String(c.n).length + 1) * 6.3 + (open ? 22 : 10);
      const box: Box = { x0: c.x - size / 2 - 2, x1: c.x + size / 2 + 4 + w, y0: c.y - 8, y1: c.y + 8 };
      const dotBox: Box = { x0: c.x - size / 2, x1: c.x + size / 2, y0: c.y - size / 2, y1: c.y + size / 2 };
      const showName = open || (named < nameCap && !taken.some(t => hits(t, box)));
      if (showName) {
        taken.push(box);
        named++;
      } else taken.push(dotBox);
      const btn = el('button', 'news-pin') as HTMLButtonElement;
      btn.type = 'button';
      btn.dataset.newsPin = c.head.city;
      btn.dataset.tone = pinTone(c.up, c.down);
      if (open) btn.dataset.open = '';
      if (open) btn.style.zIndex = '3';
      const names = c.members.map(m => `${m.city} ${m.n}`).join(', ');
      const what = `${c.n} ${c.n === 1 ? 'story' : 'stories'}${c.majors ? `, ${c.majors} major` : ''}`;
      btn.title = near > 0 && bucket < 5.5 ? `${names} — ${what}. Click to zoom in.` : `${near > 0 ? names : c.head.city} — ${what}. Click for ${near > 0 ? `${c.head.city}'s` : 'its'} loudest story.`;
      btn.setAttribute('aria-label', btn.title);
      const dot = el('span', 'news-pin__dot');
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      btn.append(dot);
      if (showName) {
        const name = el('span', 'news-pin__name', label);
        name.dataset.newsCity = c.head.city;
        name.append(el('span', 'news-pin__n', String(c.n)));
        btn.append(name);
      }
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        if (near > 0 && map.getZoom() < 5.6) {
          moved.current = true;
          const lngs = c.members.map(m => nearLng(m.lng, c.head.lng));
          const lats = c.members.map(m => m.lat);
          map.fitBounds(new maplibregl.LngLatBounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]), {
            padding: 80,
            maxZoom: Math.min(6, Math.max(map.getZoom() + 1.5, 4.5)),
            duration: 700,
          });
        } else onPickRef.current(c.head);
      });
      btn.addEventListener('mouseenter', () => {
        btn.dataset.hot = '';
        onHoverRef.current(near > 0 ? { ...c.head, city: `${c.head.city} and ${near} near`, n: c.n, majors: c.majors, up: c.up, down: c.down } : c.head);
      });
      btn.addEventListener('mouseleave', () => {
        delete btn.dataset.hot;
        onHoverRef.current(null);
      });
      markers.push(new maplibregl.Marker({ element: btn, anchor: 'left', offset: [-size / 2, 0] }).setLngLat([c.head.lng, c.head.lat]).addTo(map));
    });

    /* country names under the pins, biggest first, where they do not cover a pin or a name */
    if (bucket >= 2) {
      const minArea = bucket < 3 ? 0.012 : bucket < 4 ? 0.0025 : 0.0004;
      for (const country of countriesLabeled()) {
        if (country.area < minArea) break;
        const pt = at(country.lng, country.lat);
        const w = country.name.length * 7.6 + 8;
        const box: Box = { x0: pt.x - w / 2, x1: pt.x + w / 2, y0: pt.y - 7, y1: pt.y + 7 };
        if (taken.some(t => hits(t, box))) continue;
        taken.push(box);
        const e = el('div', 'news-country', country.name);
        e.dataset.newsCountry = country.name;
        markers.push(new maplibregl.Marker({ element: e, anchor: 'center' }).setLngLat([country.lng, country.lat]).addTo(map));
      }
    }
    return () => markers.forEach(m => m.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pinsKey, selectedCity, bucket, atlasRev]);

  /* quiet place names for bearings once zoomed to a region: only those on screen, re-placed when the view settles */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || map.getZoom() < 3) return;
    const z = map.getZoom();
    const b = map.getBounds();
    const markers: maplibregl.Marker[] = [];
    const pinPts = pinsRef.current.map(p => map.project([p.lng, p.lat]));
    const placed: { x: number; y: number }[] = [];
    const visible = GAZETTEER.filter(c => appearAt(c.z) <= z && b.contains([c.lng, c.lat])).sort((a, b2) => b2.pop - a.pop);
    for (const c of visible) {
      const pt = map.project([c.lng, c.lat]);
      if (pinPts.some(p => Math.abs(p.y - pt.y) < 16 && pt.x - p.x > -60 && pt.x - p.x < 130)) continue;
      if (placed.some(p => Math.hypot(p.x - pt.x, p.y - pt.y) < 70)) continue;
      placed.push(pt);
      const e = el('div', 'news-place');
      e.append(el('span', 'news-place__dot'), el('span', '', c.n));
      markers.push(new maplibregl.Marker({ element: e, anchor: 'left', offset: [-1.5, 0] }).setLngLat([c.lng, c.lat]).addTo(map));
      if (placed.length >= 24) break;
    }
    return () => markers.forEach(m => m.remove());
  }, [ready, viewRev]);

  /* where the open story's lines land, named once the world is big enough to hold the names */
  const wide = bucket >= 0.5;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const markers = reachEnds(reach).map(z => {
      const e = el('div', 'news-reach-end');
      e.dataset.newsReach = z.label;
      e.append(el('span', 'news-reach-end__dot'));
      if (wide) e.append(el('span', 'news-reach-end__name', z.label));
      return new maplibregl.Marker({ element: e, anchor: 'left', offset: [-3, 0] }).setLngLat([z.lng, z.lat]).addTo(map);
    });
    return () => markers.forEach(m => m.remove());
  }, [ready, reach, wide]);

  /* the open cash sessions, named at the top of their band */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const markers = sessions.map(s => {
      const e = el('div', 'news-session-tag', `${s.label} open`);
      return new maplibregl.Marker({ element: e, anchor: 'top' }).setLngLat([(s.west + s.east) / 2, 74]).addTo(map);
    });
    return () => markers.forEach(m => m.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sessionKey]);

  const zoomBy = (d: number) => {
    const map = mapRef.current;
    if (!map) return;
    moved.current = true;
    map.easeTo({ zoom: map.getZoom() + d, duration: 300 });
  };
  const home = () => {
    const map = mapRef.current;
    if (!map) return;
    moved.current = false;
    /* the reader asked for the frame back: aim again even where the last fit already pointed */
    lastFit.current = '';
    fit(map, true);
  };

  return (
    <div className={`news-live-map relative h-full w-full ${className}`} data-news-map="live" data-zoom={ready ? '1' : '0'} data-atlas={atlasRev >= 2 ? 'fine' : 'coarse'}>
      <div ref={host} className="h-full w-full" style={{ background: MAP_INK[tone].sea }} />
      {ready && (
        <div className="news-map-ctrl" data-touch-skip>
          <button type="button" onClick={() => zoomBy(1)} title="Zoom in" aria-label="Zoom in" data-touch-skip>
            +
          </button>
          <button type="button" onClick={() => zoomBy(-1)} title="Zoom out" aria-label="Zoom out" data-touch-skip>
            −
          </button>
          <button type="button" onClick={home} title="Back to the whole world" aria-label="Back to the whole world" data-touch-skip data-news-map-home>
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M1.8 8h12.4M8 1.8c2 2 2 10.4 0 12.4M8 1.8c-2 2-2 10.4 0 12.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          </button>
        </div>
      )}
      {ready && note && (
        <div className="news-map-empty" data-news-map-empty>
          <span>{note}</span>
        </div>
      )}
    </div>
  );
};

/** The map once the coarse atlas is in hand; a box of the same size until then */
const LiveMapLoader = (props: Props) => {
  const [ready, setReady] = useState(atlasLevel > 0);
  const onFail = useRef(props.onFail);
  onFail.current = props.onFail;
  useEffect(() => {
    if (ready) return;
    let dead = false;
    loadCoarse()
      .then(() => !dead && setReady(true))
      .catch(() => !dead && onFail.current?.());
    return () => {
      dead = true;
    };
  }, [ready]);
  return ready ? <LiveMap {...props} /> : <div className={props.className} data-news-map="loading" />;
};

export default LiveMapLoader;
