# Plan de fixeo práctico — Intercomunicador Caja ↔ Supervisores

## Objetivo y criterio

Dejar un chat de texto sencillo que funcione de forma fiable entre la caja y sus supervisores. Para un local pequeño, priorizamos **enviar, recibir y recuperar mensajes sin confusión**. No vamos a convertir esto en un proyecto de autenticación ni a retrasar el chat por extras.

Este plan reemplaza como guía de trabajo a la especificación extensa anterior. La implementación ya tiene piezas en el frontend, SQL y Push, pero eso **no significa que el flujo completo esté comprobado contra Supabase**.

**Proyecto Cloud/Sync confirmado por el usuario:** [https://kcananrtcmckovdstvao.supabase.co](https://kcananrtcmckovdstvao.supabase.co). Usar este proyecto para el SQL del chat y la función Push; no confundirlo con staging ni con el proyecto de licencias.

**Comprobación remota de solo lectura (10 oct 2026):** están las cinco tablas requeridas (incluidas las dos de pairing), las políticas de miembro, `device_messages` en Realtime y el trigger Push; `pg_net` está habilitado. La Edge Function `intercom-push` figura ACTIVE, versión 4 y `verify_jwt=false`; responde `405` a GET y `401` a POST sin secreto, coherente con el handler desplegado. En Vault existen los nombres `intercom_push_url` y `intercom_webhook_secret`, con valores no vacíos y URL con forma correcta. No se leyó ningún valor secreto. La clave pública local coincide con la derivada del par privado local; el secreto VAPID remoto no se puede leer para comparar criptográficamente. `pg_cron` no está habilitado, pero la limpieza programada no bloquea el chat MVP.

## Prioridades

### P0 — Que la conversación funcione (bloquea el uso diario)

1. **Esquema remoto comprobado.** La inspección read-only confirmó tablas de pairing y chat, políticas de miembros, Realtime y trigger en `kcananrtcmckovdstvao`. No repetir el SQL de instalación sin necesidad: incluye DDL y puede modificar objetos existentes.
2. **Probar con dos dispositivos reales o dos navegadores.** Uno como Caja y otro como Supervisor, emparejados a la misma caja. Enviar en ambos sentidos y confirmar que el mensaje aparece sin recargar; recargar y comprobar que sigue en el historial.
3. **Corregir los fallos que salgan en ese recorrido:** mensaje que no aparece, historial desordenado o vacío, canal que no reconecta, pairing incorrecto, o error de permisos. Mostrar un error entendible y un botón de reintento; no dejar la interfaz aparentando que el envío funcionó.
4. **Validar el flujo de lectura y envío.** Los no leídos pertenecen al dispositivo que los lee; leer desde un monitor no debe limpiar los del otro. El cursor avanza solo hasta mensajes realmente visibles. Si la red falla, permitir reintentar el mismo mensaje sin duplicarlo.
5. **Validar el uso cotidiano:** abrir/cerrar el chat, Enter para enviar, teclado táctil, textos con tildes y emoji, límite de 160 caracteres, botón de sincronizar de nuevo y retorno a la conversación desde `?intercom=1`.

Piezas actuales para revisar/fijar: [useDeviceIntercom](src/hooks/useDeviceIntercom.js), [IntercomModal](src/components/IntercomModal.jsx), [IntercomWidget](src/components/IntercomWidget.jsx), [intercomModel](src/utils/intercomModel.js), las integraciones en [App](src/App.jsx) y [OwnerMonitorView](src/views/OwnerMonitorView.jsx).

### P1 — Notificaciones con la app cerrada (después de aprobar P0)

6. El chat debe seguir funcionando aunque Push no esté configurado: Realtime y el historial son suficientes mientras la app está abierta. Push es un extra separado, con botón voluntario para activarlo; no pedir permiso automáticamente ni mostrarlo como activo si falla.
7. La configuración de servidor parece preparada (función activa, endpoint y secreto webhook en Vault), pero el flujo Push **no está probado de punta a punta**: la tabla tenía cero suscripciones activas y el permiso de notificaciones del navegador de prueba está denegado. Probar en un navegador/dispositivo con permiso concedido, suscribirlo desde la app y enviar desde otro miembro con la PWA cerrada. Hasta entonces dejar Push como pendiente y usar el chat abierto; no bloquear por ello la entrega de P0.
8. Al tocar una notificación debe abrirse el intercomunicador de la caja correcta. Si Push no está soportado o el usuario lo rechaza, indicarlo con claridad y mantener funcionando el chat dentro de la app.

Piezas actuales de Push: [Service Worker](public/intercom-push-sw.js), [Edge Function](supabase/functions/intercom-push/index.ts), [configuración Supabase](supabase/config.toml) y la integración Workbox en [vite.config.js](vite.config.js).

## Seguridad suficiente para este local

Mantener solo las barreras prácticas necesarias para evitar errores entre cajas:

- Consultar y escribir mensajes dentro del pairing activo de esa caja; comprobarlo en la prueba con dos cajas distintas y una desvinculada.
- No incluir claves `service_role` ni la clave VAPID privada en la app. No mandar por el chat contraseñas, datos de tarjetas ni información sensible de clientes.
- Mantener el límite de texto y los permisos básicos existentes. No añadir login nuevo, MFA, cifrado E2E, auditoría, políticas complejas ni infraestructura adicional para este chat.
- Si una regla de permisos impide el uso normal, corregir la regla y repetir la prueba; no quitar el aislamiento entre cajas para “hacerlo andar”.

## Qué no hacer ahora

No bloquear el chat por Cron, retención exacta de 48 horas, métricas de egress, presencia/heartbeats, reintentos durables de Push, soporte Electron, carga de mensajes antiguos, adjuntos, reacciones o funciones de autorización. El historial inicial de 30 mensajes es suficiente para empezar. Revisar el crecimiento real más adelante y agregar una limpieza simple solo si hace falta.

## Verificación y salida a uso

1. Ejecutar las pruebas existentes de modelo, hook y modal; agregar una prueba solo cuando reproduzca un fallo concreto de este recorrido.
2. Ejecutar build y ESLint de los archivos tocados.
3. Repetir la conversación en dos dispositivos conectados al proyecto Cloud/Sync `kcananrtcmckovdstvao`: enviar Caja → Supervisor y Supervisor → Caja, cerrar/abrir, refrescar, probar desconexión breve y revisar no leídos.
4. El usuario confirmó ese proyecto como el del local. Aplicar el esquema allí solo cuando se haya confirmado que el SQL terminó sin errores; no cambiar a staging ni al proyecto de licencias.
5. Declarar Push “listo” únicamente tras recibir y abrir una notificación con la app cerrada. Si no se prueba, reportarlo como pendiente, sin impedir usar el chat foreground.

## Dependencias y límites conocidos

- Las pruebas unitarias locales no prueban el chat entre dos dispositivos ni Push. La inspección remota confirmó tablas, políticas, Realtime y trigger en el proyecto Cloud/Sync correcto; no se envió un mensaje de prueba real ni se verificó una notificación recibida.
- Push cerrado depende de permisos, navegador, sistema operativo y configuración de Supabase; no prometer entrega garantizada.
- Por ahora el alcance es mensajes operativos breves entre la caja y sus supervisores. No es una herramienta para autorizar pagos ni sustituye la comunicación urgente cara a cara.
