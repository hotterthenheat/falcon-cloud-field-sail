/*
  The wire map, drawn here. Land and borders come from the
  public-domain country atlas already in the bundle — no
  tile server, no key. Water is the background, so zooming
  out never opens a black frame.
*/
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(maplibreWorkerUrl);
import { feature } from 'topojson-client';
import { geoArea, geoCentroid, geoContains } from 'd3-geo';
import worldAtlas from 'world-atlas/countries-50m.json';
import cities from '../../data/cities.json';
import { useResolvedTheme } from '../../theme/theme';
import type { CityPing, GeoZone, NewsGrade } from '../../data/newsroom';
import type { FlyTo, HeatPoint, Reach } from './NewsMap';

const SEA: Record<'dark' | 'light', string> = { dark: '#12181e', light: '#d7e3ea' };
const LAND: Record<'dark' | 'light', string> = { dark: '#2a333c', light: '#f3f0e8' };
const EDGE: Record<'dark' | 'light', string> = { dark: 'rgba(255,255,255,0.22)', light: 'rgba(20,28,36,0.25)' };
const INK: Record<NewsGrade, string> = { THREAT: 'rgb(var(--bear))', ALLY: 'rgb(var(--bull))', WATCH: '#8a8f99' };

let land: GeoJSON.FeatureCollection | null = null;
const landCollection = (): GeoJSON.FeatureCollection => {
  if (!land) {
    const fc = feature(worldAtlas as unknown as Parameters<typeof feature>[0], (worldAtlas as { objects: { countries: Parameters<typeof feature>[1] } }).objects.countries) as unknown as GeoJSON.FeatureCollection;
    land = { type: 'FeatureCollection', features: fc.features.filter(f => String(f.id) !== '010' && f.geometry) };
  }
  return land;
};
const countryFeatures = () => landCollection().features;

type GazCity = { n: string; lat: number; lng: number; pop: number; z: number; c: string };
const GAZETTEER = cities as GazCity[];
/** Natural Earth's rank, restated as the zoom on this map where the city may appear.
    Zoomed out: the megacities only. Closer: the rest come in. */
const appearAt = (neZoom: number) => (neZoom <= 2.1 ? 0 : neZoom <= 3 ? 2.2 : neZoom <= 4 ? 3.15 : neZoom <= 5.1 ? 4.05 : 4.85);
const km = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const x = (aLng - bLng) * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180);
  return Math.hypot(x, aLat - bLat) * 111;
};
const COUNTRY_NAME: Record<string, string> = {
  'United States of America': 'United States',
  'Dem. Rep. Congo': 'Congo',
  'Dominican Rep.': 'Dominican Republic',
  'Central African Rep.': 'Central African Republic',
  'Bosnia and Herz.': 'Bosnia',
};
type CountryLabel = { name: string; area: number; lng: number; lat: number; feature: GeoJSON.Feature };
let countryLabels: CountryLabel[] | null = null;
const countriesLabeled = () => {
  if (!countryLabels) {
    countryLabels = countryFeatures()
      .map(f => {
        const c = geoCentroid(f);
        const raw = String((f.properties as { name?: string } | null)?.name ?? '');
        return { name: COUNTRY_NAME[raw] ?? raw, area: geoArea(f), lng: c[0], lat: c[1], feature: f };
      })
      .filter(c => c.name && Number.isFinite(c.lng) && Number.isFinite(c.lat));
  }
  return countryLabels;
};

/** Local land. Nothing leaves the browser. */
const baseStyle = (tone: 'dark' | 'light') => ({
  version: 8 as const,
  sources: {
    land: { type: 'geojson' as const, data: landCollection() },
  },
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': SEA[tone] } },
    { id: 'land', type: 'fill' as const, source: 'land', paint: { 'fill-color': LAND[tone] } },
    { id: 'land-line', type: 'line' as const, source: 'land', paint: { 'line-color': EDGE[tone], 'line-width': 0.7 } },
  ],
});

export interface LiveSession {
  key: string;
  label: string;
  west: number;
  east: number;
}

interface Props {
  pins: CityPing[];
  selectedCity: string | null;
  hoverCity: string | null;
  onPick: (pin: CityPing) => void;
  onHover: (pin: CityPing | null) => void;
  heat: HeatPoint[];
  reach: Reach | null;
  flyTo?: FlyTo | null;
  sessions: LiveSession[];
  className?: string;
}

/** World width at zoom z is 512 * 2^z. Stay a hair inside that so the tiles cover the box. */
const coverZoom = (w: number, h: number) => Math.log2(Math.max(w, h, 64) / 512) + 0.04;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const band = (west: number, east: number): GeoJSON.Feature => {
  const ring: [number, number][] = [];
  for (let x = east; x > west; x -= 6) ring.push([x, -58]);
  ring.push([west, -58]);
  for (let x = west; x < east; x += 6) ring.push([x, 72]);
  ring.push([east, 72], [east, -58]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
};

const landData = (pins: CityPing[], heat: HeatPoint[], reach: Reach | null): GeoJSON.FeatureCollection => {
  const features: GeoJSON.Feature[] = [];
  for (const f of countryFeatures()) {
    if (String(f.id) === '010') continue;
    let heatW = 0;
    let touched = false;
    for (const h of heat) if (geoContains(f, [h.lng, h.lat])) heatW += h.w;
    for (const p of pins) if (!touched && geoContains(f, [p.lng, p.lat])) touched = true;
    const open = !!(reach && geoContains(f, [reach.lng, reach.lat]));
    const role = open ? 'open' : heatW > 0 ? 'heat' : touched ? 'news' : '';
    if (!role || !f.geometry) continue;
    features.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: { role } });
  }
  return { type: 'FeatureCollection', features };
};

const reachData = (reach: Reach | null): GeoJSON.FeatureCollection => {
  if (!reach) return EMPTY;
  const zones = reach.zones.filter((z: GeoZone) => Math.hypot(z.lat - reach.lat, z.lng - reach.lng) > 0.5);
  return {
    type: 'FeatureCollection',
    features: zones.map(z => ({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [reach.lng, reach.lat],
          [(reach.lng + z.lng) / 2, (reach.lat + z.lat) / 2 + Math.min(12, Math.hypot(z.lat - reach.lat, z.lng - reach.lng) * 0.15)],
          [z.lng, z.lat],
        ],
      },
    })),
  };
};

const setSource = (map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) => {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  src?.setData(data);
};

const ensureLayers = (map: maplibregl.Map) => {
  if (map.getSource('news-land')) return;
  map.addSource('news-session', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'news-session',
    type: 'fill',
    source: 'news-session',
    paint: { 'fill-color': '#c7d3e8', 'fill-opacity': 0.07 },
  });
  map.addSource('news-land', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'news-land-fill',
    type: 'fill',
    source: 'news-land',
    paint: {
      'fill-color': ['match', ['get', 'role'], 'open', '#5f9e86', 'heat', '#c4845a', '#4d7a68'],
      'fill-opacity': ['match', ['get', 'role'], 'open', 0.42, 'heat', 0.34, 0.28],
    },
  });
  map.addLayer({
    id: 'news-land-line',
    type: 'line',
    source: 'news-land',
    paint: {
      'line-color': ['match', ['get', 'role'], 'open', '#e7edf4', '#c5d0dc'],
      'line-width': ['match', ['get', 'role'], 'open', 1.25, 0.6],
      'line-opacity': 0.85,
    },
  });
  map.addSource('news-reach', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'news-reach',
    type: 'line',
    source: 'news-reach',
    paint: { 'line-color': '#d5deea', 'line-width': 1.25, 'line-opacity': 0.75 },
  });
};

const LiveMap = ({ pins, selectedCity, hoverCity, onPick, onHover, heat, reach, flyTo = null, sessions, className = '' }: Props) => {
  const theme = useResolvedTheme();
  const host = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const coverRef = useRef(1);
  const moved = useRef(false);
  const flying = useRef(false);
  const flightRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [viewId, setViewId] = useState(0);
  const pinsRef = useRef(pins);
  const heatRef = useRef(heat);
  const reachRef = useRef(reach);
  const sessionsRef = useRef(sessions);
  pinsRef.current = pins;
  heatRef.current = heat;
  reachRef.current = reach;
  sessionsRef.current = sessions;
  const onPickRef = useRef(onPick);
  const onHoverRef = useRef(onHover);
  onPickRef.current = onPick;
  onHoverRef.current = onHover;

  const fit = (map: maplibregl.Map, animate: boolean) => {
    const pts = pinsRef.current;
    const cover = coverRef.current;
    if (pts.length === 0) {
      map.jumpTo({ center: [8, 28], zoom: cover });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    pts.forEach(p => b.extend([p.lng, p.lat]));
    map.fitBounds(b, { padding: { top: 28, bottom: 44, left: 28, right: 28 }, duration: animate ? 650 : 0, maxZoom: 3.2 });
    if (map.getZoom() < cover) map.setZoom(cover);
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const z = coverZoom(el.clientWidth, el.clientHeight);
    coverRef.current = z;
    const map = new maplibregl.Map({
      container: el,
      style: baseStyle(theme === 'light' ? 'light' : 'dark'),
      center: [8, 28],
      zoom: z,
      minZoom: z,
      maxZoom: 8,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: true,
      maxPitch: 0,
      fadeDuration: 0,
    });
    map.touchZoomRotate.disableRotation();
    map.scrollZoom.setWheelZoomRate(1 / 240);
    const paintGap = () => {
      const tone = themeRef.current === 'light' ? 'light' : 'dark';
      if (map.getLayer('background')) map.setPaintProperty('background', 'background-color', SEA[tone]);
    };
    const hold = () => {
      if (flying.current) return;
      const box = el.getBoundingClientRect();
      const next = coverZoom(box.width, box.height);
      coverRef.current = next;
      map.setMinZoom(next);
      if (map.getZoom() < next) map.jumpTo({ zoom: next, center: map.getCenter() });
    };
    const push = () => {
      if (!map.getSource('news-land')) return;
      setSource(map, 'news-land', landData(pinsRef.current, heatRef.current, reachRef.current));
      setSource(map, 'news-reach', reachData(reachRef.current));
      setSource(map, 'news-session', { type: 'FeatureCollection', features: sessionsRef.current.map(s => band(s.west, s.east)) });
    };
    map.on('load', () => {
      paintGap();
      ensureLayers(map);
      push();
      hold();
      fit(map, false);
      setZoom(map.getZoom());
      setReady(true);
    });
    map.on('style.load', () => {
      paintGap();
      ensureLayers(map);
      push();
    });
    map.on('movestart', (e: maplibregl.MapLibreEvent) => {
      if (e.originalEvent) moved.current = true;
    });
    map.on('dragstart', (e: maplibregl.MapLibreEvent) => {
      if (e.originalEvent) moved.current = true;
    });
    const onWheel = () => {
      moved.current = true;
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    map.on('moveend', () => {
      setZoom(map.getZoom());
      setViewId(n => n + 1);
    });
    const ro = new ResizeObserver(() => {
      map.resize();
      hold();
      if (!flying.current && !moved.current) fit(map, false);
    });
    ro.observe(el);
    mapRef.current = map;
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // theme is applied below so the map is not rebuilt on every parent render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const themeRef = useRef(theme);
  const seenTheme = useRef(theme);
  themeRef.current = theme;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || seenTheme.current === theme) return;
    seenTheme.current = theme;
    map.setStyle(baseStyle(theme === 'light' ? 'light' : 'dark'));
  }, [theme, ready]);

  const sessionKey = sessions.map(s => s.key).join(' ');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource('news-land')) return;
    setSource(map, 'news-land', landData(pins, heat, reach));
    setSource(map, 'news-reach', reachData(reach));
    setSource(map, 'news-session', { type: 'FeatureCollection', features: sessions.map(s => band(s.west, s.east)) });
  }, [ready, pins, heat, reach, sessionKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || moved.current) return;
    fit(map, false);
  }, [ready, pins]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !flyTo) return;
    const flight = ++flightRef.current;
    moved.current = true;
    const here = map.getCenter();
    let destLng = flyTo.lng;
    while (destLng - here.lng > 180) destLng -= 360;
    while (here.lng - destLng > 180) destLng += 360;
    const dlng = Math.abs(destLng - here.lng);
    const dlat = Math.abs(flyTo.lat - here.lat);
    const deg = Math.hypot(dlng * Math.cos((((here.lat + flyTo.lat) / 2) * Math.PI) / 180), dlat);
    const cover = coverRef.current;
    const arrive = 5.05;
    flying.current = true;
    map.stop();
    map.setMinZoom(Math.max(0, cover - 2.4));
    const duration = deg < 2.5 ? 800 : Math.round(Math.min(2400, Math.max(1200, 700 + deg * 10)));
    const arm = requestAnimationFrame(() => {
      if (flightRef.current !== flight) return;
      if (deg < 2.5) {
        map.easeTo({
          center: [destLng, flyTo.lat],
          zoom: Math.max(map.getZoom(), arrive),
          duration,
          essential: true,
          easing: (t: number) => 1 - Math.pow(1 - t, 3),
        });
      } else {
        map.flyTo({
          center: [destLng, flyTo.lat],
          zoom: arrive,
          duration,
          curve: 1.42,
          essential: true,
        });
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
      map.setMinZoom(coverRef.current);
    };
    map.on('moveend', onEnd);
    return () => {
      cancelAnimationFrame(arm);
      map.off('moveend', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.key, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const markers: maplibregl.Marker[] = [];
    const bounds = map.getBounds();
    const span = Math.abs(bounds.getEast() - bounds.getWest());
    const whole = span > 300 || zoom < 1.15;
    const inside = (lng: number, lat: number) => whole || bounds.contains([lng, lat]);
    const quiet = theme === 'light';
    const nameInk = quiet ? 'rgba(28,34,40,0.78)' : 'rgba(232,236,242,0.88)';
    const softInk = quiet ? 'rgba(28,34,40,0.42)' : 'rgba(214,220,228,0.48)';
    const placed: { x: number; y: number }[] = [];
    const crowded = (lng: number, lat: number, gap: number) => {
      const pt = map.project([lng, lat]);
      if (placed.some(p => Math.hypot(p.x - pt.x, p.y - pt.y) < gap)) return true;
      placed.push(pt);
      return false;
    };
    const countryPlaced: { x: number; y: number }[] = [];
    const namedCountries = new Set<string>();
    if (zoom >= 2.45 && zoom <= 5.7) {
      const minArea = zoom < 3.2 ? 0.012 : zoom < 4.3 ? 0.0025 : 0.00035;
      const camera = map.getCenter();
      for (const country of countriesLabeled()) {
        if (country.area < minArea) continue;
        const lookingAt = geoContains(country.feature, [camera.lng, camera.lat]);
        const middleOnScreen = inside(country.lng, country.lat);
        if (!lookingAt && !middleOnScreen) continue;
        let lng = country.lng;
        let lat = country.lat;
        if (!middleOnScreen) {
          const at = map.project([camera.lng, camera.lat]);
          const below = map.unproject([at.x, at.y + 36]);
          lng = below.lng;
          lat = below.lat;
        }
        const pt = map.project([lng, lat]);
        if (countryPlaced.some(p => Math.hypot(p.x - pt.x, p.y - pt.y) < 80)) continue;
        countryPlaced.push(pt);
        const el = document.createElement('div');
        el.dataset.newsCountry = country.name;
        el.textContent = country.name;
        el.style.cssText = `pointer-events:none;font:600 11px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:${softInk};white-space:nowrap;text-shadow:0 1px 2px ${quiet ? 'rgba(255,255,255,0.85)' : '#0b1016'};`;
        markers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map));
        namedCountries.add(country.name);
      }
    }
    const visible = GAZETTEER.filter(c => appearAt(c.z) <= zoom && inside(c.lng, c.lat)).sort((a, b) => b.pop - a.pop);
    const shown: GazCity[] = [];
    for (const c of visible) {
      if (crowded(c.lng, c.lat, 52)) continue;
      shown.push(c);
      if (shown.length >= 32) break;
    }
    if (zoom >= 2.45 && zoom <= 6.4) {
      const best = new Map<string, GazCity>();
      for (const c of shown) {
        const name = COUNTRY_NAME[c.c] ?? c.c;
        if (namedCountries.has(name)) continue;
        const prev = best.get(name);
        if (!prev || c.pop > prev.pop) best.set(name, c);
      }
      for (const [name, c] of best) {
        const at = map.project([c.lng, c.lat]);
        const below = map.unproject([at.x, at.y + 22]);
        const el = document.createElement('div');
        el.dataset.newsCountry = name;
        el.textContent = name;
        el.style.cssText = `pointer-events:none;font:600 11px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:${softInk};white-space:nowrap;text-shadow:0 1px 2px ${quiet ? 'rgba(255,255,255,0.85)' : '#0b1016'};`;
        markers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([below.lng, below.lat]).addTo(map));
      }
    }
    const rolled = zoom < 3.9;
    const claimed = new Set<string>();
    const buckets = new Map<string, { city: string; lat: number; lng: number; n: number; grade: NewsGrade; top: CityPing }>();
    if (rolled) {
      for (const p of pins) {
        let host: GazCity | null = null;
        let best = 1e9;
        for (const c of shown) {
          const d = km(p.lat, p.lng, c.lat, c.lng);
          if (d < best) {
            best = d;
            host = c;
          }
        }
        if (!host) continue;
        claimed.add(p.city);
        const had = buckets.get(host.n);
        if (!had) buckets.set(host.n, { city: host.n, lat: host.lat, lng: host.lng, n: p.n, grade: p.grade, top: p });
        else {
          had.n += p.n;
          if (p.maxSeverity > had.top.maxSeverity) {
            had.top = p;
            had.grade = p.grade;
          }
        }
      }
    }
    const labeled = new Set<string>();
    for (const c of shown) {
      const news = buckets.get(c.n);
      if (news) labeled.add(c.n);
      const el = document.createElement(news ? 'button' : 'div');
      el.dataset.newsCityMark = c.n;
      if (news) {
        (el as HTMLButtonElement).type = 'button';
        el.style.cssText = 'display:flex;align-items:center;gap:4px;background:none;border:0;padding:0;cursor:pointer;';
        el.addEventListener('click', ev => {
          ev.stopPropagation();
          onPickRef.current(news.top);
        });
      } else {
        el.style.cssText = 'display:flex;align-items:center;gap:4px;pointer-events:none;';
      }
      const dot = document.createElement('span');
      dot.style.cssText = news
        ? `width:7px;height:7px;border-radius:999px;background:${INK[news.grade]};box-shadow:0 0 0 1px rgba(0,0,0,0.55);display:block;flex:none;`
        : `width:3px;height:3px;border-radius:999px;background:${softInk};display:block;flex:none;`;
      const name = document.createElement('span');
      name.textContent = news ? `${c.n}  ${news.n}` : c.n;
      name.dataset.newsCity = c.n;
      name.style.cssText = `font:${news ? 600 : 500} ${news ? 11 : 10}px/1.15 ui-sans-serif,system-ui,sans-serif;color:${news ? nameInk : softInk};white-space:nowrap;text-shadow:0 1px 2px ${quiet ? 'rgba(255,255,255,0.8)' : '#0b1016'};`;
      el.append(dot, name);
      markers.push(new maplibregl.Marker({ element: el, anchor: 'left' }).setLngLat([c.lng, c.lat]).addTo(map));
    }
    for (const p of pins) {
      const open = p.city === selectedCity;
      if (labeled.has(p.city)) continue;
      if (claimed.has(p.city) && !open) continue;
      if (!open && !inside(p.lng, p.lat)) continue;
      const hot = p.city === hoverCity;
      const wrap = document.createElement('button');
      wrap.type = 'button';
      wrap.dataset.newsPin = p.city;
      wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;background:none;border:0;padding:0;cursor:pointer;';
      const dot = document.createElement('span');
      const size = open || hot ? 12 : 8;
      dot.style.cssText = `width:${size}px;height:${size}px;border-radius:999px;background:${INK[p.grade]};box-shadow:0 0 0 ${open ? 2 : 1}px ${open ? 'rgb(var(--silver))' : 'rgba(0,0,0,0.65)'};display:block;flex:none;`;
      const name = document.createElement('span');
      name.textContent = `${p.city}  ${p.n}`;
      name.dataset.newsCity = p.city;
      name.style.cssText = `font:600 11px/1.15 ui-sans-serif,system-ui,sans-serif;color:${nameInk};white-space:nowrap;text-shadow:0 1px 2px ${quiet ? 'rgba(255,255,255,0.8)' : '#0b1016'};`;
      wrap.style.cssText = 'display:flex;align-items:center;gap:4px;background:none;border:0;padding:0;cursor:pointer;';
      wrap.append(dot, name);
      wrap.addEventListener('click', ev => {
        ev.stopPropagation();
        onPickRef.current(p);
      });
      wrap.addEventListener('mouseenter', () => onHoverRef.current(p));
      wrap.addEventListener('mouseleave', () => onHoverRef.current(null));
      markers.push(new maplibregl.Marker({ element: wrap, anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(map));
    }
    return () => markers.forEach(m => m.remove());
  }, [ready, pins, selectedCity, hoverCity, zoom, theme, viewId]);

  return (
    <div className={`news-live-map relative h-full w-full ${className}`} data-news-map="live" data-zoom={ready ? '1' : '0'} data-map-z={zoom.toFixed(2)}>
      <div ref={host} className="h-full w-full" style={{ background: theme === 'light' ? SEA.light : SEA.dark }} />
    </div>
  );
};

export default LiveMap;
