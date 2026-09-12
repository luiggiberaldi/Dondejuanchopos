# 🛠️ PLAN MAESTRO DE FIXEO — Sincronización de Ventas y Convergencia Cloud

> **Incidencia raíz:** Las ventas del equipo principal dejan de llegar a la nube cuando su
> historial local queda truncado, porque el push de ventas es "todo o nada". Esto ya provocó
> 3 incidentes (08-09, 11-09, 12-09). Este plan elimina la causa estructural de forma
> permanente, en 4 fases.
>
> **Documentación base:** `.agents/AGENTS.md` §8 (blindajes actuales) y §9 (incidencia 12-09).
> **Estado inicial:** FASE 0 completa (12-09). FASE 1 lista para implementar.

---

## 🎯 Objetivo

Que **cada venta registrada en cualquier dispositivo autoritativo llegue a la nube en
minutos, sin intervención manual, sin riesgo de sobreescritura destructiva, y con
numeración única y coherente** — incluso si el dispositivo tiene un historial local
pequeño, estuvo offline, o hay más de una instancia operando.

---

## 📖 Contexto técnico (lo que existe hoy)

| Componente | Archivo | Estado actual |
|---|---|---|
| Push de ventas | `src/hooks/useCloudSync.js` (`pushCloudSyncNow`) | Push de array completo, bloqueado por circuit breaker si `cierres < 39` (PC principal) o `cierres < maxKnown` |
| Fusión defensiva | `src/utils/salesMerge.js` (`mergeSalesArrays`) | Union por `id`, preserva sellados — **ya existe y es sólida**, pero SOLO se usa en pull/monitor y en `storageService`, no en el push |
| Auto-recuperación local | `src/utils/storageService.js` | Detecta encogimiento (`isCierresCountShrinking`) y restaura desde `bodega_sales_shadow_backup_v1` |
| Numeración de ventas | `src/utils/checkoutProcessor.js:388`, `src/utils/customerTransactionProcessor.js` | `max(local)+1` → colisiona si el local está truncado |
| Pull desde la nube | `src/hooks/useCloudSync.js` (`_applyFromCloud`) | Solo el monitor hace pull; el POS primario NUNCA (push-only) |
| Identidad | `dj_device_id` | Dos instancias operan con `PDA-V2-...39F` (el PC real + un dataset viejo del 19-08) |
| Comandos supervisor | `src/hooks/useSupervisorCommands.js` | Acciones nuevas: `delete_customer`, `register_customer_payment` (con `creditos`), `update_sales_record` |
| Monitor | `useMonitorShiftMetrics.js`, `MonitorDeudasTab.jsx` | Lee Doc 60; no hay alerta de divergencia PC-vs-nube |

---

# FASE 0 — Estabilización (✅ COMPLETADA 12-09-2026)

- [x] Rescate de las 14 ventas del PC al Doc 60 (renumeradas #804–#817).
- [x] Abono de Ramón reclasificado a `pago_movil` en nube y PC local (no cuenta en gaveta).
- [x] Fiadas de jose gregorio (#802/#803) registradas con historial.
- [x] Snapshot de rollback: `backups/snapshot-doc60-pre-rescate14.json`, `snapshot-consolidado-doc60-52-20260912.json`.
- [x] Regla operativa provisional: **verificar Monitor vs `request_full_backup` al cierre de cada jornada** y rescatar a mano si diverge.

---

# FASE 1 — Merge-on-push (fix central, elimina la causa raíz) — ✅ IMPLEMENTADA 12-09

> **Estado:** código desplegado a `dondejuanchopos.vercel.app` (12-09). Activación en la caja
> pendiente de que el PC vuelva a estar en línea (comando `enable_feature` encolado; bucle
> `scripts/wait-and-activate-merge.mjs` re-intenta hasta confirmar).
>
> **Decisiones de implementación (2026-09-12):**
> - **Opción A aplicada (merge en cliente, sin DDL):** el Management API token estaba
>   vencido, pero se descubrió que NO hace falta: `device_pairings` es legible por anon y
>   el RPC `read_paired_audit_documents` (SECURITY DEFINER, granted a anon) solo valida el
>   vínculo (primary, monitor). El POS lee su propio Doc 60 con RPC existente → cero SQL.
> - `src/utils/salesPushMerge.js`: `prepareSalesPushPayload` (unión por id con veto de
>   no-encogimiento) + `fetchCloudSalesReference` (lectura RPC con caché TTL 15 s y
>   single-flight). 13 tests en `tests/salesPushMerge.test.js`, incluida la invariante I5.
> - **I5 (empate → gana la nube):** `mergeSalesArrays(cloud, local)` + canonización de
>   `REGISTRO_CIERRE`: el summary sellado lo manda la nube salvo que el local sea
>   ESTRICTAMENTE más nuevo (evita que el local truncado resucite el cierre $0.71 ya
>   reescrito — incidente 11-09).
> - `pushCloudSyncNow` (useCloudSync.js): el merge corre ANTES del breaker clásico con
>   triple compuerta: flag `dj_sales_push_merge_v1` (kill-switch sin redeploy) ∧
>   `device_id` de la caja de producción (la instancia fantasma queda en passthrough) ∧
>   respeto al flujo de purga deliberada (`confirm_sales_purge_flag`). El breaker de 39
>   cierres queda intacto como segunda línea.
> - Nuevo comando de supervisor `enable_feature` (envelope `inventory_update`+
>   `action:'enable_feature'` por la constraint viva de la tabla) con lista blanca
>   estricta de flags (solo `dj_sales_push_merge_v1`).
>
> **Pendiente para cerrar FASE 1:** confirmar `applied` + verificar que el push fusionado
> del PC llega al Doc 60 cuando la caja reabra (el bucle de activación lo verifica solo).

**Problema:** el breaker es binario: un local con historial pequeño no puede subir NADA,
ni siquiera sus ventas nuevas e inocuas.

**Solución:** el push de `bodega_sales_v1` deja de ser "reemplazar el documento" y pasa a
ser "publicar una unión por id, sin borrados". El breaker solo bloquea cuando el push
intentaría **eliminar** registros que la nube ya tiene.

### Tareas
1. **RPC de upsert-safe en Supabase** (`rpc_push_sales_merge`):
   - Entrada: array de registros (el payload local del dispositivo).
   - En la nube: union por `id` entre Doc 60 y el array entrante usando la lógica de
     `mergeSalesArrays` (portarla a SQL/plpgsql o hacer el merge en el cliente y enviar
     el array ya fusionado — ver decisión abajo).
   - Rechaza (error explícito) si el resultado tiene MENOS registros que Doc 60 actual.
   - Devuelve `{ finalCount, added, updated }`.
2. **Cambiar `pushCloudSyncNow`** para `bodega_sales_v1`:
   - Antes de subir, fusionar local + último Doc 60 conocido (caché `bodega_sales_v1` del
     último pull/eco ya está en el dispositivo vía `LAST_PUSH_HASH`… si no existe, hacer
     un GET puntual del Doc). Enviar la unión por RPC.
   - El breaker actual queda como **segunda línea**: solo bloquea si `mergeSalesArrays`
     no fue posible (no hay base local) o si el conteo de cierres del resultado final
     fuera menor al máximo conocido.
3. **Tests** (`tests/salesPushMerge.test.js`):
   - Local con 2 cierres + nube con 42 → push → nube conserva 42 y añade las nuevas.
   - Local que "perdió" registros (borrado real) → RPC rechaza.
   - Venta sellada modificada localmente → la nube preserva el sellado.
   - Idempotencia: mismo push dos veces → sin duplicados.
4. **Despliegue** a `dondejuanchopos` + verificación en vivo con un backup del PC.

### Decisión de diseño (para tomar al implementar)
- **Opción A (recomendada):** merge en el cliente + RPC con guard de "no-encogimiento"
  en SQL (`IF v_new_count < v_current_count THEN RAISE`). Menos SQL que mantener, y
  `mergeSalesArrays` ya está testeado en JS.
- Opción B: portar el merge a plpgsql. Más atómico, más costoso de mantener.

### Criterio de aceptación
- [ ] PC con historial truncado sube sus ventas nuevas en <2 min tras facturar.
- [ ] Ningún push puede reducir el conteo de Doc 60 (testeado).
- [ ] Suite completa en verde (`npx vitest run`).

**Esfuerzo estimado:** 1 sesión. Riesgo: medio (toca el camino crítico de escritura) —
mitigado con tests + el snapshot de rollback.

---

# FASE 2 — Reconstrucción del historial del PC (una vez, controlada)

**Problema:** el PC tiene 56 registros locales (2 cierres, numeración propia). Aunque la
FASE 1 permita su push, su numeración sigue divergente y su arqueo local incompleto.

### Tareas
1. Comando supervisor nuevo: `action: 'replace_sales_history'` (solo PC autoritativo,
   exige `confirm: true` y que la app esté **sin turno activo** o lo rechaza):
   - Backup previo obligatorio: `bodega_sales_pre_replace_v1` + descarga JSON.
   - Escribe el Doc 60 consolidado en `bodega_sales_v1` y el mirror.
   - Idempotente y con registro de auditoría (`abasto_audit_log_v1`).
2. Ejecutarlo **fuera de horario** (turno cerrado), verificar:
   - Historial local = Doc 60 (935+ registros, 42 cierres).
   - Numeración alineada (última venta #817).
   - Arqueo del día coincide con el Monitor.
3. **Luego** reactivar el flujo normal: con el historial completo, incluso el breaker
   viejo volvería a permitir el push (defensa en profundidad).

### Criterio de aceptación
- [ ] PC local tiene los 42 cierres y la numeración canónica.
- [ ] El arqueo del PC y el Monitor muestran exactamente lo mismo.
- [ ] Backup `bodega_sales_pre_replace_v1` descargado y guardado.

**Esfuerzo estimado:** ½ sesión (comando ya tiene el patrón de `update_sales_record`).

---

# FASE 3 — Identidad y numeración (prevenir colisiones)

### 3A. Una sola instancia por `device_id`
1. En el `request_full_backup`, incluir un `instanceFingerprint` (timestamp de creación de
   la BD local + userAgent). Si llegan dos fingerprints distintos con el mismo
   `device_id`, el Monitor alerta "INSTANCIA FANTASMA DETECTADA".
2. Localizar la instancia vieja (dataset 19-08): probablemente un navegador/perfil
   olvidado o un emulador. Decidir: purgar su almacenamiento (comando nuevo
   `wipe_device_storage` con doble confirmación) o simplemente no reutilizar ese perfil.
3. Regla operativa: nunca restaurar backups entre dispositivos sin re-pairing.

### 3B. Numeración central de ventas
1. Función compartida `getNextSaleNumber()`:
   - Fuente primaria: `max(saleNumber)` del último Doc 60 conocido + 1.
   - El checkout **reserva** el número con una fila en tabla nueva
     `sale_number_reservations (device_id, sale_number, created_at)` (o secuencia de
     Supabase). Si falla la reserva (offline), cae a `max(local)+1` y marca la venta con
     `_numeroProvisional: true` — el merge-on-push de FASE 1 la renumerará sin romper
     referencias (`cierreId` no depende del número).
2. Migrar `checkoutProcessor.js` y `customerTransactionProcessor.js` a esta función.
3. Test: dos dispositivos con caches distintas facturan a la vez → números distintos.

### Criterio de aceptación
- [ ] Alerta de instancia fantasma funcionando en el Monitor.
- [ ] Cero colisiones de `saleNumber` tras un día de ventas (verificable con query de
      duplicados — hoy existen los #759–#763 duplicados históricos como referencia).

**Esfuerzo estimado:** 1–1.5 sesiones (3B tiene migración de tabla nueva).

---

# FASE 4 — Observabilidad (que nada vuelva a quedar invisible)

1. **Alerta de divergencia en el Monitor** (tab de resumen del turno):
   - Comparar `count(ventas hoy en Doc 60)` vs `sales_count` del último
     `cloud_backups` del PC. Diferencia > 0 → banner ámbar "N ventas sin sincronizar".
2. **Auto-chequeo diario** (script `scripts/daily-sync-audit.mjs`):
   - Doc 60 vs último backup de cada dispositivo autoritativo.
   - Duplicados de `saleNumber` del día.
   - Comandos `pending` con más de 24 h.
   - Salida para cron/GitHub Actions o para correrlo a mano cada mañana.
3. **Métrica en el backup**: subir ya `sales_count` (hoy llega en 0) para que la
   comparación sea barata.

### Criterio de aceptación
- [ ] Si el PC deja de sincronizar, el dueño lo ve en el Monitor en minutos, no en el arqueo.
- [ ] Script de auditoría diaria en verde y documentado en AGENTS.md.

**Esfuerzo estimado:** ½–1 sesión.

---

## 🗓️ Orden de ejecución recomendado

```
FASE 1 (merge-on-push)  ──►  FASE 2 (reconstrucción PC)  ──►  FASE 3A/3B  ──►  FASE 4
     fix estructural            higiene de datos               prevención         observabilidad
     1 sesión                   ½ sesión (fuera de horario)    1–1.5 sesiones     ½–1 sesión
```

- **FASE 1 primero**: sin ella, cualquier otra cosa es maquillaje — la fuga sigue abierta.
- **FASE 2 después**: una vez que el push fusiona, reconstruir el local es seguro y de un
  solo uso.
- **FASE 4 puede adelantarse** si el dueño quiere visibilidad inmediata (es lo más barato
  y no toca lógica de escritura).

## 🔒 Reglas de seguridad transversales (aplican a todas las fases)

1. Nada se borra: siempre unión por id + snapshots de rollback en `backups/`.
2. Toda escritura en la nube va precedida de snapshot descargado al repo.
3. Los comandos nuevos de supervisor nacen con: idempotencia por id, `withLock`, y
   rechazo explícito si la precondición no se cumple (turno activo, saldo pendiente, etc.).
4. Cada fase termina con `npx vitest run` completo en verde + deploy verificado en
   `https://dondejuanchopos.vercel.app`.
5. Recordar el retraso de activación del Service Worker (~15 min): al probar comandos
   nuevos, encolar → esperar → re-encolar si falla con "Acción inválida".

## 📌 Métricas de éxito del plan

| Métrica | Hoy (12-09) | Meta |
|---|---|---|
| Ventas del PC en la nube | solo tras rescate manual | 100% automáticas, <2 min |
| Colisiones de `saleNumber` | 5 históricas + las del incidente | 0 nuevas |
| Escritores por `device_id` | 2 (PC + fantasma) | 1 |
| Detección de divergencia | al hacer el arqueo | <10 min (Monitor) |
| Intervención manual por jornada | 1–2 (rescates) | 0 |
