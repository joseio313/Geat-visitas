-- ═══════════════════════════════════════════════════════════════════════════
-- v208 · AGENDADO DE VISITA
--   1. agenda_personal.captador  → la visita se ve en las dos agendas sin
--      duplicar filas (la del cerrador que la atiende y la de quien la generó)
--   2. backfill de las visitas ya agendadas
--   3. sincronizar_visita_grupal() deja de duplicar la visita en el calendario
--      grupal (visita_nueva del modal + visita_captador del trigger)
--   4. limpieza del duplicado vivo (lead 7414)
--   5. el aviso de activo=false / completada=true, en la base
--
-- Verificado antes de escribir esto:
--   · agenda_personal tiene GRANT a NIVEL DE TABLA para anon/authenticated
--     (relacl = anon=arwdDxtm), así que la columna nueva queda incluida sola:
--     NO hace falta GRANT por columna (a diferencia de v202b/v203).
--   · Ningún trigger de agenda_personal se dispara con este UPDATE:
--     trg_set_visita_fecha es AFTER INSERT (no UPDATE) y los otros tres exigen
--     completada false→true. El backfill no toca completada.
--
-- Se aplico con supabase apply_migration (name: v208_agenda_visita), que ya
-- envuelve todo en una transaccion: por eso no lleva BEGIN/COMMIT propios.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.agenda_personal ADD COLUMN IF NOT EXISTS captador text;

CREATE INDEX IF NOT EXISTS idx_agenda_personal_captador
  ON public.agenda_personal (captador) WHERE captador IS NOT NULL;

COMMENT ON COLUMN public.agenda_personal.captador IS
  'v208: quien GENERO la visita (leads.captador al agendarla). La fila sigue '
  'siendo del cerrador que la atiende (colaborador); esta columna existe para '
  'que la visita aparezca tambien en la agenda de la captadora SIN duplicar '
  'filas. La leen solo las dos vistas de agenda (semanal y mensual). Los '
  'contadores de carga siguen filtrando por colaborador a proposito: si '
  'contaran por captador, la misma visita sumaria carga a dos personas.';

-- ── 2 ─── backfill: 75 filas de visita cuyo captador ≠ colaborador ────────
--         (35 de ellas todavia abiertas). Solo metadato de atribucion.
UPDATE public.agenda_personal ap
   SET captador = l.captador
  FROM public.leads l
 WHERE ap.lead_id = l.id
   AND ap.tipo ILIKE 'visita%'
   AND ap.captador IS NULL
   AND COALESCE(l.captador,'') <> ''
   AND l.captador <> ap.colaborador;

-- ── 3 ─── el calendario grupal deja de mostrar la visita dos veces ────────
-- El modal de agendado inserta 'visita_nueva' en agenda_grupal. Eso dispara
-- sincronizar_estado_lead_visita, que desde v201 SIEMPRE escribe
-- leads.visita_fecha; y ese UPDATE dispara este trigger, que insertaba ADEMAS
-- una fila 'visita_captador'. Resultado: la misma visita, dos veces en el
-- calendario del equipo (lead 7414: ids 233 y 234).
-- Este trigger sigue siendo necesario para el camino viejo (visita_fecha
-- cargada desde la ficha del lead, sin pasar por el modal): 50 de las 51 filas
-- 'visita_captador' vivas vienen de ahi. Lo unico que cambia es que, si la
-- visita YA esta en el calendario por el modal a la misma fecha, no duplica.
CREATE OR REPLACE FUNCTION public.sincronizar_visita_grupal()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NEW.visita_fecha IS NOT NULL AND
     (OLD.visita_fecha IS NULL OR NEW.visita_fecha != OLD.visita_fecha) THEN

    -- El espejo viejo de este mismo trigger se descarta siempre: si no, al
    -- reagendar quedaba una visita fantasma en la fecha anterior.
    DELETE FROM agenda_grupal
     WHERE lead_id = NEW.id AND tipo IN ('visita_captador','visita_seguimiento');

    -- v208: si la visita ya la puso el modal de agendado a la MISMA fecha,
    -- no crear el espejo. Esa fila es la buena: lleva lugar, ubicacion del
    -- terreno y modo de pago, que este trigger no tiene de donde sacar.
    IF EXISTS (
      SELECT 1 FROM agenda_grupal
       WHERE lead_id = NEW.id
         AND tipo IN ('visita_nueva','visita_oficina','reagendo')
         AND fecha_inicio = NEW.visita_fecha
    ) THEN
      RETURN NEW;
    END IF;

    INSERT INTO agenda_grupal(
      tipo, titulo, lead_id, captador, cerrador, sala,
      fecha_inicio, fecha_fin, creado_por
    ) VALUES (
      'visita_captador',
      'Visita: ' || COALESCE(NEW.nombre, 'Cliente'),
      NEW.id,
      NEW.captador,
      NEW.cerrador,
      NEW.visita_sala,
      NEW.visita_fecha,
      NEW.visita_fecha + INTERVAL '1 hour',
      COALESCE(NEW.captador, 'Sistema')
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 4 ─── el unico duplicado vivo hoy (medido: 1 de 51) ──────────────────
-- Se borra la copia del trigger (234) y queda la del modal (233), que es la
-- que tiene lugar='terreno'. Borrar y no dar de baja: agenda_grupal no tiene
-- columna activo, y es exactamente lo que hace el propio trigger con sus
-- espejos viejos.
DELETE FROM public.agenda_grupal
 WHERE id = 234 AND lead_id = 7414 AND tipo = 'visita_captador';

-- ── 5 ─── el aviso donde lo va a ver quien limpie datos a mano ───────────
COMMENT ON TABLE public.agenda_personal IS
  'Tareas y visitas por colaborador. AVISO v208 — DAR DE BAJA UNA FILA ES '
  'SOLO activo=false, NUNCA completada=true: completada=true significa "la '
  'visita OCURRIO" y dispara fn_registrar_visita_atendida, que pasa el lead a '
  'visita_realizada (y si el tipo es Visita oficina, visito_oficina=true + '
  'fecha_visita_oficina=hoy). El 20-ago-2026, limpiando el duplicado del lead '
  '7414, esas dos banderas juntas marcaron como asistida una visita del dia '
  'siguiente y hubo que revertir el lead a mano.';

COMMENT ON COLUMN public.agenda_personal.completada IS
  'true = la tarea/visita OCURRIO. Dispara fn_registrar_visita_atendida y '
  'fn_sync_estado_lead_por_tarea, que mueven el estado del lead. NO usar para '
  'dar de baja una fila: para eso es activo=false.';

COMMENT ON COLUMN public.agenda_personal.activo IS
  'false = fila dada de baja (duplicado, error de carga). Es el UNICO borrado '
  'correcto: no dispara nada y las vistas de agenda ya filtran activo=true.';
