import type {Station,Water} from './model';
export function validateMap(map:unknown):Water;
export function interpolateMap(map:Water,stations:Station[],options:{now:number;maxGapM:number;maxAgeMs:number;maxSkewMs:number}):Water;
