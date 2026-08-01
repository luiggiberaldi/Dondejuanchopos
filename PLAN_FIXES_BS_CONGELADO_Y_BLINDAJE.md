# Plan de Fixes — Commit `8ee624d` (Bs Congelado, Blindaje de Inventario y Lote Remoto)

**Fecha:** 2026-07-31
**Commit revisado:** `8ee624d` — *fix(pos/monitor): blindaje atómico de precios congelados en lote, notificaciones realtime y sanitización de tasa manual* (16 archivos, +1121 / −90)
**Estado del build:** ✅ `npx vite build` pasa.

**Veredicto:** el commit compila y su diseño es correcto, pero **tres defectos de una línea anulan la mayor parte de lo que pretende hacer**: el status nuevo lo rechaza la base de datos, la mitad del wizard apunta a un campo que no existe, y el circuit breaker no frena lo que dice frenar. Ninguno de los tres produce error visible: todos fallan en silencio.

Los tres comparten la misma causa: **no hay nada que verifique que un identificador nuevo coincide con el que ya usa el resto del sistema** — ni el status contra la constraint, ni `hasBox` contra `sellByBox`, ni el umbral contra su propio mensaje de error. Por eso este plan añade guarda-raíles, no sólo parches.

---

## 1. Hallazgos

| # | Hallazgo | Severidad | Fase |
|---|---|---|---|
| B1 | `applied_with_warnings` viola la CHECK constraint: el comando queda `pending` para siempre y el monitor nunca se entera | 🔴 | F1 |
| B2 | `hasBox` / `hasHalfBox` no existen (el campo es `sellByBox` / `sellByHalfBox`): cajas y medios bultos nunca entran al wizard | 🔴 | F2 |
| B3 | El circuit breaker usa `Math.min` donde necesita `Math.max`: sólo bloquea si quedan menos de 5 productos | 🔴 | F3 |
| B4 | El shadow snapshot dura una sola escritura y cuesta 3× I/O en cada venta | 🟠 | F3 |
| B5 | La alerta de Bs congelado se pierde al arrancar: el efecto corre con `products = []` y quema el baseline | 🟠 | F4 |
| B6 | El push diferido a la nube no está garantizado: se marca `applied` antes de empujar | 🟠 | F5 |
| B7 | La limpieza D4 de `priceBsManual` quedó neutralizada (sólo borra lo que ya está vacío) | 🟡 | F6 |
| B8 | `'bs_manual'` y `'fijo'` son modos fantasma: nadie los escribe y `productProcessor` no los reconoce | 🟡 | F6 |
| B9 | `batch_edit` es O(n×m): `updatedList.map()` dentro del `for` | 🟡 | F7 |

### Lo que quedó bien (no tocar)

- `sanitizeRateMode` ([ProductContext.jsx:65-77](src/context/ProductContext.jsx#L65-L77)) — cubre JSON doble-codificado, comillas sueltas y el fallback legacy de `bodega_use_auto_rate`. Sólido.
- El merge `{ ...existing, ...data }` en la acción `edit` — corrige que una edición parcial borrara campos no enviados.
- `batch_edit` corre dentro de `withLock` con lectura fresca del catálogo. Patrón correcto (D3).
- La validación ampliada a `boxPriceBsManual` / `halfBoxPriceBsManual`.
- En la importación de backup, cambiar `removeItem('dj_cloud_sync_ts')` por un timestamp actual: se acaba de empujar todo, la caja **es** la fuente de verdad.
- El debounce de 400 ms en sí (sólo le falta el flush de F5).

---

## 2. Protocolo

Una fase = un commit. Localizar el código por **anclas de texto**, no por número de línea. Tras cada fase:

```bash
npx eslint --no-cache <archivos tocados>
npx vitest run
npm run build
```

**DETENTE** y reporta si el código no coincide con lo que este plan describe: significa que el árbol cambió desde `8ee624d` y las conclusiones hay que rehacerlas.

**Reglas vigentes:** SEC-002, SEC-009 (nada de `localStorage.setItem` directo fuera de `storageService`), SEC-010, guarda FIN-022, `parseFloat` prohibido en código financiero, **sin código de migración de datos**, y no hacer push salvo pedido explícito.

**Orden:** F1 → F2 → F3 → F4 → F5 → F6 → F7 → F8.
F1 incluye SQL: **correrlo en Supabase antes de desplegar el JS de esa fase.**

---

## 3. Fases

### F1 🔴 — `applied_with_warnings` en la constraint

**Archivos:** [supabase_supervisor_commands_setup.sql](supabase_supervisor_commands_setup.sql), [src/hooks/useSupervisorCommands.js](src/hooks/useSupervisorCommands.js)

**El problema.** [useSupervisorCommands.js:133](src/hooks/useSupervisorCommands.js#L133) escribe `applied_with_warnings`; la constraint sólo admite tres valores:

```sql
CHECK (status IN ('pending', 'applied', 'failed'));
```

Postgres devuelve 23514. `updateCommandStatus` lo reintenta 3 veces con backoff (**4,5 s bloqueando el bucle de comandos** por un error que no es transitorio), devuelve `false`, y el `await` que lo llama descarta ese valor. El comando queda `pending` en la base para siempre. El monitor espera la transición `pending → applied | applied_with_warnings` ([OwnerMonitorView.jsx:609](src/views/OwnerMonitorView.jsx#L609)) y nunca la recibe: el lote se aplicó en la caja pero en el monitor se ve colgado.

**1.1 SQL.** El bloque actual está envuelto en `IF NOT EXISTS`, así que **editar el archivo no actualiza una base ya creada**. Hay que reemplazarlo por el patrón `DROP` + `ADD` que ya usa `command_type` justo encima:

```sql
ALTER TABLE public.supervisor_commands DROP CONSTRAINT IF EXISTS supervisor_commands_status_check;
ALTER TABLE public.supervisor_commands ADD CONSTRAINT supervisor_commands_status_check
    CHECK (status IN ('pending', 'applied', 'applied_with_warnings', 'failed'));
```

Correrlo en Supabase **antes** de desplegar el resto de la fase. Y actualizar el comentario de la línea 22 (`-- 'pending' | 'applied' | 'failed'`), que si no queda mintiendo.

**1.2** `applied_at` sólo se rellena para `'applied'` ([useSupervisorCommands.js:48](src/hooks/useSupervisorCommands.js#L48)). Un comando con avisos también terminó:

```js
if (status === 'applied' || status === 'applied_with_warnings') fields.applied_at = new Date().toISOString();
```

**1.3** No reintentar errores que no son transitorios. Una violación de constraint no mejora esperando 4,5 s:

```js
if (!error) return true;
// 23514 = check_violation, 23503 = foreign_key_violation, 22P02 = invalid_text_representation.
// Reintentar un error de esquema sólo retrasa el bucle de comandos.
if (['23514', '23503', '22P02'].includes(error.code)) {
    console.error(`[SupervisorCommands] Error de esquema al fijar status="${status}" — no se reintenta:`, error);
    return false;
}
```

**1.4 Guarda-raíl.** El fallo pasó porque nadie lee la respuesta. Que el llamador reaccione:

```js
const ok = await updateCommandStatus(command.id, nextStatus, warnMsg);
if (!ok) {
    console.error(`[SupervisorCommands] El comando ${command.id} se aplicó localmente pero no se pudo marcar en la nube.`);
    unmarkApplied(command.id);   // permitir que el catch-up lo reintente en el próximo arranque
}
```

Requiere añadir `unmarkApplied` junto a `markApplied` ([useSupervisorCommands.js:28](src/hooks/useSupervisorCommands.js#L28)). **Ojo:** sólo es seguro desmarcar si el comando es idempotente. `batch_edit` lo es (reescribe los mismos valores). Si algún handler futuro no lo fuera, esta rama tendría que excluirlo — dejarlo escrito en el comentario.

**1.5 Guarda-raíl estructural.** Los valores válidos viven hoy en dos sitios que nadie compara. Centralizarlos en `src/constants/commandStatus.js`:

```js
// ESPEJO EXACTO de supervisor_commands_status_check.
// Si añades un valor aquí, corre también el ALTER en Supabase o la BD lo rechazará en silencio.
export const COMMAND_STATUS = Object.freeze({
    PENDING: 'pending',
    APPLIED: 'applied',
    APPLIED_WITH_WARNINGS: 'applied_with_warnings',
    FAILED: 'failed',
});
export const VALID_COMMAND_STATUSES = Object.freeze(Object.values(COMMAND_STATUS));
```

y en `updateCommandStatus`, fallar ruidoso en desarrollo antes de llegar a la red:

```js
if (import.meta.env.DEV && !VALID_COMMAND_STATUSES.includes(status)) {
    throw new Error(`[SupervisorCommands] Status "${status}" no está en VALID_COMMAND_STATUSES — la BD lo va a rechazar.`);
}
```

Usar `COMMAND_STATUS.*` en `useSupervisorCommands.js` y en `OwnerMonitorView.jsx:609-611`.

**Test** (`tests/commandStatus.test.js`): leer `supabase_supervisor_commands_setup.sql`, extraer con regex los literales de `supervisor_commands_status_check`, y afirmar que el conjunto es **exactamente** igual a `VALID_COMMAND_STATUSES`. Eso convierte el bug de hoy en un test que falla mañana.

**Verificación manual:** desde el monitor, editar un lote donde un producto haya sido borrado en la caja. El comando debe pasar a `applied_with_warnings` y el monitor mostrar el aviso con los nombres de los fallidos.

---

### F2 🔴 — `sellByBox` / `sellByHalfBox`: la mitad del wizard está muerta

**Archivos:** [src/context/ProductContext.jsx](src/context/ProductContext.jsx), [src/components/Products/BsCongeladoWizardModal.jsx](src/components/Products/BsCongeladoWizardModal.jsx)

**El problema.** `hasBox` y `hasHalfBox` aparecen **dos veces cada uno en todo el repositorio**, y son exactamente los dos archivos de este commit. El campo canónico es `sellByBox` / `sellByHalfBox` (136 y 95 usos; ver [productProcessor.js:123](src/utils/productProcessor.js#L123)). Como `undefined` es falsy, esas ramas nunca entran:

- [ProductContext.jsx:229](src/context/ProductContext.jsx#L229) y [:231](src/context/ProductContext.jsx#L231) → `frozenCount` no cuenta cajas ni medios bultos.
- [BsCongeladoWizardModal.jsx:229](src/components/Products/BsCongeladoWizardModal.jsx#L229) y [:257](src/components/Products/BsCongeladoWizardModal.jsx#L257) → el wizard no lista esas filas.

Una tienda que congela precios de caja ve el toast «Tasa actualizada», sin alerta; el wizard no se abre; y sigue vendiendo cajas a la tasa vieja. Es justo la pérdida que la función existe para evitar. El código de escritura ([BsCongeladoWizardModal.jsx:411-428](src/components/Products/BsCongeladoWizardModal.jsx#L411-L428)) está bien: nunca se le pasa nada.

**2.1** Sustituir en los cuatro sitios `p.hasBox` → `p.sellByBox` y `p.hasHalfBox` → `p.sellByHalfBox`.

Cuidado con la semántica anidada: `productProcessor.js:123` define `sellByHalfBox: Boolean(sellByBox) && Boolean(sellByHalfBox)` — el medio bulto **exige** que haya caja. Los productos que no pasaron por ese normalizador podrían traer `sellByHalfBox: true` con `sellByBox: false`, así que la condición del medio bulto debe ser `p.sellByBox && p.sellByHalfBox` para no listar un formato que no se vende.

**2.2 Guarda-raíl.** El error nació de escribir el nombre de un campo de memoria. Extraer la detección a un único helper y que ambos archivos lo importen — hoy `isFrozenMode` está **duplicado literalmente** en [ProductContext.jsx:226-230](src/context/ProductContext.jsx#L226-L230) y [BsCongeladoWizardModal.jsx:192-196](src/components/Products/BsCongeladoWizardModal.jsx#L192-L196), que es como se desincronizan:

```js
// src/utils/frozenPrices.js
/**
 * Formatos con precio en Bs congelado (no siguen la tasa).
 * Los nombres de campo son los canónicos de productProcessor: sellByBox / sellByHalfBox.
 */
export function isFrozenMode(mode, bsManual, forceBcv, bsUsdRef) { … }

export function getFrozenFormats(p) {
    const out = [];
    if (isFrozenMode(p.pricingMode, p.priceBsManual, p.forceBcv, p.priceBsUsdRef)) {
        out.push({ type: 'unidad', currentBs: p.priceBsManual || 0, currentUsd: p.priceUsdt || p.priceUsd || 0 });
    }
    if (p.sellByBox) {
        const boxMode = p.boxPricingMode === 'inherit' ? p.pricingMode : p.boxPricingMode;
        if (isFrozenMode(boxMode, p.boxPriceBsManual || p.boxPriceBs, p.forceBcv, p.boxPriceBsUsdRef)) {
            out.push({ type: 'caja', … });
        }
    }
    if (p.sellByBox && p.sellByHalfBox) { … }
    return out;
}
```

`frozenCount` pasa a ser `products.reduce((a, p) => a + getFrozenFormats(p).length, 0)` y `frozenItems` del wizard se construye sobre la misma lista. Un solo sitio que puede equivocarse de nombre, no dos.

**Test** (`tests/frozenPrices.test.js`):
- Producto con `pricingMode: 'bs_fijo'` → 1 formato.
- Producto con `sellByBox: true`, `boxPricingMode: 'bs_fijo'` → incluye `'caja'`. **Este test falla con el código actual** — es el que prueba el fix.
- `sellByBox: true, sellByHalfBox: true`, ambos congelados → 2 formatos además de la unidad.
- `sellByHalfBox: true` con `sellByBox: false` → **no** produce `'medioBulto'`.
- `boxPricingMode: 'inherit'` hereda de `pricingMode`.
- Producto en `'bcv'` con todo lo demás vacío → 0 formatos.

**Guarda-raíl adicional (barato y de alto rendimiento).** Regla ESLint que impida reintroducir el nombre inventado, en `eslint.config.js`:

```js
'no-restricted-syntax': [..., {
    selector: "MemberExpression[property.name=/^(hasBox|hasHalfBox)$/]",
    message: 'Campo inexistente. Usa sellByBox / sellByHalfBox (ver productProcessor.js).'
}]
```

**Verificación manual:** producto con caja en `bs_fijo`, cambiar la tasa manual. La alerta debe contar la caja y el wizard debe ofrecer la fila «Caja».

---

### F3 🔴🟠 — Circuit breaker y shadow snapshot

**Archivo:** [src/utils/storageService.js](src/utils/storageService.js)

**B3 — el umbral está invertido.** [storageService.js:139](src/utils/storageService.js#L139):

```js
if (!isBulkDeleteAllowed && value.length < Math.min(existing.length * 0.3, 5)) {
```

Con más de 17 productos, `existing.length * 0.3 > 5`, así que `Math.min` devuelve **siempre 5**: la condición real es `value.length < 5`. Un catálogo de 500 reducido a 50 —la «reducción anómala» que describe el propio mensaje de error— pasa sin freno.

```js
// Bloquear si el catálogo se reduce a menos del 30 %, con piso de 5 para no
// estorbar en catálogos diminutos. Con Math.min esto sólo saltaba al quedar <5.
const floor = Math.max(existing.length * 0.3, 5);
if (!isBulkDeleteAllowed && value.length < floor) { … }
```

**B4 — el snapshot dura una escritura y cuesta en cada venta.** Hoy se respalda **antes** del chequeo y en **cada** `setItem('bodega_products_v1')`. Dos consecuencias:

1. Si una sobrescritura mala pasa el filtro, el shadow queda bueno — pero la siguiente venta descuenta stock y **lo sobrescribe con el catálogo ya corrupto**. La ventana de recuperación es de una escritura.
2. Cada venta pasa de 1 escritura a 1 lectura + 2 escrituras del catálogo completo en IndexedDB, en el camino más caliente de la app.

Ambas se resuelven **respaldando por tiempo, no por escritura**:

```js
const SHADOW_MIN_INTERVAL_MS = 30 * 60 * 1000;   // 30 min
const lastTs = Date.parse(localStorage.getItem('bodega_shadow_backup_ts') || '') || 0;
const shrinks = value.length < existing.length;

// Respaldar sólo si hace rato del último respaldo, y NUNCA cuando el catálogo
// encoge: si esta escritura es la mala, el respaldo debe seguir siendo el de antes.
if (!shrinks && Date.now() - lastTs > SHADOW_MIN_INTERVAL_MS) {
    await localforage.setItem('bodega_products_shadow_backup_v1', existing);
    localStorage.setItem('bodega_shadow_backup_ts', new Date().toISOString());
}
```

Esto conserva el valor de recuperación (siempre hay una copia de como mucho 30 min antes, y **nunca** una copia tomada durante un borrado) y elimina el coste por venta salvo dos veces por hora.

**3.1 Guarda-raíl.** `confirm_bulk_delete_catalog_flag` se pone y se quita alrededor de la escritura en [ProductContext.jsx:608-610](src/context/ProductContext.jsx#L608-L610). Si `storageService.setItem` lanza entre medias, el `removeItem` no corre y **el circuit breaker queda desactivado indefinidamente**. Envolver en `try/finally`:

```js
localStorage.setItem('confirm_bulk_delete_catalog_flag', 'true');
try {
    await storageService.setItem('bodega_products_v1', shadow);
} finally {
    localStorage.removeItem('confirm_bulk_delete_catalog_flag');
}
```

Y como red adicional, que el propio breaker caduque el permiso: guardar `confirm_bulk_delete_catalog_ts` junto al flag y tratarlo como inválido si tiene más de 60 s. Un permiso de borrado masivo que sobrevive a un reinicio no es un permiso, es un agujero.

**3.2 Guarda-raíl.** El breaker lanza una excepción que casi ningún llamador espera. Verificar que las rutas que escriben el catálogo la propagan con un mensaje entendible en vez de morir en un `catch` mudo — como mínimo `ProductContext.setProducts`, `remoteInventoryProcessor` y la importación de backup deben mostrar un toast que diga que la escritura fue **bloqueada**, no que «falló al guardar».

**Test** (`tests/storageGuard.test.js`, con `localforage` mockeado):
- 500 → 50 productos **lanza** `[CircuitBreaker]`. *(Falla con el código actual.)*
- 500 → 400 pasa.
- 500 → 50 con el flag activo pasa.
- 10 → 3 pasa (piso de 5).
- Una escritura que encoge el catálogo **no** actualiza el shadow.
- Dos escrituras seguidas que crecen: sólo la primera respalda.

---

### F4 🟠 — La alerta se pierde al arrancar

**Archivo:** [src/context/ProductContext.jsx](src/context/ProductContext.jsx)

**El problema.** El efecto de detección depende de `[effectiveRate, rateMode, products]` pero no espera a que el catálogo cargue. Al arrancar, `products` es `[]`: `frozenCount` da 0, se muestra el toast genérico y —lo decisivo— **se escribe `dj_last_effective_rate`**. Cuando los productos terminan de cargar, `lastKnown === effectiveRate` y la alerta ya no puede dispararse.

El escenario principal (la tasa cambió con la app cerrada) es precisamente el que se pierde.

**4.1** Salir temprano mientras carga, sin tocar el baseline:

```js
// No evaluar —ni, sobre todo, mover el baseline— hasta tener el catálogo:
// con products=[] el conteo da 0 y quemaría la alerta del arranque.
if (isLoadingProducts) return;
```

y añadir `isLoadingProducts` a las dependencias.

**4.2** El mismo razonamiento aplica al `return` temprano de `rateMode !== 'manual'`, que también escribe `dj_last_effective_rate`. Ahí sí es correcto actualizarlo (en modo automático no hay alerta que dar), pero debe quedar **después** de la guarda de carga.

**4.3** El efecto recorre todo el catálogo en cada cambio de `products`, es decir en cada venta. Con `getFrozenFormats` de F2 el conteo sigue siendo O(n); acotarlo a que sólo recalcule cuando de verdad cambió la tasa:

```js
if (!(lastKnown > 0 && Math.abs(lastKnown - effectiveRate) > 0.05)) {
    localStorage.setItem('dj_last_effective_rate', String(effectiveRate));
    return;                       // sin recorrer el catálogo
}
```

**Test** (`tests/bsCongeladoAlert.test.js`): montar el provider con `isLoadingProducts: true`, `dj_last_effective_rate = 100`, `effectiveRate = 120`. Afirmar que **no** se escribe `dj_last_effective_rate`; luego pasar `isLoadingProducts: false` con productos congelados y afirmar que la alerta aparece.

**Verificación manual:** con productos en `bs_fijo`, cerrar la app, cambiar la tasa manual desde el monitor, reabrir. Debe salir la alerta con el conteo correcto, no el toast genérico.

---

### F5 🟠 — Garantizar el push diferido

**Archivo:** [src/hooks/useSupervisorCommands.js](src/hooks/useSupervisorCommands.js)

**El problema.** `scheduleCloudProductsSync()` (debounce de 400 ms) sustituyó un `await pushCloudSync`. El comando se marca `applied` **antes** de que el push ocurra: si la app se cierra en esos 400 ms, el monitor da el cambio por sincronizado y la nube queda vieja.

El debounce es la decisión correcta —evita estrangular el lote— y se mantiene. Sólo hay que cerrar la ventana.

**5.1** Extraer el cuerpo del timer a `flushCloudProductsSync()` y llamarlo también desde `beforeunload` y desde `visibilitychange` cuando el documento pasa a `hidden` (en móvil `beforeunload` no siempre dispara):

```js
let cloudSyncTimer = null;
let cloudSyncPending = false;

async function flushCloudProductsSync() {
    if (!cloudSyncPending) return;
    cloudSyncPending = false;
    if (cloudSyncTimer) { clearTimeout(cloudSyncTimer); cloudSyncTimer = null; }
    try { … push … } catch (e) { cloudSyncPending = true; console.error(…); }
}
```

Registrar los listeners una sola vez a nivel de módulo (el timer ya es de módulo) y **quitarlos en el cleanup del hook** para no acumularlos en cada montaje.

**5.2** Si el push falla, dejar `cloudSyncPending = true` para que el siguiente arranque lo recoja. Que `forceSyncAllPOSData` cubra el hueco es aceptable como red final, pero no debe ser el único mecanismo.

**Verificación manual:** aplicar un lote y cerrar la pestaña de inmediato. Al reabrir el monitor, los precios deben estar actualizados.

---

### F6 🟡 — Restaurar el contrato D4 y eliminar los modos fantasma

**Archivo:** [src/utils/remoteInventoryProcessor.js](src/utils/remoteInventoryProcessor.js)

**B7.** La limpieza quedó así:

```js
if (data.pricingMode !== 'bs_fijo' && data.pricingMode !== 'bs_manual' && data.pricingMode !== 'fijo'
    && (data.priceBsManual == null || data.priceBsManual === '')) {
    normalized.priceBsManual = null;
}
```

Sólo borra el campo cuando **ya** está vacío: es un no-op. El comentario D4 inmediatamente encima («evita `priceBsManual` basura en modo bcv») ahora contradice al código. Hoy no rompe precios porque [productProcessor.js:161](src/utils/productProcessor.js#L161) lo anula al leer —`priceBsManual: pricingMode === 'bs_fijo' && raw.priceBsManual ? … : null`— pero `boxPriceBsManual` y `halfBoxPriceBsManual`, que este mismo commit introdujo, **no tienen esa red**.

Restaurar la condición original y extenderla a los dos campos nuevos:

```js
if (!FROZEN_MODES.includes(data.pricingMode)) {
    normalized.priceBsManual = null;
    normalized.boxPriceBsManual = null;
    normalized.halfBoxPriceBsManual = null;
}
```

**Antes de aplicarlo, verificar el flujo del wizard**, porque es el que motivó el debilitamiento: [BsCongeladoWizardModal.jsx:403-404](src/components/Products/BsCongeladoWizardModal.jsx#L403-L404) sí fija `pricingMode = 'bs_fijo'` junto al precio, y las líneas 414 y 423 fijan `boxPricingMode` / `halfBoxPricingMode`. Con la limpieza restaurada, el guardado del wizard **debe seguir funcionando**; si no lo hace, el problema es que el `pricingMode` de caja y medio bulto se evalúa contra el campo de la unidad. En ese caso la limpieza de `boxPriceBsManual` debe mirar `boxPricingMode` (resolviendo `'inherit'`), no `pricingMode`. **Cubrirlo con test antes de tocar nada.**

**B8.** `'bs_manual'` y `'fijo'` no los escribe nadie: son 4 lecturas defensivas, las cuatro introducidas por este commit, y [productProcessor.js:144](src/utils/productProcessor.js#L144) no los reconoce. Si alguna vez llegaran, caerían en la cadena de inferencia y un `'fijo'` sin `priceBsManual` se degradaría a `'tasa_dia'`, perdiendo el congelado.

Definir el vocabulario en un solo sitio, `src/constants/pricingModes.js`:

```js
// Vocabulario canónico. productProcessor.js sólo reconoce estos cuatro:
// cualquier otro valor cae en la inferencia y puede perder el precio congelado.
export const PRICING_MODES = Object.freeze(['tasa_dia', 'bcv', 'dual_usd', 'bs_fijo']);
export const FROZEN_MODES = Object.freeze(['bs_fijo']);
```

Importarlo en `remoteInventoryProcessor`, `productProcessor`, `ProductContext` y el wizard, y **eliminar** `'bs_manual'` y `'fijo'` de los `includes`. Si se quiere tolerancia con datos viejos, que sea explícita y en un solo punto de entrada (`normalizeRawProduct`), mapeando el alias a `'bs_fijo'` — no repartida en cuatro `includes` que se desincronizan.

**Test** (`tests/remoteInventory.test.js`, ampliar):
- `edit` con `pricingMode: 'bcv'` sobre un producto que tenía `priceBsManual: 5000` → el resultado guarda `priceBsManual: null`.
- Lo mismo para `boxPriceBsManual` y `halfBoxPriceBsManual`.
- `batch_edit` desde el wizard con `pricingMode: 'bs_fijo'` → el precio **se conserva**. *(Este es el que protege contra romper la función al arreglar D4.)*
- `PRICING_MODES` coincide exactamente con la lista de `productProcessor.js:144`.

---

### F7 🟡 — `batch_edit` en O(n)

**Archivo:** [src/utils/remoteInventoryProcessor.js](src/utils/remoteInventoryProcessor.js)

`updatedList = updatedList.map(p => p.id === pId ? … : p)` dentro del `for`: 200 ítems sobre 1000 productos son 200.000 iteraciones y 200 arrays nuevos, en un POS que corre en Android de gama baja. Indexar una vez:

```js
const byId = new Map(products.map(p => [p.id, p]));
for (const item of items) {
    const existingProd = byId.get(item.productId);
    …
    byId.set(item.productId, { ...existingProd, ...normalized });
}
const updatedList = products.map(p => byId.get(p.id) || p);
```

Preserva el orden original del catálogo, que el `map` encadenado también preservaba.

---

### F8 🟢 — Arnés de regresión

**Archivo:** nuevo `tests/commit8ee624d.regression.test.js` (o repartir en los archivos de cada fase)

Cada 🔴 de este plan comparte una propiedad: **falla en silencio**. Los tests de arriba cubren cada caso; esta fase añade los dos invariantes transversales, que son los que habrían detectado los tres:

1. **Espejo esquema ↔ constantes** — los literales de `supervisor_commands_status_check` y `supervisor_commands_command_type_check` en el `.sql` coinciden exactamente con `VALID_COMMAND_STATUSES` y la lista de tipos de comando del JS.
2. **Nombres de campo de producto** — recorrer un producto de referencia construido con `normalizeRawProduct` y afirmar que los campos que consultan `ProductContext` y el wizard (`sellByBox`, `sellByHalfBox`, `boxPricingMode`, `boxPriceBsManual`, `halfBoxPricingMode`, `halfBoxPriceBsManual`, `priceBsUsdRef`, `boxPriceBsUsdRef`) **existen** en él. Un campo inventado como `hasBox` habría hecho fallar este test el mismo día.

Correr la suite completa y `npm run build`.

---

## 4. Decisiones

| ID | Decisión | Motivo |
|---|---|---|
| G1 | Ampliar la constraint en vez de degradar a `'applied'` | El fallo parcial es información real que el dueño necesita; perderla para encajar en el esquema sería resolver al revés. |
| G2 | Errores de esquema no se reintentan | Un 23514 no mejora esperando; sólo bloquea el bucle de comandos 4,5 s. |
| G3 | Desmarcar `markApplied` si el status no se pudo escribir | Deja que el catch-up lo reintente. Válido porque `batch_edit` es idempotente; anotado para futuros handlers. |
| G4 | El shadow backup se toma por tiempo y **nunca** cuando el catálogo encoge | Un respaldo tomado durante el borrado no es un respaldo. Y desaparece el coste por venta. |
| G5 | El permiso de borrado masivo caduca a los 60 s | Un flag que sobrevive a un reinicio desactiva el breaker de forma permanente. |
| G6 | `isFrozenMode` deja de estar duplicado | La copia literal en dos archivos es el mecanismo exacto por el que `hasBox` pasó desapercibido. |
| G7 | El vocabulario de modos se define una vez y se elimina el alias fantasma | Cuatro `includes` sueltos con listas distintas es el mismo error de B1 y B2 en otra forma. |
| G8 | Se mantiene el debounce de 400 ms, con flush | La decisión de fondo era correcta; sólo faltaba cerrar la ventana de pérdida. |

---

## 5. Riesgos

- **F1 exige correr SQL en Supabase antes de desplegar el JS de esa fase.** Si se despliega al revés, todo lote con fallos parciales queda `pending` (el comportamiento de hoy) hasta correr el `ALTER`.
- **Los comandos que ya quedaron `pending` en la base no se arreglan solos.** Hay filas huérfanas de este bug. Limpiarlas es una decisión del usuario sobre datos existentes y **queda fuera de alcance** (regla de no migración); si se quiere, un `UPDATE … SET status='applied' WHERE status='pending' AND created_at < …` manual, revisado a mano.
- **F6 es la fase con más riesgo de regresión**: restaura una limpieza que fue debilitada precisamente para que el wizard funcionara. Por eso el test de `batch_edit` con `'bs_fijo'` debe escribirse **antes** del cambio. Si al restaurar D4 el wizard deja de guardar, **detenerse**: significa que la resolución de `boxPricingMode`/`'inherit'` necesita su propio arreglo primero.
- **F2 cambia el conteo que ve el usuario.** Tras el fix, la alerta reportará más productos que antes — porque antes faltaban las cajas. No es una regresión.
- **F3 elimina el respaldo por escritura.** Si alguien contaba con que el shadow fuera «el estado inmediatamente anterior», deja de serlo (pasa a ser «de hace como mucho 30 min, nunca durante un borrado»), que es lo que lo hace útil de verdad.
- Ninguna fase toca la guarda FIN-022, `parseFloat` en código financiero, ni los métodos de pago COP.

## 6. Si algo no encaja

Si al abrir un archivo el código no coincide con las anclas de este documento —por ejemplo si la constraint ya incluye `applied_with_warnings`, o si `hasBox` ya fue renombrado— **detente y reporta la diferencia** antes de editar. Este plan describe el árbol en `8ee624d`.
