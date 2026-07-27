-- ============================================================================
-- v168 — Blindaje del sistema de asignación captador ↔ cerrador
-- Proyecto Supabase: jsacnpgpnvoslrpurfxc (Geat CRM)
-- Todo idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- Soft-delete siempre (activo=false), nunca DELETE.
-- ORDEN DE APLICACIÓN: BARRIDO (bloque F) → luego bloques A..E.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A) BUG 1 — completar una tarea de visita marca visito_oficina
--    Estado previo: la función YA ponía visito_oficina=true, pero solo para
--    tipo exactamente IN ('Visita oficina','Visita terreno','Visita técnica').
--    En la base hay 10 tareas con tipo 'visita_oficina' (snake) que NUNCA
--    disparaban nada. Además pg_trigger_depth()>1 abortaba el trigger cuando
--    la tarea se completaba desde otro trigger (cascada) — el caso 7046.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_registrar_visita_atendida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_tipo       text;
  v_es_oficina boolean;
  v_es_visita  boolean;
BEGIN
  -- tope de recursión (antes era >1, que bloqueaba las cascadas legítimas)
  IF pg_trigger_depth() > 3 THEN RETURN NEW; END IF;

  IF NEW.completada = true AND COALESCE(OLD.completada, false) = false
     AND NEW.lead_id IS NOT NULL THEN

    -- normalizar: 'visita_oficina', 'Visita Oficina', 'Visita técnica' → 'visita oficina'/'visita tecnica'
    v_tipo := lower(translate(COALESCE(NEW.tipo,''), '_áéíóúÁÉÍÓÚ', ' aeiouaeiou'));
    v_es_oficina := v_tipo LIKE 'visita oficina%';
    v_es_visita  := v_tipo LIKE 'visita %';

    IF v_es_visita THEN
      UPDATE leads SET
        fecha_visita_oficina = CASE
          WHEN v_es_oficina THEN COALESCE(NEW.completada_en::date, CURRENT_DATE)
          ELSE fecha_visita_oficina END,
        visito_oficina = CASE
          WHEN v_es_oficina THEN true
          ELSE visito_oficina END,
        estado = CASE
          WHEN estado IN ('reservado','cerrado_ganado','cerrado_perdido') THEN estado
          ELSE 'visita_realizada' END,
        updated_at = now()
      WHERE id = NEW.lead_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- B) BUG 1 (cobertura agenda_grupal)
--    agenda_grupal NO tiene columna `completada`: no existe "completar" un
--    evento grupal. La única señal afirmativa es que alguien REGISTRE una
--    visita de oficina con fecha ya pasada (= "el cliente ya vino").
--    OJO: un evento futuro que simplemente venció NO es prueba de asistencia
--    (guard anti-falsa visita oficina, v149) — por eso solo INSERT, nunca por
--    vencimiento ni por UPDATE.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_visita_grupal_marca_oficina()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NEW.lead_id IS NOT NULL
     AND lower(COALESCE(NEW.tipo,'')) IN ('visita_nueva','visita_oficina','visita_captador','visita')
     AND COALESCE(NEW.lugar,'oficina') <> 'terreno'
     AND NEW.fecha_inicio <= now() THEN
    UPDATE leads SET
      visito_oficina = true,
      fecha_visita_oficina = COALESCE(fecha_visita_oficina,
                                      (NEW.fecha_inicio AT TIME ZONE 'America/La_Paz')::date),
      updated_at = now()
    WHERE id = NEW.lead_id
      AND COALESCE(visito_oficina,false) = false;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_visita_grupal_marca_oficina ON public.agenda_grupal;
CREATE TRIGGER trg_visita_grupal_marca_oficina
  AFTER INSERT ON public.agenda_grupal
  FOR EACH ROW EXECUTE FUNCTION public.fn_visita_grupal_marca_oficina();

-- ────────────────────────────────────────────────────────────────────────────
-- C) BUG 2 — completar una tarea sincroniza estado (y cerrador si corresponde)
--    Regla pedida: solo asignar cerrador si el colaborador de la tarea tiene
--    rol closer o commercial_lead. Si no (p.ej. captadora), se sincroniza el
--    estado y cerrador queda en NULL.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sync_estado_lead_por_tarea()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_rol    text;
  v_estado text;
  v_tipo   text;
BEGIN
  IF pg_trigger_depth() > 3 THEN RETURN NEW; END IF;
  IF NOT (NEW.completada = true AND COALESCE(OLD.completada,false) = false
          AND NEW.lead_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT estado INTO v_estado FROM leads WHERE id = NEW.lead_id;
  -- fases finales: no retroceder ni pisar
  IF v_estado IS NULL OR v_estado IN ('reservado','cerrado_ganado','cerrado_perdido') THEN
    RETURN NEW;
  END IF;

  SELECT rol INTO v_rol FROM colaboradores
   WHERE nombre = NEW.colaborador AND COALESCE(activo,false) = true LIMIT 1;

  v_tipo := lower(translate(COALESCE(NEW.tipo,''), '_áéíóúÁÉÍÓÚ', ' aeiouaeiou'));

  UPDATE leads SET
    estado = CASE
      WHEN v_tipo LIKE 'visita %' THEN 'visita_realizada'
      WHEN estado = 'nuevo'       THEN 'en_seguimiento'
      ELSE estado END,
    cerrador = CASE
      WHEN COALESCE(cerrador,'') = '' AND v_rol IN ('closer','commercial_lead')
        THEN NEW.colaborador
      ELSE cerrador END,
    updated_at = now()
  WHERE id = NEW.lead_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_estado_lead_por_tarea ON public.agenda_personal;
CREATE TRIGGER trg_sync_estado_lead_por_tarea
  AFTER UPDATE ON public.agenda_personal
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_estado_lead_por_tarea();

-- ────────────────────────────────────────────────────────────────────────────
-- D) BUG 3 + BUG 6a — asignar cerrador nunca deja el lead huérfano
--    1º CREA la tarea del nuevo cerrador, 2º cierra las de los demás.
--    Ese orden importa: trg_exigir_siguiente_paso aborta el cierre de la
--    última tarea abierta de un lead activo. Creando primero, siempre hay otra.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_tarea_para_nuevo_cerrador()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_tipo  text;
  v_fecha timestamptz;
BEGIN
  IF pg_trigger_depth() > 4 THEN RETURN NEW; END IF;

  IF NEW.cerrador IS DISTINCT FROM OLD.cerrador
     AND COALESCE(NEW.cerrador,'') <> ''
     AND COALESCE(NEW.archivado,false) = false
     AND COALESCE(NEW.estado,'') NOT IN ('cerrado_ganado','cerrado_perdido') THEN

    v_tipo := CASE COALESCE(NEW.estado,'')
                WHEN 'visita_agendada'  THEN 'Visita oficina'
                WHEN 'visita_realizada' THEN 'Cotización'
                WHEN 'reservado'        THEN 'Reserva'
                ELSE 'Indagación' END;

    v_fecha := COALESCE(
      NEW.visita_fecha,
      ((date_trunc('day', (now() AT TIME ZONE 'America/La_Paz'))
        + interval '1 day' + interval '9 hours') AT TIME ZONE 'America/La_Paz'));

    -- 1) tarea abierta para el nuevo cerrador (si no tiene ya una)
    IF NOT EXISTS (
      SELECT 1 FROM agenda_personal
       WHERE lead_id = NEW.id AND colaborador = NEW.cerrador
         AND completada = false AND COALESCE(activo,true) = true
    ) THEN
      INSERT INTO agenda_personal
        (colaborador, lead_id, tipo, titulo, nota, fecha_programada, completada, activo)
      VALUES
        (NEW.cerrador, NEW.id, v_tipo,
         COALESCE(NEW.nombre, 'Lead #'||NEW.id),
         'Tarea creada automáticamente al asignarte el lead como cerrador',
         v_fecha, false, true)
      ON CONFLICT DO NOTHING;
    END IF;

    -- 2) cerrar (soft) las abiertas de cualquier otro colaborador
    UPDATE agenda_personal
       SET completada = true, activo = false, completada_en = now(),
           nota_resultado = COALESCE(nota_resultado,
             'Cerrada automáticamente: el lead pasó al cerrador '||NEW.cerrador)
     WHERE lead_id = NEW.id
       AND completada = false AND COALESCE(activo,true) = true
       AND colaborador IS DISTINCT FROM NEW.cerrador;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_tarea_para_nuevo_cerrador ON public.leads;
CREATE TRIGGER trg_tarea_para_nuevo_cerrador
  AFTER UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_tarea_para_nuevo_cerrador();

-- ────────────────────────────────────────────────────────────────────────────
-- E) BUG 6b — no repetir una fase de intento ya cumplida
--    El 7046 acumuló 8 tareas "1er intento" completadas. En vez de rechazar el
--    INSERT (rompería la app), el tipo AVANZA al siguiente escalón libre.
--    Solo aplica a la escalera de intentos; el resto de tipos pasa igual.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_evitar_tarea_duplicada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_orden text[] := ARRAY['1er intento','2do intento','3er intento','Indagación'];
  v_i     int;
BEGIN
  IF NEW.lead_id IS NULL OR COALESCE(NEW.completada,false) = true THEN
    RETURN NEW;
  END IF;

  v_i := array_position(v_orden, NEW.tipo);
  IF v_i IS NULL THEN RETURN NEW; END IF;

  WHILE v_i < array_length(v_orden,1) AND EXISTS (
    SELECT 1 FROM agenda_personal
     WHERE lead_id = NEW.lead_id AND tipo = v_orden[v_i] AND completada = true
  ) LOOP
    v_i := v_i + 1;
  END LOOP;

  NEW.tipo := v_orden[v_i];
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_evitar_tarea_duplicada ON public.agenda_personal;
CREATE TRIGGER trg_evitar_tarea_duplicada
  BEFORE INSERT ON public.agenda_personal
  FOR EACH ROW EXECUTE FUNCTION public.fn_evitar_tarea_duplicada();

-- ============================================================================
-- F) BARRIDO DE REPARACIÓN (una sola vez, ANTES de crear los triggers A..E)
--    Orden: S1 → S3 → S4 → S2 (crear tareas faltantes al final, para barrer
--    también los huérfanos que generen las cascadas de S3).
-- ============================================================================

-- S1 · leads con tareas abiertas de 2+ colaboradores → dejar solo la del
--      responsable (cerrador si existe, si no el captador).
WITH multi AS (
  SELECT ap.lead_id
    FROM agenda_personal ap
    JOIN leads l ON l.id = ap.lead_id
   WHERE ap.completada = false AND COALESCE(ap.activo,true) = true
     AND COALESCE(l.archivado,false) = false
     AND l.estado NOT IN ('cerrado_ganado','cerrado_perdido')
   GROUP BY ap.lead_id
  HAVING COUNT(DISTINCT ap.colaborador) > 1
)
UPDATE agenda_personal ap
   SET completada = true, activo = false, completada_en = now(),
       nota_resultado = COALESCE(ap.nota_resultado,
         'Cerrada en barrido v168: el lead tenía tareas abiertas de dos personas')
  FROM leads l
 WHERE l.id = ap.lead_id
   AND ap.lead_id IN (SELECT lead_id FROM multi)
   AND ap.completada = false AND COALESCE(ap.activo,true) = true
   AND ap.colaborador IS DISTINCT FROM COALESCE(NULLIF(l.cerrador,''), l.captador);

-- S3 · leads con tareas avanzadas pero estado='nuevo' → sincronizar estado
--      (y cerrador solo si el dueño de la tarea es closer/commercial_lead).
UPDATE leads l
   SET estado = CASE WHEN EXISTS (
                       SELECT 1 FROM agenda_personal ap
                        WHERE ap.lead_id = l.id AND ap.completada = true
                          AND lower(translate(COALESCE(ap.tipo,''),'_áéíóú',' aeiou')) LIKE 'visita %')
                     THEN 'visita_realizada' ELSE 'en_seguimiento' END,
       cerrador = COALESCE(NULLIF(l.cerrador,''), (
         SELECT ap.colaborador FROM agenda_personal ap
           JOIN colaboradores c ON c.nombre = ap.colaborador
                               AND c.rol IN ('closer','commercial_lead')
                               AND COALESCE(c.activo,false) = true
          WHERE ap.lead_id = l.id AND ap.completada = true
          ORDER BY ap.completada_en DESC NULLS LAST LIMIT 1)),
       updated_at = now()
 WHERE l.estado = 'nuevo'
   AND COALESCE(l.archivado,false) = false
   AND EXISTS (SELECT 1 FROM agenda_personal ap
                WHERE ap.lead_id = l.id AND ap.completada = true);

-- S4 · backfill visito_oficina desde tareas "Visita oficina" YA completadas
--      (única evidencia afirmativa; NO se infiere de eventos grupales vencidos).
UPDATE leads l
   SET visito_oficina = true,
       fecha_visita_oficina = COALESCE(l.fecha_visita_oficina, (
         SELECT COALESCE(ap.completada_en::date, ap.fecha_programada::date)
           FROM agenda_personal ap
          WHERE ap.lead_id = l.id AND ap.completada = true
            AND lower(translate(COALESCE(ap.tipo,''),'_áéíóú',' aeiou')) LIKE 'visita oficina%'
          ORDER BY ap.completada_en DESC NULLS LAST LIMIT 1)),
       updated_at = now()
 WHERE COALESCE(l.visito_oficina,false) = false
   AND EXISTS (SELECT 1 FROM agenda_personal ap
                WHERE ap.lead_id = l.id AND ap.completada = true
                  AND lower(translate(COALESCE(ap.tipo,''),'_áéíóú',' aeiou')) LIKE 'visita oficina%');

-- S2 · leads activos sin ninguna tarea abierta → crear una para el responsable.
INSERT INTO agenda_personal
  (colaborador, lead_id, tipo, titulo, nota, fecha_programada, completada, activo)
SELECT COALESCE(NULLIF(l.cerrador,''), l.captador),
       l.id,
       CASE COALESCE(l.estado,'')
         WHEN 'visita_agendada'  THEN 'Visita oficina'
         WHEN 'visita_realizada' THEN 'Cotización'
         ELSE 'Indagación' END,
       COALESCE(l.nombre,'Lead #'||l.id),
       'Tarea creada por el barrido v168: el lead estaba sin tarea abierta',
       ((date_trunc('day', (now() AT TIME ZONE 'America/La_Paz'))
         + interval '1 day' + interval '9 hours') AT TIME ZONE 'America/La_Paz'),
       false, true
  FROM leads l
 WHERE COALESCE(l.archivado,false) = false
   AND l.estado IN ('nuevo','en_seguimiento','visita_agendada','visita_realizada')
   AND COALESCE(NULLIF(l.cerrador,''), l.captador) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM agenda_personal ap
                    WHERE ap.lead_id = l.id AND ap.completada = false
                      AND COALESCE(ap.activo,true) = true)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- G) BUG 5 — mensaje de error con las DOS salidas
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bloquear_visita_sin_indagacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE l record;
BEGIN
  IF NEW.lead_id IS NOT NULL
     AND COALESCE(NEW.tipo,'') IN ('visita_nueva','visita_oficina','visita_captador','reagendo') THEN
    SELECT estado, visito_oficina, indagacion_completa, ind_ciudad, ind_tipo, ind_financiamiento,
           ind_monto_financiamiento, ind_presupuesto, ind_presupuesto_tope,
           ind_lugar_terreno, ind_plantas, ind_cuando_construir
      INTO l FROM public.leads WHERE id = NEW.lead_id;
    IF l IS NULL THEN RETURN NEW; END IF;
    IF l.estado IN ('visita_agendada','visita_realizada','reservado','cerrado_ganado') THEN
      RETURN NEW;
    END IF;
    IF COALESCE(l.visito_oficina,false) THEN
      RETURN NEW;
    END IF;
    IF NOT ( COALESCE(l.indagacion_completa,false) OR (
         COALESCE(l.ind_ciudad,'')<>'' AND COALESCE(l.ind_tipo,'')<>''
         AND COALESCE(l.ind_financiamiento,'')<>''
         AND l.ind_monto_financiamiento IS NOT NULL
         AND l.ind_presupuesto IS NOT NULL
         AND l.ind_presupuesto_tope IS NOT NULL
         AND COALESCE(l.ind_lugar_terreno,'')<>''
         AND l.ind_plantas IS NOT NULL
         AND COALESCE(l.ind_cuando_construir,'')<>'' ) ) THEN
      RAISE EXCEPTION 'INDAGACION_INCOMPLETA: hay dos salidas para el lead %. 1) Completá la indagación en la ficha del lead. 2) Si el cliente YA vino a la oficina, marcá "Visitó oficina" en la ficha y volvé a agendar.', NEW.lead_id;
    END IF;
  END IF;
  RETURN NEW;
END $function$;
