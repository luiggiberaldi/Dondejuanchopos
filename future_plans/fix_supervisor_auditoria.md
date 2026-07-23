# Plan de Ejecución — Fix Modo Supervisor (8 hallazgos)

> **Audiencia:** LLM ejecutor. Sigue este documento al pie de la letra.
> **Regla de oro:** verificado contra el código. Si algo no coincide, DETENTE y reporta.
> **Protocolo:** anclas de texto, no números de línea. Un commit por fase. Harness: `npx eslint --no-cache <archivos> && npx vitest run tests/remoteInventory.test.js tests/pricingMode.test.js && npm run build`.

---

## 1. Diccionario de anclas

| Elemento | Ancla |
|---|---|
| Cola de cambios | `const PENDING_KEY = 'dj_pending_inventory_changes_v1'` en `OwnerMonitorView.jsx` |
| `queueInventoryChange` | ANCLA: `const queueInventoryChange = (action, productId, data) => {` |
| `persistPending` | ANCLA: `const persistPending = (next) => {` |
| `hasPendingFor` | ANCLA: `const hasPendingFor = (productId) =>` |
| `normalizeProduct` | ANCLA: `/** Normalización mínima de consistencia` en `remoteInventoryProcessor.js` |
| `SupervisorRateModal` actualización local | ANCLA: `// Actualizar localmente también para consistencia visual del monitor` |
| `inventoryMetrics` costo | ANCLA: `const cost = p.costPrice || 0` en `OwnerMonitorView.jsx` |
| `criticalProducts` precio | ANCLA: `prod.price` en `OwnerMonitorView.jsx` |
| Barra flotante | ANCLA: `{pendingChanges.length > 0 && (` |
| Modal remoto en monitor | ANCLA: `effectiveRate={bcvRate}` en `OwnerMonitorView.jsx` |

---

## 2. Fases

### FASE 1 — Correcciones críticas de datos (hallazgos #4, #13, #14)

**Archivos:** `src/utils/remoteInventoryProcessor.js`, `src/views/OwnerMonitorView.jsx`

**#4 — `normalizeProduct` no aplica D4 por `pricingMode`:**
En `normalizeProduct` (ANCLA: `/** Normalización mínima de consistencia`), después de calcular `normalized.priceBsManual`, añadir:
```js
// D4: si el payload trae pricingMode, limpiar los campos Bs que no corresponden
const VALID_MODES = ['tasa_dia', 'bcv', 'dual_usd', 'bs_fijo'];
if (VALID_MODES.includes(data.pricingMode)) {
    normalized.pricingMode = data.pricingMode;
    normalized.forceBcv = data.pricingMode === 'bcv';
    if (data.pricingMode !== 'bs_fijo') normalized.priceBsManual = null;
    if (data.pricingMode !== 'dual_usd') normalized.priceBsUsdRef = null;
}
```

**#13 — `inventoryMetrics` usa `p.costPrice` en vez de `p.costUsd`:**
En `OwnerMonitorView.jsx` (ANCLA: `const cost = p.costPrice || 0`), cambiar a:
```js
const cost = p.costUsd || p.costPrice || 0;
```
(Fallback a `costPrice` para compatibilidad con productos legacy.)

**#14 — `criticalProducts` usa `prod.price` (campo legacy):**
Busca ANCLA: `prod.price` en `OwnerMonitorView.jsx` y reemplaza por `prod.priceUsd || prod.price || 0`.

**Test nuevo en `tests/remoteInventory.test.js`:**
```js
it('normalizeProduct aplica D4: modo bcv limpia priceBsManual', async () => {
    const res = await applyInventoryCommand({
        action: 'edit', productId: 'p1',
        data: { name: 'Ron Santa Teresa', priceUsd: 10, priceBsManual: 820, pricingMode: 'bcv', barcode: '111', sellByBox: true, boxUnits: 12, boxBarcode: '222' },
    });
    expect(res.success).toBe(true);
    const [p] = await storageService.getItem(PRODUCTS_KEY);
    expect(p.priceBsManual).toBeNull();
    expect(p.forceBcv).toBe(true);
    expect(p.pricingMode).toBe('bcv');
});
```

**Commit:** `fix(supervisor): D4 en normalizeProduct + costUsd en metricas del monitor`.

---

### FASE 2 — Fix de concurrencia en la cola (hallazgos #2, #3, #11)

**Archivo:** `src/views/OwnerMonitorView.jsx`

**#11 — `PENDING_KEY` dentro del componente:**
Mover la constante FUERA del componente (antes de `export default function OwnerMonitorView`):
```js
const PENDING_KEY = 'dj_pending_inventory_changes_v1';
```
Eliminar la declaración dentro del componente (ANCLA: `const PENDING_KEY = 'dj_pending_inventory_changes_v1'`).

**#2 y #3 — Closure stale en `queueInventoryChange` y `persistPending`:**
Reescribir `queueInventoryChange` para usar `setPendingChanges(prev => ...)` en vez de capturar `pendingChanges` por closure. Patrón:
```js
const queueInventoryChange = useCallback((action, productId, data) => {
    setPendingChanges(prev => {
        const next = [...prev];
        const idxOf = (act) => next.findIndex(c => c.productId === productId && c.action === act);

        if (action === 'adjust_stock') {
            const i = idxOf('adjust_stock');
            if (i >= 0) {
                const newDelta = (Number(next[i].data?.delta) || 0) + (Number(data?.delta) || 0);
                if (newDelta === 0) next.splice(i, 1);
                else next[i] = { ...next[i], data: { delta: newDelta }, queuedAt: new Date().toISOString() };
            } else {
                next.push({ action, productId, data, queuedAt: new Date().toISOString() });
            }
        } else if (action === 'edit') {
            const addIdx = idxOf('add');
            if (addIdx >= 0) {
                next[addIdx] = { ...next[addIdx], data: { ...data, id: productId }, queuedAt: new Date().toISOString() };
            } else {
                const i = idxOf('edit');
                if (i >= 0) next[i] = { ...next[i], data, queuedAt: new Date().toISOString() };
                else next.push({ action, productId, data, queuedAt: new Date().toISOString() });
            }
        } else if (action === 'delete') {
            const hadAdd = idxOf('add') >= 0;
            for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].productId === productId) next.splice(i, 1);
            }
            if (!hadAdd) next.push({ action, productId, data: null, queuedAt: new Date().toISOString() });
        } else {
            next.push({ action, productId, data, queuedAt: new Date().toISOString() });
        }

        try { localStorage.setItem(PENDING_KEY, JSON.stringify(next)); } catch { /* storage lleno */ }
        return next;
    });
    showToast('Cambio en cola — pulsa «Subir al sistema» para enviarlo', 'info');
    return true;
}, []);
```
Esto elimina la necesidad de `persistPending` separado para el caso de `queueInventoryChange`. `persistPending` se mantiene para `uploadPendingChanges` y `discardPendingChanges` pero se convierte en función pura (sin `setPendingChanges`):
```js
const persistPending = useCallback((next) => {
    setPendingChanges(next);
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(next)); } catch { /* storage lleno */ }
}, []);
```
Añadir `useCallback` al import de React (ANCLA: `import React, { useState, useEffect, useMemo } from 'react'`).

**Commit:** `fix(supervisor): closure stale en cola de cambios y PENDING_KEY fuera del componente`.

---

### FASE 3 — Fix de UX: bcvRate al modal remoto + limpiar customRate (hallazgos #5, #8)

**Archivos:** `src/views/OwnerMonitorView.jsx`, `src/components/SupervisorRateModal.jsx`

**#8 — `bcvRate` no llega al formulario remoto:**
En `OwnerMonitorView.jsx`, busca ANCLA: `effectiveRate={bcvRate}` en el montaje de `RemoteProductFormModal` y añade el prop `bcvRate`:
```jsx
<RemoteProductFormModal
    ...
    effectiveRate={bcvRate}
    bcvRate={rates?.bcv?.price || bcvRate}
/>
```

**#5 — `bodega_custom_rate` no se limpia al cambiar a modo no-manual:**
En `SupervisorRateModal.jsx` (ANCLA: `// Actualizar localmente también para consistencia visual del monitor`), añadir después de actualizar `bodega_rate_mode`:
```js
if (rateMode !== 'manual') {
    localStorage.removeItem('bodega_custom_rate');
}
```

**Commit:** `fix(supervisor): bcvRate al formulario remoto y limpiar customRate en cambio de modo`.

---

### FASE 4 — UX: badge de cambios pendientes + barra flotante contextual (hallazgos #1, #6)

**Archivo:** `src/views/OwnerMonitorView.jsx`

**#1 — `hasPendingFor` sin usar (edit/delete no tienen badge visual):**
En la fila de producto del inventario, junto al nombre del producto (donde ya están los badges de stock y formato), añadir un badge cuando `hasPendingFor(p.id)` sea true y el delta de stock sea 0 (para no duplicar con el badge de delta):
```jsx
{hasPendingFor(p.id) && pendingStockDelta(p.id) === 0 && (
    <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
        Cambio pendiente
    </span>
)}
```

**#6 — Barra flotante visible en todas las pestañas:**
En la condición de la barra flotante (ANCLA: `{pendingChanges.length > 0 && (`), cambiar a:
```jsx
{pendingChanges.length > 0 && viewTab === 'inventario' && (
```
Si se prefiere que sea visible en todas las pestañas (para que el supervisor no olvide subir), mantener la condición actual pero mejorar el texto a "X cambios de inventario pendientes".

**Commit:** `fix(supervisor): badge de cambios pendientes en filas y barra flotante contextual`.

---

### FASE 5 — Cierre y harness completo

1. `npx eslint --no-cache src/views/OwnerMonitorView.jsx src/utils/remoteInventoryProcessor.js src/components/SupervisorRateModal.jsx` — 0 errores.
2. `npx vitest run tests/remoteInventory.test.js tests/pricingMode.test.js` — todos verdes.
3. `npm run build` — ✓.
4. Actualizar `future_plans/PROGRESO_inventario_remoto.md` con los fixes aplicados.

**Commit:** `docs(supervisor): registro de fixes post-auditoria`.

---

## 3. Si algo no encaja

Si `prod.price` no aparece en `OwnerMonitorView.jsx` o `p.costPrice` ya fue corregido, reporta antes de continuar. Si `useCallback` ya está importado, no lo dupliques.
