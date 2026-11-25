export const emptyMap = {type: 'FeatureCollection', features: []};
const isNumber = Number.isFinite;
const validPoint = p => Array.isArray(p) && p.length === 2 && p.every(isNumber)
  && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const validRing = ring => Array.isArray(ring) && ring.length >= 4
  && ring.every(validPoint) && ring[0].every((v, i) => v === ring.at(-1)[i]);
const validPolygon = rings => Array.isArray(rings) && rings.length && rings.every(validRing);

export function validateMap(map) {
  if (map?.type !== 'FeatureCollection' || !Array.isArray(map.features)) throw Error('Expected GeoJSON FeatureCollection');
  const ids = new Set();
  for (const item of map.features) {
    const {type, properties: p, geometry: g} = item ?? {};
    const validGeometry = g?.type === 'Polygon' ? validPolygon(g.coordinates) :
      g?.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length && g.coordinates.every(validPolygon);
    if (type !== 'Feature' || !p || typeof p.reach_id !== 'string' || !p.reach_id || ids.has(p.reach_id)
        || typeof p.flow_id !== 'string' || !p.flow_id || !isNumber(p.from_m) || !isNumber(p.to_m)
        || p.from_m < 0 || p.to_m <= p.from_m || !validGeometry) throw Error('Invalid water reach: ' + JSON.stringify(p));
    ids.add(p.reach_id);
  }
  return map;
}

export function interpolateMap(map, stations, {maxGapM, maxSkewMs, now, maxAgeMs}) {
  const groups = new Map();
  for (const s of stations) {
    const row = s.latest;
    if (!s.flow_id || !isNumber(s.chainage_m) || !row || row.salinity_psu === null ||
        row.measured_at === null || now - row.measured_at > maxAgeMs || row.measured_at > now) continue;
    if (!groups.has(s.flow_id)) groups.set(s.flow_id, []);
    groups.get(s.flow_id).push({id: s.id, m: s.chainage_m, row});
  }
  for (const group of groups.values()) group.sort((a, b) => a.m - b.m);
  return {...map, features: map.features.map(feature => {
    const p = feature.properties;
    const group = groups.get(p.flow_id) || [];
    const mid = (p.from_m + p.to_m) / 2;
    const lower = group.findLast(x => x.m <= p.from_m);
    const upper = group.find(x => x.m >= p.to_m);
    const usable = lower && upper && upper.m - lower.m <= maxGapM &&
      Math.abs(upper.row.measured_at - lower.row.measured_at) <= maxSkewMs;
    const estimate = usable
      ? lower.row.salinity_psu + (upper.row.salinity_psu - lower.row.salinity_psu) * (mid - lower.m) / (upper.m - lower.m)
      : null;
    return {...feature, properties: {
      reach_id: p.reach_id, flow_id: p.flow_id, from_m: p.from_m, to_m: p.to_m,
      name: typeof p.name === 'string' ? p.name : p.reach_id,
      salinity_psu: estimate === null ? null : Math.round(estimate * 100) / 100,
      sources: usable ? [lower.id, upper.id] : [],
      oldest_measured_at: usable ? Math.min(lower.row.measured_at, upper.row.measured_at) : null
    }};
  })};
}
