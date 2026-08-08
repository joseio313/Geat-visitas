# Conectar el CRM con Google Drive (OAuth) — trámite pendiente

Estado al 2026-08-08: **el código está listo y desplegado; falta solo este trámite.**
Mientras no se haga, los audios se quedan en Supabase (como antes de v175) y el
indicador del Parte del Día muestra "☁️ Drive sin conectar".

---

## Por qué OAuth y no una cuenta de servicio

El primer intento usó una **Service Account** y Google devolvió:

```
Service Accounts do not have storage quota
```

Motivo: en Drive el archivo lo posee quien lo sube, y una Service Account no tiene
cuota propia ni puede usar la de una cuenta personal. La salida habitual es subir a
una **Unidad Compartida** (Shared Drive), que sí tiene cuota propia — pero las
Unidades Compartidas son exclusivas de **Google Workspace**: una cuenta `@gmail.com`
gratuita no puede crear ninguna.

Con **OAuth** la cuenta `registrograbaciones2026@gmail.com` se autoriza a sí misma:
los archivos quedan a su nombre y consumen **sus 15 GB**. Gratis y sin Workspace.

> Si algún día se contrata Google Workspace, la Service Account vuelve a servir. La
> credencial quedó aparcada en `app_config.google_sa_json_parked` y el código ya
> manda `supportsAllDrives=true` en todas las llamadas — ver el final de este archivo.

---

## Los pasos (una sola vez, ~10 minutos)

Todo logueado como **registrograbaciones2026@gmail.com**, en el proyecto de Google
Cloud "GEAT Grabaciones" (ya creado, con la Google Drive API habilitada).

### 1. Pantalla de consentimiento OAuth
`console.cloud.google.com` → **APIs y servicios → Pantalla de consentimiento OAuth**
- Tipo de usuario: **Externo**
- Nombre de la app: `GEAT CRM`
- Correo de asistencia y correo de contacto: el tuyo
- Guardar

### 2. ⚠️ Publicar la app — el paso que más se olvida
En **Público** (o *Audiencia*), botón **"Publicar aplicación"** → estado
**"En producción"**.

**Esto va ANTES del paso 4.** Si generás el refresh token con la app en estado
"Prueba", Google lo revoca a los **7 días** y el CRM deja de subir audios. Si eso
pasa, el Parte del Día lo va a decir con todas las letras
("el refresh_token venció o fue revocado…").

### 3. Crear el ID de cliente
**APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**
- Tipo de aplicación: **Aplicación web**
- En *URIs de redireccionamiento autorizados*, agregar exactamente:
  ```
  https://developers.google.com/oauthplayground
  ```
- Crear → anotar **ID de cliente** y **Secreto de cliente**

### 4. Sacar el refresh token
Ir a **https://developers.google.com/oauthplayground**

1. Engranaje ⚙️ (arriba a la derecha) → tildar **"Use your own OAuth credentials"**
   → pegar el ID de cliente y el secreto del paso 3
2. En el panel izquierdo, en el campo de scopes, escribir **a mano**:
   ```
   https://www.googleapis.com/auth/drive.file
   ```
3. **Authorize APIs** → loguearse con `registrograbaciones2026@gmail.com`
4. Va a aparecer "Google no verificó esta aplicación" — es tuya:
   *Configuración avanzada → Ir a GEAT CRM (no seguro)* → Permitir
5. **Exchange authorization code for tokens**
6. Copiar el valor de **`refresh_token`** (empieza con `1//`)

### 5. Cargarlo en el CRM
Entrar al CRM como admin → **Parte del Día → 💾 Almacenamiento → ⚙️ Conectar Google Drive**
→ pegar **ID de cliente**, **Secreto** y **Refresh token** → **Guardar y probar**.

El CRM valida contra Google antes de guardar: si algo está mal, no guarda nada y
dice el motivo. Si sale bien, crea sola la carpeta **"Grabaciones GEAT"**.

### 6. Correr el barrido
En el mismo bloque aparece **"☁️ Mover 23 audio(s) a Drive"**. Son ~403 MB; va por
tandas (la grabación id 12 tiene 353 segmentos) y avisa cuánto liberó en cada vuelta.

---

## Detalles que conviene saber

- **Scope `drive.file`**: es un scope *no sensible*, así que Google no exige proceso
  de verificación. La contra es que la app **sólo ve los archivos que ella misma
  crea** — por eso la carpeta la crea el CRM y no hace falta pegar ningún ID de
  carpeta. La carpeta "Grabaciones GEAT" que se creó a mano en el primer intento
  quedó huérfana: se puede borrar.
- **A favor**: con ese scope el CRM no puede tocar ningún otro archivo del Drive.
- **Dónde vive la credencial**: `app_config.google_oauth_json`, excluida de la policy
  `lectura_publica` — el navegador nunca la recibe. La usa sólo la Edge Function
  `geat-drive` con `service_role`.
- **Nada se pierde**: el orden es subir → verificar → guardar `audio_drive_url` →
  recién ahí borrar de Supabase. Si Drive falla, el audio se queda donde está.

## Si algún día hay Google Workspace

Para volver al modo Service Account (que ahí sí funciona, contra una Unidad Compartida):

```sql
update public.app_config
set value = (select value from public.app_config where key = 'google_sa_json_parked')
where key = 'google_sa_json';

update public.app_config set value = '<ID DE LA UNIDAD COMPARTIDA>'
where key = 'google_drive_folder_id';

update public.app_config set value = '' where key = 'google_oauth_json';
```

Hay que compartir la Unidad Compartida como **Administrador de contenido** con
`geat-drive@geat-grabaciones.iam.gserviceaccount.com`. `geat-drive` prefiere OAuth
cuando las dos credenciales están cargadas, por eso el último `update` la vacía.
