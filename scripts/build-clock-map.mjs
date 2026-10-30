/**
 * Build simplified regional paths for the before/after clock map.
 *
 * Sources (downloaded at build time, not shipped):
 * - Natural Earth 1:50m admin-1, public domain
 *   https://www.naturalearthdata.com/
 * - U.S. Census cartographic counties via the us-atlas TopoJSON (public domain)
 *   https://github.com/topojson/us-atlas
 *
 * Regeneration needs `polygon-clipping` and `topojson-client` installed locally.
 * The app does not depend on them at runtime.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import polygonClipping from 'polygon-clipping';

const ne = JSON.parse(readFileSync('/tmp/geo/ne_50m_admin_1.geojson', 'utf8'));
const countiesTopo = JSON.parse(readFileSync('/tmp/geo/counties-10m.json', 'utf8'));
const counties = feature(countiesTopo, countiesTopo.objects.counties);

const DEG = Math.PI / 180;
const PHI1 = 40 * DEG;
const PHI2 = 64 * DEG;
const PHI0 = 48 * DEG;
const LAMBDA0 = -126 * DEG;
const N = (Math.sin(PHI1) + Math.sin(PHI2)) / 2;
const C = Math.cos(PHI1) ** 2 + 2 * N * Math.sin(PHI1);
const RHO0 = Math.sqrt(C - 2 * N * Math.sin(PHI0)) / N;

function project(lon, lat) {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const rho = Math.sqrt(C - 2 * N * Math.sin(phi)) / N;
  const theta = N * (lambda - LAMBDA0);
  return [rho * Math.sin(theta), RHO0 - rho * Math.cos(theta)];
}

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

function findCounty(id) {
  const feature = counties.features.find((item) => String(item.id) === id);
  if (!feature) throw new Error(`Missing county ${id}`);
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
const nwt = intersection(findAdmin('Northwest Territories', 'Canada'), box(-141, 59.8, -101, 71));
const saskatchewan = findAdmin('Saskatchewan', 'Canada');
const washington = findAdmin('Washington', 'United States of America');
const oregon = findAdmin('Oregon', 'United States of America');
const idaho = findAdmin('Idaho', 'United States of America');
const montana = findAdmin('Montana', 'United States of America');
const california = findAdmin('California', 'United States of America');
// Western Aleutians (including Hawaii-Aleutian time, west of 169.5°W) are cropped.
// The cut is farther east than that line so the Alaska Peninsula stays readable.
const alaska = intersection(findAdmin('Alaska', 'United States of America'), box(-163, 51, -129, 71.5));

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

const pacificCountyIds = ['16009', '16017', '16021', '16035', '16049', '16055', '16057', '16061', '16069', '16079'];
const pacificCounties = union(pacificCountyIds.map(findCounty));
const northIdaho = intersection(idaho, pacificCounties);
const southIdaho = difference(idaho, northIdaho);

const malheur = findCounty('41045');
const malheurMountain = intersection(oregon, intersection(malheur, box(-119.2, 42.48, -116.2, 45.2)));
const oregonPacific = difference(oregon, malheurMountain);

const regions = {
  bc: mainBc,
  neBc,
  seBc,
  alberta,
  yukon,
  nwt,
  saskatchewan,
  washington,
  oregon: oregonPacific,
  malheur: malheurMountain,
  northIdaho,
  southIdaho,
  montana,
  california,
  alaska,
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
  ['Missoula', -113.99, 46.87, 'montana'],
  ['Anchorage', -149.90, 61.22, 'alaska'],
  ['Juneau panhandle', -134.52, 58.30, 'alaska'],
  ['Fairbanks', -147.72, 64.84, 'alaska'],
  ['Los Angeles', -118.24, 34.05, 'california'],
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

const projected = {};
let minX = Infinity;
let minY = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;
for (const [id, multi] of Object.entries(regions)) {
  projected[id] = multi.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => {
    const point = project(lon, lat);
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
    return point;
  })));
}

const PAD = 0.012;
const width = maxX - minX;
const height = maxY - minY;
minX -= width * PAD;
maxX += width * PAD;
minY -= height * PAD;
maxY += height * PAD;
const targetWidth = 1000;
const scale = targetWidth / (maxX - minX);
const targetHeight = Math.round((maxY - minY) * scale);
console.log('viewBox', `0 0 ${targetWidth} ${targetHeight}`, 'scale', scale.toFixed(1));

function scalePoint([x, y]) {
  return [(x - minX) * scale, (maxY - y) * scale];
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

const MIN_AREA = 18;
const paths = {};
const anchors = {};
for (const [id, multi] of Object.entries(projected)) {
  const kept = [];
  let largest = null;
  let largestArea = 0;
  for (const poly of multi) {
    const rings = poly.map((ring) => simplify(ring.map(scalePoint), 1.05)).map(closeRing).filter((ring) => ring.length >= 4);
    const minArea = id === 'nwt' ? 4000 : id === 'alaska' ? 8 : MIN_AREA;
    if (!rings.length || ringArea(rings[0]) < minArea) continue;
    kept.push(rings);
    const area = ringArea(rings[0]);
    if (area > largestArea) {
      largestArea = area;
      largest = rings[0];
    }
  }
  paths[id] = kept;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const [x, y] of largest ?? []) {
    sx += x;
    sy += y;
    n++;
  }
  anchors[id] = n ? [Number((sx / n).toFixed(1)), Number((sy / n).toFixed(1))] : [0, 0];
  console.log(id, 'polys', kept.length, 'anchor', anchors[id].join(','), 'area', Math.round(largestArea));
}

function pathFor(multi) {
  return multi.map((rings) => rings.map((ring) => ring.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + 'Z').join('')).join('');
}

const cityDots = checks.map(([name, lon, lat]) => {
  const [x, y] = scalePoint(project(lon, lat));
  return { name, x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
});

const markerIds = ['Vancouver', 'Creston', 'Seattle', 'Whitehorse', 'Yellowknife', 'Anchorage'];
const markers = Object.fromEntries(cityDots.filter((city) => markerIds.includes(city.name)).map((city) => [city.name, [city.x, city.y]]));

const payload = {
  viewBox: `0 0 ${targetWidth} ${targetHeight}`,
  width: targetWidth,
  height: targetHeight,
  paths: Object.fromEntries(Object.entries(paths).map(([id, multi]) => [id, pathFor(multi)])),
  anchors,
  markers,
};

writeFileSync('/tmp/geo/clock-map-paths.json', JSON.stringify(payload));
const ts = `/* Generated by scripts/build-clock-map.mjs from Natural Earth 1:50m (public domain)
   and U.S. Census counties via us-atlas (public domain). Do not edit by hand. */
export const clockMapViewBox = ${JSON.stringify(payload.viewBox)};
export const clockMapPaths: Record<string, string> = ${JSON.stringify(payload.paths, null, 2)};
export const clockMapAnchors: Record<string, [number, number]> = ${JSON.stringify(payload.anchors, null, 2)};
export const clockMapMarkers: Record<string, [number, number]> = ${JSON.stringify(payload.markers, null, 2)};
`;
writeFileSync(new URL('../src/lib/clock-map-paths.ts', import.meta.url), ts);
console.log('markers', markers);

const colors = {
  bc: '#f0c654', neBc: '#d4a017', seBc: '#e76f51', alberta: '#e76f51', yukon: '#f0c654',
  nwt: '#e76f51', saskatchewan: '#e76f51', washington: '#58a6ff', oregon: '#58a6ff',
  malheur: '#e76f51', northIdaho: '#58a6ff', southIdaho: '#e76f51', montana: '#e76f51',
  california: '#58a6ff', alaska: '#58a6ff',
};
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${payload.viewBox}" width="${targetWidth}" height="${targetHeight}">
  <rect width="100%" height="100%" fill="#0d1117"/>
  ${Object.entries(payload.paths).map(([id, d]) => `<path d="${d}" fill="${colors[id]}" fill-rule="evenodd" stroke="#0d1117" stroke-width="1.2"/>`).join('\n')}
  ${Object.entries(anchors).map(([id, [x, y]]) => `<text x="${x}" y="${y}" fill="#0d1117" font-size="14" text-anchor="middle">${id}</text>`).join('\n')}
  ${cityDots.map((city) => `<g><circle cx="${city.x}" cy="${city.y}" r="2.2" fill="#fff"/><text x="${city.x + 4}" y="${city.y - 3}" fill="#fff" font-size="8">${city.name}</text></g>`).join('\n')}
</svg>`;
writeFileSync('/tmp/geo/preview.svg', svg);
console.log(failed ? 'CITY CHECKS FAILED' : 'CITY CHECKS PASSED');
if (failed) process.exitCode = 2;
