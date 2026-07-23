-- =========================================================
-- TECH PRO CATÁLOGO — CORREÇÃO DO ENVIO PÚBLICO DE SELEÇÕES
-- Execute uma vez no SQL Editor do MESMO projeto Supabase.
-- Não libera a leitura pública dos pedidos.
-- =========================================================

alter table public.orders enable row level security;

grant insert on table public.orders to anon, authenticated;

drop policy if exists "Public can create orders" on public.orders;
drop policy if exists "Catalog public can create orders" on public.orders;

create policy "Public can create orders"
on public.orders
for insert
to anon, authenticated
with check (
  char_length(btrim(customer_name)) between 1 and 100
  and jsonb_typeof(items) = 'array'
  and jsonb_array_length(items) between 1 and 100
  and coalesce(total, 0) >= 0
);

-- A leitura continua restrita ao administrador autenticado.
drop policy if exists "Admins read orders" on public.orders;
create policy "Admins read orders"
on public.orders
for select
to authenticated
using (true);

-- Força o Data API/PostgREST a recarregar as políticas e o esquema.
notify pgrst, 'reload schema';

-- Verificação: deve listar Public can create orders e Admins read orders.
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'orders'
order by policyname;
