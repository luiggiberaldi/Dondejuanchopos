# Plan Mejorado de Sincronización y Resiliencia Supervisor ↔ Caja (Bajo Riesgo)

> **Proyecto:** Donde Juancho POS & Supervisor  
> **Fecha de Consolidación:** 4 de octubre de 2026  
> **Estado:** **APROBADO TRAS AUDITORÍA TÉCNICA**. Listo para implementación por fases. Re-auditado el 4-oct-2026 contra el código y la base de pruebas (ver §5): 3 correcciones al documento, baseline 103/104 verde salvo el test que el Paso 1 ya contempla.  
> **Alcance:** Exclusivamente cliente (React/PWA/Hooks/Utils). **Sin DDL, sin migraciones en Supabase, sin escrituras manuales en producción, sin tocar datos contables.**  
> **Dispositivo Central:** Sunmi V2 / Caja Principal (`PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F` / `DJ-V2-...`).

---

## 1. Diagnóstico Consolidado y Mecanismos de Falla

### 1.1 Hecho Principal: Retraso de 5 Minutos en Subida tras Re-emparejamiento
* **Cronología Registrada (4-oct-2026):**
  - Venta #763 sincronizada a las 14:38:03 UTC.
  - Re-emparejamiento a las 14:41:01 UTC (`device_pairings.monitor_device_id` actualizado en la nube).
  - Entre 14:41 y 14:46:11 UTC la caja no subió ningún documento (ni ventas ni carrito).
  - A las 14:46:12 UTC, los 12 documentos se vaciaron juntos en una ráfaga de 1.8 segundos.
* **Causa Raíz Verificada en Código:**
  - `src/utils/cloudRetry.js:7-8`: El código de error Postgres `P0001` está clasificado en `PERMANENT_DATABASE_CODES` y `GLOBAL_DATABASE_CODES`.
  - Cuando `read_paired_audit_documents` o una subida falla con 400 (`P0001`), `recordCloudRetryFailure` aplica `PERMANENT_RETRY_BASE_MS = 5 * 60 * 1000` (5 minutos exactos, sin jitter) sobre `sync:${activeDeviceId}`.
  - `src/hooks/useCloudSync.js:178-179`: `if (globalRetry.coolingDown) return false;` congela **todos los documentos de la caja** durante exactamente 300 segundos.
  - Al expirar el enfriamiento a los 5 minutos, el tick periódico (`forcePushLocalData`, 60 s) libera todos los documentos acumulados de golpe.

### 1.2 Hecho Secundario: Numeración Provisional por Desincronización de Caché
* **Causa Raíz Verificada en Código:**
  - `src/utils/salesPushMerge.js:103`: `resolveMonitorDeviceId` almacena en `localStorage` la clave `dj_cloud_merge_monitor_id_${deviceId}` sin TTL ni invalidación.
  - `src/utils/saleNumberAllocator.js:41`: Contiene una **copia duplicada** que cachea bajo `dj_cloud_merge_monitor_id` (sin sufijo).
  - Al re-emparejar el Supervisor, la base de datos tiene el nuevo ID, pero la caja sigue llamando con el ID antiguo.
  - Postgres devuelve HTTP 400 `{"code":"P0001","message":"REMOTE_AUDIT_PAIRING_REQUIRED"}`.
  - La función `fetchCloudSalesReference` captura el fallo en silencio y devuelve `null`.
  - `saleNumberAllocator.js` no puede obtener la referencia canónica y cae al máximo local con `provisional: true`. La caja no se detiene, pero numera en provisional hasta que la caché se limpie.

### 1.3 Hecho Terciario: Pérdida del Latido de Presencia en Terminales Sunmi (467 min)
* **Causa Raíz Descubierta en Auditoría:**
  - `src/hooks/useCloudSync.js:774`: En `schedulePresence`, si `!navigator.onLine` es verdadero, la función retorna de inmediato **sin programar ningún temporizador**.
  - El código espera despertar exclusivamente con `window.addEventListener('online', handlePresenceOnline)`.
  - En terminales Android Sunmi V2 (y WebViews en redes comerciales), cuando el router Wi-Fi mantiene el enlace local activo pero se interrumpe la salida a internet, Chromium **no siempre dispara el evento `online`** al restaurarse la conectividad WAN.
  - El único otro punto que reactiva la presencia es el cambio de pestaña (`handlePresenceVisibility`), pero en un terminal de caja dedicado la app opera a pantalla completa y nunca pasa a segundo plano.
  - **Resultado:** La cadena del latido muere en memoria y no vuelve a ejecutarse hasta reiniciar la aplicación.

### 1.4 Hecho Cuarto: Fallbacks de Comandos del Supervisor (`applied_at` nulo y `pending` perpetuos)
* **Causa Raíz Verificada en Código:**
  - `src/hooks/useSupervisorCommands.js:85-111`: Si el `UPDATE` completo con `{ status, applied_at, error_reason }` falla, un fallback reintenta con solo `{ status }`. Si el fallback tiene éxito, devuelve `true` y la fila queda en Supabase como `applied` pero con `applied_at = NULL` (364 casos históricos, 32%).
  - `src/hooks/useSupervisorCommands.js`: hay **dos caminos** que entierran el comando. Para `update_customer_balance` el exacto es `:357-360`: `appliedIds.add` + `markApplied` + `await updateCommandStatus(command.id, 'applied')` **sin comprobar el resultado**; como el ID queda en `appliedIds`, el dedup de `:227` lo salta en cada ciclo para siempre. El patrón equivalente para inventario genérico está en `:706-714` (con `isReappliableCommand`). En ambos casos el comando queda `pending` en la nube sin reintento ni confirmación.

---

## 2. Plan Mejorado y Fases de Implementación

Las fases se ordenan por criticidad y desacoplamiento. Se descarta la antigua Fase C para proteger la estabilidad operativa.

```
┌──────────────────────────────────────────────────────────┐
│ FASE 1: Reducción del Candado Global de 5 min (cloudRetry)│ ◄── Prioridad 1
└──────────────────────────┬───────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│ FASE 2: Unificación y Auto-recuperación de Caché Pairing │ ◄── Prioridad 2
└──────────────────────────┬───────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│ FASE 3: Ventana de Pull del Supervisor (30 s)            │ ◄── Prioridad 3
└──────────────────────────┬───────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│ FASE 4: Latido de Presencia Autosostenido (Sunmi Guard)  │ ◄── Prioridad 4
└──────────────────────────┬───────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│ FASE 5: Confirmación Segura de Comandos (Saldo Protegido)│ ◄── Prioridad 5
└──────────────────────────────────────────────────────────┘
```

---

### FASE 1 — Eliminación del Candado Global de 5 Minutos ante Errores de Vínculo
* **Archivos:** `src/utils/cloudRetry.js`, `src/hooks/useCloudSync.js`
* **Objetivo:** Evitar que un error transitorio de emparejamiento congele todas las subidas de la caja durante 300 segundos.
* **Cambios:**
  1. **Diferenciación de Errores en `isPermanentCloudError`:** Errores con mensaje `REMOTE_AUDIT_*` o errores de emparejamiento no deben tratarse como fallos permanentes globales de esquema (`5 min - 6 h`). Deben usar backoff transitorio corto (15 s, 30 s).
  2. **Tope al Candado Global por Dispositivo (`sync:${deviceId}`):** Limitar el retraso global por dispositivo a un máximo de **60 segundos (1 tick)** para errores no fatales de sincronización, preservando el backoff largo únicamente para credenciales definitivamente inválidas (HTTP 401/403).
  3. **Auto-limpieza al Verificar Vínculo:** Si la caja detecta que `device_pairings` está activo y sano, ejecutar `clearCloudRetryFailure('sync:' + activeDeviceId)` inmediatamente.

---

### FASE 2 — Unificación y Auto-recuperación de Caché de Emparejamiento
* **Archivos:** `src/utils/salesPushMerge.js`, `src/utils/saleNumberAllocator.js`
* **Objetivo:** Eliminar claves duplicadas, detectar desincronización de monitor y auto-recuperar la referencia cloud sin intervención del cajero.
* **Cambios:**
  1. **Unificación de la Resolución de Monitor:**
     - Exportar `resolveMonitorDeviceId` e `invalidateMonitorDeviceCache(deviceId)` desde `src/utils/salesPushMerge.js`.
     - Eliminar la función duplicada y la constante `MONITOR_CACHE_KEY = 'dj_cloud_merge_monitor_id'` de `src/utils/saleNumberAllocator.js`. Ambos módulos deben consumir la misma función y la misma clave con sufijo (`dj_cloud_merge_monitor_id_${deviceId}`).
     - La función de invalidación debe limpiar ambas claves por compatibilidad defensiva.
     - Nota de auditoría: `resolveMonitorDeviceId(deviceId, client)` hoy no acepta opciones (`salesPushMerge.js:116`); el snippet del punto 2 asume un tercer parámetro `{ bypassCache: true }` que hay que añadir.
  2. **Auto-sanación ante Error `REMOTE_AUDIT_PAIRING_REQUIRED`:**
     - En `fetchCloudSalesReference`, inspeccionar el objeto `error` de la llamada RPC:
       ```js
       if (error) {
           const msg = String(error.message || '');
           if (msg.includes('REMOTE_AUDIT_PAIRING_REQUIRED') || msg.includes('REMOTE_AUDIT_')) {
               console.warn('[SalesPushMerge] Vínculo desactualizado en caché. Re-resolviendo con device_pairings...');
               invalidateMonitorDeviceCache(deviceId);
               // Reintento único e inmediato
               const freshMonitorId = await resolveMonitorDeviceId(deviceId, client, { bypassCache: true });
               if (freshMonitorId) {
                   const retry = await client.rpc(READ_RPC, {
                       p_primary_device_id: deviceId,
                       p_monitor_device_id: freshMonitorId,
                       p_doc_ids: [SALES_CLOUD_CACHE_KEY],
                   });
                   if (!retry.error && Array.isArray(retry.data) && retry.data.length > 0) {
                       return retry.data[0]?.data?.payload || null;
                   }
               }
           }
           console.warn(`[SalesPushMerge] RPC error (${error.code}):`, error.message);
           return null;
       }
       ```
  3. **UX Limpia (Cero Falsas Alarmas al Cajero):**
     - Si la auto-recuperación funciona, **no emitir ningún aviso de recarga**. La caja continúa operando de forma transparente.
     - Solo registrar en consola técnica si el segundo intento también falla porque la tienda carece de emparejamiento activo.

---

### FASE 3 — Reducción de la Ventana de Catch-up del Monitor (3 min → 30 s)
* **Archivos:** `src/hooks/useMonitorSync.js`, `tests/monitorSyncRecovery.test.js`
* **Objetivo:** Acortar la visibilidad de ventas en el Supervisor a menos de 30 segundos sin depender del canal Realtime.
* **Cambios:**
  1. En `src/hooks/useMonitorSync.js:20`:
     `const MONITOR_HEALTHY_PULL_INTERVAL_MS = 30 * 1000;` (antes 180.000 ms).
  2. **Verificación de Eficiencia:** La consulta incremental envía `p_updated_after: updatedAfter`. Cuando no hay ventas nuevas, el servidor devuelve `[]` (< 1 KB de transferencia y ~100 ms de ejecución).
  3. **Actualización de la Suite de Pruebas:**
     En `tests/monitorSyncRecovery.test.js:90-99`:
     Ajustar el paso de tiempo de `tick(30000)` a `tick(10000)` para verificar que no hay llamadas prematuras antes de los 30 s, alineando el test con la nueva constante.

---

### ⚠️ FASE DESCARTADA (Antigua Fase C) — NO APLICAR
* **Motivo Técnico:**
  El plan original proponía que si no llegan eventos de WebSocket, la app considere la conexión como "no sana" y entre en sondeo forzado cada 10 segundos marcando la UI como "desconectada".
* **Riesgos Confirmados en Auditoría:**
  1. Realtime no entrega eventos a `anon`. La app consideraría la conexión permanentemente rota.
  2. Forzaría 8.640 consultas diarias por monitor abierto cada 10 s sin necesidad.
  3. El Supervisor mostraría falsamente un banner rojo de "Desconectado" a pesar de estar recibiendo todas las ventas vía HTTP cada 30 segundos.
* **Decisión:** **Descartada formalmente**. La Fase 3 (30 s) resuelve el requerimiento de forma óptima y sin estrés de red.

---

### FASE 4 — Cadena de Latido Autosostenida (Sunmi Kiosk Guard)
* **Archivos:** `src/hooks/useCloudSync.js`
* **Objetivo:** Impedir que el latido de presencia muera de forma definitiva ante micro-cortes de red en terminales Sunmi V2.
* **Cambios:**
  1. En `src/hooks/useCloudSync.js:771-780` (`schedulePresence`):
     - No retornar inmediatamente si `!navigator.onLine`.
     - Si la red está temporalmente inaccesible o el chequeo falla, programar un reintento seguro con backoff (ej. `Math.max(delay, 30000)`).
  2. Al disparar el timer, `pingPosPresence` volverá a evaluar el estado de la conexión. Si la conectividad WAN se restauró, el latido continuará sin depender de si el sistema operativo emitió o no el evento `online`.
  3. Mantener intacto el guardarraíl de identidad `if (!isCurrent()) return;` para no revivir latidos de sesiones destruidas.
  4. **Corrección obligatoria (auditoría):** en `pingPosPresence` los retornos tempranos por `!navigator.onLine` (`useCloudSync.js:782`) ocurren **antes** del `try/finally`, de modo que no rearman la cadena. Si solo se modifica `schedulePresence`, el reintento de 30 s es un único disparo: si la red sigue caída, la cadena vuelve a morir. El `return` de `:782` debe reprogramar el latido (p. ej. `schedulePresence(30000)`); es seguro porque `schedulePresence` ya valida `isCurrent()`.

---

### FASE 5 — Blindaje de Confirmación de Comandos y Protección de Saldos
* **Archivos:** `src/hooks/useSupervisorCommands.js`
* **Objetivo:** Resolver los 364 comandos sin hora (`applied_at`) y evitar que fallos de red dejen comandos `pending` para siempre.
* **Salvaguarda Absoluta de Negocio (Regla de Oro de Clientes):**
  > [!IMPORTANT]
  > Un comando de tipo `update_customer_balance` ya aplicado en la base de datos local IndexedDB **NUNCA DEBE RE-EJECUTARSE** sobre el saldo del cliente durante un reintento. El reintento es **exclusivamente de confirmación en la nube (`updateCommandStatus`)**.
* **Cambios:**
  1. **Reintento Acotado de Confirmación:**
     - En `updateCommandStatus`, si el update falla por error de red o timeout, realizar hasta 3 reintentos con esperas cortas (3 s, 6 s, 12 s) antes de desistir.
     - Registrar explícitamente en el log `error.code` y `error.message` para auditoría RLS.
  2. **Manejo Seguro de `appliedIds`:**
     - Si el comando se aplicó localmente en IndexedDB pero falló la confirmación en la nube tras los reintentos:
       - **NO** eliminarlo de `appliedIds` (para no duplicar cobros o abonos).
       - Despachar un evento local visible para el Supervisor indicando que la operación está activa localmente pero pendiente de confirmación en el servidor.
  3. **Tratamiento del Fallback `{ status }`:**
     - Si la columna `applied_at` fuese rechazada por esquema o permisos, registrar una advertencia estructurada y no reportar éxito ciego.
  4. **Notas de auditoría:**
     - El reintento vive dentro de `updateCommandStatus`, que el catch-up llama en secuencia: acotarlo a errores transitorios (red/timeout/408/425/429/5xx) para no sumar hasta 21 s de espera por cada comando fallido en la cola.
     - El evento local del punto 2 es efímero (muere al recargar la página). Persistir la marca — un tercer intento que escriba solo `error_reason`, o una clave en `localStorage` — para que "pendiente de confirmación" sobreviva al reinicio.

---

### 🔧 Corrección de Test Preexistente en el Repositorio
* **Archivo:** `tests/salesHistoryRestoreWiring.test.js:71`
* **Problema Actual:**
  El test falla porque busca con regex `/if \(!fresh && _refCache\.payload/`, pero el código en `salesPushMerge.js:156` incluye la validación de dispositivo `_refCache.deviceId === deviceId`.
* **Solución:** Flexibilizar la expresión regular en el test a `/if \(!fresh && .*_refCache\.payload/` para que valide la omisión de la caché TTL ante `fresh: true` sin acoplarse estrictamente al orden de los operandos.

---

## 3. Matriz de Riesgos y Guardarraíles

| Fase | Riesgo Identificado | Guardarraíl Mandatorio Implementado |
|---|---|---|
| **Fase 1** | Bucle de reintentos rápidos contra errores de autenticación reales. | Errores 401/403 preservan el backoff largo (`PERMANENT_RETRY_BASE_MS`). Solo se alivia `P0001` de emparejamiento. |
| **Fase 2** | Borrado accidental de caché válida durante caídas de red normales. | La invalidación solo se activa si `error.message` contiene explícitamente `REMOTE_AUDIT_PAIRING_REQUIRED`. Errores de red/timeout no tocan la caché. |
| **Fase 3** | Sobrecarga de peticiones en Supabase. | Verificado en auditoría: lecturas incrementales con `p_updated_after` devuelven 0 KB cuando no hay ventas nuevas. |
| **Fase 4** | Generación de latidos zombies tras cambio de dispositivo o logout. | Se mantiene `if (!isCurrent()) return;` en todos los puntos de entrada del heartbeat. |
| **Fase 5** | Duplicación de abonos o desajuste de saldo en clientes (caso Jose Gregorio). | La ejecución del abono en IndexedDB es única; los reintentos aplican solo sobre la fila en `supervisor_commands`. |

---

## 4. Estrategia de Rollout y Verificación

1. **Paso 1:** Corregir el regex en `tests/salesHistoryRestoreWiring.test.js` y confirmar suite base 100% verde.
2. **Paso 2:** Implementar **Fase 1 y Fase 2** (resuelve la causa raíz del retraso y la numeración provisional).
3. **Paso 3:** Implementar **Fase 3** (ventana de 30 s en Supervisor y ajuste de su test). Antes, medir una vez el tamaño real de una lectura incremental sin ventas nuevas: la cifra "0 KB" está afirmada, no medida.
4. **Paso 4:** Implementar **Fase 4** (resiliencia del latido en Sunmi).
5. **Paso 5:** Implementar **Fase 5** (confirmación robusta de comandos).
6. **Validación Operativa Final:**
   - Ejecutar `bunx vitest run` (deben pasar todas las suites de sync, presencia y comandos).
   - Ejecutar `bun run build` (confirmar compilación y generación de Service Worker sin advertencias).
   - Simular re-emparejamiento en entorno de desarrollo y constatar que la siguiente venta numera desde la nube en menos de 5 segundos.

---

## 5. Acta de auditoría de esta versión (4-oct-2026, 20:30)

El archivo fue re-consolidado a las 20:02 (210 líneas, 5 fases). Se re-auditó contra el código imprimiendo cada cita y comparándola con el archivo correspondiente, y ejecutando la base de pruebas.

| Verificación | Resultado |
|---|---|
| Citas de §1.1 (candado de 5 min) | ✅ `cloudRetry.js:7-8` (`P0001` en ambos sets), `PERMANENT_RETRY_BASE_MS` = 5 min sin jitter (`:61-62`), candado global `useCloudSync.js:178-179` sobre `sync:<device>`, tick de 60 s (`:748`) |
| Citas de §1.2 (doble caché) | ✅ clave con sufijo (`salesPushMerge.js:103,118`) vs. sin sufijo (`saleNumberAllocator.js:41,102,109`); error tragado en `:173`; fallback provisional `saleNumberAllocator.js:236-245` |
| §1.3 (latido) | ✅ mecanismo real: `schedulePresence` no arma si `!navigator.onLine` (`:774`); reactivación solo por `online` (`:882`) o `visibilitychange` (`:886`); `pingPosPresence` solo se invoca desde timer, `online`, `visibility` y el arranque (`:778/:860/:871/:881`). El corte de 467 min sigue sin reproducirse: es lectura de código, no reproducción |
| §1.4 | ⚠️ mecanismo real, cita imprecisa para `update_customer_balance` — corregida a `:357-360` + dedup `:227` |
| FASE 1 | ✅ implementable tal cual. `isPermanentCloudError` existe (`cloudRetry.js:34`) |
| FASE 2 | ✅ implementable; añadida nota del parámetro `bypassCache` |
| FASE 3 | ⚠️ implementable; medición de egreso pendiente (afirmada, no medida). El test afectado es `:90-99` y el ajuste propuesto lo resuelve |
| FASE 4 | ⚠️ incompleta tal como estaba escrita — añadido punto 4 (rearmar desde `:782`) |
| FASE 5 | ✅ viable; añadidas 2 notas (acotar reintentos a errores transitorios, persistir la marca) |
| FASE descartada (antigua C) | ✅ decisión correcta e independiente de la causa raíz del Realtime, que sigue sin verificarse (publicación nunca consultada) |
| Test preexistente roto | ✅ **reproducido**: `salesHistoryRestoreWiring.test.js:71` falla (1 failed / 103 passed en 6 suites, 65.6 s). El regex propuesto sí matchea el código real de `salesPushMerge.js:156` |
| Despliegue | ⚠️ el build instalado en las PCs es anterior a `7bdda75` — nada llega a campo sin build nueva por terminal |

**Veredicto: LISTA para implementar** en el orden del §4, con la Fase 4 corregida (punto 4) y la medición de la Fase 3 antes de activarla. Se sugiere adelantar la Fase 5 justo después de la 2: es la que protege saldos de clientes.

## 6. Implementación ejecutada (5-oct-2026, 01:2x UTC-4) — con punto de rollback

Implementadas las 5 fases + el Paso 1 sobre el commit sin errores documentado **`7bdda75`** (HEAD, 1-oct-2026: *"blindaje de storage durable, backoff de nube y medidor local de egress"*; `b96b732` verificado inválido). Cambios: **9 archivos, +224/−48 líneas**. Los archivos tocados estaban limpios vs HEAD.

| Fase | Resultado |
|---|---|
| Paso 1 | ✅ regex del test flexibilizado — suite base verde |
| FASE 1 | ✅ `isPairingLinkError` (REMOTE_AUDIT_*/POS_SYNC_DEVICE_NOT_REGISTERED ya no clasifican como permanentes), `shouldCapGlobalLock`, `GLOBAL_LOCK_MAX_MS` = 60 s exportados desde `cloudRetry.js`; candado global de `useCloudSync.js` acotado a 1 tick salvo 401/403/404/esquema; auto-limpieza del candado al confirmarse el latido |
| FASE 2 | ✅ `resolveMonitorDeviceId` única y exportada (opción `bypassCache`), `invalidateMonitorDeviceCache` limpia ambas claves, auto-sanación ante `REMOTE_AUDIT_*` en `fetchCloudSalesReference` con 1 reintento; duplicado eliminado de `saleNumberAllocator.js` |
| FASE 5 (adelantada) | ✅ reintentos de confirmación 3s/6s/12s **solo** transitorios (408/425/429/5xx/red); fallback `{status}` intacto; en los 3 puntos de entierro (`:357-360`, `:400-402`, `:706-714`) se registra `dj_unconfirmed_commands_v1` (persistente) + evento `supervisor_command_unconfirmed`; nunca se re-ejecuta el comando |
| FASE 3 | ✅ **medido antes de activar**: lectura incremental sin cambios = 0 filas / ~0 KB (HTTP 200, 248-766 ms) → 2.880 lecturas/día por monitor ≈ 0,01 MB/día; intervalo 3 min → 30 s y su test ajustado |
| FASE 4 | ✅ `schedulePresence` ya no abandona la cadena offline (piso 30 s) y el retorno temprano de `pingPosPresence` (`:782`) reprograma — la corrección obligatoria del punto 4 incluida; `!isCurrent()` preservado |
| Validación | ✅ **7 suites = 119 tests, exit 0** (antes 103/104) · `bun run build` exit 0 (PWA generada; advertencia de chunks preexistente) |

**Punto de rollback:** copias previas de los 9 archivos en `C:/tmp/auditoria/rollback-7bdda75/`. Para revertir TODO: `git checkout -- tests/salesHistoryRestoreWiring.test.js src/utils/cloudRetry.js src/hooks/useCloudSync.js src/utils/salesPushMerge.js src/utils/saleNumberAllocator.js src/hooks/useSupervisorCommands.js src/hooks/useMonitorSync.js tests/monitorSyncRecovery.test.js tests/saleNumberAllocator.test.js` (los restaura a `7bdda75`; no toca los 8 archivos sucios preexistentes ni este plan). Prueba de contrato de FASE 5 pendiente: no existe suite dedicada de `updateCommandStatus` — el reintento se validó por revisión y suites de regresión.