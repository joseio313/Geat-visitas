/* ══════════════════════════════════════════════════════════════════════════
   v249 · asignar_cerrador_alternancia() — se asigna por VISITA REAL
   22-sep-2026

   QUÉ ESTABA MAL (medido, no supuesto):
   1. Se disparaba con `NEW.estado ILIKE '%visita%'` y un cambio de estado, SIN
      mirar visita_fecha. saveSeguimiento pone estado='visita_agendada' con solo
      elegir un próximo paso llamado "Visita ..." (index.html, rama
      _esFaseVisita), así que un lead en "1er intento" que nunca tuvo visita
      salía con cerrador. Esa es la vía por la que 8 perdidos de Genoveva
      quedaron con cerrador y visita_fecha NULL.
   2. Alternancia David/Gustavo escrita a mano 5 veces. Gustavo Vaca está
      inactivo desde junio-2026, así que los cuatro caminos terminaban en David:
      la alternancia no alternaba nada.
   3. El swap de v140 estaba roto —
        turno_cerrador := otro_cerrador; otro_cerrador := turno_cerrador;
      deja las DOS variables con el mismo valor (falta la temporal), así que el
      chequeo de solape de 90 minutos comparaba al cerrador contra sí mismo.
      Al sacar la alternancia el swap desaparece: ya no hay dos variables que
      intercambiar.

   QUÉ HACE AHORA:
   - Asigna SOLO si `NEW.visita_fecha IS NOT NULL`. El texto del estado ya no
     alcanza.
   - Se dispara con lo que traiga la visita real: el cambio de visita_fecha
     (UPDATE #1 de sincronizar_estado_lead_visita, y también el reprogramar de
     v241) o el cambio de estado a '%visita%' teniendo ya fecha. Hacen falta las
     dos puertas: sincronizar_estado_lead_visita escribe visita_fecha en un
     UPDATE y el estado en OTRO, y si el lead ya venía en 'visita_agendada'
     (por la rama _esFaseVisita del front) el segundo UPDATE nunca ocurre.
   - El cerrador es el PRIMER colaborador activo con rol 'commercial_lead',
     por id. Hoy es David Gambarte (id 6). Sale de la tabla, no del código: un
     cerrador nuevo entra sin tocar esta función.
   - Si NO hay ningún commercial_lead activo, no inventa a nadie: el lead queda
     sin cerrador. El fallback 'David Gambarte' de v140 se va.
   - El chequeo de solape de 90 min queda SOLO para avisar del conflicto, y
     ahora excluye la visita del propio lead (antes la contaba y por eso daba
     "ocupado" siempre).
   - La tabla cerrador_alternancia deja de usarse. No se borra.

   RESPALDO: la definición anterior está completa y verbatim en
   bk_fn_cerrador_alternancia_20260922 (columna def). Para volver atrás:

     DO $rb$
     DECLARE d text;
     BEGIN
       SELECT def INTO d FROM bk_fn_cerrador_alternancia_20260922;
       EXECUTE d;
     END $rb$;
   ══════════════════════════════════════════════════════════════════════════ */

CREATE OR REPLACE FUNCTION public.asignar_cerrador_alternancia()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  cerrador_final text;
  hora_visita    timestamptz;
  ocupado        boolean := false;
  ventana        interval := interval '90 minutes';
BEGIN
  -- El que ya tiene cerrador no se toca.
  IF COALESCE(NEW.cerrador,'') <> '' THEN
    RETURN NEW;
  END IF;

  -- v249: sin visita real no se asigna. El texto del estado no alcanza.
  IF NEW.visita_fecha IS NULL THEN
    RETURN NEW;
  END IF;

  -- Las dos puertas por las que llega una visita real.
  IF NOT ( OLD.visita_fecha IS DISTINCT FROM NEW.visita_fecha
           OR (NEW.estado ILIKE '%visita%' AND OLD.estado IS DISTINCT FROM NEW.estado) ) THEN
    RETURN NEW;
  END IF;

  -- v249: el cerrador sale de colaboradores, no de dos nombres escritos a mano.
  SELECT c.nombre
    INTO cerrador_final
    FROM colaboradores c
   WHERE c.activo AND c.rol = 'commercial_lead'
   ORDER BY c.id
   LIMIT 1;

  -- Sin cerrador activo no se inventa uno: el lead queda sin asignar.
  IF cerrador_final IS NULL THEN
    RETURN NEW;
  END IF;

  hora_visita := NEW.visita_fecha;

  -- Solape: solo para avisar. La visita de ESTE lead no cuenta como conflicto.
  SELECT EXISTS (
    SELECT 1 FROM agenda_grupal ag
     WHERE ag.cerrador = cerrador_final
       AND ag.lead_id IS DISTINCT FROM NEW.id
       AND ag.fecha_inicio BETWEEN hora_visita - ventana AND hora_visita + ventana
  ) INTO ocupado;

  NEW.cerrador              := cerrador_final;
  NEW.cerrador_confirmacion := 'asignado';
  NEW.cerrador_asignado_en  := now();

  /* Los avisos quedan como estaban. OJO: `notificaciones` es write-only — el
     front nunca la lee — así que estos INSERT no llegan a nadie hoy. Se
     conservan para no cambiar dos cosas en la misma pasada. */
  INSERT INTO notificaciones (destinatario, tipo, titulo, mensaje, lead_id, fecha_programada, leida)
  VALUES (
    cerrador_final, 'cerrador_por_confirmar',
    '🤝 Visita asignada: ' || COALESCE(NEW.nombre,'lead'),
    CASE WHEN ocupado
         THEN 'ATENCIÓN: ya tenés otra visita cerca de ese horario. Revisá y reprogramá si hace falta.'
         ELSE 'Se te asignó esta visita. Confirmá si podés atenderla o avisá que no.'
    END,
    NEW.id, now(), false
  );

  IF ocupado THEN
    INSERT INTO notificaciones (destinatario, tipo, titulo, mensaje, lead_id, fecha_programada, leida)
    SELECT nombre, 'conflicto_agenda',
      '⚠️ Conflicto de horario: ' || COALESCE(NEW.nombre,'lead'),
      'El cerrador ya tiene otra visita cerca de ese horario. Revisar.',
      NEW.id, now(), false
    FROM colaboradores WHERE rol = 'admin' LIMIT 1;
  END IF;

  IF NEW.captador IS NOT NULL AND NEW.captador <> '' THEN
    INSERT INTO notificaciones (destinatario, tipo, titulo, mensaje, lead_id, fecha_programada, leida)
    VALUES (NEW.captador, 'cerrador_asignado',
      '👤 Cerrador asignado: ' || cerrador_final,
      'Para la visita de ' || COALESCE(NEW.nombre,'tu lead') || '. Pendiente de confirmación.',
      NEW.id, now(), false);
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.asignar_cerrador_alternancia() IS
'v249 (22-sep-2026): asigna cerrador SOLO si hay visita real (visita_fecha no nula). El cerrador es el primer colaborador activo con rol commercial_lead, por id — sin alternancia, sin nombres hardcodeados y sin el fallback a David. Respaldo de la versión anterior en bk_fn_cerrador_alternancia_20260922.';
