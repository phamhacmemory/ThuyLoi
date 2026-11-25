import {createHash,randomBytes} from 'node:crypto';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {verifiedRoot} from './endpoint-tls.mjs';

const endpoint='https://rjvcrcskqslirypvzljf.supabase.co/functions/v1/ingest';
const folder=resolve(import.meta.dirname,'..');
const privateDir=join(folder,'private');
const sqlLiteral=value=>"'"+value.replaceAll("'","''")+"'";
const ids=['BB-01','BB-02','BB-03'];
const prompt=createInterface({input:process.stdin,output:process.stdout});
try {
  const email=(await prompt.question('Email tai khoan xem dashboard (da tao trong Supabase Auth): ')).trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Email khong hop le');
  const pem=await verifiedRoot(endpoint);
  console.log('HTTPS verified.');
  mkdirSync(privateDir,{recursive:true,mode:0o700});
  const keyPath=join(privateDir,'stations.json');
  try {
    writeFileSync(keyPath,JSON.stringify(Object.fromEntries(ids.map(id=>[id,randomBytes(32).toString('hex')])),null,2)+'\n',{flag:'wx',mode:0o600});
  } catch(error) {if(error.code!=='EEXIST') throw error;}
  const keys=JSON.parse(readFileSync(keyPath,'utf8'));
  const registrations=ids.map(id=>{
    if(!/^[a-f0-9]{64}$/.test(keys[id]??'')) throw Error('Invalid stored token for '+id);
    return '('+[id,'Trạm '+id,createHash('sha256').update(keys[id]).digest('hex')].map(sqlLiteral).join(',')+')';
  });
  const header=join(folder,'firmware','Station','bong_bot_local_config.h');
  let source;
  try {source=readFileSync(header,'utf8');}
  catch(error){if(error.code!=='ENOENT')throw error;source=readFileSync(join(folder,'firmware','Station','settings.example.h'),'utf8');}
  const certificatePattern=/\bROOT_CA\s*=\s*R"PEM\([\s\S]*?\)PEM"/;
  if(!certificatePattern.test(source)) throw Error('ROOT_CA setting missing');
  source=source.replace(certificatePattern,()=>`ROOT_CA = R"PEM(\n${pem.trim()}\n)PEM"`);
  if(!source.includes(endpoint)) throw Error('Check INGEST_URL in firmware configuration');
  writeFileSync(header,source);
  writeFileSync(join(privateDir,'register.sql'),`begin;
do $bb$ begin
  if not exists (select 1 from auth.users where lower(email)=lower(${sqlLiteral(email)})) then
    raise exception 'Create the dashboard user in Supabase Auth first';
  end if;
end $bb$;
insert into public.bb_dashboard_users(user_id)
select id from auth.users where lower(email)=lower(${sqlLiteral(email)}) on conflict do nothing;
insert into public.bb_devices(id,name,token_sha256) values
${registrations.join(',\n')}
on conflict(id) do nothing;
commit;
`,{mode:0o600});
  writeFileSync(join(privateDir,'serial.txt'),ids.map(id=>
    id+'\nSET '+id+' '+keys[id]+' <RX> <TX> <BAUD> <APN>\n'
  ).join('\n'),{mode:0o600});
  console.log('Da tao private/register.sql, private/serial.txt va cau hinh CA cho firmware.');
} catch(error){console.error('Loi: '+error.message);process.exitCode=1;}
finally {prompt.close();}
