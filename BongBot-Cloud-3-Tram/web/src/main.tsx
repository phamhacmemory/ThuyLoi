import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MapPanel} from './MapPanel';
import {readCloud as get, supabase} from './cloud';
import type {Session} from '@supabase/supabase-js';
import {number,online,time,type Dashboard,type Reading,type Station} from './model';
import './styles.css';

const metrics = [
  {id:'salinity_psu', label:'Độ mặn', unit:'PSU',color:'#58dfc7'},
  {id:'ec_us_cm',label:'Độ dẫn điện',unit:'µS/cm',color:'#67baf3'},
  {id:'temp_c',label:'Nhiệt độ nước',unit:'°C',color:'#f8bf73'},
  {id:'salinity_adc_raw',label:'Tín hiệu GPIO4',unit:'ADC',color:'#67d8cc'},
  {id:'battery_v',label:'Điện áp pin',unit:'V',color:'#a89af5'}
] as const;
type Metric = typeof metrics[number];
function Trend({rows, metric, now, hours}:{rows:Reading[];metric:Metric;now:number;hours:number}) {
  const start = now-hours*3600000;
  const valid = rows.filter(r=>r[metric.id]!==null && r.observed_at>=start && r.observed_at<=now);
  if (!valid.length) return <div className="chart-empty">Chưa có mẫu {metric.label.toLowerCase()} trong khoảng này.</div>;
  const timestampLabel = new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Ho_Chi_Minh'});
  const values = valid.map(r=>r[metric.id]!);
  const low = Math.min(...values), high = Math.max(...values), pad = (high-low)*0.08 || Math.max(0.1,Math.abs(high)*0.04);
  const min = metric.id === 'temp_c' ? low-pad : Math.max(0,low-pad), max = high+pad;
  const x = (when:number) => 68+698*(when-start)/(now-start);
  const y = (value:number) => 145-130*(value-min)/(max-min);
  const paths:string[][] = [];
  let previous:Reading|undefined;
  for (const row of valid) {
    if (!previous || row.observed_at-previous.observed_at>180000 || (row.measured_at===null)!==(previous.measured_at===null)) paths.push([]);
    paths.at(-1)!.push(`${x(row.observed_at)},${y(row[metric.id]!)}`);
    previous=row;
  }
  return <svg className="chart" viewBox="0 0 780 174" role="img" aria-label={`Lịch sử ${metric.label}, ${valid.length} mẫu, ${metric.unit}`}>
    {[0,.25,.5,.75,1].map(p=>{const v=min+(max-min)*p;return <g key={p}><line x1={68} x2={766} y1={y(v)} y2={y(v)}/><text x={62} y={y(v)+4} textAnchor="end">{number(v,2)}</text></g>})}
    {[0,.25,.5,.75,1].map(p=><text key={p} x={x(start+(now-start)*p)} y={167} textAnchor={p===0?'start':p===1?'end':'middle'}>{timestampLabel.format(start+(now-start)*p)}</text>)}
    {paths.map((points,i)=>points.length===1 ? <circle key={i} cx={points[0].split(',')[0]} cy={points[0].split(',')[1]} r={3} fill={metric.color}/> : <polyline key={i} points={points.join(' ')} fill="none" stroke={metric.color} strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>)}
  </svg>;
}
function StationDetail({s,d}:{s:Station|undefined;d:Dashboard|null}) {
  const latest=s?.latest, fix=s?.fix;
  const isOld = d && fix && (fix.measured_at===null || d.now-fix.measured_at>d.maxAgeMs);
  return <section className="panel details"><div className="panel-head"><div><h2>{s?.name ?? 'Chi tiết trạm'}</h2><p>{s?.id ?? 'Chưa có trạm'}</p></div>
    {s && d && <span className={'status '+(online(s,d)?'up':'')}>{online(s,d)?'Trực tuyến':s.last_seen?'Mất kết nối':'Chờ dữ liệu'}</span>}</div>
    <dl><div><dt>Lần nhận dữ liệu cuối</dt><dd>{time(s?.last_seen)}</dd></div><div><dt>Thời điểm đo</dt><dd>{time(latest?.measured_at)}</dd></div>
      <div><dt>Tọa độ GPS gần nhất</dt><dd>{d?.preview ? 'Vị trí mô phỏng' : fix ? `${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}` : '—'}</dd></div>
      <div><dt>Thời điểm tọa độ</dt><dd>{time(fix?.measured_at)}{isOld && <span className="warn"> · GPS chưa cập nhật</span>}</dd></div>
      <div><dt>HDOP / vệ tinh</dt><dd>{number(fix?.hdop)} / {number(fix?.satellites,0)}</dd></div>
      <div><dt>Mẫu không lưu được (từ lúc bật)</dt><dd>{number(latest?.dropped,0)}</dd></div></dl>
    {fix && !d?.preview && <a className="text-link" href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(`${fix.lat},${fix.lng}`)} target="_blank" rel="noreferrer">Mở tọa độ trong Google Maps ↗</a>}
  </section>;
}
function App({email}:{email:string}) {
  const [data,setData]=useState<Dashboard|null>(null);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState('');
  const [hours,setHours]=useState(1);
  const [metric,setMetric]=useState<Metric>(metrics[0]);
  const [history,setHistory]=useState<{id:string;hours:number;readings:Reading[];truncated:boolean}|null>(null);
  const [historyError,setHistoryError]=useState('');
  useEffect(()=>{
    const ctl = new AbortController();
    let next=0;
    async function poll() {
      try {
        const d = await get<Dashboard>('/api/v1/dashboard',AbortSignal.any([ctl.signal,AbortSignal.timeout(8000)]));
        if(ctl.signal.aborted)return;
        setData(d);setError('');
        setSelected(id=>d.stations.some(s=>s.id===id)?id:d.stations[0]?.id||'');
      } catch (error) {
        if(!ctl.signal.aborted)setError((error as {code?:string})?.code==='42501'
          ? 'Tài khoản chưa được cấp quyền xem dashboard.' : 'Không kết nối được máy chủ. Dữ liệu hiển thị có thể đã cũ.');
      }
      if(!ctl.signal.aborted)next=window.setTimeout(poll,15000);
    }
    void poll();
    return ()=>{ctl.abort();window.clearTimeout(next);};
  },[]);
  const selectedStation = data?.stations.find(s=>s.id===selected);
  const historyTick=hours===1 ? Math.floor((data?.now??0)/60000) : 0;
  const [historyRefresh,setHistoryRefresh]=useState(0);
  useEffect(()=>{
    if(!selected)return;
    const controller=new AbortController();
    setHistoryError('');
    get<{readings:Reading[];truncated:boolean}>(`/api/v1/history?id=${encodeURIComponent(selected)}&hours=${hours}`,AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]))
      .then(result=>{if(!controller.signal.aborted)setHistory({...result,id:selected,hours});})
      .catch(()=>{if(!controller.signal.aborted)setHistoryError('Không tải được lịch sử đo.');});
    return ()=>controller.abort();
  },[selected,hours,historyTick,historyRefresh]);
  const currentHistory = history?.id===selected&&history.hours===hours ? history : null;
  const up=data?.stations.filter(s=>online(s,data)).length ?? 0;
  const gpsSamples=data?.live ? (currentHistory?.readings??[]).filter(row=>row.lat!==null&&row.lng!==null).slice(-10).reverse() : [];
  return <>
    <header className="top"><div className="top-inner"><div className="brand"><span className="brand-mark" aria-hidden="true">≈</span><div><h1>Quan trắc Bông Bót</h1><span>Hệ thống thủy lợi Nam Măng Thít</span></div></div>
      <span className={'server-state '+(error?'bad':'')}><i/>{error?'Mất kết nối máy chủ':data?'Máy chủ trực tuyến':'Đang kết nối'}</span></div></header>
    <main>
      <div className="cloud-account"><span>{email}</span><button onClick={()=>void supabase.auth.signOut({scope:'local'})}>Đăng xuất</button></div>
      {data?.live && <div className="preview-banner"><strong>Dữ liệu thực</strong><span>ESP32-S3 · Supabase</span></div>}
      {data?.preview && <div className="preview-banner"><strong>Bản xem trước</strong><span>Dữ liệu minh họa · Đang chạy trên máy này</span></div>}
      {error && <div className="notice" role="alert">{error}</div>}
      <section className="toolbar"><div><h2>{data?.preview ? 'Dashboard quan trắc' : 'Giám sát hiện trường'}</h2><p>{up}/{data?.stations.length??0} trạm trực tuyến · Giờ Việt Nam</p></div>
        <label>Trạm quan trắc<select value={selected} onChange={e=>setSelected(e.target.value)} disabled={!data?.stations.length}>
          {!data?.stations.length && <option value="">Chưa cấu hình trạm</option>}{data?.stations.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}
        </select></label></section>
      <div className="metrics">{metrics.map(m=><div className="panel metric" key={m.id} style={{'--metric':m.color} as React.CSSProperties}>
        <span>{m.label}</span><div><strong>{number(selectedStation?.latest?.[m.id])}</strong><small>{m.unit}</small></div>
      </div>)}</div>
      <div className="content"><MapPanel data={data} selected={selected} onSelect={setSelected}/><StationDetail s={selectedStation} d={data}/></div>
      {data?.live && <section className="panel gps-history"><div className="panel-head"><div><h2>Mẫu tọa độ đã lưu</h2><p>{selectedStation?.name??'Chưa chọn trạm'}</p></div></div>
        {gpsSamples.length ? <div className="gps-scroll"><table><thead><tr><th scope="col">Thời điểm đo</th><th scope="col">Vĩ độ</th><th scope="col">Kinh độ</th><th scope="col">Vệ tinh</th><th scope="col">HDOP</th></tr></thead>
          <tbody>{gpsSamples.map(row=><tr key={row.sample_id}><td>{time(row.measured_at??row.received_at)}{row.measured_at===null?' (giờ nhận)':''}</td>
            <td>{row.lat!.toFixed(6)}</td><td>{row.lng!.toFixed(6)}</td><td>{number(row.satellites,0)}</td><td>{number(row.hdop)}</td></tr>)}</tbody></table></div> :
          <div className="chart-empty">{historyError || 'Chưa có mẫu GPS hợp lệ trong khoảng đã chọn.'}</div>}
      </section>}
      <section className="panel history"><div className="panel-head"><div><h2>Lịch sử quan trắc</h2><p>{selectedStation?.name??'Chưa chọn trạm'} · {metric.unit}</p></div>
        <div className="map-actions"><select aria-label="Chỉ số lịch sử" value={metric.id} onChange={e=>setMetric(metrics.find(m=>m.id===e.target.value)??metrics[0])}>{metrics.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select>
        <button onClick={()=>setHistoryRefresh(n=>n+1)}>Làm mới lịch sử</button><select aria-label="Khoảng thời gian" value={hours} onChange={e=>setHours(Number(e.target.value))}>{[1,6,24,72].map(h=><option key={h} value={h}>{h} giờ</option>)}</select></div></div>
        {historyError ? <div className="notice">{historyError}</div> : <Trend rows={currentHistory?.readings??[]} metric={metric} hours={hours} now={data?.now??Date.now()}/>}
        {currentHistory?.truncated && <p className="chart-note">Hiển thị 10.000 mẫu gần nhất trong khoảng đã chọn.</p>}
        {currentHistory?.readings.some(r=>r.measured_at===null) && <p className="chart-note">Mẫu thiếu giờ đo được đặt theo giờ máy chủ nhận.</p>}
      </section>
      <footer><span>Cống Bông Bót · Vĩnh Long</span><span>Cập nhật {time(data?.now)}</span></footer>
    </main>
  </>;
}
function CloudApp() {
  const [session,setSession]=useState<Session|null|undefined>();
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,current)=>setSession(current));
    return ()=>subscription.unsubscribe();
  },[]);
  if(session) return <App key={session.user.id} email={session.user.email??''}/>;
  return <main className="cloud-login">
    <section className="panel"><h1>Quan trắc Bông Bót</h1>
    <form onSubmit={async event=>{
      event.preventDefault();setBusy(true);setError('');
      try {
        const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
        if(error) setError('Đăng nhập thất bại. Kiểm tra email và mật khẩu.');
        else setPassword('');
      } catch {setError('Không kết nối được Supabase.');}
      finally {setBusy(false);}
    }}>
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label>Mật khẩu<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <button disabled={busy||session===undefined}>{busy?'Đang đăng nhập…':'Đăng nhập'}</button>
      {error&&<p role="alert">{error}</p>}
    </form></section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<CloudApp/>);
