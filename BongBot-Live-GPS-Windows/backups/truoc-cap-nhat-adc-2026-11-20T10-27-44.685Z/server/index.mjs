import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { validateMap, interpolateMap, emptyMap } from './geo.mjs';
import { previewStations, previewWater, seedPreview } from './preview-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = process.env;
const preview = env.BONGBOT_PREVIEW === '1';
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const sha = val => createHash('sha256').update(val).digest('hex');
const equal = (a, b) => timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const live = !preview && env.BONGBOT_LIVE_FILE ? readJson(env.BONGBOT_LIVE_FILE) : null;
const basicHash = live ? sha('Basic '+Buffer.from(live.user+':'+live.password).toString('base64')) : null;
const devices = new Map();
const usedTokens = new Set();
const positions = new Map();
const configuredDevices = preview ? previewStations.map(station => ({...station,token_sha256:sha(station.id)}))
  : live ? [{id:live.station,name:'Cống Bông Bót',token_sha256:sha(live.deviceToken)}]
  : readJson(env.DEVICES_FILE || join(root, 'config/devices.json'));
for (const {id, name, token_sha256, flow_id = null, chainage_m = null} of configuredDevices) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(id) || devices.has(id) ||
      typeof name !== 'string' || !name.trim() ||
      typeof token_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(token_sha256) || usedTokens.has(token_sha256) ||
      (flow_id === null ? chainage_m !== null : typeof flow_id !== 'string' || !flow_id || !Number.isFinite(chainage_m) || chainage_m < 0)) {
    throw Error('Invalid device configuration: ' + id);
  }
  if (flow_id !== null) {
    if (!positions.has(flow_id)) positions.set(flow_id, new Set());
    if (positions.get(flow_id).has(chainage_m)) throw Error('Duplicate station chainage in ' + flow_id);
    positions.get(flow_id).add(chainage_m);
  }
  usedTokens.add(token_sha256);
  devices.set(id, {id, name, token_sha256, flow_id, chainage_m});
}
const water = validateMap(preview ? previewWater : env.WATER_FILE ? readJson(env.WATER_FILE) : emptyMap);
const dbFile = env.DB_PATH || join(root, 'data/telemetry.sqlite');
if (!preview) mkdirSync(dirname(dbFile), {recursive: true});
const db = new DatabaseSync(preview ? ':memory:' : dbFile);
db.exec(readFileSync(join(root, 'server/schema.sql'), 'utf8'));
const fields = 'sample_id, measured_at, received_at, observed_at, lat, lng, hdop, satellites, ec_us_cm, temp_c, salinity_psu, battery_v, dropped';
const insert = db.prepare(`INSERT INTO readings
  (device_id,sample_id,measured_at,received_at,lat,lng,hdop,satellites,ec_us_cm,temp_c,salinity_psu,battery_v,dropped,payload)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
if (preview) seedPreview(db, insert);
const duplicate = db.prepare('SELECT payload FROM readings WHERE device_id=? AND sample_id=?');
const latest = db.prepare(`SELECT ${fields} FROM readings WHERE device_id=? ORDER BY observed_at DESC, received_at DESC LIMIT 1`);
const fix = db.prepare('SELECT lat,lng,hdop,satellites,measured_at,received_at FROM readings WHERE device_id=? AND lat IS NOT NULL ORDER BY measured_at DESC,received_at DESC LIMIT 1');
const contact = db.prepare('SELECT max(received_at) AS last_seen FROM readings WHERE device_id=?');
const history = db.prepare(`SELECT ${fields} FROM readings WHERE device_id=? AND observed_at BETWEEN ? AND ? ORDER BY observed_at DESC, received_at DESC LIMIT ?`);
const limits = {
  lat: [-90, 90], lng: [-180, 180], hdop: [0, 99.99], satellites: [0, 100],
  ec_us_cm: [0, 300000], temp_c: [-55, 125], salinity_psu: [0, 80], battery_v: [0, 100], dropped: [0, 4294967295]
};
const MAX_BODY = 4096;
const minute = 60_000;
function positiveVariable(name, fallback) {
  const value = Number(env[name] || fallback);
  if (!Number.isFinite(value) || value <= 0) throw Error('Invalid ' + name);
  return value;
}
const maxAgeMs = (preview ? 15 : positiveVariable('MAP_MAX_AGE_MIN', 15)) * minute;
const maxSkewMs = (preview ? 5 : positiveVariable('MAP_MAX_SKEW_MIN', 5)) * minute;
const maxGapM = preview ? 2000 : positiveVariable('MAP_MAX_GAP_M', 2000);
const onlineMs = (preview ? 3 : positiveVariable('DEVICE_ONLINE_MIN', 3)) * minute;
const assets = new Map();
const mime = {html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',webp:'image/webp'};
const reply = (res, status, value) => {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
};
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415,'application/json required');
  if (Number(req.headers['content-length']) > MAX_BODY) throw new HttpError(413,'body too large');
  let length = 0;
  const chunks = [];
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    length += chunk.length;
    if (length > MAX_BODY) throw new HttpError(413,'body too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400,'invalid JSON'); }
}
function normalize(data, now) {
  if (typeof data.sample_id !== 'string' || !/^[a-zA-Z0-9_-]{12,80}$/.test(data.sample_id)) throw new HttpError(422,'invalid sample_id');
  const sample = {measured_at: data.measured_at ?? null};
  if (sample.measured_at !== null && (!Number.isSafeInteger(sample.measured_at) ||
      sample.measured_at < Date.UTC(2024,0,1) || sample.measured_at > now + 2*minute)) throw new HttpError(422,'invalid measured_at (UTC milliseconds)');
  for (const [key, [min,max]] of Object.entries(limits)) {
    const v = data[key] ?? null;
    if (v !== null && (!Number.isFinite(v) || v < min || v > max ||
        (['satellites','dropped'].includes(key) && !Number.isInteger(v)))) throw new HttpError(422,'invalid ' + key);
    sample[key] = v;
  }
  if ((sample.lat === null) !== (sample.lng === null) || (sample.lat === null && (sample.hdop !== null || sample.satellites !== null)))
    throw new HttpError(422,'invalid GPS fields');
  return sample;
}
const list = () => [...devices.values()].map(({token_sha256, ...station}) => ({
  ...station, latest: latest.get(station.id) ?? null, fix: fix.get(station.id) ?? null, last_seen: contact.get(station.id).last_seen
}));
const server = http.createServer({requestTimeout: 12_000, headersTimeout: 8_000, connectionsCheckingInterval: 1000}, async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options','DENY');
  try {
    const {pathname, searchParams} = new URL(req.url, 'http://localhost');
    const now = Date.now();
    if (req.method === 'GET' && pathname === '/healthz') {
      db.prepare('SELECT 1').get();
      return reply(res,200,live ? {ok:true,station_service:live.instance} : {ok:true});
    }
    if (req.method === 'POST' && pathname === '/api/v1/ingest') {
      if (preview) throw new HttpError(405,'preview is read-only');
      const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || '')?.[1];
      const id = req.headers['x-device-id'];
      const device = devices.get(id);
      if (!token || !device || !equal(sha(token), device.token_sha256)) {
        req.resume();
        throw new HttpError(401,'invalid device credentials');
      }
      const data = await body(req);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400,'expected object');
      const sample = normalize(data, now);
      const payload = JSON.stringify(sample);
      const result = insert.run(id, data.sample_id, sample.measured_at, now,
        ...Object.keys(limits).map(key => sample[key]), payload);
      if (!result.changes && duplicate.get(id,data.sample_id).payload !== payload) throw new HttpError(409,'sample_id payload conflict');
      return reply(res,result.changes ? 201 : 200,{ok:true, duplicate:!result.changes, sample_id:data.sample_id});
    }
    if (basicHash && !equal(sha(req.headers.authorization || ''),basicHash)) {
      res.setHeader('WWW-Authenticate','Basic realm="Bong Bot AIoT", charset="UTF-8"');
      throw new HttpError(401,'dashboard login required');
    }
    if (req.method !== 'GET') throw new HttpError(405,'method not allowed');
    if (pathname === '/api/v1/dashboard') {
      const stations = list();
      const map = interpolateMap(water, stations, {now,maxAgeMs,maxSkewMs,maxGapM});
      return reply(res,200,{stations,map,now,onlineMs,maxAgeMs,preview,live:!!live,mapsKey:preview ? '' : env.GOOGLE_MAPS_KEY || ''});
    }
    if (pathname === '/api/v1/history') {
      const id = searchParams.get('id');
      if (!devices.has(id)) throw new HttpError(404,'unknown device');
      const hours = Number(searchParams.get('hours') ?? '24');
      if (![1,6,24,72].includes(hours)) throw new HttpError(400,'hours must be 1, 6, 24 or 72');
      const rows = history.all(id,now-hours*60*minute,now+2*minute,10001);
      const truncated = rows.length > 10000;
      return reply(res,200,{readings:rows.slice(0,10000).reverse(),truncated});
    }
    const asset = pathname === '/' ? 'index.html' : /^\/assets\/[\w.-]+$/.test(pathname) ? pathname.slice(1) : null;
    if (!asset) throw new HttpError(404,'not found');
    if (!assets.has(asset)) {
      try { assets.set(asset, readFileSync(join(root,'dist',asset))); }
      catch (error) { if(error.code==='ENOENT') throw new HttpError(404,'asset not found. Run npm run build.'); throw error; }
    }
    res.writeHead(200,{'Content-Type':mime[asset.split('.').at(-1)] || 'application/octet-stream',
      'Cache-Control': asset === 'index.html' ? 'no-cache' : 'public,max-age=31536000,immutable'});
    res.end(assets.get(asset));
  } catch (error) {
    if (!error.status) console.error(error);
    if (error.status === 413) { res.setHeader('Connection','close'); req.resume(); }
    if (!res.writableEnded && !res.destroyed) reply(res,error.status || 500,{error:error.status ? error.message : 'server error'});
  }
});
server.maxConnections = 128;
server.listen(preview ? 0 : Number(env.PORT || 8080), preview ? '127.0.0.1' : env.HOST || '127.0.0.1');
if (!preview) server.on('listening', () => console.log('AIoT listening', server.address()));
export {server};
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => db.close()));
