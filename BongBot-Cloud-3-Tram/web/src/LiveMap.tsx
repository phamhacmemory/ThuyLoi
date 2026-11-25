import {useEffect,useRef,useState} from 'react';
import {circleMarker,geoJSON,map as makeMap,layerGroup,tileLayer,type Map,type LayerGroup} from 'leaflet';
import type {GeoJsonObject} from 'geojson';
import {color,number,type Dashboard} from './model';
import 'leaflet/dist/leaflet.css';

export function LiveMap({data,selected,layer,onSelect}:{data:Dashboard;selected:string;layer:boolean;onSelect:(id:string)=>void}) {
  const box=useRef<HTMLDivElement>(null);
  const map=useRef<Map|null>(null);
  const markers=useRef<LayerGroup|null>(null);
  const water=useRef<LayerGroup|null>(null);
  const current=useRef('');
  const [tilesError,setTilesError]=useState(false);

  useEffect(()=>{
    if(!box.current) return;
    const instance=makeMap(box.current,{scrollWheelZoom:false}).setView([10.02,106.02],10);
    map.current=instance;
    tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).on('tileerror',()=>setTilesError(true)).on('tileload',()=>setTilesError(false)).addTo(instance);
    water.current=layerGroup().addTo(instance);
    markers.current=layerGroup().addTo(instance);
    const resize=new ResizeObserver(()=>instance.invalidateSize({pan:false}));
    resize.observe(box.current);
    return ()=>{resize.disconnect();instance.remove();map.current=null;markers.current=null;water.current=null;current.current='';};
  },[]);

  useEffect(()=>{
    if(!markers.current || !water.current || !map.current) return;
    markers.current.clearLayers();
    water.current.clearLayers();
    if (layer) geoJSON(data.map as GeoJsonObject,{
      style:f=>({color:color(f?.properties.salinity_psu??null),weight:1.25,fillOpacity:f?.properties.salinity_psu==null?0.13:0.55})
    }).addTo(water.current);
    for(const s of data.stations) {
      if(!s.fix) continue;
      const psu=s.latest?.salinity_psu??null;
      const fresh = s.latest?.lat===s.fix.lat && s.latest?.lng===s.fix.lng &&
        s.latest?.measured_at===s.fix.measured_at && s.fix.measured_at!==null &&
        data.now-s.fix.measured_at<=data.maxAgeMs && s.fix.measured_at<=data.now;
      const marker=circleMarker([s.fix.lat,s.fix.lng],{radius:s.id===selected?9:6,color:'#fff',weight:2,
        fillColor:layer?color(fresh?psu:null):'#13b9b0',fillOpacity:1});
      const label=document.createElement('span');
      label.textContent=s.name+(layer&&fresh&&psu!==null?` · ${number(psu)} PSU`:'');
      marker.bindTooltip(label);
      marker.on('click',()=>onSelect(s.id));
      markers.current.addLayer(marker);
      if(s.id===selected && current.current!==selected) {
        map.current.setView([s.fix.lat,s.fix.lng],16);
        current.current=selected;
      }
    }
  },[data,layer,selected,onSelect]);

  const fix=data.stations.find(s=>s.id===selected)?.fix;
  return <><div className="map live-base" ref={box} aria-label="Bản đồ OpenStreetMap vị trí trạm"/>
    {fix && <button className="locate live-locate" onClick={()=>map.current?.setView([fix.lat,fix.lng],16)}>⌖ Về trạm</button>}
    {!fix && <div className="live-map-hint">Chờ tọa độ GPS của trạm</div>}
    {tilesError && <div className="live-map-hint live-map-error" role="status">Chưa tải được nền bản đồ. Tọa độ vẫn có ở ô Chi tiết trạm.</div>}
  </>;
}
