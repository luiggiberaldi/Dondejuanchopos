# Intercomunicador — Notificaciones Push (Web Push / FCM)

> **Última actualización:** 2026-11-05
> **Alcance:** cómo funcionan las notificaciones push del intercomunicador Caja ↔ Supervisores, la incidencia del 2026-11-05 (no llegaban en Android), las mejoras de la notificación y el runbook de operación.
> **Plan original del módulo:** [`PLAN_INTERCOMUNICADOR_MENSAJERIA_NOTIFICACIONES.md`](../PLAN_INTERCOMUNICADOR_MENSAJERIA_NOTIFICACIONES.md)

---

## 1. Arquitectura

```
Dispositivo A escribe ──► INSERT en public.device_messages (Supabase)
                              │
                              ▼  Database Webhook (header x-intercom-webhook-secret)
                    Edge Function  intercom-push   (verify_jwt = false)
                              │  1. valida que el remitente sea miembro activo (intercom_is_active_member)
                              │  2. obtiene miembros activos del vínculo (intercom_active_members) menos el remitente
                              │  3. lee sus suscripciones en device_push_subscriptions (revoked_at IS NULL)
                              │  4. firma con VAPID y envía (Urgency High, TTL 1 h)
                              ▼
                    Push service (fcm.googleapis.com en Android/Chrome)
                              │
                              ▼
       Service Worker  public/intercom-push-sw.js  (importado por el SW de Workbox)
                              │  - si la conversación está visible → postMessage a la app (sin notificación)
                              │  - si no → showNotification (agrupada por conversación)
                              ▼
                    Notificación en el teléfono
```

### Archivos

| Archivo | Rol |
|---|---|
| `supabase/functions/intercom-push/index.ts` | Edge Function que recibe el webhook y envía los push. |
| `public/intercom-push-sw.js` | Handlers `push` y `notificationclick` del service worker. Se carga vía `workbox.importScripts` (`vite.config.js`). |
| `public/intercom-badge.png` | Icono pequeño (badge) monocromo de la notificación. |
| `scripts/generate-intercom-badge.cjs` | Regenera `intercom-badge.png` (`node scripts/generate-intercom-badge.cjs`). |
| `src/hooks/useDeviceIntercom.js` | `enablePush` / `disablePush` / `syncPushState`, lectura del chat y cierre de notificaciones al leer. |
| `src/utils/intercomPush.js` | Registro de la suscripción en `device_push_subscriptions` (con liberación de endpoint duplicado). |
| `scripts/generate-intercom-vapid.ts` | Genera un par de claves VAPID nuevo (ver runbook). |
| `.intercom-vapid-private.json` | Par de claves VAPID vigente (local, **no** se sube al repo). |
| `public/push-test/` | Página de diagnóstico Web Push (`/push-test/`). |

### Configuración

| Dónde | Variable | Contenido |
|---|---|---|
| Vercel / `.env` | `VITE_INTERCOM_VAPID_PUBLIC_KEY` | Clave pública VAPID con la que los teléfonos crean la suscripción. |
| Supabase secrets | `INTERCOM_VAPID_KEYS_JSON` | Par de claves VAPID (JSON de `exportVapidKeys`) con el que firma el servidor. **Debe ser el mismo par que la clave pública anterior.** |
| Supabase secrets | `INTERCOM_VAPID_SUBJECT` | `mailto:` de contacto VAPID. |
| Supabase secrets | `INTERCOM_WEBHOOK_SECRET` | Secreto compartido con el Database Webhook. |
| Supabase (automático) | `SUPABASE_ANON_KEY` | Se envía al SW para la acción "Marcar como leído". |

---

## 2. Incidencia 2026-11-05 — "Dice que están activadas pero no llegan"

### Síntoma
En Android, tras pulsar "Activar notificaciones" el panel mostraba **activadas**, pero no llegaba ninguna notificación del intercomunicador.

### Diagnóstico
1. Las suscripciones existían en `device_push_subscriptions` y estaban bien enlazadas (`primary_device_id` correcto).
2. El webhook sí invocaba la función (`POST | 200`), pero cada invocación registraba `1 push deliveries failed`.
3. El log no decía la causa porque el código leía `pushError.status`, y la librería `@negrel/webpush` expone el código en `pushError.response.status` → siempre `undefined`.
4. Tras corregir el log, FCM respondía:
   ```
   push 403: the VAPID credentials in the authorization header do not correspond
   to the credentials used to create the subscriptions.
   ```

### Causa raíz
El secreto `INTERCOM_VAPID_KEYS_JSON` de Supabase contenía **otro par de claves** distinto al de `VITE_INTERCOM_VAPID_PUBLIC_KEY` del cliente (desplegado en Vercel con `BKP1Pkm0qyRe…`). Cada push quedaba rechazado con 403 aunque la suscripción pareciera válida.

### Corrección
| Cambio | Detalle |
|---|---|
| Secreto VAPID | `INTERCOM_VAPID_KEYS_JSON` reemplazado por el contenido de `.intercom-vapid-private.json` (mismo par que la clave pública del cliente). Verificado: push de prueba `{"delivered":1,"failed":0}` y notificación recibida en el teléfono. |
| Prioridad / TTL | Envío con `Urgency: high` y `TTL: 3600` (antes prioridad normal y 60 s: Android en Doze retenía el mensaje y expiraba antes de llegar). |
| Errores | Se lee `PushMessageError.response.status`; se registra código + respuesta del push service; 404/410 marcan la suscripción como `revoked_at`. |
| Cliente | `enablePush` compara `subscription.options.applicationServerKey` con la clave pública actual; si difiere, desuscribe y vuelve a suscribir (evita 403 silenciosos tras rotar claves). |

Commit: `9171733 fix(intercom-push): entrega fiable de notificaciones en Android`.

---

## 3. Mejoras de la notificación (2026-11-05)

| # | Mejora | Implementación |
|---|---|---|
| 1 | **Remitente y texto del mensaje** | El trigger `intercom_enqueue_push` (pg_net) solo envía `id`, `primary_device_id` y `sender_device_id`, así que la función lee `sender_name`, `sender_role`, `message` y `created_at` de `device_messages` por `id` (service role). Envía `title = sender_name` y `body = message`, en lugar del genérico "Nuevo mensaje · Intercomunicador / Tienes un mensaje nuevo". El texto se ve en la pantalla de bloqueo. |
| 2 | **Badge monocromo** | `badge: /intercom-badge.png` (burbuja de chat blanca sobre transparente, 96×96). Antes se usaba `apple-touch-icon.png` y Android lo pintaba como un cuadro sólido. El icono grande sigue siendo el logo. |
| 3 | **Agrupación y aviso por cada mensaje** | Una notificación por conversación (`tag = intercom-<primary>`). Si ya existe, se reemplaza por "N mensajes nuevos · Intercomunicador" con las últimas 5 líneas `Remitente: texto` (vista expandida). `renotify: true` → suena/vibra con cada mensaje. Sin `topic` en FCM, para que no se descarten mensajes intermedios. |
| 4 | **Urgencia** | `vibrate: [300, 120, 300, 120, 300]`, `silent: false`, `requireInteraction: true` (queda en pantalla hasta tocarla o deslizarla) y `timestamp` = hora real del mensaje (`created_at`). |
| 5 | **Botones de acción** | "Abrir chat" y "Marcar como leído". |

### "Marcar como leído" sin abrir la app
La función incluye en el payload `read = { url, key (anon), primaryDeviceId, readerDeviceId, messageId, createdAt }`. El SW hace un upsert REST a `device_message_reads` (`on_conflict=primary_device_id,reader_device_id`). La RLS (`intercom_reads_member_insert/update`) solo lo permite si el lector es miembro activo del vínculo. Después avisa a las pestañas abiertas (`INTERCOM_PUSH`) para que recalculen el contador de no leídos.

### Reinicio del contador
Cuando la app guarda la lectura (`persistReadCursor`), cierra las notificaciones con el tag de la conversación. Deslizar la notificación también la reinicia.

### Formato del payload (Edge Function → SW)
```json
{
  "title": "Supervisor",
  "body": "Ok, ya cerré la caja 2",
  "tag": "intercom-<primary_device_id>",
  "url": "/?intercom=1&conversation=<primary_device_id>",
  "timestamp": 1762371988000,
  "read": {
    "url": "https://<ref>.supabase.co",
    "key": "<anon key>",
    "primaryDeviceId": "<primary_device_id>",
    "readerDeviceId": "<device_id del receptor>",
    "messageId": "<uuid>",
    "createdAt": "<ISO>"
  }
}
```
El SW tolera payloads antiguos (sin `read` ni `timestamp`): muestra solo "Abrir chat".

### Limitaciones conocidas
- Responder escribiendo desde la notificación (inline reply) no existe en Web Push.
- Si la conversación está **visible** en la app, no se muestra notificación (se refresca el chat).
- `vibrate` y `actions` dependen del navegador; iOS (PWA instalada) ignora parte de estas opciones.

---

## 4. Sonido de las notificaciones

### App abierta (chat cerrado o en otra vista)
`IntercomWidget` llama a `soundService.playIntercomAlert()`, que:
- **siempre suena**, aunque los sonidos de la app estén silenciados (`dj_sound_enabled = 'false'` no aplica al intercomunicador);
- toca dos ráfagas de tres tonos con onda cuadrada, ganancia 1.0 y un compresor (volumen percibido máximo sin distorsión);
- vibra `[200, 100, 200]`.

El volumen final también depende del volumen multimedia del teléfono. El navegador solo permite audio después de que el usuario haya tocado la pantalla al menos una vez en esa sesión (política de autoplay).

### App cerrada o en segundo plano (Web Push)
**Web Push no permite elegir sonido ni volumen.** La notificación usa el sonido del canal de notificaciones de Android asignado al sitio o a la PWA instalada. Desde el código solo se garantiza `silent: false`, `renotify: true` y la vibración. Para que suene fuerte, en cada teléfono:

1. **PWA instalada:** Ajustes → Aplicaciones → *Donde Juancho* → Notificaciones.
   **En Chrome sin instalar:** Chrome → Configuración → Notificaciones → `dondejuanchopos.vercel.app`.
2. Poner la categoría en **Alerta / Sonido** (no "Silencio"), activar **Mostrar en pantalla emergente** y elegir un tono fuerte.
3. Subir el **volumen de notificaciones** del teléfono (no el multimedia).
4. Excluir la app o Chrome del **ahorro de batería** (Ajustes → Batería → Sin restricciones) y revisar que "No molestar" no la silencie.

---

## 5. Runbook

### Ver por qué no llega un push
Logs de la función (Supabase → Edge Functions → `intercom-push` → Logs), o por API:
```sql
select timestamp, event_message from logs
where source = 'function_logs' order by timestamp desc limit 30
```
| Log | Significado | Acción |
|---|---|---|
| `push 403 … VAPID credentials …` | Claves VAPID servidor ≠ cliente. | Alinear `INTERCOM_VAPID_KEYS_JSON` con `VITE_INTERCOM_VAPID_PUBLIC_KEY`, y luego desactivar/activar push en los equipos. |
| `push 404` / `push 410` | Suscripción muerta; se marca `revoked_at` automáticamente. | Reactivar push en ese equipo. |
| Sin líneas `push …` y `delivered: 0` | El receptor no tiene suscripción, o no es miembro activo del vínculo. | Revisar `device_push_subscriptions` y `device_monitors`. |
| `sender validation failed` / `active members lookup failed` | Error en las RPC de Supabase. | Revisar `intercom_is_active_member` / `intercom_active_members`. |

### Rotar claves VAPID (solo si es imprescindible)
1. `deno run -A scripts/generate-intercom-vapid.ts` → escribe `.intercom-vapid-private.json` e imprime la clave pública.
2. Actualizar **ambos lados a la vez**:
   - Vercel: `VITE_INTERCOM_VAPID_PUBLIC_KEY` = clave pública, y redeploy.
   - Supabase: `npx supabase secrets set --project-ref kcananrtcmckovdstvao INTERCOM_VAPID_KEYS_JSON="$(cat .intercom-vapid-private.json)"`.
3. En cada equipo: abrir la app y activar push (el cliente detecta la clave distinta y se vuelve a suscribir).

### Desplegar la función
```bash
npx supabase functions deploy intercom-push --project-ref kcananrtcmckovdstvao --no-verify-jwt
```
`--no-verify-jwt` es obligatorio: el webhook se autentica con `x-intercom-webhook-secret`, no con JWT.

### Prueba manual
Enviar un mensaje desde otro miembro del vínculo, con el teléfono receptor bloqueado o con la app en segundo plano. Para una prueba sin escribir mensaje, se puede reenviar al webhook un `INSERT` con un `device_messages` existente (header `x-intercom-webhook-secret`); la respuesta indica `{"delivered": n, "failed": m}`.

---

## 6. Distinguir participantes en el chat (v1.1.6)

| Mejora | Detalle |
|---|---|
| **Color por persona** | Se calcula con un hash del `sender_device_id`, no del nombre: cada persona tiene el mismo color en todos los equipos aunque renombre su dispositivo. Paleta de 8 tonos medios (`src/utils/intercomIdentity.js`), legibles con fondo claro y oscuro. Se aplica al nombre y al borde izquierdo de la burbuja. |
| **Avatar con iniciales** | Círculo de color sólido con iniciales blancas ("Luis Medina" → `LM`, "Kelman" → `KE`). |
| **Etiqueta "Caja"** | Junto al nombre en los mensajes con `sender_role = 'pos'`. |
| **Mensajes agrupados** | Los mensajes seguidos de la misma persona, a 5 minutos o menos uno de otro, no repiten nombre ni avatar y van más juntos. |

Los mensajes propios no cambian: a la derecha, en índigo y sin nombre.

---

## 7. Editar mensajes enviados

Como en WhatsApp: en tus propios mensajes aparece **✏️ Editar** junto a la hora. Al tocarlo, el campo de escritura entra en modo edición, con un aviso "Editando mensaje" que muestra el texto original. Enter o ✓ guarda; Esc o ✕ cancela. El mensaje editado muestra **"Editado"** junto a la hora.

| Regla | Dónde se valida |
|---|---|
| Solo el dispositivo que envió el mensaje puede editarlo. | Servidor (`intercom_edit_message`) y cliente (`canEditMessage`). |
| Solo hasta **15 minutos** después de enviarlo. Pasado ese tiempo, el botón desaparece solo (el reloj del modal se actualiza cada 30 s). | Servidor y cliente (`INTERCOM_EDIT_WINDOW_MS`). |
| De 1 a 160 caracteres. | Servidor (CHECK de la tabla + RPC) y cliente (`validateMessage`). |
| El dispositivo debe seguir siendo miembro activo del vínculo. | Servidor. |
| Los mensajes que se están enviando o que fallaron no se editan. | Cliente. |

- **Base de datos:** `supabase_intercom_edit_message.sql` agrega `device_messages.edited_at` y la RPC `intercom_edit_message(p_primary, p_device, p_message_id, p_message)`. Si el texto no cambia, no se marca como editado.
- **Tiempo real:** los demás equipos ven la edición al instante por el evento `UPDATE` de Realtime (v1.1.5).
- **Push:** editar **no** envía notificación, porque el trigger de push es `AFTER INSERT`.
- **Orden de despliegue:** aplicar el SQL **antes** de publicar el cliente. El cliente lee la columna `edited_at`, y sin ella la carga del chat falla.
