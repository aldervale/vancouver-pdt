/**
 * Build simplified regional paths for the before/after clock map.
 *
 * Sources (downloaded at build time, not shipped):
 * - Natural Earth 1:50m admin-1, public domain
 *   https://www.naturalearthdata.com/
 * - USDOT/BTS NTAD Time Zones (public-domain federal data), queried 2026-10-30
 *   https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Time_Zones/FeatureServer/0
 *   Query: zone IN ('Pacific','Mountain'), outFields=zone,utc, outSR=4326,
 *   f=geojson, maxAllowableOffset=0.002; save as /tmp/geo/ntad-time-zones.geojson.
 *
 * Regeneration needs `polygon-clipping` installed locally.
 * The app does not depend on them at runtime.
 *
 * The main map is a cropped Albers view of B.C. and its neighbours.
 * Most of Alaska is a separate inset; the panhandle stays beside northern B.C.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import polygonClipping from 'polygon-clipping';

const ne = JSON.parse(readFileSync('/tmp/geo/ne_50m_admin_1.geojson', 'utf8'));
const timeZones = JSON.parse(readFileSync('/tmp/geo/ntad-time-zones.geojson', 'utf8'));

const DEG = Math.PI / 180;

function makeProjector(phi1Deg, phi2Deg, phi0Deg, lambda0Deg) {
  const phi1 = phi1Deg * DEG;
  const phi2 = phi2Deg * DEG;
  const phi0 = phi0Deg * DEG;
  const lambda0 = lambda0Deg * DEG;
  const n = (Math.sin(phi1) + Math.sin(phi2)) / 2;
  const c = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
  const rho0 = Math.sqrt(c - 2 * n * Math.sin(phi0)) / n;
  return (lon, lat) => {
    const phi = lat * DEG;
    const lambda = lon * DEG;
    const rho = Math.sqrt(c - 2 * n * Math.sin(phi)) / n;
    const theta = n * (lambda - lambda0);
    return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)];
  };
}

const projectMain = makeProjector(42, 61, 51, -120);
const projectAlaska = makeProjector(55, 70, 63, -153);

function toMulti(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function closeRing(ring) {
  if (!ring.length) return ring;
  const [a] = ring;
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) return [...ring, a];
  return ring;
}

function sanitize(multi) {
  return multi
    .map((poly) => poly.map(closeRing).filter((ring) => ring.length >= 4))
    .filter((poly) => poly.length && poly[0].length >= 4);
}

function findAdmin(name, admin) {
  const feature = ne.features.find((item) => item.properties.name === name && item.properties.admin === admin);
  if (!feature) throw new Error(`Missing ${name}`);
  return sanitize(toMulti(feature.geometry));
}

function findTimeZone(name) {
  const feature = timeZones.features.find((item) => item.properties.zone === name);
  if (!feature) throw new Error(`Missing DOT time zone ${name}`);
  return sanitize(toMulti(feature.geometry));
}

function box(minLon, minLat, maxLon, maxLat) {
  return [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]];
}

function intersection(a, b) {
  if (!a.length || !b.length) return [];
  return sanitize(polygonClipping.intersection(a, b));
}

function difference(a, b) {
  if (!a.length) return [];
  if (!b.length) return a;
  return sanitize(polygonClipping.difference(a, b));
}

function union(parts) {
  return sanitize(parts.reduce((acc, part) => (acc.length ? polygonClipping.union(acc, part) : part), []));
}

const bc = findAdmin('British Columbia', 'Canada');
const alberta = findAdmin('Alberta', 'Canada');
const yukon = findAdmin('Yukon', 'Canada');
const saskatchewan = findAdmin('Saskatchewan', 'Canada');
const washington = findAdmin('Washington', 'United States of America');
const oregon = findAdmin('Oregon', 'United States of America');
const idaho = findAdmin('Idaho', 'United States of America');
const montana = findAdmin('Montana', 'United States of America');
const california = findAdmin('California', 'United States of America');

// Populated south only. High Arctic islands and the empty northern taper are cropped.
const nwt = intersection(findAdmin('Northwest Territories', 'Canada'), box(-136.5, 59.8, -102, 64.05));
const yukonSouth = intersection(yukon, box(-141.5, 59.7, -123.5, 64.05));

// Western Aleutians (Hawaii-Aleutian time, west of 169.5°W) stay cropped.
// The cut is farther east than that line so the Alaska Peninsula stays readable.
const alaskaAll = intersection(findAdmin('Alaska', 'United States of America'), box(-163, 51, -129.5, 71.5));
const alaskaPanhandle = intersection(alaskaAll, box(-141.15, 54.45, -129.4, 60.6));
const alaskaMainland = difference(alaskaAll, alaskaPanhandle);

// Story crop: northern California through the southern Yukon, coast through Saskatchewan.
// Keeps the San Francisco Bay shape and cuts the map before Los Angeles.
const frame = box(-141.3, 37.55, -101.05, 64.08);

// Peace River and Northern Rockies communities named by the province.
// Fort Ware sits near the western edge and is called out separately as PCT.
const neClip = [[
  [-126.6, 60.02],
  [-120.0, 60.02],
  [-119.95, 54.55],
  [-121.6, 54.55],
  [-123.15, 55.35],
  [-124.55, 56.8],
  [-126.15, 58.7],
  [-126.6, 60.02],
]];
// East Kootenay and Golden, east of Creston.
const seClip = [[
  [-117.2, 51.62],
  [-115.7, 51.7],
  [-113.9, 51.15],
  [-113.9, 48.95],
  [-116.22, 48.95],
  [-116.48, 49.28],
  [-116.85, 49.85],
  [-117.2, 50.85],
  [-117.2, 51.62],
]];

const neBc = intersection(bc, [neClip]);
const seBc = intersection(bc, [seClip]);
const mainBc = difference(difference(bc, neBc), seBc);

// The legal Idaho line follows the Salmon River, splitting Idaho County.
// Use DOT's verified zone polygons rather than assigning that whole county.
const pacificZone = findTimeZone('Pacific');
const mountainZone = findTimeZone('Mountain');
const northIdaho = intersection(idaho, pacificZone);
const southIdaho = difference(idaho, northIdaho);

// DOT also resolves the township-based southern Malheur boundary in 49 CFR 71.9.
const malheurMountain = intersection(oregon, mountainZone);
const oregonPacific = difference(oregon, malheurMountain);

const regions = {
  bc: intersection(mainBc, frame),
  neBc: intersection(neBc, frame),
  seBc: intersection(seBc, frame),
  alberta: intersection(alberta, frame),
  yukon: intersection(yukonSouth, frame),
  nwt,
  saskatchewan: intersection(saskatchewan, frame),
  washington: intersection(washington, frame),
  oregon: intersection(oregonPacific, frame),
  malheur: intersection(malheurMountain, frame),
  northIdaho: intersection(northIdaho, frame),
  southIdaho: intersection(southIdaho, frame),
  montana: intersection(montana, frame),
  california: intersection(california, frame),
  alaskaPanhandle: intersection(alaskaPanhandle, frame),
  alaska: alaskaMainland,
};

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = (yi > point[1]) !== (yj > point[1])
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function contains(multi, lon, lat) {
  const point = [lon, lat];
  return multi.some((poly) => pointInRing(point, poly[0]) && !poly.slice(1).some((hole) => pointInRing(point, hole)));
}

const checks = [
  ['Vancouver', -123.12, 49.28, 'bc'],
  ['Prince George', -122.75, 53.92, 'bc'],
  ['Kelowna', -119.50, 49.89, 'bc'],
  ['Nelson', -117.29, 49.49, 'bc'],
  ['Creston', -116.51, 49.10, 'bc'],
  ['Dawson Creek', -120.24, 55.76, 'neBc'],
  ['Fort St. John', -120.85, 56.25, 'neBc'],
  ['Fort Nelson', -122.70, 58.81, 'neBc'],
  ['Chetwynd', -121.63, 55.70, 'neBc'],
  ["Hudson's Hope", -121.91, 56.03, 'neBc'],
  ['Taylor', -120.69, 56.15, 'neBc'],
  ['Tumbler Ridge', -120.99, 55.13, 'neBc'],
  ['Cranbrook', -115.77, 49.51, 'seBc'],
  ['Fernie', -115.06, 49.50, 'seBc'],
  ['Sparwood', -114.89, 49.73, 'seBc'],
  ['Invermere', -116.03, 50.51, 'seBc'],
  ['Kimberley', -115.98, 49.67, 'seBc'],
  ['Radium Hot Springs', -116.07, 50.62, 'seBc'],
  ['Elkford', -114.92, 50.02, 'seBc'],
  ['Golden', -116.96, 51.30, 'seBc'],
  ['Whitehorse', -135.05, 60.72, 'yukon'],
  ['Yellowknife', -114.37, 62.45, 'nwt'],
  ['Calgary', -114.07, 51.05, 'alberta'],
  ['Edmonton', -113.49, 53.55, 'alberta'],
  ['Regina', -104.61, 50.45, 'saskatchewan'],
  ['Seattle', -122.33, 47.61, 'washington'],
  ['Portland', -122.68, 45.52, 'oregon'],
  ['Ontario, OR', -116.96, 44.03, 'malheur'],
  ['Southern Malheur', -117.45, 42.25, 'oregon'],
  ['Boise', -116.20, 43.62, 'southIdaho'],
  ["Coeur d'Alene", -116.78, 47.68, 'northIdaho'],
  ['Lewiston', -117.02, 46.42, 'northIdaho'],
  ['Riggins (south of Salmon River)', -116.315, 45.422, 'southIdaho'],
  ['White Bird (north of Salmon River)', -116.300, 45.761, 'northIdaho'],
  ['Malheur south of township boundary', -117.45, 42.40, 'oregon'],
  ['Malheur north of township boundary', -117.45, 42.50, 'malheur'],
  ['Missoula', -113.99, 46.87, 'montana'],
  ['Anchorage', -149.90, 61.22, 'alaska'],
  ['Juneau panhandle', -134.52, 58.30, 'alaskaPanhandle'],
  ['Fairbanks', -147.72, 64.84, 'alaska'],
  ['Redding', -122.39, 40.59, 'california'],
  ['San Francisco', -122.42, 37.77, 'california'],
  ['Fort Ware', -125.63, 57.42, 'bc'],
];

let failed = false;
for (const [name, lon, lat, expected] of checks) {
  const hits = Object.entries(regions).filter(([, multi]) => contains(multi, lon, lat)).map(([id]) => id);
  const ok = hits.length === 1 && hits[0] === expected;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}: ${hits.join(',') || 'none'} (expected ${expected})`);
}

function densifyRing(ring, step = 0.4) {
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    out.push(a);
    const pieces = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    for (let k = 1; k < pieces; k++) {
      const t = k / pieces;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function prepare(regionMap, project, epsilon, minArea, width) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const projected = {};
  for (const [id, multi] of Object.entries(regionMap)) {
    projected[id] = multi.map((poly) => poly.map((ring) => densifyRing(ring).map(([lon, lat]) => {
      const point = project(lon, lat);
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxY = Math.max(maxY, point[1]);
      return point;
    })));
  }
  const padX = (maxX - minX) * 0.02;
  const padY = (maxY - minY) * 0.02;
  minX -= padX;
  maxX += padX;
  minY -= padY;
  maxY += padY;
  const scale = width / (maxX - minX);
  const height = Math.round((maxY - minY) * scale);
  const scalePoint = ([x, y]) => [(x - minX) * scale, (maxY - y) * scale];

  const paths = {};
  const anchors = {};
  for (const [id, polys] of Object.entries(projected)) {
    const kept = [];
    let largest = null;
    let largestArea = 0;
    for (const poly of polys) {
      const localEpsilon = id === 'alaskaPanhandle' ? 6.5 : epsilon;
      const localMinArea = id === 'alaskaPanhandle' ? 900 : minArea;
      const rings = poly
        .map((ring) => simplify(ring.map(scalePoint), localEpsilon))
        .map(closeRing)
        .filter((ring) => ring.length >= 4);
      if (!rings.length || ringArea(rings[0]) < localMinArea) continue;
      kept.push(rings);
      const area = ringArea(rings[0]);
      if (area > largestArea) {
        largestArea = area;
        largest = rings[0];
      }
    }
    paths[id] = kept;
    const anchor = largest ? labelPoint(largest) : [0, 0];
    anchors[id] = [Number(anchor[0].toFixed(1)), Number(anchor[1].toFixed(1))];
    console.log(id, 'polys', kept.length, 'anchor', anchors[id].join(','), 'area', Math.round(largestArea));
  }
  return { paths, anchors, width, height, scalePoint };
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area / 2);
}

function distToSeg(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

function simplify(points, epsilon) {
  if (points.length < 3) return points;
  let maxDist = 0;
  let index = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i++) {
    const dist = distToSeg(points[i], points[0], points[last]);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, index + 1), epsilon);
    const right = simplify(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[last]];
}

function labelPoint(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const cols = 36;
  const rows = 36;
  let best = [(minX + maxX) / 2, (minY + maxY) / 2];
  let bestD = -1;
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j <= rows; j++) {
      const x = minX + ((maxX - minX) * i) / cols;
      const y = minY + ((maxY - minY) * j) / rows;
      if (!pointInRing([x, y], ring)) continue;
      let d = Infinity;
      for (let k = 0; k < ring.length - 1; k++) {
        const dist = distToSeg([x, y], ring[k], ring[k + 1]);
        if (dist < d) d = dist;
        if (d <= bestD) break;
      }
      if (d > bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  }
  return best;
}

const mainRegions = Object.fromEntries(Object.entries(regions).filter(([id]) => id !== 'alaska'));
const main = prepare(mainRegions, projectMain, 0.65, 70, 1000);
const alaska = prepare({ alaska: regions.alaska }, projectAlaska, 3.4, 40, 640);

function pathFor(multi) {
  return multi.map((rings) => rings.map((ring) => ring.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + 'Z').join('')).join('');
}

const markerIds = ['Vancouver', 'Creston', 'Seattle', 'Whitehorse', 'Yellowknife'];
const markers = {};
for (const [name, lon, lat] of checks) {
  if (!markerIds.includes(name)) continue;
  const [x, y] = main.scalePoint(projectMain(lon, lat));
  markers[name] = [Number(x.toFixed(1)), Number(y.toFixed(1))];
}
const [ax, ay] = alaska.scalePoint(projectAlaska(-149.9, 61.22));
const anchorage = [Number(ax.toFixed(1)), Number(ay.toFixed(1))];

const mainPaths = Object.fromEntries(Object.entries(main.paths).map(([id, multi]) => [id, pathFor(multi)]));
const alaskaPath = pathFor(alaska.paths.alaska);

const payload = {
  viewBox: `0 0 ${main.width} ${main.height}`,
  alaskaViewBox: `0 0 ${alaska.width} ${alaska.height}`,
  paths: mainPaths,
  anchors: main.anchors,
  markers,
  anchorage,
  alaskaPath,
};

writeFileSync('/tmp/geo/clock-map-paths.json', JSON.stringify(payload));
const ts = `/* Generated by scripts/build-clock-map.mjs from Natural Earth 1:50m (public domain)
   and USDOT/BTS NTAD time-zone boundaries (public domain). Do not edit by hand. */
export const clockMapViewBox = ${JSON.stringify(payload.viewBox)};
export const alaskaViewBox = ${JSON.stringify(payload.alaskaViewBox)};
export const clockMapPaths: Record<string, string> = ${JSON.stringify(payload.paths, null, 2)};
export const clockMapAnchors: Record<string, [number, number]> = ${JSON.stringify(payload.anchors, null, 2)};
export const clockMapMarkers: Record<string, [number, number]> = ${JSON.stringify(payload.markers, null, 2)};
export const alaskaInsetPath = ${JSON.stringify(payload.alaskaPath)};
export const anchorageMarker: [number, number] = ${JSON.stringify(payload.anchorage)};
`;
writeFileSync(new URL('../src/lib/clock-map-paths.ts', import.meta.url), ts);
console.log('viewBox', payload.viewBox, 'alaska', payload.alaskaViewBox);
console.log('markers', markers, 'anchorage', anchorage);

const colors = {
  bc: '#f0c654', neBc: '#f0c654', seBc: '#e36a45', alberta: '#e36a45', yukon: '#f0c654',
  nwt: '#e36a45', saskatchewan: '#e36a45', washington: '#f0c654', oregon: '#f0c654',
  malheur: '#e36a45', northIdaho: '#f0c654', southIdaho: '#e36a45', montana: '#e36a45',
  california: '#f0c654', alaskaPanhandle: '#8ec8ff',
};
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${payload.viewBox}" width="${main.width}" height="${main.height}">
  <rect width="100%" height="100%" fill="#10161d"/>
  ${Object.entries(mainPaths).map(([id, d]) => `<path d="${d}" fill="${colors[id]}" fill-rule="evenodd" stroke="#f7f4ee" stroke-width="1.4" stroke-linejoin="round"/>`).join('\n')}
  ${Object.entries(main.anchors).map(([id, [x, y]]) => `<text x="${x}" y="${y}" fill="#1a140c" font-size="18" font-family="sans-serif" text-anchor="middle">${id}</text>`).join('\n')}
  ${Object.entries(markers).map(([name, [x, y]]) => `<g><circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="#1a140c"/><text x="${x + 6}" y="${y - 6}" fill="#fff" font-size="11">${name}</text></g>`).join('\n')}
</svg>`;
writeFileSync('/tmp/geo/preview.svg', svg);
const alaskaSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${payload.alaskaViewBox}" width="${alaska.width}" height="${alaska.height}">
  <rect width="100%" height="100%" fill="#10161d"/>
  <path d="${alaskaPath}" fill="#8ec8ff" stroke="#f7f4ee" stroke-width="2"/>
  <circle cx="${anchorage[0]}" cy="${anchorage[1]}" r="5" fill="#fff"/>
</svg>`;
writeFileSync('/tmp/geo/alaska.svg', alaskaSvg);
console.log(failed ? 'CITY CHECKS FAILED' : 'CITY CHECKS PASSED');
if (failed) process.exitCode = 2;

