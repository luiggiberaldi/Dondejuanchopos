# Progreso — Edición Remota de Inventario

Plan: `future_plans/inventario_remoto_supervisor.md` · Rama: `feat/inventario-remoto`

- [x] Fase 0 — Rama y línea base (`feat/inventario-remoto` creada)
- [x] Fase 1 — DDL + RLS versionados (`supabase_supervisor_commands_setup.sql`) — commit `da9002e` — **⚠️ PENDIENTE: el humano debe ejecutarlo en el SQL editor de Supabase (proyecto CLOUD/SYNC)**
- [x] Fase 2 — Hook: catch-up de pendientes + deduplicación por ID (`dj_applied_supervisor_cmds_v1`) — commit `1d3cf5d`
- [x] Fase 3 — Aplicador `applyInventoryCommand` con `withLock` + validación en caja — commit `1d3cf5d` (10 tests en `tests/remoteInventory.test.js`)
- [x] Fase 4 — Banner `SupervisorInventoryNotification` montado en App.jsx — commit `f4f71d5`
- [x] Fase 5 — UI del monitor — commit `f28dedf`. **Cambio de diseño pedido por el usuario a mitad de fase:** los cambios NO se envían de inmediato; se acumulan en una cola local persistida (`dj_pending_inventory_changes_v1`) con fusión (deltas sumados, edits colapsados, delete cancela pendientes) y se envían todos con el botón flotante «Subir al sistema». Anti-pisado derivado: el `edit` remoto nunca modifica stock (solo `adjust_stock`).
- [x] Fase 6 — Cierre: lint 0 errores, build ✓, 88 tests verdes (78 previos + 10 nuevos)

## Verificación con hardware real (pendiente del humano)
1. Ejecutar `supabase_supervisor_commands_setup.sql` en Supabase (proyecto cloud/sync).
2. Celular emparejado: editar precio Bs manual → Subir al sistema → la caja aplica y suena el banner.
3. +1/-1 varias veces en un producto → el badge proyecta el neto → Subir → el stock cambia UNA vez por el neto.
4. Apagar la PC de caja, encolar y subir cambios, encender la PC → el catch-up los aplica al conectar.
5. Enviar un edit con barcode duplicado → la caja lo marca `failed` con `error_reason` (verificar en la tabla).

## Notas
- D8 (egress): payloads sin base64; en `edit` la caja preserva `image`; el formulario remoto no maneja foto.
- Los combos no se editan desde el monitor (botón deshabilitado); se gestionan en la caja.

## Auditoría post-lanzamiento y fixes aplicados

Plan: `future_plans/fix_supervisor_auditoria.md` · Rama: `fix/supervisor-auditoria`

Se auditó el modo supervisor completo (monitor + comandos remotos) en busca de errores y mejoras. De 14 hallazgos, se corrigieron 9 en 4 fases:

- [x] Fase 1 — commit `fix(supervisor): D4 en normalizeProduct + costUsd en metricas del monitor`
  - #4: `normalizeProduct` (ruta remota) no aplicaba la normalización D4 (limpieza de `priceBsManual`/`priceBsUsdRef` según `pricingMode`) que sí tenía `buildProductPayload` (ruta local) — cerraba el hueco que la propia auditoría de precios había dejado sin tapar en el camino remoto.
  - #13/#14: el monitor leía `p.costPrice`/`p.price` (campos legados) en vez de `p.costUsd`/`p.priceUsd` para métricas de costo/ganancia — corregido con fallback `costUsd || costPrice`.
  - 2 tests nuevos en `tests/remoteInventory.test.js` (12/12 verdes).
- [x] Fase 2 — commit `fix(supervisor): closure stale en cola de cambios y PENDING_KEY fuera del componente`
  - #2/#3/#11: `queueInventoryChange` capturaba `pendingChanges` por closure sin `useCallback`/`setState(prev=>...)`, lo que podía perder actualizaciones en taps rápidos de +/-; reescrito con actualización funcional. `PENDING_KEY` movida a scope de módulo.
- [x] Fase 3 — commit `fix(supervisor): bcvRate al formulario remoto y limpiar customRate en cambio de modo`
  - #5: faltaba pasar `bcvRate` a `RemoteProductFormModal` (afectaba el preview de precio en modo BCV).
  - #8: al cambiar de modo de tasa en `SupervisorRateModal`, no se limpiaba `bodega_custom_rate` viejo — quedaba como referencia fantasma.
- [x] Fase 4 — commit `fix(supervisor): badge de cambios pendientes en filas y barra flotante contextual`
  - #1: `hasPendingFor` estaba declarado pero sin uso — ahora dispara un badge «Cambio pendiente» en filas con un edit/delete encolado (sin duplicar el badge cuando ya hay delta de stock).
  - #6: la barra flotante «Subir al sistema» ahora solo aparece en la pestaña Inventario (`viewTab === 'inventario'`), no en todas las pestañas del monitor.
- [x] Fase 5 — cierre: lint 0 errores en los 5 archivos tocados, `npx vitest run tests/remoteInventory.test.js tests/pricingMode.test.js` → 23/23 verdes, `npm run build` ✓.

**Hallazgos NO corregidos en esta pasada** (documentados, no urgentes):
- #7: estado visual persistente en los botones +/- de stock.
- #9: inconsistencia de vocabulario «Encolar» vs «Subir al sistema».
- #10: falta indicador de conexión en los botones editar/eliminar.
- #12: fallo silencioso del import dinámico de `pushLocalSync`.
