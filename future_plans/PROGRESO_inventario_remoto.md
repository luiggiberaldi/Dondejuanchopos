# Progreso — Edición Remota de Inventario

Plan: `future_plans/inventario_remoto_supervisor.md` · Rama: `feat/inventario-remoto`

- [x] Fase 0 — Rama y línea base (`feat/inventario-remoto` creada; baseline: suite completa verde en la rama padre)
- [ ] Fase 1 — DDL + RLS versionados (`supabase_supervisor_commands_setup.sql`) — **requiere que el humano lo ejecute en Supabase**
- [ ] Fase 2 — Hook: catch-up de pendientes + deduplicación por ID
- [ ] Fase 3 — Aplicador `applyInventoryCommand` con lock + validación en caja
- [ ] Fase 4 — Banner `SupervisorInventoryNotification` en la caja
- [ ] Fase 5 — UI del monitor: botones ±, tarjetas con precios duales, formulario remoto ligero
- [ ] Fase 6 — Cierre y pruebas de flujo (edición en vivo / stock / offline→catch-up)

## Notas
- D8 (egress): payloads sin base64; en `edit` la caja preserva `image` si el payload no la trae.
