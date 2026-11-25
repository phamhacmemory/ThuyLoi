import { color, number, type Dashboard } from './model';

const x = (lon:number) => (lon-105.95)*8000;
const y = (lat:number) => (10.08-lat)*8000;

export function PreviewMap({data,layer,selected,onSelect}:{data:Dashboard;layer:boolean;selected:string;onSelect:(id:string)=>void}) {
  return <div className="preview-map">
    <svg viewBox="0 0 920 390" aria-label="Sơ đồ minh họa lớp độ mặn">
      <defs>
        <pattern id="preview-grid" width="36" height="36" patternUnits="userSpaceOnUse">
          <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#375347" strokeOpacity=".38"/>
        </pattern>
        <linearGradient id="preview-land" x2="1" y2="1">
          <stop stopColor="#1b342e"/><stop offset="1" stopColor="#132923"/>
        </linearGradient>
      </defs>
      <rect width="920" height="390" fill="url(#preview-land)"/>
      <rect width="920" height="390" fill="url(#preview-grid)"/>
      <g fill="none" stroke="#55715b" strokeWidth="1.5" strokeOpacity=".65">
        <path d="M0 110C140 144 207 63 313 88S511 154 593 111 724 35 925 38"/>
        <path d="M-4 85C135 126 200 40 310 67S495 129 581 95 725 17 926 15"/>
        <path d="M5 45C130 85 212 8 313 32S477 109 575 80"/>
        <path d="M-7 338C150 345 257 264 376 282S559 351 705 295 838 234 928 239"/>
        <path d="M-8 373C151 386 264 289 392 317S557 381 710 321 835 272 929 255"/>
        <path d="M143 396C259 350 327 322 426 357S589 410 742 347 837 295 929 282"/>
      </g>
      <g fill="none" stroke="#75978b" strokeWidth="1" strokeDasharray="5 6" opacity=".6">
        <path d="M0 181C164 168 246 99 344 104S526 169 627 121 758 66 919 60"/>
        <path d="M0 321C169 312 201 245 320 260S500 309 592 298 798 213 920 211"/>
      </g>
      {data.map.features.map((f,i)=>{
        const shape = f.geometry as {type:string;coordinates:[number,number][][]};
        if (shape.type!=='Polygon') return null;
        const salinity = f.properties.salinity_psu;
        const base = shape.coordinates[0].map(([lon,lat])=>`${x(lon)},${y(lat)}`).join(' ');
        return <polygon key={i} points={base} fill={layer && salinity!==null ? color(salinity) : '#285b6d'}
          fillOpacity={layer && salinity!==null ? .83 : .92} stroke="#bddce6" strokeOpacity=".34">
          <title>{f.properties.name} · {salinity===null ? 'Thiếu dữ liệu' : `${number(salinity)} PSU · nội suy`}</title>
        </polygon>;
      })}
      {data.stations.map(s=>{
        if (!s.fix) return null;
        const px=x(s.fix.lng), py=y(s.fix.lat);
        const active=s.id===selected;
        return <g role="button" tabIndex={0} key={s.id} className="preview-point"
          aria-label={`Chọn trạm ${s.name}`} aria-pressed={active}
          onClick={()=>onSelect(s.id)}
          onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(s.id);}}}>
          <circle cx={px} cy={py} r={22} fill="transparent"/>
          <circle cx={px} cy={py} r={active ? 13 : 10} fill="#0c2732" stroke={active ? '#fff' : '#d3ebf4'} strokeWidth={active ? 3 : 1.5}/>
          <circle cx={px} cy={py} r={5} fill={layer ? color(s.latest?.salinity_psu??null) : '#55d7bd'}/>
          <text x={px} y={py+35} className="preview-station-label" textAnchor="middle">{s.name}</text>
        </g>;
      })}
    </svg>
    <div className="preview-map-label">Sơ đồ minh họa · Không dùng định vị</div>
  </div>;
}
