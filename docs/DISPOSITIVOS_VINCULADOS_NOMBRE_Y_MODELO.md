# Dispositivos vinculados — modelo, sistema operativo y nombre editable

> **Fecha:** 2026-11-05
> **Alcance:** modal "Vincular Dispositivos" (pestaña *Dispositivos*) del modo Supervisor y nombre con el que cada supervisor firma en el intercomunicador.
> **Relacionado:** [`INTERCOMUNICADOR_PUSH_NOTIFICACIONES.md`](INTERCOMUNICADOR_PUSH_NOTIFICACIONES.md)

---

## Qué hace

| Antes | Ahora |
|---|---|
| Todos los equipos aparecían como "Supervisor Remoto" con el mismo icono de teléfono. | Cada equipo muestra un icono según su sistema (teléfono, monitor o laptop) y una línea con **sistema y modelo**, por ejemplo `Android 14 · SM-A325M`, `Windows 11` o `iOS 18 · iPhone`. |
| El nombre solo se podía poner al vincular. | Botón ✏️ junto al nombre para **renombrar** cualquier equipo del vínculo, incluido el propio. Máximo 40 caracteres. |
| El intercomunicador firmaba con el nombre del usuario que inició sesión. | Firma con el **nombre del dispositivo**. Si el equipo sigue llamándose "Supervisor Remoto", usa el nombre del usuario, como antes. |

## Cómo se obtiene el modelo

Chrome envía un *user agent reducido* (`Android 10; K`) que oculta el modelo y la versión real. Por eso cada dispositivo los consulta en su propio navegador con `navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion'])` y los reporta a la nube cada vez que abre el modo Supervisor.

| Navegador / sistema | Qué se ve |
|---|---|
| Chrome / Edge en Android | Versión de Android + modelo real (p. ej. `SM-A325M`, `Pixel 10`). |
| Chrome / Edge en Windows | `Windows 10` o `Windows 11` (según `platformVersion`). |
| Safari en iPhone / iPad | `iOS 18 · iPhone` / `iPadOS · iPad`. Apple no expone el modelo exacto. |
| Firefox | Sistema según el user agent, sin modelo. |
| Equipos que aún no abrieron la versión nueva | Lo que se pueda deducir del `user_agent` guardado al vincular. |

El valor que envía Android en `model` es el código del fabricante (por ejemplo `SM-A325M` = Galaxy A32). No se traduce a nombre comercial.

## Base de datos — `supabase_monitor_device_info.sql`

Script idempotente. Ejecutarlo en el SQL Editor de Supabase o con la Management API.

| Objeto | Cambio |
|---|---|
| `device_monitors.device_platform` | Nueva columna: sistema y versión (`Android 14`, `Windows 11`…). |
| `device_monitors.device_model` | Nueva columna: modelo reportado por el equipo. |
| `list_monitors(p_requester_id)` | Misma autorización; ahora también devuelve `device_platform` y `device_model`. |
| `rename_monitor(p_requester_id, p_target_monitor_id, p_label)` | **Nueva.** Autoriza igual que `revoke_monitor` (la caja o un monitor activo del mismo vínculo). Normaliza espacios, exige 1–40 caracteres y actualiza el `sender_name` de los mensajes ya enviados por ese dispositivo (`messages_renamed` en la respuesta). |
| `report_monitor_device_info(p_monitor_device_id, p_platform, p_model, p_user_agent)` | **Nueva.** El propio monitor actualiza su sistema, modelo y user agent. Solo afecta filas no revocadas. |

## Código

| Archivo | Rol |
|---|---|
| `src/utils/deviceInfo.js` | `parseUserAgent`, `detectDeviceInfo` (client hints), `describeDevice` (texto e icono para la lista) y `DEFAULT_MONITOR_LABEL`. |
| `src/hooks/useOwnDeviceLabel.js` | Al montar el modo Supervisor, reporta sistema/modelo y lee el nombre propio con `list_monitors`. Lo guarda en `localStorage` (`dj_device_label`) y emite `dj-device-label-changed`. |
| `src/components/Monitor/SupervisorPairingModal.jsx` | Icono por sistema, línea de modelo y edición del nombre (Enter guarda, Esc cancela). Si se renombra el propio equipo, actualiza el nombre del intercomunicador al instante. |
| `src/views/OwnerMonitorView.jsx` | `senderName` del intercomunicador = nombre del dispositivo, o el usuario si sigue en "Supervisor Remoto". |
| `src/components/PairingScanScreen.jsx` | Guarda el nombre elegido al vincular en `dj_device_label`. |
| `tests/deviceInfo.test.js` | Pruebas de detección y formato. |

## Notas

- Al renombrar, `rename_monitor` también actualiza `sender_name` en los mensajes que ese dispositivo ya envió en el vínculo, así que el historial muestra el nombre nuevo. No envía notificaciones: el trigger de push solo se dispara en INSERT. Si el chat está abierto en otro equipo, el nombre nuevo se ve al recargar o reabrir el chat.
- Si otro supervisor renombra tu equipo, el cambio se ve en tu intercomunicador la próxima vez que abras el modo Supervisor.
- La caja principal no aparece en esta lista (no es un monitor), así que su nombre en el intercomunicador no cambia con esta función.
