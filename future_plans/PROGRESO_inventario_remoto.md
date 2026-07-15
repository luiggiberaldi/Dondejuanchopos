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
