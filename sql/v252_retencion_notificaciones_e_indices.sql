/* ══════════════════════════════════════════════════════════════════════════
   v252 · Retención de notificaciones + índices
   23-sep-2026

   ⚠️ LO PRIMERO, PORQUE CAMBIA EL SENTIDO DE LA TAREA:
   archivar NO reduce el tamaño de la base. Las 18.491 filas salieron de la
   tabla viva pero siguen en el mismo Postgres, en notificaciones_archivo.
   Medido: base 48 MB → 53 MB al crear el archivo, y de vuelta a 48 MB recién
   después de un VACUUM FULL sobre la tabla viva (el DELETE no devuelve espacio
   al disco por sí solo). Neto del día: +131 kB, porque los índices nuevos pesan
   400 kB y la tabla viva se achicó de 5.776 kB a 816 kB.
   La base son 48 MB en total. Si el objetivo es volver al plan gratis, el
   tamaño de la base no es lo que lo bloquea; el egress sí — y ahí los ítems
   pesados son los PDFs dv_* de Operativa 1 y el poll de 60 s, no esta tabla.

   ── 1 · RETENCIÓN ───────────────────────────────────────────────────────────
   notificaciones_archivo: misma estructura (9 columnas, igual que la viva),
   RLS habilitada sin policies y sin grants para anon/authenticated, así que no
   se expone por PostgREST.
   El movimiento se hizo en un bloque atómico que copia, verifica fila por fila
   que cada id a borrar tenga copia, y recién entonces borra. Conteos:
     ANTES   viva 21.538 · archivo 0
     DESPUÉS viva  3.047 · archivo 18.491 · suma 21.538 · solapadas 0
     viejas que quedaron en la viva: 0
   Job semanal: se REEMPLAZÓ purgar-notificaciones-semanal (jobid 2), que
   borraba a los 90 días SIN archivar, por archivar-notificaciones-semanal
   (jobid 4, mismo horario: domingo 07:00 UTC = 03:00 Bolivia). Dejar los dos
   era una mina: si el archivado fallaba un mes, el viejo borraba sin copia.

   ── 2 · DUPLICADAS ──────────────────────────────────────────────────────────
   OJO: la premisa "notificar_leads_frios inserta una fila por lead por día" ya
   no era cierta — eso se arregló el 11-ago-2026 con el backoff 2/7/30. Medido
   hoy: 357 filas lead_frio en 30 días sobre 289 leads (máx 2 por lead, que es
   la escalada). El generador real hoy es notificar_eventos, con 1.266 PARES
   exactos (2.532 filas en 30 días) de seguimiento + recordatorio_seguimiento
   escritos en el mismo instante para el mismo lead. Esa función queda igual,
   como pediste.
   Lo que sí se agregó a notificar_leads_frios:
     a) UN SOLO aviso pendiente por lead: no inserta si ya hay un lead_frio sin
        leer en la tabla VIVA. Mira solo la viva a propósito — una archivada ya
        no es pendiente, es historia; si contara, el primer aviso silenciaría al
        lead para siempre y los hitos de 7 y 30 no volverían a salir.
     b) El historial de hitos ahora se consulta contra notificaciones +
        notificaciones_archivo. Sin esto, el archivado de hoy hacía que 26 leads
        recibieran de nuevo un aviso ya dado (medido: 41 dispararían mirando
        solo la viva, 15 mirando las dos).

   ── 3 · ÍNDICES ─────────────────────────────────────────────────────────────
   leads: created_at, archivado, estado, captador. notificaciones: created_at.
   Los cinco se verificaron con EXPLAIN sobre las consultas reales del front:
   los cinco dan Index Only Scan, ninguno quedó muerto. Pesan 400 kB en total.

   ── RESPALDOS Y REVERSIÓN ───────────────────────────────────────────────────
   · Las filas borradas están completas en notificaciones_archivo. Volverlas:
       INSERT INTO notificaciones
       SELECT * FROM notificaciones_archivo ON CONFLICT (id) DO NOTHING;
   · notificar_leads_frios anterior (11-ago-2026) en
     bk_fn_notificar_leads_frios_20260923 — restauración probada:
       DO $rb$ DECLARE d text; BEGIN
         SELECT def INTO d FROM bk_fn_notificar_leads_frios_20260923; EXECUTE d;
       END $rb$;
   · Volver al job viejo:
       SELECT cron.unschedule('archivar-notificaciones-semanal');
       SELECT cron.schedule('purgar-notificaciones-semanal','0 7 * * 0',
         $q$DELETE FROM notificaciones WHERE created_at < now() - interval '90 days'
              AND (fecha_programada IS NULL OR fecha_programada < now())$q$);
   · Los índices se sacan con DROP INDEX idx_... (ver nombres abajo).
   ══════════════════════════════════════════════════════════════════════════ */

-- ── 1 · tabla de archivo ───────────────────────────────────────────────────
CREATE TABLE public.notificaciones_archivo (LIKE public.notificaciones INCLUDING CONSTRAINTS);
ALTER TABLE public.notificaciones_archivo ADD PRIMARY KEY (id);
CREATE INDEX idx_notif_archivo_created_at ON public.notificaciones_archivo (created_at);
CREATE INDEX idx_notif_archivo_lead_id    ON public.notificaciones_archivo (lead_id);
ALTER TABLE public.notificaciones_archivo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notificaciones_archivo FROM anon, authenticated;

COMMENT ON TABLE public.notificaciones_archivo IS
'v252 (23-sep-2026): archivo historico de notificaciones. Misma estructura que la tabla viva. Recibe lo que pasa de 30 dias via fn_archivar_notificaciones(), que copia primero y borra despues SOLO lo que ya tiene copia aca. RLS habilitada sin policies y sin grants para anon/authenticated: no se expone por PostgREST. OJO: esto NO reduce el tamano de la base — las filas siguen en el mismo Postgres, solo salen de la tabla que se consulta.';

-- ── el movimiento, atómico: copia → verifica → borra ───────────────────────
DO $$
DECLARE
  v_corte   timestamptz := now() - interval '30 days';
  n_mover   int; n_copiadas int; n_borradas int; n_sin_copia int;
BEGIN
  SELECT count(*) INTO n_mover FROM notificaciones WHERE created_at < v_corte;

  INSERT INTO notificaciones_archivo
  SELECT * FROM notificaciones WHERE created_at < v_corte;
  GET DIAGNOSTICS n_copiadas = ROW_COUNT;

  IF n_copiadas <> n_mover THEN
    RAISE EXCEPTION 'copia incompleta: habia % para mover y se copiaron %. No se borra nada.', n_mover, n_copiadas;
  END IF;

  SELECT count(*) INTO n_sin_copia
    FROM notificaciones n
   WHERE n.created_at < v_corte
     AND NOT EXISTS (SELECT 1 FROM notificaciones_archivo a WHERE a.id = n.id);
  IF n_sin_copia > 0 THEN
    RAISE EXCEPTION '% filas quedaron sin copia en el archivo. No se borra nada.', n_sin_copia;
  END IF;

  DELETE FROM notificaciones n
   WHERE n.created_at < v_corte
     AND EXISTS (SELECT 1 FROM notificaciones_archivo a WHERE a.id = n.id);
  GET DIAGNOSTICS n_borradas = ROW_COUNT;

  IF n_borradas <> n_copiadas THEN
    RAISE EXCEPTION 'borradas % distinto de copiadas %', n_borradas, n_copiadas;
  END IF;

  RAISE NOTICE 'copiadas % / borradas %', n_copiadas, n_borradas;
END $$;

-- El DELETE no devuelve espacio al disco: sin esto la tabla seguia en 5.776 kB.
VACUUM (FULL, ANALYZE) public.notificaciones;

-- ── la función del archivado semanal ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_archivar_notificaciones(p_dias int DEFAULT 30)
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_corte    timestamptz;
  n_copiadas int;
  n_borradas int;
BEGIN
  v_corte := now() - make_interval(days => p_dias);

  /* Copia primero. ON CONFLICT DO NOTHING: si una corrida anterior murio entre
     el INSERT y el DELETE, la siguiente no falla por el id repetido. */
  INSERT INTO notificaciones_archivo
  SELECT * FROM notificaciones WHERE created_at < v_corte
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS n_copiadas = ROW_COUNT;

  /* Borra SOLO lo que ya tiene copia. El EXISTS no es decorativo: es la unica
     garantia de que un fallo en el INSERT no se lleve filas sin respaldo. */
  DELETE FROM notificaciones n
   WHERE n.created_at < v_corte
     AND EXISTS (SELECT 1 FROM notificaciones_archivo a WHERE a.id = n.id);
  GET DIAGNOSTICS n_borradas = ROW_COUNT;

  RETURN n_borradas;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_archivar_notificaciones(int) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_archivar_notificaciones(int) IS
'v252 (23-sep-2026): mueve a notificaciones_archivo lo que pasa de p_dias (30 por defecto) y recien despues borra de la tabla viva, solo las filas que ya tienen copia. La corre el job semanal archivar-notificaciones-semanal. OJO: no reduce el tamano de la base, solo el de la tabla que se consulta; para devolver espacio al disco hace falta un VACUUM FULL.';

-- ── el job: reemplaza al que borraba sin archivar ─────────────────────────
SELECT cron.unschedule('purgar-notificaciones-semanal');
SELECT cron.schedule('archivar-notificaciones-semanal', '0 7 * * 0',
                     'SELECT public.fn_archivar_notificaciones(30);');

-- ── 2 · un solo aviso pendiente por lead (ver el bloque de arriba) ────────
-- Migración: v252_leads_frios_un_aviso_pendiente_por_lead
-- Respaldo previo: bk_fn_notificar_leads_frios_20260923

-- ── 3 · índices ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads (created_at);
CREATE INDEX IF NOT EXISTS idx_leads_archivado  ON public.leads (archivado);
CREATE INDEX IF NOT EXISTS idx_leads_estado     ON public.leads (estado);
CREATE INDEX IF NOT EXISTS idx_leads_captador   ON public.leads (captador);
CREATE INDEX IF NOT EXISTS idx_notificaciones_created_at ON public.notificaciones (created_at);
ANALYZE public.leads;
ANALYZE public.notificaciones;
