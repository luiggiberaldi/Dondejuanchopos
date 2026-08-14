# PLAN DE FIXEO — INVENTARIO + KARDEX E2E

**Fecha:** 2026-08-12
**Estado:** Implementación local P0/P1 aplicada; cloud/RLS, conciliación histórica y dry-run quedan como siguientes fases
**Alcance:** inventario local, Kardex, checkout, combos, productos modulares, consumo diferido, anulaciones, ajustes remotos, snapshots y conciliación patrimonial.

> Este documento convierte el reporte de auditoría en un plan ejecutable por fases. Cada fase tiene dependencias, arnés de prueba, guarda-raíles y criterios de salida. No se deben mezclar correcciones de fases posteriores antes de que las invariantes de la fase anterior estén verdes.

---

## 1. Objetivo y contrato de éxito

El sistema debe mantener una sola verdad física:

```text
stockInicial + Σ(cantidad de movimientos Kardex) = stockActual
```

Para cada movimiento individual:

```text
stock_antes + cantidad = stock_despues
```

Para una operación idempotente:

```text
reintentar la misma referencia no cambia el resultado final
```

Para una venta:

```text
stockInicial
- unidades físicas realmente vendidas/despachadas
+ unidades físicamente devueltas
= stockFinal
```

El Kardex debe representar **SKU físicos que modificaron stock**, no necesariamente los ítems comerciales visibles en el carrito.

### Resultado esperado

- Cero movimientos con `stock_antes + cantidad !== stock_despues`.
- Cero discrepancias no explicadas entre productos y Kardex.
- Cero ajustes de inventario guardados en `bodega_sales_v1`.
- Combos y modulares registran componentes, no salidas ficticias del padre.
- Consumo diferido descuenta una sola vez, durante despacho.
- Anulaciones devuelven únicamente lo que efectivamente salió.
- Reintentos offline o por timeout no duplican stock ni Kardex.
- Toda operación con fallo queda detectable y recuperable.
- La suite automática relevante pasa sin excepciones de entorno.

---

## 2. Diagnóstico base que el plan debe preservar

### Anchors actuales

| Área | Ubicación actual | Riesgo principal |
|---|---|---|
| Servicio Kardex | `src/services/kardexService.js` | Relee el stock ya persistido y puede fabricar snapshots desplazados |
| Checkout | `src/utils/checkoutProcessor.js` | La deducción física y el loop Kardex no usan el mismo mapa |
| Anulación | `src/utils/voidSaleProcessor.js` | El consumo diferido puede restaurarse junto con la ficha |
| Ajustes rápidos | `src/context/ProductContext.jsx` | Buffer debounced acumula el delta solicitado, no siempre el delta real |
| Ajustes de vista | `src/views/ProductsView.jsx` | Escribe ajustes como ventas falsas en `bodega_sales_v1` |
| Ajustes remotos | `src/utils/remoteInventoryProcessor.js` | Persiste producto antes de registrar movimiento |
| Consumo diferido | `src/services/consumptionSessionService.js` | Stock, ficha y Kardex no comparten una transacción lógica única |
| Conciliación | `src/utils/kardexScope.js` | `detectKardexDiscrepancies()` solo detecta stock negativo |
| Vista | `src/views/KardexView.jsx` | Carga todo el historial y no muestra discrepancias accionables |
| Snapshot | `src/services/kardexService.js` | `createInventorySnapshot()` oculta negativos con `Math.max(0, ...)` |

### Estado de pruebas a tomar como línea base

La ejecución observada de `bun test --run` fue:

```text
221 tests
187 pass
24 fail
16 errors
10 skipped
```

Los errores actuales incluyen globals de navegador ausentes (`localStorage`, `FileReader`, `navigator.locks`) y hooks de test no disponibles (`afterEach`). Esto debe resolverse en la Fase 0 antes de usar la suite completa como gate. No se debe declarar “0 regresiones” comparando contra una suite que no arranca de forma determinista.

El `AGENT.md` documenta otra línea base histórica (349 tests, 0 fallos). La discrepancia debe quedar registrada y resolverse con una ejecución reproducible antes del primer commit de fixeo.

---

## 3. Reglas operativas del trabajo

1. **No corregir y reestructurar simultáneamente.** Primero agregar el arnés que reproduce el fallo; después cambiar producción.
2. **Un commit por fase**, con archivos de producción y tests relacionados únicamente.
3. **No tocar cambios ajenos** ya presentes en el checkout.
4. **No borrar ni reescribir Kardex histórico** automáticamente.
5. Las reparaciones históricas deben tener modo `dry-run`, reporte de diferencias y confirmación explícita.
6. Toda escritura crítica usa `withLock('pos_write_lock')`.
7. Toda operación de stock debe retornar un resultado estructurado con `success`, `operationId`, `movementIds`, `pending` y `error` cuando corresponda.
8. Los errores de cloud no deben revertir una operación local confirmada, pero sí deben dejar una cola pendiente visible y reintentable.
9. El monto/cantidad solicitado y el cambio físico aplicado deben conservarse por separado cuando existe clamp o stock insuficiente.
10. Las funciones puras no pueden leer `localStorage`, `window`, hora del sistema ni red.

---

# FASE 0 — Arnés de pruebas y línea base reproducible

**Prioridad:** P0
**Dependencias:** ninguna
**Objetivo:** poder reproducir los bugs sin depender del navegador real ni de datos del negocio.

## 0.1 Arnés determinista

Crear, solo dentro de `tests/`:

- `tests/fixtures/inventoryFactory.js`
- `tests/helpers/memoryStorage.js`
- `tests/helpers/inventoryHarness.js`
- `tests/helpers/faultInjector.js`
- `tests/helpers/assertInventoryInvariants.js`

### Fixture mínimo

```js
createProduct({ id, stock, costUsd, isCombo, comboItems, ... })
createSale({ id, items, status: 'COMPLETADA' })
createMovement({ producto_id, cantidad, stock_antes, stock_despues, referencia_id })
createConsumptionSession({ id, saleId, totalQuota, servedCount, dispatches })
```

Los fixtures deben usar IDs, fechas y cantidades deterministas. No utilizar `Date.now()`, `Math.random()` ni UUID aleatorio salvo que el test lo controle mediante un stub.

### Memory storage

El storage de test debe permitir:

- `getItem`, `setItem`, `removeItem`.
- Snapshot profundo para evitar mutaciones accidentales.
- Registro de operaciones y orden de escritura.
- Inyección de error en una lectura o escritura concreta.
- Barrera/latch para solapar dos operaciones concurrentes.
- Reset completo entre tests.

### Fault injector

Casos configurables:

```js
failNext('bodega_products_v1', 'setItem')
failNext('bodega_kardex_v1', 'setItem')
failOnce('bodega_consumption_sessions_v1', 'setItem')
delay('bodega_products_v1', 50)
```

El arnés debe poder demostrar que una operación fallida queda pendiente o se recupera sin duplicar.

## 0.2 Setup de Vitest

Revisar `tests/setup.js` y centralizar:

- `localStorage`/`sessionStorage` funcionales.
- `window`, `CustomEvent` y `crypto.randomUUID` deterministas.
- `navigator.locks` configurable para probar camino nativo y fallback.
- `FileReader` solo donde sea necesario; no cargar componentes UI para tests de dominio.
- Hooks globales (`beforeEach`, `afterEach`) importados explícitamente o configurados de forma consistente.
- Mock de `useCloudSync` que registre egress sin red real.

**Guardrail G0.1:** un test de smoke debe importar cada servicio de inventario bajo el entorno oficial y no lanzar errores de globals.

## 0.3 Gates de salida

```bash
bun run test -- tests/inventoryKardexE2E.test.js tests/kardexScope.test.js
bun run lint -- tests src/utils/kardexScope.js
bun run build
```

Criterio de salida:

- El arnés corre dos veces consecutivas con el mismo resultado.
- No hay errores de entorno.
- Los tests de dominio no dependen de IndexedDB real, Supabase ni hora local.

---

# FASE 1 — Modelo canónico de movimiento físico

**Prioridad:** P0
**Dependencia:** Fase 0
**Objetivo:** que todos los flujos calculen el mismo mapa físico antes de escribir stock o Kardex.

## 1.1 Helper puro de unidades físicas

Crear un módulo de dominio, por ejemplo:

```text
src/utils/inventoryMovementModel.js
```

Funciones propuestas:

```js
getPhysicalQuantity(item, productCatalog)
expandCartToPhysicalDeductions(cart, products, options)
aggregatePhysicalDeductions(deductions)
buildStockTransition(stockBefore, requestedDelta, policy)
```

Cada deducción debe contener:

```js
{
  productoId,
  cantidad,
  cantidadSolicitada,
  unidad,
  origen: 'VENTA' | 'COMBO' | 'MODULAR' | 'CONSUMO_DIFERIDO' | 'AJUSTE',
  saleItemId,
  parentProductId,
  metadata
}
```

### Reglas obligatorias

- Producto normal: una salida por su propio ID.
- Caja/medio bulto: cantidad física = cantidad comercial × unidades del formato.
- Combo: una salida por cada componente físico.
- Modular: una salida por cada selección física.
- Consumo diferido: el cobro no produce deducción; el despacho sí.
- La misma referencia/producto se agrega antes de registrar Kardex.
- Un combo sin componentes encontrados debe producir una anomalía explícita, no una salida ficticia del padre.

## 1.2 Transición de stock

Definir una única política:

```js
buildStockTransition(stockBefore, requestedDelta, { allowNegative })
```

Debe devolver:

```js
{
  stockAntes,
  stockDespues,
  cantidadAplicada,
  cantidadSolicitada,
  cantidadNoAplicada,
  clamped,
  negativeStockUsed
}
```

Si `allowNegative=false` y se solicita `-5` con stock `2`:

```text
stockAntes       = 2
stockDespues     = 0
cantidadAplicada = -2
cantidadSolicitada = -5
cantidadNoAplicada = -3
clamped          = true
```

El Kardex debe registrar la cantidad aplicada, y guardar la solicitada en `metadata`.

## 1.3 Tests automáticos

Archivo: `tests/inventoryMovementModel.test.js`

- `IK-MODEL-001`: unidad normal.
- `IK-MODEL-002`: venta por caja.
- `IK-MODEL-003`: medio bulto.
- `IK-MODEL-004`: combo expande componentes.
- `IK-MODEL-005`: modular expande selecciones.
- `IK-MODEL-006`: consumo diferido no descuenta en cobro.
- `IK-MODEL-007`: cantidades repetidas se agregan por SKU.
- `IK-MODEL-008`: clamp de salida no genera stock negativo falso.
- `IK-MODEL-009`: `stockAntes + cantidadAplicada === stockDespues`.
- `IK-MODEL-010`: producto/componente inexistente devuelve anomalía explícita.

**Guardrail G1.1:** `expandCartToPhysicalDeductions()` debe ser pura; test estático que rechace referencias a `localStorage`, `window`, `storageService` y `Date`.

---

# FASE 2 — Servicio transaccional local Stock + Kardex

**Prioridad:** P0
**Dependencia:** Fase 1
**Objetivo:** eliminar snapshots desplazados y formalizar idempotencia.

## 2.1 Fachada única

Crear una fachada protegida por lock, por ejemplo:

```js
applyInventoryOperation(operation)
```

La operación debe incluir:

```js
{
  operationId,
  referenceId,
  referenceType,
  reason,
  actor,
  deductions,
  source,
  allowNegative
}
```

Dentro de un único `withLock('pos_write_lock')`:

1. Leer catálogo fresco.
2. Revisar `operationId`/referencia ya aplicada.
3. Calcular transiciones con el helper puro.
4. Construir productos nuevos.
5. Construir movimientos Kardex con snapshots explícitos.
6. Persistir el resultado local y el estado de operación.
7. Emitir evento después de persistir.
8. Encolar sync cloud fuera del camino crítico o mediante outbox.

El servicio Kardex debe recibir explícitamente:

```js
stockAntes
stockDespues
cantidadAplicada
```

No debe inferir el stock anterior leyendo el producto después de una mutación.

## 2.2 Idempotencia

La clave debe ser estable y suficiente:

```text
operationId + productoId + movementKind
```

No depender solamente de `referenciaId + productoId` cuando una referencia puede contener más de un tipo de movimiento.

Reintentar una venta, anulación, despacho o comando remoto debe devolver el resultado original sin añadir otra salida/entrada.

## 2.3 Estado de operación/outbox

Añadir una clave local separada, por ejemplo:

```text
bodega_inventory_operations_v1
```

Cada operación debe tener estados:

```text
PENDING → APPLIED_LOCAL → SYNC_PENDING → SYNCED
                         ↘ FAILED_RETRYABLE
                         ↘ FAILED_PERMANENT
```

La operación local no debe marcarse completa si el catálogo y el Kardex no están ambos persistidos.

## 2.4 Tests automáticos

Archivo: `tests/inventoryOperationService.test.js`

- `IK-TX-001`: salida normal persiste producto y Kardex con snapshots correctos.
- `IK-TX-002`: entrada normal.
- `IK-TX-003`: doble ejecución con mismo `operationId` no duplica.
- `IK-TX-004`: dos operaciones concurrentes serializan.
- `IK-TX-005`: una escritura Kardex fallida deja operación pendiente.
- `IK-TX-006`: reintento de operación pendiente no duplica stock.
- `IK-TX-007`: rollback lógico/no publicación parcial cuando falla antes de completar.
- `IK-TX-008`: cada movimiento cumple la ecuación de transición.
- `IK-TX-009`: la referencia y el usuario se conservan.
- `IK-TX-010`: `kardex_movement_recorded` ocurre después de persistencia.

**Guardrail G2.1:** test estático que enumere llamadas a `recordKardexMovementUnlocked`; fuera del servicio transaccional solo deben existir adaptadores aprobados y cada uno debe enviar snapshots explícitos.

**Guardrail G2.2:** test dinámico que intercepte `storageService.setItem` y falle si se escribe `bodega_products_v1` desde una operación crítica sin lock.

---

# FASE 3 — Integración del checkout y anulaciones

**Prioridad:** P0
**Dependencia:** Fase 2
**Objetivo:** alinear venta, componentes físicos y reversión.

## 3.1 Checkout

Modificar el flujo para que el mapa físico se calcule una sola vez y sea usado tanto para:

- actualización del catálogo;
- movimientos Kardex;
- auditoría de stock negativo;
- metadata de la venta.

No volver a iterar `cart` para fabricar movimientos independientes.

### Reglas

- Venta normal: una deducción por SKU físico agregado.
- Combo: solo componentes.
- Modular: solo selecciones.
- Diferido: el cobro crea ficha, no movimiento de stock, salvo selección inicial efectivamente despachada.
- Si una referencia incluye varias líneas del mismo producto, se registra una cantidad agregada.
- El Kardex debe guardar `saleId`, `saleNumber`, `checkoutOperationId` y `source`.

## 3.2 Anulación

La anulación debe leer la operación original o sus movimientos físicos, no reconstruir cantidades desde una interpretación distinta del carrito.

- Venta normal: invierte exactamente los movimientos aplicados.
- Combo/modular: invierte componentes.
- Venta diferida: no restaurar el combo padre desde `sale.items`; delegar en los despachos de la ficha.
- Una anulación repetida debe ser idempotente.

## 3.3 Tests E2E

Archivo: `tests/inventoryKardexE2E.test.js`

### `IK-E2E-001` Venta normal

```text
Producto p1: stock 10
Venta: 2
Esperado: stock 8
Kardex: cantidad -2, 10 → 8
```

### `IK-E2E-002` Venta por caja

```text
Producto p1: stock 30
Venta: 2 cajas × 12
Esperado: stock 6
Kardex: cantidad -24, 30 → 6
```

### `IK-E2E-003` Combo

```text
A: stock 10, combo consume 2 A
B: stock 20, combo consume 1 B
Venta: 3 combos
Esperado: A = 4, B = 17
Kardex: A -6 y B -3
Kardex: cero salida del producto combo
```

### `IK-E2E-004` Modular

```text
Selecciones A y B
Esperado: salidas únicamente en A/B según la selección
Kardex del producto modular padre: cero
```

### `IK-E2E-005` Repetición de SKU

Dos líneas del mismo producto deben producir una única operación agregada o dos movimientos válidos no deduplicados incorrectamente.

### `IK-E2E-006` Anulación normal

Venta `10 → 8`; anulación `8 → 10`; suma neta de Kardex igual a cero.

### `IK-E2E-007` Anulación doble

La segunda anulación no cambia stock ni crea otro movimiento.

### `IK-E2E-008` Falla de Kardex

Simular fallo después de la venta. La operación debe quedar detectable como pendiente y reintentarse exactamente una vez.

---

# FASE 4 — Ajustes locales y remotos

**Prioridad:** P0/P1
**Dependencia:** Fase 2
**Objetivo:** eliminar ventas falsas, respetar clamp y asegurar concurrencia.

## 4.1 Ajuste rápido y por lote

`ProductContext.adjustStock()` y `ProductsView` deben delegar al servicio transaccional. El wrapper de UI solo puede encargarse de haptic/toast.

Eliminar la escritura de ajustes en:

```text
bodega_sales_v1
```

El motivo del egreso debe llegar al movimiento Kardex y a la auditoría, no a una venta artificial.

El lote debe ser una sola operación lógica o una secuencia de operaciones con `operationId` derivado estable:

```text
batchId + productId
```

## 4.2 Ajuste remoto

`remoteInventoryProcessor` debe llamar la misma fachada local para:

- `adjust_stock` por delta;
- `adjust_stock` por `targetStock`;
- altas con stock inicial;
- comandos reintentados.

Ediciones de precio/nombre sin stock no deben producir movimientos Kardex.

## 4.3 Tests

Archivo: `tests/inventoryAdjustmentsE2E.test.js`

- `IK-ADJ-001`: botón +1.
- `IK-ADJ-002`: botón -1.
- `IK-ADJ-003`: salida mayor al stock con negativos desactivados registra solo cantidad aplicada.
- `IK-ADJ-004`: salida mayor al stock con negativos activados registra todo y marca anomalía.
- `IK-ADJ-005`: 50 clics rápidos serializados.
- `IK-ADJ-006`: lote con tres productos y motivo común.
- `IK-ADJ-007`: lote repetido no duplica.
- `IK-ADJ-008`: ajuste remoto por delta.
- `IK-ADJ-009`: ajuste remoto por `targetStock`.
- `IK-ADJ-010`: edición remota de precio no cambia stock ni Kardex.
- `IK-ADJ-011`: no aparece ningún registro `AJUSTE_*` en `bodega_sales_v1`.
- `IK-ADJ-012`: dos comandos remotos concurrentes no pierden movimientos.

**Guardrail G4.1:** test estructural que prohíba `storageService.setItem('bodega_sales_v1'` dentro de `ProductsView`, `StockBatchModal` y servicios de inventario.

**Guardrail G4.2:** test de lock que intercepte toda mutación de `bodega_products_v1` y verifique que pertenece a una sección crítica aprobada.

---

# FASE 5 — Consumo diferido

**Prioridad:** P0
**Dependencia:** Fases 2 y 3
**Objetivo:** que cobro, despacho, reversión y anulación sean una cadena coherente.

## 5.1 Modelo de ficha

Cada despacho debe tener:

```text
sessionId
saleId
dispatchId
operationId
items físicos
cantidad aplicada
estado
```

La ficha debe ser la fuente de verdad de lo efectivamente despachado.

## 5.2 Reglas

- Cobro sin selección: no baja stock y no crea salida física.
- Selección inicial: se registra como despacho inicial y baja stock una vez.
- Despacho parcial: baja solo sus unidades.
- Reversión de despacho: devuelve solo ese `dispatchId`.
- Anulación de venta: cancela la ficha y revierte la suma de despachos no revertidos.
- No reconstruir componentes del combo completo al anular una venta diferida.
- No permitir despachos por encima de cuota o stock.
- Reintentar el mismo despacho devuelve el resultado existente.

## 5.3 Tests

Archivo: `tests/consumptionInventoryE2E.test.js`

- `IK-CONS-001`: cobro diferido sin stock change.
- `IK-CONS-002`: despacho inicial descuenta una vez.
- `IK-CONS-003`: dos despachos parciales cuadran cuota y stock.
- `IK-CONS-004`: despacho por encima de cuota no escribe nada.
- `IK-CONS-005`: stock insuficiente no escribe nada.
- `IK-CONS-006`: reintento del mismo despacho es idempotente.
- `IK-CONS-007`: reversión de un despacho devuelve solo ese despacho.
- `IK-CONS-008`: anulación de venta devuelve despachos efectivamente realizados.
- `IK-CONS-009`: anulación repetida no duplica devolución.
- `IK-CONS-010`: fallo entre producto, sesión y Kardex deja operación recuperable.

**Guardrail G5.1:** para una venta `isDeferredConsumption`, un test debe fallar si el checkout genera salida Kardex del combo padre sin un despacho asociado.

---

# FASE 6 — Conciliación, snapshots y reparación segura

**Prioridad:** P1
**Dependencia:** Fases 1–5
**Objetivo:** convertir la auditoría en una herramienta real de cuadre.

## 6.1 Reconstrucción por producto

Ampliar `src/utils/kardexScope.js` con funciones puras:

```js
reconstructStock(kardex, productoId, { until })
compareProductStock(product, kardex)
findKardexAnomalies(kardex)
```

Debe validar:

- `stock_antes + cantidad === stock_despues`.
- continuidad entre movimientos consecutivos;
- referencias duplicadas;
- movimientos sin producto;
- productos actuales sin movimiento inicial cuando deberían tenerlo;
- stock actual vs. último stock Kardex;
- snapshots negativos no explicados.

No confiar exclusivamente en `stock_despues`: cuando un movimiento histórico es legacy o inconsistente, calcular también por suma de cantidades y marcar la fuente de la discrepancia.

## 6.2 Reparación dry-run

Crear una función/comando de auditoría que solo produzca:

```js
{
  productoId,
  stockActual,
  stockReconstruido,
  diferencia,
  movimientosAfectados,
  recomendacion
}
```

No modificar datos automáticamente. Una futura reparación debe crear movimientos de ajuste explícitos, nunca editar movimientos históricos.

## 6.3 Snapshots

`createInventorySnapshot()` debe:

- conservar stock negativo real;
- marcar `hasAnomaly` y `anomalyValue`;
- guardar costo utilizado y su fuente;
- guardar `kardexLastMovementAt`;
- estar asociado a `cierreId`, `turnoId` y `operationId`.

## 6.4 Tests

Archivo: `tests/kardexReconciliation.test.js`

- `IK-REC-001`: reconstrucción básica.
- `IK-REC-002`: discrepancia positiva.
- `IK-REC-003`: discrepancia negativa.
- `IK-REC-004`: continuidad rota de snapshots.
- `IK-REC-005`: cantidad que no cuadra con snapshots.
- `IK-REC-006`: referencia duplicada.
- `IK-REC-007`: stock negativo visible como anomalía.
- `IK-REC-008`: producto sin Kardex y stock positivo.
- `IK-REC-009`: dry-run no modifica storage.
- `IK-REC-010`: snapshot conserva negativos y costo fuente.

**Guardrail G6.1:** toda anomalía debe ser serializable, estable y exportable; no usar `console.error` como único mecanismo de auditoría.

---

# FASE 7 — Vista, exportación y rendimiento

**Prioridad:** P1/P2
**Dependencia:** Fase 6
**Objetivo:** hacer visible y utilizable el resultado de la auditoría.

## 7.1 KardexView

Agregar:

- banner de discrepancias;
- filtro por producto/SKU/referencia/motivo con tokens y acentos normalizados;
- todos los tipos generados por el dominio;
- rango de fechas en zona local del dispositivo;
- indicador de operaciones pendientes;
- estado “Kardex desactualizado” cuando exista outbox;
- vista de detalle con `operationId`, `saleId`, `dispatchId` y metadata;
- paginación o carga incremental.

Diferenciar claramente:

```text
Valor por costo actual
Valor por costo promedio ponderado
```

No etiquetar como promedio ponderado un cálculo hecho solo con `product.costUsd`.

## 7.2 CSV

Centralizar `escapeCsvCell(value)`:

- duplicar comillas internas;
- envolver siempre celdas de texto;
- preservar saltos de línea;
- proteger fórmulas que comiencen por `=`, `+`, `-`, `@` si el CSV se abre en hojas de cálculo;
- testear producto, motivo y usuario con comillas, comas y saltos.

## 7.3 Tests

Archivo: `tests/kardexViewData.test.js` o tests puros del adaptador:

- `IK-UI-001`: filtro por múltiples tokens.
- `IK-UI-002`: fechas locales inclusivas.
- `IK-UI-003`: todos los tipos visibles/filtrables.
- `IK-UI-004`: CSV con comillas/comas/saltos.
- `IK-UI-005`: discrepancias presentadas sin mutar datos.
- `IK-UI-006`: paginación conserva orden cronológico.

**Guardrail G7.1:** un test de catálogo de tipos compara `MOVEMENT_TYPES` con las opciones del filtro y con los tipos aceptados por el servicio.

---

# FASE 8 — Integridad cloud y seguridad del Kardex

**Prioridad:** P1
**Dependencia:** Fases 2 y 6
**Objetivo:** evitar que la sincronización o un restore destruya el historial local.

## 8.1 Outbox y sincronización

- No sincronizar el array completo en cada movimiento una vez exista el modelo de operaciones.
- Enviar operaciones idempotentes o snapshots versionados.
- Conservar `device_id`, `operationId`, `sequence` y `created_at`.
- Rechazar versiones antiguas mediante `shouldApplySyncVersion`.
- Marcar conflictos para revisión, no sobrescribir silenciosamente.

## 8.2 SQL/RLS

Auditar y corregir el esquema de `supabase_kardex_schema.sql` antes de usarlo en producción:

- eliminar políticas `USING(true)`/`WITH CHECK(true)`;
- aislar por `device_id`/tenant;
- restringir UPDATE/DELETE;
- preferir INSERT append-only;
- crear constraint de cantidad no cero;
- validar tipos de movimiento;
- índice único de idempotencia por referencia/producto/tipo;
- registrar usuario y timestamps server-side.

La aplicación no debe asumir que editar un SQL local actualiza una base ya creada: toda migración necesita script explícito y verificación post-aplicación.

## 8.3 Tests/guardrails

- `IK-CLOUD-001`: payload de Kardex no filtra otro device.
- `IK-CLOUD-002`: operación repetida cloud es idempotente.
- `IK-CLOUD-003`: versión vieja no pisa una nueva.
- `IK-CLOUD-004`: UPDATE/DELETE no autorizado es rechazado.
- `IK-CLOUD-005`: sync offline se reintenta sin duplicar.
- Test estático que rechace `USING (true)` en el SQL de Kardex.

---

# 4. Guardrails transversales obligatorios

## GR-01 — Invariante matemática

Cada test que persista un movimiento debe ejecutar:

```js
expect(stockAntes + cantidad).toBe(stockDespues)
```

Con tolerancia solo para unidades de peso, usando el helper de precisión del proyecto.

## GR-02 — Una operación, un dueño

No permitir que checkout, vista, contexto y servicio escriban el mismo stock por caminos paralelos. Las vistas solo llaman fachadas.

## GR-03 — Sin ventas falsas

Búsqueda estática en código de inventario:

```text
bodega_sales_v1 + AJUSTE
bodega_sales_v1 + MERMA
bodega_sales_v1 + AUTOCONSUMO
```

Debe fallar salvo en el procesador financiero legítimo de gastos/ventas.

## GR-04 — Snapshot explícito

Toda llamada de movimiento no fundacional debe proveer `stockAntes`, `stockDespues` o pasar por `applyInventoryOperation()`. El servicio no debe inferir `stockAntes` desde el catálogo mutado.

## GR-05 — Idempotencia

Toda operación de stock debe tener `operationId` o referencia estable. Un test de 2, 10 y 50 reintentos debe dejar una sola aplicación.

## GR-06 — No ocultar anomalías

Prohibir `Math.max(0, stock)` en snapshots, reconstrucción y reportes de auditoría. El clamp pertenece a la política de aplicación, no a la evidencia histórica.

## GR-07 — Errores observables

Un `catch` de Kardex no puede limitarse a `console.error`. Debe:

- devolver error estructurado;
- persistir estado pendiente/fallido;
- permitir reintento;
- mostrar alerta cuando el usuario necesita intervenir.

## GR-08 — Tipos canónicos

Centralizar tipos y subtipos en constantes. Un test debe comparar:

```text
constantes ↔ servicio ↔ filtros UI ↔ reportes ↔ SQL
```

## GR-09 — No tocar el historial

No editar ni borrar movimientos históricos para “cuadrar”. Toda corrección se hace con un movimiento `AJUSTE`, con motivo, usuario y referencia a la anomalía.

## GR-10 — Concurrencia

Los escenarios de doble clic, dos pestañas, venta + ajuste remoto y dos despachos deben probarse con barreras reales y no solo con llamadas secuenciales.

---

# 5. Suite automática final

Crear un comando/reporter dedicado, sin reemplazar la suite general:

```bash
bunx vitest run \
  tests/inventoryMovementModel.test.js \
  tests/inventoryOperationService.test.js \
  tests/inventoryKardexE2E.test.js \
  tests/inventoryAdjustmentsE2E.test.js \
  tests/consumptionInventoryE2E.test.js \
  tests/kardexReconciliation.test.js
```

## Matriz mínima de cobertura

| ID | Escenario | Invariante principal |
|---|---|---|
| IK-E2E-001 | Venta normal | snapshot correcto |
| IK-E2E-002 | Caja/medio bulto | cantidad física |
| IK-E2E-003 | Combo | componentes |
| IK-E2E-004 | Modular | selecciones |
| IK-E2E-005 | SKU repetido | agregación/idempotencia |
| IK-E2E-006 | Anulación | reversión exacta |
| IK-CONS-001 | Cobro diferido | no descuento prematuro |
| IK-CONS-002 | Despacho | descuento único |
| IK-CONS-008 | Anulación diferida | solo despachado |
| IK-ADJ-003 | Clamp | cantidad aplicada |
| IK-ADJ-005 | 50 ajustes rápidos | serialización |
| IK-ADJ-008 | Remoto delta | lock + snapshot |
| IK-TX-005 | Fallo Kardex | pending/retry |
| IK-REC-003 | Discrepancia | detección |
| IK-REC-009 | Dry-run | no mutación |
| IK-UI-004 | CSV | escape seguro |
| IK-CLOUD-005 | Offline sync | sin duplicados |

## Property-based / fuzzing ligero

Sin agregar una librería nueva inicialmente, usar tablas generadas con `Array.from` y semilla fija para probar:

- cantidades 0, positivas, decimales y negativas;
- combinaciones de caja/unidad/medio bulto;
- secuencias aleatorias de entradas/salidas/anulaciones;
- reintentos en posiciones aleatorias;
- stock inicial cero, positivo y negativo permitido.

Para cada secuencia verificar:

```text
stockFinal === stockInicial + suma(movimientos)
no hay movimiento inválido
no hay doble referencia aplicada
```

Si más adelante se requiere property-based testing formal, evaluar una dependencia solo después de verificar que no exista ya en el proyecto y aprobar su impacto en bundle/devDependencies.

---

# 6. Gates por fase y stop conditions

Cada fase debe terminar con:

```bash
bun run lint
bun run test
bun run typecheck
bun run build
bun run format:check
```

El `typecheck` actual puede terminar con éxito aunque reporte incidencias porque el script contiene `|| true`; el plan debe registrar la salida real y no usar el código de salida como única evidencia.

## Detener inmediatamente si

- aparece una regresión fuera del alcance de la fase;
- una operación puede guardar stock sin Kardex o Kardex sin operación detectable;
- un reintento cambia cantidades;
- un test depende de datos reales del negocio;
- se propone editar/borrar Kardex histórico;
- una modificación necesita SQL pero no existe migración/versionado;
- `withLock` vuelve a introducir anidamiento/deadlock;
- la suite completa no puede distinguir errores de entorno de fallos de producto.

## Gate de release

No publicar el fixeo de Inventario/Kardex hasta tener:

- suite E2E dedicada verde dos veces consecutivas;
- suite completa sin errores de entorno;
- `lint` sin errores nuevos;
- build reproducible;
- verificación SQL/RLS ejecutada en el proyecto correcto;
- reporte dry-run de discrepancias históricas;
- plan de reparación histórica aprobado por el usuario;
- checklist manual completado en una caja de prueba.

---

# 7. Orden de implementación recomendado

```text
Fase 0  Arnés y baseline
   ↓
Fase 1  Modelo físico puro
   ↓
Fase 2  Fachada transaccional Stock + Kardex
   ↓
Fase 3  Checkout + anulaciones
   ↓
Fase 4  Ajustes locales + remotos
   ↓
Fase 5  Consumo diferido
   ↓
Fase 6  Conciliación + snapshots + dry-run
   ↓
Fase 7  UI + CSV + rendimiento
   ↓
Fase 8  Cloud/RLS/outbox
```

### Prioridad resumida

1. **P0:** snapshots, combos/modulares, consumo diferido, ajustes falsos, idempotencia y errores de Kardex.
2. **P1:** conciliación real, snapshots sin ocultar negativos, outbox y RLS.
3. **P2:** UI, CSV, paginación, costo promedio y fuzzing.

**Este documento no aplica ninguna de estas correcciones automáticamente.**
