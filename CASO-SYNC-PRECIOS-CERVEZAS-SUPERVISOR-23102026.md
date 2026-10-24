# Caso de Estudio y Reporte Forense: Sincronización de Precios de Cervezas (Supervisor ➔ PC de Caja)

> **Fecha del Incidente:** 23 de Octubre de 2026 (~22:29 a 23:00 UTC / 18:29 a 19:00 HL)  
> **Dispositivo Principal Autoritativo:** `PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F` (PC / Caja Principal)  
> **Operador en Caja durante el incidente:** Luis Medina (`CAJERO`, ID: 2)  
> **Dispositivos Supervisor involucrados:** `mon_j3mewwp8q6_mtdn9jyo`, `mon_d7qah2gaq0_mvbpl0c7`, `mon_o7v9vj2u8v_mviv7cky`  
> **Estado del Reporte:** Auditado, causas raíz identificadas y fixeo de ingeniería propuesto. Causa #2 **cerrada con evidencia forense** el 24-10-2026 (sección 6). Diagnóstico del «cambio en confirmación» atascado en la sección 7.

---

## 1. Resumen Ejecutivo del Incidente

El supervisor modificó desde el Monitor Remoto los precios de venta en Bolívares (modo `bs_fijo`) para cajas y medias cajas de cerveza retornable (Solera Pilsen, Polar Light, Zulia y Polar Negrita).

* **Síntoma reportado:** Los precios modificados no se reflejaban en la pantalla de ventas ni en los cobros de la PC de caja (a excepción de Polar Negrita, que sí cambió). El supervisor reenvió los comandos varias veces observando que en el monitor pasaban a estado `applied`, pero en la caja los productos seguían con el precio anterior.
* **Diagnóstico de Infraestructura:** La conectividad en tiempo real (Supabase Realtime y canal de comandos `supervisor_commands`) **funcionó al 100%**. Los 9 comandos emitidos llegaron a la PC de caja en un lapso de 3 a 5 segundos y fueron procesados localmente.
* **Causa Raíz Global:** Coexistencia de dos fallas a nivel de software:
  1. **Conflicto de alias en actualización por lote (`batch_edit`):** La fusión de claves en `remoteInventoryProcessor.js` priorizó el valor viejo de `boxPriceBs` del producto existente sobre el valor nuevo de `boxPriceBsManual` enviado por el asistente.
  2. **Condición de carrera con el Autoguardado de React (`ProductContext.jsx`):** En comandos individuales rápidos, el autoguardado de la PC (debounce de 1000 ms) sobreescribió en IndexedDB y en la nube los precios recién mutados con los datos viejos que React aún conservaba en memoria.

---

## 2. Cronología y Evidencia Forense de Comandos

En la tabla `supervisor_commands` se verificaron los 9 comandos emitidos:

| # | Hora (UTC) | ID Comando | Tipo / Acción | Producto Afectado | Precio Enviado | Resultado Real en PC/Cloud |
|---|---|---|---|---|---|---|
| 1 | 22:29:43 | `33fe17c5` | `edit` | Cerveza Zulia | Caja: 25.750 Bs / ½: 12.880 Bs | **Revertido a 25.480 Bs / 12.740 Bs** |
| 2 | 22:32:32 | `70a02725` | `edit` | Cerveza Zulia | Caja: 25.750 Bs / ½: 12.880 Bs | **Revertido a 25.480 Bs / 12.740 Bs** |
| 3 | 22:33:24 | `f1dd76ae` | `edit` | **Polar Negrita** | Caja: 25.750 Bs / ½: 12.880 Bs | ✅ **APLICADO EXITOSAMENTE** |
| 4 | 22:34:12 | `391235a4` | `edit` | Polar Light | Caja: 25.750 Bs / ½: 12.880 Bs | **Revertido a 25.480 Bs / 12.740 Bs** |
| 5 | 22:35:54 | `8b01cb00` | `edit` | Cerveza Zulia | Caja: 25.750 Bs / ½: 12.880 Bs | **Revertido a 25.480 Bs / 12.740 Bs** |
| 6 | 22:37:03 | `7339c2f2` | `edit` | Solera Pilsen | Caja: 27.225 Bs / ½: 13.860 Bs | **Revertido a 26.950 Bs / 13.020 Bs** |
| 7 | 22:38:52 | `45587224` | `edit` | Polar Light | Caja: 25.750 Bs / ½: 12.880 Bs | **Revertido a 25.480 Bs / 12.740 Bs** |
| 8 | 22:47:03 | `cd582c9f` | `edit` | Solera Pilsen | Caja: 27.230 Bs / ½: 13.860 Bs | **Revertido a 26.950 Bs / 13.020 Bs** |
| 9 | 22:59:19 | `41b5b9a0` | `batch_edit` | Solera Pilsen | Caja: 27.230 Bs / ½: 13.860 Bs | **Ignorado por bug de alias (26.950 Bs)** |

> **Evidencia en ventas:** A las 22:14:27 UTC (15 minutos antes de la ráfaga de comandos), la PC registró la **Venta #1468** (Operador: Luis Medina), vendiendo 1 Caja de Zulia a **25.480,00 Bs**.

---

## 3. Análisis Detallado de las Causas Raíz

### Causa Raíz #1: En envíos por lote (`batch_edit`) — Conflicto de alias en `normalizeProduct`

1. Cuando el Supervisor ajusta precios con el Asistente de Bolívares Congelados (`BsCongeladoWizardModal.jsx` / `MonitorOverlays.jsx`), el payload emite los cambios usando claves manuales:
   ```javascript
   // MonitorOverlays.jsx:495-502
   if (p.boxPriceBsManual !== undefined) {
       changes.boxPriceBsManual = p.boxPriceBsManual; // Ej: 27230
       changes.boxPricingMode = p.boxPricingMode || 'bs_fijo';
   }
   ```
2. Al llegar a la PC, `remoteInventoryProcessor.js` (`applyInventoryCommand`, línea 303) ejecuta:
   ```javascript
   const mergedPayload = { ...existingProd, ...pData };
   ```
3. El producto `existingProd` ya almacenaba en IndexedDB las dos claves canónica y legacy:
   * `existingProd.boxPriceBs = 26950` (Precio viejo)
   * `existingProd.boxPriceBsManual = 26950` (Precio viejo)
4. La fusión `{ ...existingProd, ...pData }` sobrescribe `boxPriceBsManual` con `27230`, pero **deja intacto `boxPriceBs` en `26950`**.
5. Seguidamente, `normalizeProduct` invoca:
   ```javascript
   const boxPriceBs = readPositiveMoney(data.boxPriceBs, data.boxPriceBsManual);
   ```
6. Según [productPriceMigration.js](file:///c:/Users/luigg/Desktop/sistemas%20personalizados/donde%20juancho/sistema%20pos/projects/donde%20juancho/src/utils/productPriceMigration.js#L10), `readPositiveMoney` evalúa los argumentos en orden y retorna el **primer número finito mayor a cero**:
   * Como `data.boxPriceBs` (26.950) es válido, retorna `26950`.
   * El valor `27230` presente en `data.boxPriceBsManual` es **ignorado por completo**.
7. Resultado: La PC guarda en IndexedDB exactamente el precio viejo (26.950 Bs), actualiza `updatedAt`, marca el comando como `applied`, y el precio jamás cambia.

---

### Causa Raíz #2: En envíos individuales (`edit`) — Race Condition con el Autoguardado de React

1. Cuando el primer comando individual llegó a la PC (Comando #3, Polar Negrita a las 22:33:24), la PC lo procesó en IndexedDB y disparó el evento `supervisor_inventory_applied`.
2. `ProductContext.jsx` escuchó el evento y llamó a `setProducts`, cargando la Polar Negrita en el estado React.
3. El cambio en el estado `products` de React activó el hook de autoguardado en [ProductContext.jsx:344-387](file:///c:/Users/luigg/Desktop/sistemas%20personalizados/donde%20juancho/sistema%20pos/projects/donde%20juancho/src/context/ProductContext.jsx#L344-L387), que tiene un temporizador con **debounce de 1.000 ms**:
   ```javascript
   savingRef.current = true;
   const timer = setTimeout(() => {
       savePromises.push(withLock('pos_write_lock', async () => {
           const durableProducts = await storageService.getItem('bodega_products_v1', []);
           // ...
           const productsForSave = products.map(product => {
               const durable = durableById.get(product.id);
               if (!durable) return product;
               const merged = { ...product }; // <--- TOMA EL PRODUCTO DE LA MEMORIA REACT
               for (const field of stockTraceFields) {
                   merged[field] = durable[field]; // <--- SOLO PROTEGE EL STOCK
               }
               return merged;
           });
           await storageService.setItem('bodega_products_v1', productsForSave);
       }));
   }, 1000);
   ```
4. Mientras este temporizador de 1 segundo estaba corriendo en la PC, el supervisor envió rápidamente los siguientes productos (Polar Light a las 22:34, Zulia a las 22:35, Solera a las 22:37).
5. Cada comando entrante se escribió en IndexedDB bajo `withLock('pos_write_lock')`. Pero cuando el temporizador del autoguardado de React disparó su callback, ejecutó el bloque anterior:
   * Tomó `products` de la memoria React (donde Light, Zulia y Solera todavía tenían los **precios viejos de 25.480 y 26.950**).
   * Solo copió de `durable` los campos de stock (`stockTraceFields`).
   * **Sobrescribió todos los precios de formato (`boxPriceBs`, `halfBoxPriceBs`) con los valores viejos de React**.
   * Disparó el push a la nube a las 22:47:09 UTC, pisando el catálogo con los precios viejos.

---

## 4. Fixeo Recomendado (Solución Definitiva de Ingeniería)

Para blindar tanto las ediciones en lote como las individuales y evitar que el autoguardado de React pise mutaciones remotas, se deben aplicar las siguientes correcciones:

### Fix A: Normalización estricta de alias en `batch_edit` y `edit`
En [src/utils/remoteInventoryProcessor.js](file:///c:/Users/luigg/Desktop/sistemas%20personalizados/donde%20juancho/sistema%20pos/projects/donde%20juancho/src/utils/remoteInventoryProcessor.js):
* En `batch_edit` (líneas 303-310), antes de hacer `{ ...existingProd, ...pData }`, sincronizar los alias de `pData`:
  * Si `pData` incluye `boxPriceBsManual`, asignar explícitamente `pData.boxPriceBs = pData.boxPriceBsManual`.
  * Si `pData` incluye `halfBoxPriceBsManual`, asignar explícitamente `pData.halfBoxPriceBs = pData.halfBoxPriceBsManual`.
* De forma simétrica en [src/components/Monitor/MonitorOverlays.jsx](file:///c:/Users/luigg/Desktop/sistemas%20personalizados/donde%20juancho/sistema%20pos/projects/donde%20juancho/src/components/Monitor/MonitorOverlays.jsx#L495-L502), asegurar que el asistente emita ambos campos canónico y legacy (`boxPriceBs` y `boxPriceBsManual`).

### Fix B: Preservación de precios en el Autoguardado de `ProductContext.jsx`
En [src/context/ProductContext.jsx](file:///c:/Users/luigg/Desktop/sistemas%20personalizados/donde%20juancho/sistema%20pos/projects/donde%20juancho/src/context/ProductContext.jsx#L368-L385):
* En la función de autoguardado dentro de `withLock('pos_write_lock')`:
  * Si `durable` tiene un `updatedAt` más reciente que el `product` de React (`new Date(durable.updatedAt) > new Date(product.updatedAt)`), **el registro durable de IndexedDB debe tener precedencia en todos sus campos de precio y configuración**, no solo en stock.
  * Opcionalmente, agregar los campos de precio y auditoría (`boxPriceBs`, `boxPriceBsManual`, `halfBoxPriceBs`, `halfBoxPriceBsManual`, `priceBsManual`, `updatedAt`, `lastOperationId`) a la lista de campos que se leen frescos de `durable` si `durable` fue modificado por un supervisor remoto (`durable.updatedByRole === 'SUPERVISOR'`).

---

## 5. Procedimiento Operativo Provisional

Mientras se despliega el parche de código:
1. **Para forzar la actualización en la PC:**
   * En la PC de caja, recargar la página (F5 o Ctrl+F5) si se observa que un cambio remoto no refrescó la memoria de React.
2. **Para actualizar las cervezas que quedaron pendientes:**
   * Enviar los precios a través de un comando limpio con ambas claves, o esperar a la aplicación del Fix A y Fix B para re-enviar la actualización desde el Monitor.

---

## 6. Causa #2 — Cadena causal CERRADA (verificación forense 24-10-2026)

> **Pregunta que cierra esta sección:** ¿qué escritura con datos viejos de React ocurrió después del último autoguardado reparador?

### 6.1 La escritura culpable (respuesta)

La escritura con datos viejos fue **el callback del autoguardado de `ProductContext` (debounce 1000 ms)** cuya clausura `products` se capturó **antes** del dispatch `supervisor_inventory_applied`. Ese callback construye `productsForSave` en [ProductContext.jsx:360-387](src/context/ProductContext.jsx#L360-L387):

```javascript
const productsForSave = products.map(product => {
    const durable = durableById.get(product.id);
    if (!durable) return product;
    const merged = { ...product };          // ← TODA la fila desde la memoria React (¡con precios y updatedAt viejos!)
    for (const field of stockTraceFields) { // ← SOLO 7 campos de stock se protegen desde durable
        merged[field] = durable[field];
    }
    return merged;
});
```

Firma forense resultante: **precios + `updatedAt` + `updatedBy*` viejos (de memoria) junto a `stockUpdatedAt`/`stockUpdatedByRole`/`lastStockOperationId` frescos (de durable)**. Esa firma es única del autoguardado: ningún otro escritor del sistema mezcla así los campos.

### 6.2 El gap que hizo posible la clausura stale

En [useSupervisorCommands.js](src/hooks/useSupervisorCommands.js) el orden es:

1. `applyInventoryCommand` → `persistProductsSnapshot` escribe IndexedDB bajo `pos_write_lock` (y emite `app_storage_update`).
2. `await updateCommandStatus(...)` — con reintentos `CONFIRM_RETRY_DELAYS_MS = [3000, 6000, 12000]` ([línea 87](src/hooks/useSupervisorCommands.js#L87)) → **hasta ~21 s + red de ventana**.
3. Recién entonces se dispatcha `supervisor_inventory_applied` ([línea 835](src/hooks/useSupervisorCommands.js#L835)), que es lo que actualiza la memoria React (`handleSupervisorInventoryApplied` → `setProducts`).

Entre (1) y (3) la memoria React sigue con precios viejos. Cualquier `setProducts` previo (heal del comando anterior, ajuste de kardex, sync) programa un autoguardado cuya clausura es stale; si su callback **escribe después** de (1), revierte el comando.

### 6.3 Contención de `pos_write_lock` (el multiplicador)

El comando `8b01cb00` (`created_at` 22:35:54 → `applied_at` 22:37:33 = **99 s**) prueba la congestión exacta de esa ventana: la cola serial (`_processQueue`) y `withLock('pos_write_lock')` acumulan espera, así que una clausura programada en T puede escribir **minutos** después de ser capturada.

### 6.4 El bucle auto-confirmante (`savingRef` / `pendingStorageRefreshRef`)

Mientras un autoguardado está pendiente, `savingRef.current = true` (HOOK-018) hace que `handleAppStorageUpdate` **trague** el `app_storage_update` que emite `persistProductsSnapshot` y lo deje en `pendingStorageRefreshRef`. Al asentarse el autoguardado, 50 ms después se relee «fresco» — que **ya es lo que el autoguardado escribió con precios viejos** — y se inyecta de vuelta en React (`setProducts(clobbered)`), programando otro autoguardado igual. La reversión se auto-sostiene y el heal del comando es un evento de una sola vez que no se re-emite.

### 6.5 Huella forense verificada en la nube (24-10-2026 ~04:12 UTC)

| Producto | Precios (caja / ½) | `updatedAt` | `stockUpdatedAt` | Veredicto |
|---|---|---|---|---|
| Zulia | 25.480 / 12.740 (viejo) | **2026-10-10T00:34:13.091Z** (viejo) | 2026-10-24T01:51:16 (fresco, venta) | Firma del autoguardado ✅ |
| Polar Light | 25.480 / 12.740 (viejo) | **2026-10-10T00:35:42.730Z** (viejo) | 2026-10-24T03:38:32 (fresco) | Firma del autoguardado ✅ |
| Polar Negrita | 25.750 / 12.880 (nuevo) | 2026-10-23T22:33:28.805Z (= heal del comando #3) | fresco | Sobrevivió ✅ |
| Solera | 26.950 / 13.020 (viejo) | 2026-10-23T22:59:24.203Z (= escritura del comando #9) | fresco | Última escritura = #9 (bug de alias) ✅ |

**Timing del clobber final:** la última escritura reparadora de Zulia/Light fue la de los comandos #5/#7 (~22:37:33–22:38:57); la escritura stale que las revirtió cayó **≈22:47:08.6**, justo después del durable write del comando #8 — su `scheduleCloudProductsSync` (400 ms) disparó **el push de las 22:47:09** que la sección 2 ya documenta (ese push fue *salida* del estado revertido, no una reversión entrante). Ninguna escritura stale posterior a las 22:59:24 (Solera conserva `updatedAt` 22:59:24 = comando #9).

**Por qué Negrita sobrevivió:** la clausura que hizo el clobber final se capturó **después** del heal de #3 (22:33:28.805) y por eso ya traía Negrita fresca; Zulia/Light/Solera entraron en esa misma clausura con sus precios viejos.

### 6.6 Merge de vuelta desde la nube: DESCARTADO

El POS primario es **push-only** para `bodega_products_v1`: `_applyFromCloud` ([useCloudSync.js:493](src/hooks/useCloudSync.js#L493)) solo lo usa el monitor, y `useCloudSync` eliminó su auto-suscripción (comentario «EGRESS-FIX (RC3)»); su init solo sube con guard de hash. No existió ninguna escritura nube→PC de productos en la ventana: el evento de las 22:47:09 fue un **push saliente** del catálogo ya revertido.

### 6.7 Corrección al escenario de la sección 3

El relato original decía que el temporizador de 1 s «estaba corriendo» mientras llegaban los comandos de las 22:34/22:35/22:37. Un debounce de 1 s no puede abarcar 3 minutos. La mecánica real, verificada arriba: **clausuras stale que escriben tarde** (empujadas por la contención del lock y el gap de `updateCommandStatus`) **más** el refresh diferido que re-ingiere el clobber. El efecto observable (precios viejos + push de las 22:47:09) es idéntico.

### 6.8 Implicaciones para el Fix B (ampliado)

1. Merge **durable-first** cuando `durable.updatedAt > product.updatedAt`: precios + `updatedAt` + `updatedBy*` + `lastOperationId` deben venir de durable, no de memoria.
2. `lastOperationId` **no** está hoy en `stockTraceFields` ([ProductContext.jsx:370-378](src/context/ProductContext.jsx#L370-L378)): el autoguardado destruye el recibo de comando (verificado: el eco conserva `lastOperationId` del comando #1 y perdió el de #2/#3).
3. Cerrar el gap: dispatchar `supervisor_inventory_applied` **inmediatamente después de `persistProductsSnapshot`**, antes del `await updateCommandStatus` (la confirmación en la nube no debe retrasar el heal local).

### 6.9 Fix B implementado (24-10-2026) ✅

1. **B1 — Merge durable-first** en el autoguardado ([ProductContext.jsx](src/context/ProductContext.jsx)): si `durable.updatedAt` es **estrictamente** más nuevo que `product.updatedAt`, la fila durable manda completa (`{ ...product, ...durable }`) — precios, `updatedAt`, `updatedBy*` y cualquier atributo viejo de la memoria quedan protegidos. Con marcas iguales o memoria más nueva, la memoria gana como antes (una edición local reciente sigue siendo intocable). El caso de la huella de Zulia (clausura con `updatedAt` 2026-10-10 escribiendo sobre el heal del 2026-10-24) ya no puede revertir nada.
2. **B3 — Recibo protegido:** `lastOperationId` añadido a `stockTraceFields` → siempre se toma de durable, incluso cuando la memoria es más nueva (una clausura que arrastre un recibo viejo no puede destruir el recibo nuevo). Esto alimenta `hasSupervisorReceipt` y evita cambios «en confirmación» huérfanos.
3. **B2 — Gap cerrado:** `supervisor_inventory_applied` se dispatcha **antes** del `await updateCommandStatus` ([useSupervisorCommands.js](src/hooks/useSupervisorCommands.js)) — el heal local ya no espera la confirmación en la nube (hasta ~21 s de reintentos con `CONFIRM_RETRY_DELAYS_MS`).

**Pruebas de regresión (5 nuevas, todas en verde):**

* [tests/productAutosaveDurableFirst.test.jsx](tests/productAutosaveDurableFirst.test.jsx): la clausura stale con la huella real de Zulia (precios 25.480 + `updatedAt` 2026-10-10) ya no revierte el heal (27.230 + auditoría + recibo `cmd-2`); con marcas iguales la memoria gana (solo durable estrictamente más nuevo invierte la prioridad); `lastOperationId` se preserva desde durable aunque la memoria sea más nueva.
* [tests/supervisorCommandHealOrder.test.js](tests/supervisorCommandHealOrder.test.js): el evento se dispara con la confirmación en la nube **colgada** (prueba del gap) y también si la confirmación falla.

**Verificación:** 5/5 nuevas + 120/121 en las suites de invariantes/cola/inventario (el fallo `remoteKardexEgress` es preexistente) + suite completa: 1106 aprobadas, 6 fallos preexistentes idénticos sin mis cambios (checkoutTelemetryWiring, importStorageIntegration, remoteKardexEgress, settingsStorageIntegration ×2, shiftHistoricalCierresGuard). Lint: 0 errores.

---

## 7. Diagnóstico: «1 cambio en confirmación» atascado (24-10-2026)

**Síntoma:** el Monitor muestra «1 cambio en confirmación / Esperando confirmación de la caja»; el botón **DESCARTAR** no lo quita («Descartados solo cambios sin enviar…») y la única forma de limpiarlo es resincronizar con la caja. Además el historial muestra «APLICADO EN CAJA EL 31/12/1969».

### 7.1 Cómo se confirma un cambio (`useSupervisorCommandQueue.js:93-115`)

Un cambio en vuelo solo se resuelve con **evidencia dura**:
1. **Recibo en el producto:** `lastOperationId` / `lastStockOperationId` / `stockOperationIds` = `commandId` (`hasSupervisorReceipt`), o
2. **`edit`:** igualdad exacta de **todas** las claves de `change.data` contra el producto sincronizado (solo se excluyen `baseUpdatedAt`/`updatedAt`/`createdAt`/`stock`), o
3. **`adjust_stock` sin recibo:** `applied_at` **finito** + `stockUpdatedAt > applied_at` + anillo `stockOperationIds` ≥ 25.

### 7.2 Por qué queda atascado (verificado en la nube)

* El eco del catálogo tiene `lastOperationId: 97a203f3-…` (= comando #1 de esta noche) pero **no** el de los comandos posteriores (`f1920b3e`, `d0daef37`): el recibo se pierde porque (a) cada comando nuevo lo sobrescribe y (b) **el autoguardado de la Causa #2 lo destruye** (`lastOperationId` no está en `stockTraceFields`).
* La igualdad exacta es casi imposible: `change.data` es el **blob completo del producto** (el payload del comando = `change.data`, [useSupervisorCommandQueue.js:702](src/hooks/useSupervisorCommandQueue.js#L702)). Verificado: el comando `f1920b3e` esperaba `priceUsd: 3.8` y el catálogo quedó en `3.9` → comparación fallida **para siempre**.
* La recuperación automática (`requestRecovery`) es de **un solo disparo por `commandId`** (`recoveryRequestedRef`, [líneas 63-66](src/hooks/useSupervisorCommandQueue.js#L63-L66)) y puede ejecutarse antes de que el eco llegue; después, el pull incremental (cursor `pullCursorRef`) no vuelve a traer el documento sin `updated_at` nuevo → **el cambio queda huérfano**.

### 7.3 Por qué no se puede descartar (es por diseño)

`discardPendingChanges` ([línea 821](src/hooks/useSupervisorCommandQueue.js#L821)) conserva a propósito los cambios `inFlight` y los `pending` ya intentados («Los enviados se conservan hasta confirmar o cancelar en la nube»), y `discardSinglePendingChange` rechaza cambios con `attemptedAt`. El botón **Anular 🚫** (`cancelSingleCloudCmd`) solo existe para comandos `pending` en la nube (`cloudPendingCmds`); un comando ya `applied` **no tiene salida por la UI**.

### 7.4 Por qué resincronizar lo desatasca

`supervisor_sync_requested` → `handleSupervisorRecovery` ([useMonitorSync.js:626](src/hooks/useMonitorSync.js#L626)) resetea `pullCursorRef = null` → **pull completo** del catálogo de la caja → re-aplica el doc (el guard de versión permite `updated_at` igual) → `products` cambia → el efecto de confirmación se re-evalúa con la evidencia fresca (recibo presente o valores coincidentes) → el cambio se resuelve.

### 7.5 El «APLICADO EN CAJA EL 31/12/1969»

Los comandos `sale_number_claim` se marcan `applied` **sin `applied_at`**: [saleNumberAllocator.js:197](src/utils/saleNumberAllocator.js#L197) hace `update({ status: 'applied' })` a secas. Verificado en la nube: 8+ comandos `sale_number_claim` del 24-10 (02:03–03:57 UTC) con `applied_at: null`. El render [MonitorCambiosTab.jsx:229](src/components/Monitor/MonitorCambiosTab.jsx#L229) hace `new Date(cmd.applied_at)` **sin guardia de null** → epoch → 31/12/1969 en UTC-4.

> **Riesgo asociado (no solo cosmético):** un `adjust_stock` cuyo comando confirme por un camino que deje `applied_at` NULL (p. ej. el fallback «Reintentando solo con status…» de `updateCommandStatus`) **nunca puede confirmarse** (`Date.parse(null)` → `NaN` en la rama 3 de 7.1) → mismo síntoma de cambio atascado.

### 7.6 Fixes recomendados

1. **[XS]** ✅ **Hecho (7.7):** guardia de null/parseo en `MonitorCambiosTab.jsx` — «APLICADO EN CAJA (SIN SELLO)» cuando `applied_at` falta o no parsea.
2. **[XS]** ✅ **Hecho (7.7):** `saleNumberAllocator.js` sella `applied_at` en la autoconfirmación del reclamo.
3. **[S]** ✅ **Hecho (6.9):** `lastOperationId`/`stockOperationIds` protegidos en el autoguardado (Fix B3) — los recibos ya no se pierden.
4. **[S]** Comparación de `edit`: comparar solo las claves realmente editadas (o excluir campos de auditoría/recibo derivados como `lastOperationId`, `stockOperationIds`, `updatedBy*`).
5. **[M]** ✅ **Hecho (7.8):** `requestRecovery` con backoff acotado (15s/45s/120s/300s) y abandono de cambios en confirmación con comando terminal.

### 7.7 Fix implementado (24-10-2026) ✅

* **Fuente:** la autoconfirmación del `sale_number_claim` ([saleNumberAllocator.js](src/utils/saleNumberAllocator.js)) ahora escribe `applied_at` además de `status: 'applied'` → los claims nuevos ya no generan filas con sello NULL.
* **Render:** [MonitorCambiosTab.jsx](src/components/Monitor/MonitorCambiosTab.jsx) parsea `applied_at` con guardia (`Date.parse` + `Number.isFinite`): NULL o malformado → «APLICADO EN CAJA (SIN SELLO)» (nunca más 31/12/1969 ni «Invalid Date»); válido → fecha y hora normales.
* **Pruebas de regresión:** 3 nuevas en [tests/monitorCambiosAppliedDate.test.jsx](tests/monitorCambiosAppliedDate.test.jsx) (NULL, malformado, válido) + [tests/saleNumberAllocator.test.js](tests/saleNumberAllocator.test.js) (el claim sella un `applied_at` finito). Dos aserciones de tests previas fijaban el payload **buggy** (`{ status: 'applied' }` sin sello) y se actualizaron para exigirlo: [saleNumberAllocator.test.js](tests/saleNumberAllocator.test.js) y el regex de [saleNumberAllocatorWiring.test.js](tests/saleNumberAllocatorWiring.test.js) — el invariante es ahora más fuerte, no más débil.
* **Verificación:** 67/67 (render + allocator + wiring + cola del supervisor), 54/54 (checkout/gastos que consumen el allocator), lint 0 errores.
* **Restante:** las filas **ya existentes** con `applied_at` NULL conservan el NULL en la nube (el render ya las muestra como «SIN SELLO»); el riesgo asociado del fallback de `updateCommandStatus` (7.5) sigue abierto.

### 7.8 Desatasque implementado (24-10-2026) ✅

* **Abandono con comando terminal:** nuevo `isChangeAbandonable` ([supervisorCommandModel.js](src/utils/supervisorCommandModel.js)) — un cambio solo es abandonable si su comando ya está **terminal** (`applied` / `applied_with_warnings` / `failed` / `cancelled`); un comando aún `pending` o desconocido se conserva porque todavía puede aplicarse. `discardPendingChanges` (botón DESCARTAR del banner y del modal) ahora retira **también** los cambios `inFlight` «en confirmación» con comando terminal — antes ningún descarte tocaba `inFlight`, por eso el botón no quitaba nada —, y `discardSinglePendingChange` abandona en vez de rechazar en ese caso. Con comando terminal el abandono es seguro: nada más llegará de la caja y el eco canónico es la verdad (7.3).
* **Backoff en la recuperación:** `requestRecovery` deja de ser un-shot por `commandId` (`recoveryRequestedRef`, 7.2) y pasa a una cadena acotada con backoff [15s, 45s, 120s, 300s] → 5 disparos en total (0s, 15s, 60s, 180s, 480s). La cadena se corta con `stopRecovery` cuando el cambio se resuelve, se abandona o al desmontar — sin tormentas de pulls. Esto cubre la ventana en la que el disparo único ocurría antes de que el eco del catálogo llegara y el pull incremental ya no lo traía.
* **Pruebas de regresión (5 nuevas)** en [tests/supervisorQueueLifecycle.test.js](tests/supervisorQueueLifecycle.test.js): los 5 disparos del backoff y su corte al resolverse; abandono del «1 cambio en confirmación» con comando terminal; conservación mientras el comando siga `pending`; descarte individual (abandona con terminal, rechaza el desconocido).
* **Verificación:** 61/61 (cola del supervisor + modelo + sync optimista + recuperación + conflictos), 16/16 (tasa + transacciones de cliente), lint 0 errores. 7.6.1–7.6.3 y 7.6.5 quedan implementados; **resta** 7.6.4 (comparación de `edit` por claves realmente editadas).
