-- v279 · grabaciones.privada (aplicada el 2026-11-09 via migracion grabaciones_privada_v279)
-- true = solo la ve su autor (colaborador). Ni admin ni commercial_lead.
-- La regla la aplica la Edge Function geat-grabaciones; la columna sola no protege nada
-- mientras anon siga con acceso a la tabla (ver pasos 5 y 7 del plan, pendientes de OK).
ALTER TABLE public.grabaciones ADD COLUMN IF NOT EXISTS privada boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.grabaciones.privada IS 'v279: true = solo la ve su autor (colaborador). Ni admin ni commercial_lead. Lo aplica la Edge Function geat-grabaciones.';
