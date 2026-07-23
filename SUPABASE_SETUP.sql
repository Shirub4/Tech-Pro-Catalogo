-- =========================================================
-- TECH PRO CATÁLOGO - BANCO, SEGURANÇA E ARMAZENAMENTO
-- Execute este arquivo inteiro no SQL Editor do Supabase.
-- =========================================================

create extension if not exists pgcrypto;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete restrict,
  name text not null,
  description text,
  details text,
  price numeric(12,2) check (price is null or price >= 0),
  size_gb numeric(12,2) check (size_gb is null or size_gb >= 0),
  image_path text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Compatibilidade ao executar este arquivo em um projeto já existente.
alter table public.items add column if not exists size_gb numeric(12,2);

create table if not exists public.settings (
  id integer primary key default 1 check (id = 1),
  brand_name text not null default 'Tech Pro',
  subtitle text not null default 'Escolha os itens e envie sua seleção',
  whatsapp_number text not null default '5522999167083',
  whatsapp_message text not null default 'Olá! Acabei de montar uma seleção pelo catálogo da Tech Pro.',
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_phone text,
  notes text,
  items jsonb not null default '[]'::jsonb,
  total numeric(12,2) not null default 0 check (total >= 0),
  total_gb numeric(14,2) not null default 0 check (total_gb >= 0),
  status text not null default 'new',
  created_at timestamptz not null default now()
);

-- Compatibilidade ao executar este arquivo em um projeto já existente.
alter table public.orders add column if not exists total_gb numeric(14,2) not null default 0;

insert into public.settings (id, brand_name, subtitle, whatsapp_number, whatsapp_message)
values (
  1,
  'Tech Pro',
  'Escolha os itens e envie sua seleção',
  '5522999167083',
  'Olá! Acabei de montar uma seleção pelo catálogo da Tech Pro.'
)
on conflict (id) do nothing;

-- Dados de exemplo. Você poderá apagar pelo painel depois.
insert into public.groups (name, sort_order, active)
select 'Videogames', 1, true
where not exists (select 1 from public.groups where name = 'Videogames');

insert into public.groups (name, sort_order, active)
select 'Acessórios', 2, true
where not exists (select 1 from public.groups where name = 'Acessórios');

insert into public.groups (name, sort_order, active)
select 'Serviços', 3, true
where not exists (select 1 from public.groups where name = 'Serviços');

-- Segurança por linha
alter table public.groups enable row level security;
alter table public.items enable row level security;
alter table public.settings enable row level security;
alter table public.orders enable row level security;

-- Remove políticas antigas com o mesmo nome, caso o script seja executado novamente.
drop policy if exists "Catalog public can read groups" on public.groups;
drop policy if exists "Admins manage groups" on public.groups;
drop policy if exists "Catalog public can read items" on public.items;
drop policy if exists "Admins manage items" on public.items;
drop policy if exists "Public can read settings" on public.settings;
drop policy if exists "Admins manage settings" on public.settings;
drop policy if exists "Public can create orders" on public.orders;
drop policy if exists "Admins read orders" on public.orders;
drop policy if exists "Admins update orders" on public.orders;
drop policy if exists "Admins delete orders" on public.orders;

create policy "Catalog public can read groups"
on public.groups for select
using (active = true or auth.role() = 'authenticated');

create policy "Admins manage groups"
on public.groups for all
to authenticated
using (true)
with check (true);

create policy "Catalog public can read items"
on public.items for select
using (active = true or auth.role() = 'authenticated');

create policy "Admins manage items"
on public.items for all
to authenticated
using (true)
with check (true);

create policy "Public can read settings"
on public.settings for select
using (true);

create policy "Admins manage settings"
on public.settings for all
to authenticated
using (true)
with check (true);

create policy "Public can create orders"
on public.orders for insert
to anon, authenticated
with check (
  char_length(customer_name) between 1 and 100
  and jsonb_array_length(items) between 1 and 100
);

create policy "Admins read orders"
on public.orders for select
to authenticated
using (true);

create policy "Admins update orders"
on public.orders for update
to authenticated
using (true)
with check (true);

create policy "Admins delete orders"
on public.orders for delete
to authenticated
using (true);

-- Bucket público somente para imagens dos itens.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-images',
  'item-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Políticas do armazenamento.
drop policy if exists "Public reads item images" on storage.objects;
drop policy if exists "Admins upload item images" on storage.objects;
drop policy if exists "Admins update item images" on storage.objects;
drop policy if exists "Admins delete item images" on storage.objects;

create policy "Public reads item images"
on storage.objects for select
using (bucket_id = 'item-images');

create policy "Admins upload item images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'item-images');

create policy "Admins update item images"
on storage.objects for update
to authenticated
using (bucket_id = 'item-images')
with check (bucket_id = 'item-images');

create policy "Admins delete item images"
on storage.objects for delete
to authenticated
using (bucket_id = 'item-images');
