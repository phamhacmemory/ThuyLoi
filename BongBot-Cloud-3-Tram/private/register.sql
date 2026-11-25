begin;
do $bb$ begin
  if not exists (select 1 from auth.users where lower(email)=lower('phamhac.memory@gmail.com')) then
    raise exception 'Create the dashboard user in Supabase Auth first';
  end if;
end $bb$;
insert into public.bb_dashboard_users(user_id)
select id from auth.users where lower(email)=lower('phamhac.memory@gmail.com') on conflict do nothing;
insert into public.bb_devices(id,name,token_sha256) values
('BB-01','Trạm BB-01','403b18fb86a3ebf8f2055657842d50b78f9a729181a3e20c849a7971477ef4c1'),
('BB-02','Trạm BB-02','7209c0a9be2d32019be5dd649072513d6aba712bd2651212aa5af44f563c31c8'),
('BB-03','Trạm BB-03','4216d99ba888192547fd3e851621f53df0ca3fc322ae07d688801aa6d9ec5e1e')
on conflict(id) do nothing;
commit;
