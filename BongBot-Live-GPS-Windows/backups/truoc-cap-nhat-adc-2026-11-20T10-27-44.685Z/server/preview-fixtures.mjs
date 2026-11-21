const banks = [
  [35,214,294], [112,195,281], [200,158,245], [288,130,221],
  [385,145,230], [478,176,257], [572,185,265], [663,158,241],
  [748,114,212], [824,84,183], [884,83,175]
];

const point = (x,y) => [105.95+x/8000,10.08-y/8000];
const flow = 'preview-river';
const chainage = x => x*2;
export const previewStations = [1,4,9].map((bank,i) => {
  const [x,north,south] = banks[bank];
  const [lng,lat] = point(x,(north+south)/2);
  return {id:'DEMO-0'+(i+1), name:['Thượng lưu','Giữa tuyến','Hạ lưu'][i],
    lng,lat,flow_id:flow,chainage_m:chainage(x)};
});
export const previewWater = {type:'FeatureCollection',features:banks.slice(0,-1).map(([x1,n1,s1],i) => {
  const [x2,n2,s2] = banks[i+1];
  return {type:'Feature',properties:{reach_id:'demo-'+(i+1),flow_id:flow,from_m:chainage(x1),to_m:chainage(x2),name:'Đoạn minh họa '+(i+1)},
    geometry:{type:'Polygon',coordinates:[[point(x1,n1),point(x1,s1),point(x2,s2),point(x2,n2),point(x1,n1)]]}};
})};

const intervalMs = 120_000;
const q = n => Math.round(n*100)/100;
export function seedPreview(db, insert) {
  function record(measured) {
    const phase = measured/3_600_000;
    for (const [i,station] of previewStations.entries()) {
      const curve = Math.sin(phase*0.82 + i*0.67) + 0.24*Math.sin(phase*2.2+i);
      const salinity = q([0.62,4.8,11.8][i] + curve*[0.25,0.75,1.1][i]);
      const temperature = q(28.3+1.2*Math.sin(phase*0.46-i*0.3)+i*0.3);
      insert.run(station.id,'demo-'+measured,measured,measured,station.lat,station.lng,
        [0.8,1.1,0.9][i],10+i,Math.round(600+1550*salinity),temperature,salinity,
        q(4.01-i*0.11+0.04*Math.sin(phase*0.25)),0,'{}');
    }
  }
  const now = Date.now();
  db.exec('BEGIN');
  try {
    for (let offset=1800;offset>=0;offset-=1) record(now-offset*intervalMs);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const refresh = setInterval(() => record(Date.now()),intervalMs);
  refresh.unref();
}
