begin;

create table if not exists public.bb_dashboard_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.bb_devices (
  id text primary key check (id ~ '^[A-Z0-9_-]{1,48}$'),
  name text not null,
  token_sha256 text not null unique check (token_sha256 ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default true,
  flow_id text,
  chainage_m double precision check (chainage_m >= 0)
);
create table if not exists public.bb_readings (
  device_id text not null references public.bb_devices(id),
  sample_id text not null check (sample_id ~ '^[A-Za-z0-9_-]{12,80}$'),
  measured_at bigint,
  received_at bigint not null,
  observed_at bigint generated always as (coalesce(measured_at,received_at)) stored,
  lat double precision, lng double precision, hdop double precision, satellites integer,
  ec_us_cm double precision, temp_c double precision, salinity_psu double precision,
  battery_v double precision, dropped bigint, salinity_adc_raw integer,
  primary key (device_id, sample_id)
);
create index if not exists bb_observed_idx on public.bb_readings(device_id,observed_at desc,received_at desc,sample_id);
create index if not exists bb_received_idx on public.bb_readings(device_id,received_at desc);
create index if not exists bb_fix_idx on public.bb_readings(device_id,measured_at desc nulls last,received_at desc) where lat is not null;

alter table public.bb_dashboard_users enable row level security;
alter table public.bb_devices enable row level security;
alter table public.bb_readings enable row level security;
revoke all on public.bb_dashboard_users,public.bb_devices,public.bb_readings from public,anon,authenticated;

create or replace function public.bb_ingest(device text, token_digest text, items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  item jsonb;
  inserted int;
  result jsonb := '[]'::jsonb;
  old public.bb_readings;
  candidate public.bb_readings;
  received bigint := floor(extract(epoch from clock_timestamp())*1000);
begin
  perform 1 from public.bb_devices d where d.id=device and d.enabled and d.token_sha256=token_digest for share;
  if not found then return jsonb_build_object('status',401); end if;
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 24 then
    return jsonb_build_object('status',422);
  end if;
  -- Stable lock order if the same samples are retried in overlapping batches.
  for item in select value from jsonb_array_elements(items) order by value->>'sample_id'
  loop
    candidate := jsonb_populate_record(null::public.bb_readings,item);
    insert into public.bb_readings
      (device_id,sample_id,measured_at,received_at,lat,lng,hdop,satellites,ec_us_cm,temp_c,salinity_psu,battery_v,dropped,salinity_adc_raw)
    values (device,candidate.sample_id,candidate.measured_at,received,candidate.lat,candidate.lng,candidate.hdop,
      candidate.satellites,candidate.ec_us_cm,candidate.temp_c,candidate.salinity_psu,candidate.battery_v,candidate.dropped,candidate.salinity_adc_raw)
    on conflict (device_id,sample_id) do nothing;
    get diagnostics inserted = row_count;
    if inserted=0 then
      select * into strict old from public.bb_readings t where t.device_id=device and t.sample_id=candidate.sample_id;
      if (to_jsonb(old) - array['device_id','received_at','observed_at']) is distinct from
         (to_jsonb(candidate) - array['device_id','received_at','observed_at']) then
        raise exception using errcode='BB409', message='sample_id payload conflict';
      end if;
    end if;
    result := result || jsonb_build_array(jsonb_build_object('sample_id',candidate.sample_id,'duplicate',inserted=0));
  end loop;
  return jsonb_build_object('status',200,'samples',result);
end;
$$;
revoke execute on function public.bb_ingest(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bb_ingest(text,text,jsonb) to service_role;

create or replace function public.bb_dashboard()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.bb_dashboard_users where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Dashboard access denied';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'name',d.name,'flow_id',d.flow_id,'chainage_m',d.chainage_m,
    'latest',to_jsonb(l)-'device_id','fix',to_jsonb(g),'last_seen',c.received_at
  ) order by d.id),'[]'::jsonb) into result
  from public.bb_devices d
  left join lateral (select * from public.bb_readings t where t.device_id=d.id order by t.observed_at desc,t.received_at desc,t.sample_id limit 1) l on true
  left join lateral (select lat,lng,hdop,satellites,measured_at,received_at from public.bb_readings t
    where t.device_id=d.id and t.lat is not null order by t.measured_at desc nulls last,t.received_at desc limit 1) g on true
  left join lateral (select received_at from public.bb_readings t where t.device_id=d.id order by t.received_at desc limit 1) c on true
  where d.enabled;
  return jsonb_build_object('stations',result,'now',floor(extract(epoch from now())*1000),'onlineMs',180000,'maxAgeMs',900000,'live',true,'mapsKey','');
end;
$$;
revoke execute on function public.bb_dashboard() from public,anon;
grant execute on function public.bb_dashboard() to authenticated;

create or replace function public.bb_history(station text, hours integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.bb_dashboard_users where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Dashboard access denied';
  end if;
  if hours is null or hours not in (1,6,24,72) then raise exception 'Invalid time range'; end if;
  with rows as (
    select t.* from public.bb_readings t where t.device_id=station
      and t.observed_at >= floor(extract(epoch from now())*1000)-hours*3600000::bigint
    order by t.observed_at desc,t.received_at desc,t.sample_id limit 10001
  ), newest as (
    select * from rows order by observed_at desc,received_at desc,sample_id limit 10000
  )
  select jsonb_build_object('readings',coalesce(jsonb_agg(to_jsonb(n)-'device_id'
    order by n.observed_at,n.received_at,n.sample_id),'[]'::jsonb),'truncated',(select count(*)>10000 from rows))
    into result from newest n;
  return result;
end;
$$;
revoke execute on function public.bb_history(text,integer) from public,anon;
grant execute on function public.bb_history(text,integer) to authenticated;
commit;
