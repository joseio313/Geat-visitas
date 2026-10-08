/* Ingesta diaria de CVs (GEAT v255, Tarea 1 de la orden del 08/10/2026).
   Idempotente: cron.schedule con el mismo jobname actualiza el job existente.
   Horarios en UTC: 11:00 = 07:00 Bolivia (UTC-4), 17:00 = 13:00 Bolivia.
   No hay credenciales aca: la key sale de app_config.sheet_sync_key y el secret del
   Apps Script vive en el entorno de la Edge Function geat-cv-cron. */

select cron.schedule(
  'cv-ingesta-0700-bo',
  '0 11 * * *',
  $$ select net.http_get(
       url := 'https://jsacnpgpnvoslrpurfxc.supabase.co/functions/v1/geat-cv-cron?key=' || (select value from app_config where key = 'sheet_sync_key'),
       timeout_milliseconds := 140000); $$
);

select cron.schedule(
  'cv-ingesta-1300-bo',
  '0 17 * * *',
  $$ select net.http_get(
       url := 'https://jsacnpgpnvoslrpurfxc.supabase.co/functions/v1/geat-cv-cron?key=' || (select value from app_config where key = 'sheet_sync_key'),
       timeout_milliseconds := 140000); $$
);
