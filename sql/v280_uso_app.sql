-- v280 — uso_app: cuántos abren el CRM como app instalada vs navegador.
-- IDEMPOTENTE (se puede correr dos veces). NO APLICADA: espera OK del CEO.
-- Datos: colaborador, modo, dispositivo, fecha. Nada sensible (sin IP, sin UA).
-- Se escribe y se lee SOLO por geat-auth (service_role): RLS activa y sin
-- policies ni GRANTs para anon/authenticated, igual que auditoria_logins.

create table if not exists public.uso_app (
  id                 bigint generated always as identity primary key,
  colaborador_id     bigint      not null,
  colaborador_nombre text        not null,
  modo               text        not null check (modo in ('app','navegador')),
  dispositivo        text        not null check (dispositivo in ('android','ios','pc')),
  dia                date        not null,          -- día calendario America/La_Paz
  fecha              timestamptz not null default now()
);

-- una fila por colaborador + modo + dispositivo + día
create unique index if not exists uso_app_uq
  on public.uso_app (colaborador_id, modo, dispositivo, dia);
create index if not exists uso_app_dia_idx on public.uso_app (dia desc);

alter table public.uso_app enable row level security;
revoke all on public.uso_app from anon, authenticated;

comment on table public.uso_app is
  'v280: aperturas del CRM por modo (app instalada / navegador). Solo geat-auth (acciones uso_app y admin_uso_app).';

-- Verificación posterior (debe dar: rls=true, 0 grants a anon):
--   select relrowsecurity from pg_class where oid='public.uso_app'::regclass;
--   select count(*) from information_schema.role_table_grants
--    where table_name='uso_app' and grantee in ('anon','authenticated');
