# Progreso — Selector Único de Precios (4 modos)

Plan: `future_plans/precios_simplificados.md` · Rama: `feat/precios-simplificados`

- [x] Fase 0 — Rama y línea base
- [x] Fase 1 — `pricingMode` canónico + payload normalizado (fix priceBsManual basura en forceBcv) — 11 tests en `tests/pricingMode.test.js`
- [x] Fase 2 — Selector único de 4 tarjetas + vista previa (Unidad, Quick) + eliminar efecto del hallazgo
- [x] Fase 3 — Herencia de modo en Caja/½Caja (Quick)
- [x] Fase 4 — Paridad en Wizard
- [x] Fase 5 — Monitor remoto + cierre

## Resultado final
- 99 tests verdes (88 previos + 11 nuevos de pricingMode)
- Build ✓, lint 0 errores
- 6 commits en `feat/precios-simplificados`

## Verificación manual pendiente
1. Crear producto en cada modo → guardar → reabrir → modo se restaura y campos ajenos vacíos.
2. Modo `dual_usd` → vender → ticket cobra Bs = ref$ × tasa.
3. Modo `bcv` → `priceBsManual` guardado es null (fix del hallazgo verificado en tests).
4. Caja con "Usar otra regla" → modo propio se persiste independiente de la unidad.
5. Formulario remoto del monitor → encolar edición con modo `bcv` → la caja aplica con `forceBcv: true` y `priceBsManual: null`.
