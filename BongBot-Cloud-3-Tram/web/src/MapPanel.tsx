import { useEffect, useRef, useState } from 'react';
import { PreviewMap } from './PreviewMap';
import { LiveMap } from './LiveMap';
import { color, number, online, time, type Dashboard, type Reach } from './model';

let googleLoad: Promise<void> | undefined;
type MapWindow = Window & { __startBongBotMap?: () => void; gm_authFailure?: () => void };
function loadMaps(key:string) {
  if (window.google?.maps?.Map) return Promise.resolve();
  if (googleLoad) return googleLoad;
  const win = window as MapWindow;
  googleLoad = new Promise<void>((resolve,reject) => {
    const script = document.createElement('script');
    const timer = window.setTimeout(() => fail(), 14000);
    function fail() {
      window.clearTimeout(timer);
      script.remove();
      googleLoad = undefined;
      reject(new Error('Không tải được Google Maps'));
    }
    win.__startBongBotMap = () => { window.clearTimeout(timer); resolve(); };
    script.src = 'https://maps.googleapis.com/maps/api/js?' + new URLSearchParams({
      key, v:'quarterly', language:'vi', region:'VN', loading:'async', callback:'__startBongBotMap'
    });
    script.async = true;
    script.onerror = fail;
    document.head.append(script);
  });
  return googleLoad;
}

const region = {lat:10.02,lng:106.02};
export function MapPanel({data, selected, onSelect}:{data:Dashboard|null;selected:string;onSelect:(id:string)=>void}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map|null>(null);
  const waters = useRef<google.maps.Data|null>(null);
  const points = useRef<google.maps.Data|null>(null);
  const popup = useRef<google.maps.InfoWindow|null>(null);
  const [state,setState] = useState<'loading'|'ready'|'error'>('loading');
  const [layer,setLayer] = useState(true);
  const [mode,setMode] = useState('terrain');
  const key = data?.mapsKey || '';
  const openMap = !!data?.live && !key;
  const onSelection = useRef(onSelect);
  const lastCentered = useRef('');
  onSelection.current = onSelect;

  useEffect(() => {
    if (!key) return;
    let active = true;
    const win = window as MapWindow;
    setState('loading');
    win.gm_authFailure = () => { if(active) setState('error'); };
    loadMaps(key).then(() => {
      if (!active || !element.current) return;
      const g = google.maps;
      map.current = new g.Map(element.current,{center:region,zoom:10,mapTypeId:'terrain',
        mapTypeControl:false, streetViewControl:false, fullscreenControl:true, gestureHandling:'cooperative'});
      waters.current = new g.Data({map:map.current});
      points.current = new g.Data({map:map.current});
      popup.current = new g.InfoWindow();
      waters.current.addListener('click',(e:google.maps.Data.MouseEvent) => {
        const p = e.feature.getProperty('reach') as Reach;
        const div = document.createElement('div');
        div.className = 'map-popup';
        const title = document.createElement('strong');
        title.textContent = p.name;
        const meta = document.createElement('p');
        meta.textContent = p.salinity_psu === null ? 'Thiếu số đo để nội suy' : `Ước tính ${number(p.salinity_psu)} PSU · ${p.sources.join(' / ')}`;
        const clock = document.createElement('p');
        if (p.oldest_measured_at !== null) clock.textContent = 'Mẫu cũ hơn: ' + time(p.oldest_measured_at);
        div.append(title,meta,clock);
        popup.current?.setContent(div);
        popup.current?.setPosition(e.latLng);
        popup.current?.open({map:map.current!});
      });
      points.current.addListener('click',(e:google.maps.Data.MouseEvent) => {
        const id = e.feature.getId();
        if (typeof id === 'string') onSelection.current(id);
      });
      setState(old => old === 'error' ? old : 'ready');
    }).catch(() => { if(active) setState('error'); });
    return () => {
      active = false;
      delete win.gm_authFailure;
      for (const target of [waters.current,points.current]) {
        if (target) { google.maps.event.clearInstanceListeners(target); target.setMap(null); }
      }
      popup.current?.close();
      waters.current = points.current = null;
      popup.current = null;
      map.current = null;
      lastCentered.current = '';
    };
  },[key]);

  useEffect(() => {
    const overlay = waters.current;
    if (!overlay || !data || state !== 'ready') return;
    popup.current?.close();
    overlay.forEach(f => overlay.remove(f));
    if (!layer) return;
    overlay.addGeoJson({...data.map,features:data.map.features.map(f => ({...f, properties:{reach:f.properties}}))});
    overlay.setStyle(f => {
      const psu = (f.getProperty('reach') as Reach).salinity_psu;
      return {strokeColor:color(psu),fillColor:color(psu),strokeWeight:1.4,fillOpacity:psu === null ? 0.16 : 0.58, zIndex:1};
    });
  },[data,layer,state]);

  useEffect(() => {
    const markerLayer = points.current;
    if (!markerLayer || !data || state !== 'ready') return;
    markerLayer.forEach(f => markerLayer.remove(f));
    for (const station of data.stations) {
      if (!station.fix) continue;
      const {lat,lng,measured_at} = station.fix;
      const row = station.latest;
      const psu = row && row.lat === lat && row.lng === lng && row.measured_at === measured_at &&
        measured_at !== null && measured_at <= data.now && data.now-measured_at <= data.maxAgeMs ? row.salinity_psu : null;
      const title = psu === null ? station.name : `${station.name} · đo ${number(psu)} PSU`;
      markerLayer.add({id:station.id,geometry:new google.maps.Data.Point({lat,lng}),
        properties:{title, psu, active:online(station,data)}});
    }
    markerLayer.setStyle(f => ({title:String(f.getProperty('title')), zIndex:10,
      icon:{path:google.maps.SymbolPath.CIRCLE,fillColor:layer ? color(f.getProperty('psu') as number|null) : f.getProperty('active') ? '#13b9b0' : '#7b8d9a',fillOpacity:1,
        strokeColor:'#ffffff',strokeWeight:f.getId()===selected ? 3 : 1.5,scale:f.getId()===selected ? 9 : 6}}));
    const station = data.stations.find(s => s.id === selected);
    if (station?.fix && lastCentered.current !== selected) {
      map.current?.setZoom(15);
      map.current?.panTo({lat:station.fix.lat,lng:station.fix.lng});
      lastCentered.current = selected;
    }
  },[data,layer,selected,state]);

  useEffect(() => { if (state === 'ready') map.current?.setMapTypeId(mode); },[mode,state]);
  const locate = () => {
    const fix = data?.stations.find(s=>s.id===selected)?.fix;
    if (fix) {map.current?.setZoom(16);map.current?.panTo({lat:fix.lat,lng:fix.lng});}
  };
  const valid = data?.map.features.filter(f=>f.properties.salinity_psu!==null).length ?? 0;
  return <section className="panel map-panel" aria-labelledby="map-title">
    <div className="panel-head"><div><h2 id="map-title">Bản đồ quan trắc</h2><p>Điểm đo GPS và lớp nội suy theo lòng sông</p></div>
      <div className="map-actions"><label className="switch"><input type="checkbox" checked={layer} onChange={e=>setLayer(e.target.checked)} /> Lớp độ mặn</label>
        {!data?.preview && !openMap && <select aria-label="Nền bản đồ" value={mode} onChange={e=>setMode(e.target.value)}><option value="terrain">Địa hình</option><option value="hybrid">Vệ tinh</option><option value="roadmap">Đường phố</option></select>}</div></div>
    <div className="map-frame">
      <div ref={element} className="map" aria-label="Google Maps vị trí trạm" />
      {data?.preview && <PreviewMap data={data} layer={layer} selected={selected} onSelect={onSelect}/>}
      {openMap && data && <LiveMap data={data} layer={layer} selected={selected} onSelect={onSelect}/>}
      {!data?.preview && !openMap && (!key || state !== 'ready') && <div className="map-empty"><span className="map-glyph" aria-hidden="true">⌖</span><strong>{!data ? 'Đang chờ dữ liệu máy chủ' : !key ? 'Chưa cấu hình Google Maps' : state==='error' ? 'Google Maps chưa khả dụng' : 'Đang tải Google Maps'}</strong>
        <small>{data && !key ? 'Thêm GOOGLE_MAPS_KEY vào cấu hình máy chủ.' : state==='error' ? 'Kiểm tra API key, billing và tên miền được phép.' : ' '}</small></div>}
      {state==='ready' && data?.stations.find(s=>s.id===selected)?.fix && <button className="locate" onClick={locate}>⌖ Về trạm</button>}
    </div>
    <div className="map-foot"><div className="legend" aria-label="Thang màu độ mặn"><span>PSU</span>{[[0,'< 1'],[1,'1 – < 4'],[4,'4 – < 10'],[10,'≥ 10'],[null,'Thiếu dữ liệu']].map(([v,label])=><span key={label}><i style={{background:color(v as number|null)}} />{label}</span>)}</div>
      <small>{!data?.map.features.length ? 'Chưa nạp ranh giới mặt nước' : `${valid}/${data.map.features.length} đoạn có ước tính`}</small></div>
  </section>;
}
