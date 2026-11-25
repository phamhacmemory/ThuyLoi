const url = Deno.env.get("SUPABASE_URL");
function serverKey() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if(keys) {
    const values = JSON.parse(keys) as Record<string,unknown>;
    const current = [values.default,...Object.values(values)].find(value =>
      typeof value==="string" && value.startsWith("sb_secret_"));
    if(typeof current==="string") return current;
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}
const key=serverKey();
const limits = {
  lat: [-90,90], lng: [-180,180], hdop: [0,99.99], satellites: [0,100],
  ec_us_cm: [0,300000], temp_c: [-55,125], salinity_psu: [0,80],
  battery_v: [0,100], dropped: [0,4294967295], salinity_adc_raw: [0,4095],
};
const integers = new Set(["satellites","dropped","salinity_adc_raw"]);
const maxBytes = 16_384;
const json = (value:unknown,status=200) => Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
type Sample = Record<string, number | string | null>;
function normalize(value:unknown, now:number):Sample {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw Error("invalid sample");
  const row = value as Record<string,unknown>;
  const id = row.sample_id;
  if (typeof id!=="string" || !/^[A-Za-z0-9_-]{12,80}$/.test(id)) throw Error("invalid sample_id");
  const time = row.measured_at ?? null;
  if (time!==null && (typeof time!=="number" || !Number.isSafeInteger(time) ||
    time<Date.UTC(2024,0,1) || time>now+120000)) throw Error("invalid measured_at");
  const normalized:Sample = {sample_id:id, measured_at:time as number|null};
  for (const [field,[min,max]] of Object.entries(limits)) {
    const n = row[field] ?? null;
    if (n!==null && (typeof n!=="number" || !Number.isFinite(n) || n<min || n>max ||
      (integers.has(field) && !Number.isInteger(n)))) throw Error("invalid "+field);
    normalized[field]=n;
  }
  if ((normalized.lat===null)!==(normalized.lng===null) ||
    (normalized.lat===null && (normalized.hdop!==null || normalized.satellites!==null))) throw Error("invalid GPS fields");
  return normalized;
}

class BodyTooLarge extends Error {}
async function readBody(request:Request) {
  if (Number(request.headers.get("Content-Length"))>maxBytes) throw new BodyTooLarge();
  const reader=request.body?.getReader();
  if (!reader) throw Error("empty body");
  const bytes=new Uint8Array(maxBytes);
  let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if (done) break;
      if(size+value.length>maxBytes) {
        await reader.cancel();
        throw new BodyTooLarge();
      }
      bytes.set(value,size);
      size+=value.length;
    }
  } finally {reader.releaseLock();}
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,size)));
}

Deno.serve(async (request) => {
  if(request.method==="GET") return json({ok:true,service:"bongbot-cloud"});
  if(request.method!=="POST") return json({error:"method not allowed"},405);
  const device=request.headers.get("X-Device-Id");
  const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("Authorization")??"")?.[1];
  if (!device || !/^[A-Z0-9_-]{1,48}$/.test(device) || !token) return json({error:"invalid device credentials"},401);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type")??"")) return json({error:"application/json required"},415);
  let body;
  try {body=await readBody(request);}
  catch(error) {return error instanceof BodyTooLarge ? json({error:"body too large"},413) : json({error:"invalid JSON"},400);}
  const batch=body && typeof body==="object" && Object.hasOwn(body,"samples");
  const values=batch ? body.samples : [body];
  if (!Array.isArray(values) || values.length<1 || values.length>24) return json({error:"invalid sample count"},422);
  let items:Sample[];
  try {
    const now=Date.now();
    items=values.map(value=>normalize(value,now));
    if(new Set(items.map(item=>item.sample_id)).size!==items.length) throw Error("duplicate id within batch");
  } catch(error){return json({error:String((error as Error).message)},422);}
  if (!url || !key) return json({error:"database configuration unavailable"},503);
  try {
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
    const token_digest=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
    const response=await fetch(url+"/rest/v1/rpc/bb_ingest",{
      method:"POST",signal:AbortSignal.timeout(10000),
      headers:{apikey:key,"Content-Type":"application/json",
        ...(key.startsWith("sb_secret_") ? {} : {Authorization:"Bearer "+key})},
      body:JSON.stringify({device,token_digest,items}),
    });
    const data=await response.json();
    if (!response.ok) {
      if (data.code==="BB409") return json({error:"sample_id payload conflict"},409);
      console.error("bb_ingest",response.status,data.code);
      return json({error:"database unavailable"},503);
    }
    if(data.status!==200) return json({error:data.status===401?"invalid device credentials":"invalid batch"},data.status);
    if (batch) return json({ok:true,accepted:items.map(item=>item.sample_id)});
    const ack=data.samples[0];
    return json({ok:true,duplicate:ack.duplicate,sample_id:ack.sample_id},ack.duplicate?200:201);
  } catch(error){console.error("ingest RPC",String(error));return json({error:"database unavailable"},503);}
});
