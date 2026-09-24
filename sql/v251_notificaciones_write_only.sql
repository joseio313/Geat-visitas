/* ══════════════════════════════════════════════════════════════════════════
   v251 · notificaciones es WRITE-ONLY — queda anotado, no se toca nada
   23-sep-2026

   NO cambia una sola línea de lógica. Los 18 INSERT INTO notificaciones que hay
   repartidos en 6 funciones se quedan donde están: cuando exista la campanita
   en el front, todos empiezan a servir solos. Lo único que faltaba era que eso
   estuviera escrito donde alguien lo lea antes de construir algo encima.

   LO MEDIDO (23-sep-2026):
   - 21.538 filas desde el 12-jun-2026, 5,7 MB.
   - **0 leídas.** Ni una. Nada en el front marca `leida=true` porque nada lee
     la tabla: es la prueba dura de que estos avisos no llegan a nadie.
   - Sin job de retención: la tabla solo crece. El cron de leads fríos reinserta
     una fila por lead por día.

   QUIÉN ESCRIBE (6 funciones, 18 INSERT):
     asignar_cerrador_alternancia   3
     procesar_rechazo_cerrador      3   (ya anotada en v250)
     notificar_eventos              5
     notificar_evento_grupal        5
     avisar_reserva_sin_indagacion  1
     notificar_leads_frios          1

   QUÉ HACE ESTE ARCHIVO:
   1. COMMENT ON TABLE notificaciones — el aviso en el lugar más visible.
   2. COMMENT ON FUNCTION en las 4 que no tenían ninguno.
   3. Repone el comentario write-only DENTRO de asignar_cerrador_alternancia().
      Estaba en sql/v249_cerrador_por_visita_real.sql pero se me quedó afuera al
      aplicar la migración: el cuerpo en la base no lo tenía. El cuerpo es
      idéntico al de v249, lo único que se agrega es el comentario.
   ══════════════════════════════════════════════════════════════════════════ */

COMMENT ON TABLE public.notificaciones IS
'WRITE-ONLY (medido 23-sep-2026): 6 funciones escriben acá (18 INSERT) y el front NO lee la tabla en ninguna pantalla. Prueba: 21.538 filas desde jun-2026 y 0 con leida=true. Tampoco hay job de retencion, asi que solo crece (el cron de leads frios reinserta 1 fila por lead por dia). Los INSERT se conservan a proposito: cuando exista la campanita en el front empiezan a servir solos. No construir nada asumiendo que estos avisos llegan hoy, y no borrar los INSERT.';

COMMENT ON FUNCTION public.notificar_eventos() IS
'Escribe 5 avisos en notificaciones, que es WRITE-ONLY: el front no lee esa tabla, asi que hoy no llegan a nadie (ver COMMENT ON TABLE notificaciones, v251). Se conservan a proposito.';

COMMENT ON FUNCTION public.notificar_evento_grupal() IS
'Escribe 5 avisos en notificaciones, que es WRITE-ONLY: el front no lee esa tabla, asi que hoy no llegan a nadie (ver COMMENT ON TABLE notificaciones, v251). Se conservan a proposito.';

COMMENT ON FUNCTION public.avisar_reserva_sin_indagacion() IS
'Avisa por notificaciones, que es WRITE-ONLY: el front no lee esa tabla, asi que hoy no llega a nadie (ver COMMENT ON TABLE notificaciones, v251). v202: esta funcion solo avisa, nunca bloquea la reserva.';

COMMENT ON FUNCTION public.notificar_leads_frios() IS
'Cron de leads frios. Avisa por notificaciones, que es WRITE-ONLY: el front no lee esa tabla (ver COMMENT ON TABLE notificaciones, v251). OJO: reinserta 1 fila por lead por dia y no hay retencion, es el mayor generador de filas de la tabla.';

/* El cuerpo es el de v249 sin un solo cambio de lógica: se agrega el bloque de
   comentario arriba del primer INSERT, que es lo que faltaba en la base. */
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

  /* v251 — los tres avisos que siguen se conservan a proposito, pero OJO:
     `notificaciones` es WRITE-ONLY. El front no lee esa tabla en ninguna
     pantalla (21.538 filas y 0 con leida=true), asi que hoy no le llegan a
     nadie. Cuando exista la campanita empiezan a servir solos: no borrarlos y
     no dar por hecho que el cerrador se entera por aca. */
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
'v249 (22-sep-2026): asigna cerrador SOLO si hay visita real (visita_fecha no nula). El cerrador es el primer colaborador activo con rol commercial_lead, por id — sin alternancia, sin nombres hardcodeados y sin el fallback a David. Respaldo de la version anterior en bk_fn_cerrador_alternancia_20260922. v251: sus 3 avisos van a notificaciones, que es WRITE-ONLY y hoy no llega a nadie.';

/* Aplicado aparte, para que el chequeo dé 6/6 funciones anotadas: el COMMENT de
   procesar_rechazo_cerrador ya traía el texto de v250 y acá se le suma la nota. */
COMMENT ON FUNCTION public.procesar_rechazo_cerrador() IS
'v250 (23-sep-2026): el reemplazo es el primer colaborador activo con rol commercial_lead por id, excluyendo al que rechazo — sin nombres hardcodeados. Si no hay otro cerrador activo la visita NO se reasigna: el rechazo queda en pie y se avisa al admin. Respaldo de la version anterior en bk_fn_procesar_rechazo_cerrador_20260923. v251: sus 3 avisos van a notificaciones, que es WRITE-ONLY y hoy no llega a nadie.';
