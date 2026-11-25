export type Fix = {lat:number; lng:number; hdop:number|null; satellites:number|null; measured_at:number|null; received_at:number};
export type Reading = {
  sample_id:string; salinity_adc_raw:number|null; measured_at:number|null; received_at:number; observed_at:number;
  lat:number|null; lng:number|null; hdop:number|null; satellites:number|null;
  ec_us_cm:number|null; temp_c:number|null; salinity_psu:number|null; battery_v:number|null; dropped:number|null;
};
export type Station = {id:string; name:string; flow_id?:string; chainage_m?:number; latest:Reading|null; fix:Fix|null; last_seen:number|null};
export type Reach = {salinity_psu:number|null; name:string; sources:string[]; oldest_measured_at:number|null};
export type Water = {type:'FeatureCollection'; features:Array<{type:'Feature'; properties:Reach; geometry:object}>};
export type Dashboard = {preview?:boolean;live?:boolean;stations:Station[]; map:Water; now:number; onlineMs:number; maxAgeMs:number; mapsKey:string};
export const number = (n:number|null|undefined, digits=2) => n == null ? '—' : n.toLocaleString('vi-VN',{maximumFractionDigits:digits});
export const time = (n:number|null|undefined) => n == null ? '—' : new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'medium',timeZone:'Asia/Ho_Chi_Minh'}).format(n);
export const color = (psu:number|null) => psu === null ? '#8796a9' : psu < 1 ? '#55d7bd' : psu < 4 ? '#5fb5ef' : psu < 10 ? '#f8bd63' : '#f47f70';
export const online = (s:Station, d:Dashboard) => s.last_seen !== null && d.now-s.last_seen <= d.onlineMs;
