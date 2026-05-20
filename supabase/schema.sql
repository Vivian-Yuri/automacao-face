-- Execute no SQL Editor do projeto Supabase (Automação Face).
-- Tabela compartilhada entre todas as instâncias do app (Render, proxies, local).

create table if not exists public.meta_saved_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ad_account', 'page', 'pixel')),
  external_id text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, external_id)
);

create index if not exists meta_saved_items_kind_idx
  on public.meta_saved_items (kind);

create index if not exists meta_saved_items_name_idx
  on public.meta_saved_items (name);

-- O servidor usa SUPABASE_SERVICE_ROLE_KEY (nunca no navegador).
-- Se no futuro usar Supabase Auth no front, habilite RLS e políticas por usuário.
