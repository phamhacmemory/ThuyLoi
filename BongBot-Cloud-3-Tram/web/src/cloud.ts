import {createClient} from '@supabase/supabase-js';
import {interpolateMap,validateMap} from './water.mjs';
import type {Dashboard, Reading, Water} from './model';

export const supabase=createClient(
  'https://rjvcrcskqslirypvzljf.supabase.co',
  'sb_publishable_y1q0u_2P7wdkGnwTPu8xgQ_mGuel7mH',
);
const empty:Water={type:'FeatureCollection',features:[]};
let waterPromise:Promise<Water>|undefined;
function getWater() {
  return waterPromise ??= fetch('/water.geojson',{signal:AbortSignal.timeout(7000)}).then(async r=>{
    if(r.status===404) return empty;
    if(!r.ok) throw Error('Map HTTP '+r.status);
    return validateMap(await r.json());
  }).catch(error=>{console.warn('Water layer unavailable',error);return empty;});
}

export async function readCloud<T>(path:string,signal:AbortSignal):Promise<T> {
  const request=new URL(path,location.origin);
  if(request.pathname==='/api/v1/dashboard') {
    const [{data,error},water]=await Promise.all([
      supabase.rpc('bb_dashboard').abortSignal(signal),getWater(),
    ]);
    if(error) throw error;
    const d=data as Omit<Dashboard,'map'>;
    return {...d,map:interpolateMap(water,d.stations,{now:d.now,maxGapM:2000,maxAgeMs:900000,maxSkewMs:300000})} as T;
  }
  if(request.pathname!=='/api/v1/history') throw Error('Unknown query');
  const {data,error}=await supabase.rpc('bb_history',{
    station:request.searchParams.get('id'),hours:Number(request.searchParams.get('hours')),
  }).abortSignal(signal);
  if(error) throw error;
  return data as {readings:Reading[],truncated:boolean} as T;
}
