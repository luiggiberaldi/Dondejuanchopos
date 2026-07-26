# Plan de Ejecución — Optimización de Egress (prerrequisito de Multisupervisor)

> **Audiencia:** LLM ejecutor. Sigue este documento al pie de la letra.
> **Regla de oro:** verificado contra el código real. Si algo no coincide, DETENTE y reporta.
> **Protocolo:** anclas de texto, no números de línea. Un commit por fase.
> **Harness por fase:** `npx eslint --no-cache <archivos>` (0 errores) + `npx vitest run <tests>` + `npm run build`.

---

## 0. Por qué existe este plan

Decisión del usuario: **optimizar el egress ANTES de implementar multisupervisor** (`future_plans/multisupervisor.md`). Multiplicar por N supervisores un modelo caro sale mucho peor que optimizar primero y luego multiplicar.

### El problema raíz

La sincronización es **documento-completo, no delta**. Cada venta hace `upsert` del array **entero** de `bodega_sales_v1` ([useCloudSync.js](src/hooks/useCloudSync.js), ANCLA: `.from('sync_documents').upsert({`), y ese upsert dispara un broadcast de Realtime que el monitor recibe completo.

```
egress ≈ Σ(escrituras) × tamaño_documento_completo × (1 + nº monitores)
```

Es **cuadrático en el tiempo**: con 2.000 ventas acumuladas, cada venta nueva sube y broadcastea el historial entero. El costo crece aunque el volumen de ventas sea constante.

### Lo que YA está optimizado (no tocar)

- `REPLICA IDENTITY DEFAULT` en `sync_documents` (FASE 2 de `supabase_egress_optimization.sql`).
- Imágenes en Storage, no en el payload (`product-images`).
- RC2: doble-push eliminado (el listener de `app_storage_update` que re-empujaba).
- RC3: canal de auto-eco `sync:${deviceId}` eliminado.
- Hash-guard en el push periódico (`LAST_PUSH_HASH_PREFIX`).

### Las 5 palancas de este plan

| # | Palanca | Ahorro estimado | Fase |
|---|---|---|---|
| P1 | Podar historial de ventas a 30 días en el sync | 70-90% (crece con la antigüedad del negocio) | F2 |
| P2 | Sacar `abasto_audit_log_v1` del sync | Un flujo entero eliminado | F1 |
| P3 | Realtime selectivo por `doc_id` en el monitor | 40-60% del tráfico del monitor, ×N supervisores | F3 |
| P4 | Subir `DEBOUNCE_HEAVY_MS` de 3s a 12s | Agrupa ráfagas en hora pico | F1 |
| P5 | Revisar push periódico de 20s y colisión de `quickHash` | Menor, pero corrige un bug latente | F4 |

---

## 1. Diccionario de anclas

| Elemento | Archivo | Ancla |
|---|---|---|
| Claves de IndexedDB | `src/config/backupKeys.js` | `export const IDB_KEYS = Object.freeze([` |
| Claves sincronizadas | `src/hooks/useCloudSync.js` | `const SYNC_KEYS = [...new Set([...IDB_KEYS, ...LS_KEYS,` |
| Keys pesadas / debounce | `src/hooks/useCloudSync.js` | `const HEAVY_KEYS = [` |
| Constante debounce pesado | `src/hooks/useCloudSync.js` | `const DEBOUNCE_HEAVY_MS = 3000;` |
| Upsert a la nube | `src/hooks/useCloudSync.js` | `const { error } = await supabaseCloud.from('sync_documents').upsert({` |
| Push periódico | `src/hooks/useCloudSync.js` | `const forcePushLocalData = async () => {` |
| Intervalo de 20s | `src/hooks/useCloudSync.js` | `const intervalId = setInterval(forcePushLocalData, 20000);` |
| Hash rápido | `src/hooks/useCloudSync.js` | `function quickHash(value) {` |
| Sync forzado completo | `src/hooks/useCloudSync.js` | `export const forceSyncAllPOSData = async (overrideDeviceId) => {` |
| Suscripción del monitor | `src/hooks/useMonitorSync.js` | `.on('postgres_changes', {` |
| Pull inicial del monitor | `src/hooks/useMonitorSync.js` | `.in('collection', ['store', 'local']);` |
| Reconstrucción de cierres | `src/views/OwnerMonitorView.jsx` | `const registerCloses = useMemo(() => {` |

---

## 2. Fases

### FASE 1 — Ganancias inmediatas de bajo riesgo (P2, P4)

**Archivos:** `src/hooks/useCloudSync.js`

**1.1 — Sacar `abasto_audit_log_v1` del sync a la nube (P2).**
Es un log append-only que **solo crece** y que el monitor no muestra en ninguna vista. Hoy viaja a la nube y se broadcastea en cada cambio.

⚠️ **No tocar `IDB_KEYS`** (ANCLA: `export const IDB_KEYS = Object.freeze([`): esa lista es la fuente de verdad de los **backups**, y el log de auditoría sí debe respaldarse. La exclusión va únicamente en la capa de sync.

En `useCloudSync.js`, tras ANCLA `const SYNC_KEYS = [...new Set([...IDB_KEYS, ...LS_KEYS,`, introducir una lista de exclusión explícita:
```js
// EGRESS: claves que se respaldan (IDB_KEYS) pero NO se sincronizan a la nube.
// El log de auditoría solo crece y ninguna vista del monitor lo consume.
const NO_SYNC_KEYS = ['abasto_audit_log_v1'];
```
y filtrar `SYNC_KEYS` con ella. Verificar que `forceSyncAllPOSData` (ANCLA: `export const forceSyncAllPOSData`) también la respete — recorre `IDB_KEYS` directamente, así que necesita el filtro explícito.

**Verificación obligatoria:** `grep -rn "abasto_audit_log_v1" src/` para confirmar que ninguna vista del monitor lo lee. Si alguna lo consume, DETENTE y reporta.

**1.2 — Subir el debounce pesado (P4).**
ANCLA: `const DEBOUNCE_HEAVY_MS = 3000;` → `12000`. En hora pico agrupa muchas más ventas en un solo upsert. Costo: hasta 12 s de latencia en el monitor, aceptable para supervisión (D2).

Actualizar el comentario de la constante para que diga por qué es 12 s y cuál es el trade-off.

**Harness:** eslint + `npx vitest run tests/remoteInventory.test.js tests/pricingMode.test.js` + `npm run build`.

**Commit:** `perf(egress): excluir audit log del sync y agrupar mas las escrituras pesadas`.

---

### FASE 2 — Poda de historial de ventas (P1 — el mayor ahorro)

**Archivos:** `src/hooks/useCloudSync.js`, `tests/egressPruning.test.js` [NUEVO]

> Decisión del usuario: **podar a los últimos 30 días**.

**2.1 — La regla (D1, crítica).**
La caja conserva **SIEMPRE el 100% del historial en local**. La poda afecta **exclusivamente** a lo que se sube a `sync_documents`. Ningún dato se pierde ni se borra: es un recorte de transporte, no de almacenamiento. Esto **no es migración de datos** (constraint del proyecto respetado).

**2.2 — Preservar la integridad de los cierres (D3, el detalle que hace no-trivial la poda).**
`OwnerMonitorView.jsx` (ANCLA: `const registerCloses = useMemo(() => {`) **reconstruye los cierres agrupando el array de ventas por `cierreId`**, y combina cada grupo con su fila `tipo === 'REGISTRO_CIERRE'`. Una poda ingenua por fecha partiría cierres a la mitad: dejaría el `REGISTRO_CIERRE` sin sus transacciones o al revés, produciendo arqueos con totales incorrectos en el monitor.

Regla de poda correcta, en este orden:
1. Conservar toda venta con `timestamp` dentro de los últimos **30 días**.
2. Conservar además **todas** las transacciones cuyo `cierreId` aparezca en el conjunto del paso 1 (aunque su timestamp sea más viejo).
3. Conservar toda transacción **sin `cierreId`** y con `cajaCerrada` falsy — es decir, el turno abierto en curso, sin importar su antigüedad. (ANCLA de la lógica que lo consume: `const unclosed = sales.filter(s => !s.cajaCerrada`.)

**2.3 — Implementación.**
Función pura y exportable `pruneSalesForSync(sales, nowMs)` en `useCloudSync.js` (parámetro `nowMs` explícito para que sea testeable — `Date.now()` no se puede usar en tests deterministas).

Aplicarla en el punto único de subida (ANCLA: `const { error } = await supabaseCloud.from('sync_documents').upsert({`): si `key === 'bodega_sales_v1'`, subir `pruneSalesForSync(value, Date.now())` en vez de `value`.

⚠️ **El hash se calcula sobre el valor LOCAL completo, no sobre el podado.** Si se hashea el podado, el paso del tiempo cambia el recorte y dispararía re-subidas fantasma. Verificar esto en `pushCloudSync`, `forcePushLocalData` y el bloque de auto-recuperación — los tres escriben `LAST_PUSH_HASH_PREFIX`.

**2.4 — Aviso en el monitor (D4).**
El monitor debe indicar que su historial está acotado ("Mostrando los últimos 30 días") para que nadie interprete un reporte antiguo vacío como pérdida de datos. Texto discreto en la pestaña de cierres.

**Tests nuevos** en `tests/egressPruning.test.js`:
1. Venta de hace 5 días → conservada.
2. Venta de hace 90 días sin `cierreId` y con `cajaCerrada` → podada.
3. Venta de hace 90 días cuyo `cierreId` **sí** está en la ventana de 30 días → **conservada** (integridad de cierre).
4. `REGISTRO_CIERRE` viejo con transacciones dentro de la ventana → conservado junto a su grupo.
5. Transacción vieja sin `cierreId` y sin `cajaCerrada` (turno abierto) → conservada.
6. Array vacío / `null` → no lanza, devuelve array vacío.

**Harness:** `npx vitest run tests/egressPruning.test.js` + eslint + `npm run build`.

**Commit:** `perf(egress): podar historial de ventas a 30 dias en el sync preservando cierres`.

---

### FASE 3 — Realtime selectivo en el monitor (P3 — habilita multisupervisor barato)

**Archivo:** `src/hooks/useMonitorSync.js`

**3.1 — El problema.**
La suscripción (ANCLA: `.on('postgres_changes', {`) filtra solo por `device_id`. El monitor recibe el payload **completo** de las 11 keys de IndexedDB cada vez que cualquiera cambia — incluidas las que **no pinta en ninguna vista**: `bodega_sales_mirror_v1`, `bodega_supplier_invoices_v1`, `bodega_pending_cart_v1`, `bodega_accounts_v2`. Y esto se paga **por cada supervisor conectado**.

**3.2 — Lista blanca de documentos.**
Definir las keys que el monitor realmente consume. Derivarlas por `grep` de `OwnerMonitorView.jsx`, no de memoria — hoy son al menos `bodega_sales_v1`, `bodega_products_v1`, `my_categories_v1`, `bodega_customers_v1` y las keys `local` de tasas/negocio.

En el handler de la suscripción, descartar temprano los `doc_id` fuera de la lista blanca (antes de `applyDocToLocal`). El pull inicial (ANCLA: `.in('collection', ['store', 'local']);`) debe filtrar igual, añadiendo `.in('doc_id', MONITOR_DOC_KEYS)`.

⚠️ El filtro de Realtime de Supabase **no soporta `IN`**, solo igualdad. Por eso el descarte es del lado del cliente: reduce el procesamiento pero **no el egress del broadcast**. El ahorro real de bytes viene del pull inicial (que sí se filtra en el servidor) y de las fases 1 y 2, que reducen el tamaño de lo que se broadcastea. **No prometer un ahorro de Realtime que el filtro cliente no da** — dejarlo escrito en el commit.

**3.3 — Verificación anti-regresión.**
Tras el filtro, confirmar que ninguna vista del monitor queda sin datos: revisar Inventario, Clientes, Monitor, Gastos y Cierres.

**Harness:** eslint + `npm run build`.

**Commit:** `perf(egress): monitor solo procesa y descarga los documentos que consume`.

---

### FASE 4 — Push periódico y colisión de hash (P5)

**Archivo:** `src/hooks/useCloudSync.js`

**4.1 — Bug latente en `quickHash` (prioridad real de esta fase).**
ANCLA: `for (let i = 0; i < Math.min(str.length, 5000); i++)`. El hash solo recorre los **primeros 5.000 caracteres**. En `bodega_sales_v1`, las ventas nuevas se agregan al **final** del array: dos estados distintos pueden producir el mismo hash si los primeros 5 KB coinciden y la longitud total colisiona. Consecuencia: **un cambio real puede no subirse nunca**. Es un riesgo de pérdida de sincronización, no de egress.

Corrección: muestrear también la **cola** del string (p. ej. primeros 2.500 + últimos 2.500 caracteres), manteniendo el costo constante. La longitud total sigue formando parte del hash.

Como el formato del hash cambia, la primera ejecución tras el deploy re-sube cada key una vez. Es un costo único y aceptable; dejarlo dicho en el commit.

**4.2 — Intervalo periódico.**
ANCLA: `const intervalId = setInterval(forcePushLocalData, 20000);`. Con el hash-guard corregido, 20 s no genera tráfico si nada cambió, pero **sí** lee y hashea las 11 keys de IndexedDB 3 veces por minuto de forma indefinida (costo de CPU/batería, no de red). Subir a **45 s** (D5): sigue siendo una red de seguridad para escrituras que se hayan escapado del debounce, con menos trabajo en reposo.

**Tests nuevos** en `tests/egressPruning.test.js`: dos arrays que comparten los primeros 5 KB y difieren solo al final producen hashes **distintos**.

**Harness:** `npx vitest run tests/egressPruning.test.js` + eslint + `npm run build`.

**Commit:** `fix(sync): quickHash muestrea la cola del documento y sube el intervalo periodico`.

---

### FASE 5 — Medición y cierre

> Sin medición esto es fe, no ingeniería.

1. `npx eslint --no-cache` sobre todos los archivos tocados — 0 errores.
2. `npx vitest run tests/egressPruning.test.js tests/remoteInventory.test.js tests/pricingMode.test.js` — todos verdes.
3. `npm run build` — ✓.
4. Crear `future_plans/PROGRESO_egress.md` con:
   - Línea base **antes** del deploy (dashboard de Supabase → Reports → Egress, valor del día).
   - Checklist de verificación manual (sección 4).
   - Casilla para anotar el egress a las 48 h y a los 7 días post-deploy.
5. Actualizar `future_plans/multisupervisor.md`: con estas palancas aplicadas, revisar si el tope de 4 monitores (D2 de ese plan) puede subir.

**Commit:** `docs(egress): registro de optimizacion y linea base de medicion`.

---

## 3. Decisiones de diseño

| ID | Decisión | Motivo |
|---|---|---|
| D1 | La poda afecta **solo al sync**; la caja conserva el 100% local | No es migración de datos (constraint del proyecto). Cero riesgo de pérdida: es transporte, no almacenamiento |
| D2 | Debounce pesado 3 s → 12 s | Agrupa ráfagas de hora pico. 12 s de latencia es invisible para supervisión |
| D3 | La poda respeta cierres completos y el turno abierto | `registerCloses` reconstruye arqueos agrupando por `cierreId`; una poda ingenua produciría totales incorrectos |
| D4 | El monitor avisa "últimos 30 días" | Sin el aviso, un reporte antiguo vacío se interpreta como pérdida de datos |
| D5 | Push periódico 20 s → 45 s | Con hash-guard correcto no genera tráfico en reposo; el ahorro es de CPU/batería |
| D6 | `IDB_KEYS` **no se toca**; la exclusión vive en la capa de sync | Esa lista gobierna los **backups**; el audit log sí debe respaldarse aunque no se sincronice |
| D7 | El hash se calcula sobre el valor **local completo**, nunca sobre el podado | El recorte cambia con el paso del tiempo → hashear el podado dispararía re-subidas fantasma |
| D8 | Se mantiene la regla D8 del proyecto: nunca base64 en payloads | Coherencia con `inventario_remoto_supervisor.md` y `supabase_egress_optimization.sql` |

---

## 4. Verificación manual

1. **Línea base:** anotar el egress del día en el dashboard de Supabase **antes** de desplegar.
2. Vender 5 productos seguidos → confirmar que se produce **un solo** upsert de `bodega_sales_v1` (pestaña Network), no cinco.
3. Monitor conectado: la venta aparece en ≤12 s (nuevo debounce). Si tarda más, revisar F1.
4. **Integridad de cierres (lo más importante):** con historial de más de 30 días, abrir la pestaña Cierres del monitor y verificar que los arqueos recientes muestran **los mismos totales** que en la caja. Un total distinto = la poda partió un cierre → DETENTE.
5. Confirmar que la caja sigue mostrando **todo** el historial en sus reportes (la poda no debe haberla tocado).
6. Verificar que el aviso "últimos 30 días" aparece en el monitor.
7. A las 48 h y a los 7 días: comparar egress contra la línea base y anotarlo en `PROGRESO_egress.md`.

---

## 5. Si algo no encaja

- Si alguna vista del monitor consume `abasto_audit_log_v1`, **DETENTE**: excluirlo del sync la dejaría vacía.
- Si `registerCloses` ya no agrupa por `cierreId`, **DETENTE**: la regla de poda de 2.2 dejaría de ser válida.
- Si `quickHash` ya muestrea la cola, no lo dupliques (F4.1 ya estaría hecha).
- Si tras la F3 alguna vista del monitor queda sin datos, la lista blanca está incompleta: amplíala en vez de revertir la fase.
- Ninguna fase de este plan requiere ejecutar SQL. Si crees que hace falta, **DETENTE y reporta** — sería señal de que el plan se desvió.
