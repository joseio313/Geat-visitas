/* ══════════════════════════════════════════════════════════════════════════
   v250 · procesar_rechazo_cerrador() — el reemplazo sale de colaboradores
   23-sep-2026

   QUÉ ESTABA MAL:
     nuevo_cerrador := CASE WHEN NEW.cerrador = 'David Gambarte'
                            THEN 'Gustavo Vaca' ELSE 'David Gambarte' END;
   Mismo patrón que asignar_cerrador_alternancia antes de v249: los dos nombres
   escritos a mano y un flip entre dos. Con Gustavo Vaca inactivo desde
   junio-2026, un rechazo de David le pasaba la visita a un colaborador
   DESACTIVADO — el lead quedaba a nombre de alguien que no entra al CRM.
   Nunca explotó porque el trigger jamás se disparó: el front no escribe
   `cerrador_confirmacion='rechazado'` en ninguna parte (medido: 0 de 7.808
   leads tienen ese valor; 84 'asignado' y 2 'confirmado'). Era una mina, no un
   incendio — se desarma antes de que exista la campanita que la pise.

   QUÉ HACE AHORA:
   - El reemplazo es el PRIMER colaborador activo con rol 'commercial_lead',
     por id, **excluyendo al que acaba de rechazar**. Sale de la tabla: un
     cerrador nuevo entra sin tocar esta función.
   - Si NO hay otro cerrador activo (hoy es el caso: David es el único), la
     visita **no se reasigna**. El rechazo QUEDA en pie
     (`cerrador_confirmacion='rechazado'`), el motivo y el detalle se conservan
     y se avisa al admin para que lo resuelva una persona. Reasignarle la
     visita al mismo que la rechazó sería peor que no hacer nada.
   - `NEW.cerrador` solo se sobreescribe cuando hay reemplazo real. El motivo y
     el detalle se limpian únicamente en ese caso: son de la asignación que se
     está cerrando.
   - El título del aviso al admin pasa por COALESCE: con `NEW.cerrador` NULL,
     la concatenación dejaba el mensaje entero en NULL.

   OJO: los INSERT INTO notificaciones se conservan, pero esa tabla es
   WRITE-ONLY — el front nunca la lee, así que ninguno de estos avisos le llega
   a nadie todavía. Se resuelve solo cuando exista la campanita. Ver v251.

   RESPALDO: definición anterior verbatim en
   bk_fn_procesar_rechazo_cerrador_20260923 (columna def). Reversión:

     DO $rb$
     DECLARE d text;
     BEGIN
       SELECT def INTO d FROM bk_fn_procesar_rechazo_cerrador_20260923;
       EXECUTE d;
     END $rb$;
   ══════════════════════════════════════════════════════════════════════════ */

CREATE OR REPLACE FUNCTION public.procesar_rechazo_cerrador()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  nuevo_cerrador text;
  admin_nombre   text;
  texto_motivo   text;
BEGIN
  IF NEW.cerrador_confirmacion = 'rechazado'
     AND OLD.cerrador_confirmacion IS DISTINCT FROM 'rechazado' THEN

    texto_motivo := COALESCE(NEW.cerrador_rechazo_motivo, 'sin motivo');
    IF NEW.cerrador_rechazo_detalle IS NOT NULL AND NEW.cerrador_rechazo_detalle <> '' THEN
      texto_motivo := texto_motivo || ' — ' || NEW.cerrador_rechazo_detalle;
    END IF;

    SELECT nombre INTO admin_nombre FROM colaboradores WHERE rol = 'admin' LIMIT 1;

    /* v250: el reemplazo sale de colaboradores, nunca de un nombre escrito a
       mano, y nunca es el que acaba de rechazar. */
    SELECT c.nombre
      INTO nuevo_cerrador
      FROM colaboradores c
     WHERE c.activo
       AND c.rol = 'commercial_lead'
       AND c.nombre IS DISTINCT FROM NEW.cerrador
     ORDER BY c.id
     LIMIT 1;

    /* Sin reemplazo el rechazo queda en pie: se avisa y lo resuelve una
       persona. El motivo NO se limpia — es la información viva del caso. */
    IF nuevo_cerrador IS NULL THEN
      IF admin_nombre IS NOT NULL THEN
        INSERT INTO notificaciones (destinatario, tipo, titulo, mensaje, lead_id, fecha_programada, leida)
        VALUES (
          admin_nombre, 'cerrador_rechazo',
          '⚠️ ' || COALESCE(NEW.cerrador,'El cerrador') || ' rechazó una visita y no hay reemplazo',
          COALESCE(NEW.cerrador,'El cerrador') || ' no puede atender a ' || COALESCE(NEW.nombre,'lead')
            || '. Motivo: ' || texto_motivo
            || '. No hay otro cerrador activo: la visita queda SIN reasignar y hay que resolverla a mano.',
          NEW.id, now(), false
        );
      END IF;
      RETURN NEW;
    END IF;

    IF admin_nombre IS NOT NULL THEN
      INSERT INTO notificaciones (destinatario, tipo, titulo, mensaje, lead_id, fecha_programada, leida)
      VALUES (
        admin_nombre, 'cerrador_rechazo',
        '⚠️ ' || COALESCE(NEW.cerrador,'El cerrador') || ' rechazó una visita',
        COALESCE(NEW.cerrador,'El cerrador') || ' no puede atender a ' || COALESCE(NEW.nombre,'lead')
          || '. Motivo: ' || texto_motivo
          || '. Reasignada a ' || nuevo_cerrador || '.',
        NEW.id, now(), false
      );
    END IF;

    NEW.cerrador                 := nuevo_cerrador;
    NEW.cerrador_confirmacion    := 'asignado';
    NEW.cerrador_asignado_en     := now();
    NEW.cerrador_rechazo_motivo  := NULL;
    NEW.cerrador_rechazo_detalle := NULL;

    INSERT INTO notificaciones (destinatario, tipo, titulo, mensaje, lead_id, fecha_programada, leida)
    VALUES (
      nuevo_cerrador, 'cerrador_por_confirmar',
      '🤝 Visita reasignada a vos: ' || COALESCE(NEW.nombre,'lead'),
      'Se te reasignó esta visita. Confirmá si podés atenderla o avisá que no.',
      NEW.id, now(), false
    );
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.procesar_rechazo_cerrador() IS
'v250 (23-sep-2026): el reemplazo es el primer colaborador activo con rol commercial_lead por id, excluyendo al que rechazo — sin nombres hardcodeados. Si no hay otro cerrador activo la visita NO se reasigna: el rechazo queda en pie y se avisa al admin. Respaldo de la version anterior en bk_fn_procesar_rechazo_cerrador_20260923.';
