# PLAN_FIXES_EGRESS_MONITOR.md
> Fecha: 2026-08-08 | Estado: listo para ejecutar

Corrige los bugs del flujo de imágenes monitor→caja y el singleton del listener de comandos.
Los errores BUG-3 y BUG-4 del plan original ya están escritos como cambios sin commitear;
este plan los verifica, agrega los tests que faltaban y completa los fixes de egress.

---

## Línea base antes de tocar nada

```bash
git stash                          # guardar cambios uncommitted del árbol de trabajo
npx vitest run 2>&1 | tail -6      # debe imprimir: 284 passed | 1 failed | 10 skipped
git stash pop
```

Si los tests no coinciden con esa línea base, **detener y reportar**.

---

## Tabla de fases

| # | Fase | Archivo principal | Impacto |
|---|------|-------------------|---------|
| FX01 | `hasActiveCloudSession` — path de caja | `imageUpload.js` | ✅ desbloquea upload en caja |
| FX02 | Monitor sube imagen antes del payload | `RemoteProductFormModal.jsx` | ⬇️ −300 KB/foto en Realtime |
| FX03 | Caja sube base64 fuera del lock | `remoteInventoryProcessor.js` | ⬇️ fallback seguro sin bloquear checkout |
| FX04 | Commit singleton guard de comandos | `useSupervisorCommands.js` | 🔒 sin triplicación |
| FX05 | Migración base64 existentes | `imageUpload.js` (existente) | ⬇️ limpia doc histórico |

---

## FX01 — `hasActiveCloudSession`: añadir path de caja

### Diagnóstico

`uploadProductImage` sale por `return null` en la caja porque `hasActiveCloudSession()`
solo comprueba `dj_paired_device_id` (clave del monitor) y tokens Supabase Auth. La caja
tiene `dj_device_id` pero no tiene esas claves → el upload silenciosamente devuelve null.
Impacto: BUG-2 (FX03) sería un no-op sin este fix previo.

### Ancla

`src/utils/imageUpload.js:39` — función `hasActiveCloudSession`

### Cambio exacto

```diff
 function hasActiveCloudSession() {
     if (typeof window === 'undefined') return false;
 
+    // 0. Verificar si es la caja principal (tiene device_id local registrado).
+    // La caja no tiene dj_paired_device_id ni token Supabase Auth, pero sí
+    // dj_device_id. Tanto monitor como caja llegan aquí con ese key presente.
+    if (localStorage.getItem('dj_device_id')) return true;
+
     // 1. Verificar si está emparejado como monitor secundario
     if (localStorage.getItem('dj_paired_device_id')) return true;
```

### Arnés — `tests/imageUpload.test.js` (archivo nuevo)

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        storage: {
            from: () => ({
                upload: vi.fn().mockResolvedValue({ error: null }),
                getPublicUrl: vi.fn().mockReturnValue({
                    data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/product-images/d/p.jpg' }
                }),
            }),
        },
    },
}));

describe('imageUpload', () => {
    beforeEach(() => localStorage.clear());

    it('IM-01: devuelve null sin sesión ni device_id', async () => {
        const { uploadProductImage } = await import('../src/utils/imageUpload');
        expect(await uploadProductImage('data:image/jpeg;base64,AA==', { id: 'p1' })).toBeNull();
    });

    it('IM-02: sube cuando dj_device_id está presente (contexto caja)', async () => {
        localStorage.setItem('dj_device_id', 'caja-001');
        const { uploadProductImage } = await import('../src/utils/imageUpload');
        const url = await uploadProductImage('data:image/jpeg;base64,/9j/4AAQ==', { id: 'p1' });
        expect(url).toContain('product-images');
    });

    it('IM-03: sube cuando dj_paired_device_id está presente (contexto monitor)', async () => {
        localStorage.setItem('dj_device_id', 'mon-002');
        localStorage.setItem('dj_paired_device_id', 'caja-001');
        const { uploadProductImage } = await import('../src/utils/imageUpload');
        const url = await uploadProductImage('data:image/jpeg;base64,/9j/4AAQ==', { id: 'p2' });
        expect(url).toContain('product-images');
    });

    it('IM-04: isStorageImageUrl discrimina URLs de Storage vs base64', async () => {
        const { isStorageImageUrl } = await import('../src/utils/imageUpload');
        expect(isStorageImageUrl('https://x.supabase.co/storage/v1/object/public/product-images/d/p.jpg')).toBe(true);
        expect(isStorageImageUrl('data:image/jpeg;base64,/9j/')).toBe(false);
        expect(isStorageImageUrl(null)).toBe(false);
    });
});
```

### Guarda raíles

- El check de `dj_device_id` va **antes** del de `dj_paired_device_id` para ser explícito,
  pero ambos cubren el monitor; la caja solo llega por el check nuevo.
- No añadir lógica de upload en FX02/FX03 antes de commitear FX01 —
  sin este fix, los tests de FX03 fallarían silenciosamente.

---

## FX02 — Monitor: upload de imagen antes de armar el payload

### Diagnóstico

`handleSubmit` en `RemoteProductFormModal.jsx:177` pone `image: form.image || null`
directamente en el payload. Si el usuario subió una foto, `form.image` es un data URI
base64 (~300 KB) que viaja dentro del comando `supervisor_commands` → Supabase Realtime
lo reemite completo a cada suscriptor. El fix: subir a Storage antes de construir `data`,
usando un `productId` determinado una sola vez para evitar UUID doble.

### Ancla

`src/components/Monitor/RemoteProductFormModal.jsx:2` — imports  
`src/components/Monitor/RemoteProductFormModal.jsx:164` — `handleSubmit`

### Cambios exactos

**[1] Import (línea 2, tras los imports existentes):**

```diff
 import { calcUsdFromBs } from '../../utils/calculatorUtils';
+// EGRESS RC1: subir imagen a Storage antes de enviar el payload al supervisor_commands.
+import { uploadProductImage, isStorageImageUrl } from '../../utils/imageUpload';
```

**[2] Bloque `handleSubmit` (reemplazar líneas 164–217 completo):**

```js
const handleSubmit = async () => {
    if (!canSave || sending) return;
    setSending(true);
    try {
        const mode = form.pricingMode;
        const boxEffMode = form.boxPricingMode === 'inherit' ? mode : form.boxPricingMode;
        const halfBoxEffMode = form.halfBoxPricingMode === 'inherit' ? mode : form.halfBoxPricingMode;

        // EGRESS RC1: determinar el ID antes del upload para ruta determinística.
        // Un solo randomUUID para todo el bloque — nunca se genera un segundo UUID.
        const productId = editingProduct?.id || crypto.randomUUID();

        // EGRESS RC1: subir imagen a Storage si es base64 nuevo.
        // Si el upload falla (offline), conserva base64 como fallback sin bloquear.
        let finalImage = form.image || null;
        if (finalImage && finalImage.startsWith('data:') && !isStorageImageUrl(finalImage)) {
            const url = await uploadProductImage(finalImage, { id: productId });
            if (url) finalImage = url;
        }

        const data = {
            ...(editingProduct || {}),
            id: productId,
            name: form.name.trim(),
            category: form.category || editingProduct?.category || 'varios',
            barcode: form.barcode.trim() || null,
            image: finalImage,
            priceUsd: Number(form.priceUsd) || 0,
            priceBsManual: mode === 'bs_fijo' && form.priceBsManual !== '' ? Number(form.priceBsManual) : null,
            priceBsUsdRef: mode === 'dual_usd' && form.priceBsUsdRef !== '' ? Number(form.priceBsUsdRef) : null,
            forceBcv: mode === 'bcv',
            pricingMode: mode,
            costUsd: Number(form.costUsd) || 0,
            stock: parseInt(form.stock, 10) || 0,
            lowStockAlert: parseInt(form.lowStockAlert, 10) || 5,
            sellByBox: form.sellByBox,
            boxUnits: form.sellByBox ? parseInt(form.boxUnits, 10) || null : null,
            boxBarcode: form.sellByBox ? form.boxBarcode.trim() || null : null,
            boxPricingMode: form.sellByBox ? form.boxPricingMode : 'inherit',
            boxPriceUsd: form.sellByBox && form.boxPriceUsd !== '' ? Number(form.boxPriceUsd) : null,
            boxPriceBs: form.sellByBox && boxEffMode === 'bs_fijo' && form.boxPriceBs !== '' ? Number(form.boxPriceBs) : null,
            boxPriceBsUsdRef: form.sellByBox && boxEffMode === 'dual_usd' && form.boxPriceBsUsdRef !== '' ? Number(form.boxPriceBsUsdRef) : null,
            sellByHalfBox: form.sellByBox && form.sellByHalfBox,
            halfBoxUnits: form.sellByHalfBox ? parseInt(form.halfBoxUnits, 10) || null : null,
            halfBoxBarcode: form.sellByHalfBox ? form.halfBoxBarcode.trim() || null : null,
            halfBoxPricingMode: form.sellByHalfBox ? form.halfBoxPricingMode : 'inherit',
            halfBoxPriceUsd: form.sellByHalfBox && form.halfBoxPriceUsd !== '' ? Number(form.halfBoxPriceUsd) : null,
            halfBoxPriceBs: form.sellByHalfBox && halfBoxEffMode === 'bs_fijo' && form.halfBoxPriceBs !== '' ? Number(form.halfBoxPriceBs) : null,
            halfBoxPriceBsUsdRef: form.sellByHalfBox && halfBoxEffMode === 'dual_usd' && form.halfBoxPriceBsUsdRef !== '' ? Number(form.halfBoxPriceBsUsdRef) : null,
        };

        // FS6: campos con prefijo _ son de la proyección del monitor, no del producto.
        for (const k of Object.keys(data)) {
            if (k.startsWith('_')) delete data[k];
        }

        const payloadData = editingProduct ? { ...data, baseUpdatedAt: editingProduct.updatedAt } : data;
        await onSubmit(editingProduct ? 'edit' : 'add', data.id, payloadData);
        onClose();
    } finally {
        setSending(false);
    }
};
```

### Guarda raíles

- Si `editingProduct` existe, `productId = editingProduct.id` → ruta Storage idéntica
  → `upsert:true` sobreescribe el archivo sin acumular huérfanos.
- Si `uploadProductImage` devuelve `null`, `finalImage` queda como base64 → FX03 lo
  recoge en la caja como segundo intento.
- `onClose()` solo se llama tras `await onSubmit(...)` exitoso; si el submit lanza,
  el `finally` libera el spinner pero no cierra el modal.

---

## FX03 — Caja: upload de base64 fuera del lock de escritura

### Diagnóstico

`applyInventoryCommand` corre dentro de `withLock('pos_write_lock', ...)`. Poner un upload
a Storage dentro del callback mantiene el lock durante la latencia de red (2–10 s), lo que
bloquea todas las operaciones de checkout simultáneas. El fix: extraer el upload **antes**
de entrar al lock, con un clon inmutable del payload para no mutar el argumento original.

El comentario D8 en línea 308 dice "nunca viaja base64" — eso era verdad antes de FX02.
Después de FX02 puede llegar base64 como fallback offline. Actualizar el comentario.

### Ancla

`src/utils/remoteInventoryProcessor.js:163` — inicio de `applyInventoryCommand`  
`src/utils/remoteInventoryProcessor.js:308` — comentario D8

### Cambios exactos

**[1] Inicio de `applyInventoryCommand` (entre la validación de `VALID_ACTIONS` y el `withLock`):**

```diff
     if (action !== 'add' && action !== 'batch_edit' && !productId) {
         return { success: false, error: 'productId requerido' };
     }
 
+    // EGRESS RC2: si el monitor no pudo subir la imagen (offline), la caja lo intenta.
+    // Se hace ANTES del withLock — un upload de red no puede sostener el write-lock
+    // porque bloquearía el checkout durante segundos.
+    // El upload es idempotente (upsert:true, ruta determinística por ID).
+    let resolvedPayload = payload;
+    const payloadImg = payload.data?.image;
+    if (payloadImg && typeof payloadImg === 'string' && payloadImg.startsWith('data:')) {
+        try {
+            const { uploadProductImage } = await import('./imageUpload');
+            const imgId = payload.data?.id || payload.productId;
+            const url = await uploadProductImage(payloadImg, { id: imgId });
+            if (url) {
+                resolvedPayload = { ...payload, data: { ...payload.data, image: url } };
+            }
+        } catch { /* fallback: el base64 sigue en resolvedPayload.data.image */ }
+    }
+
     // withLock retorna directamente el valor del callback
-    const lockResult = await withLock('pos_write_lock', async () => {
-        const products = await storageService.getItem(PRODUCTS_KEY, []) || [];
+    const lockResult = await withLock('pos_write_lock', async () => {
+        const { action, productId, data } = resolvedPayload;
+        const products = await storageService.getItem(PRODUCTS_KEY, []) || [];
```

> Nota: el destructuring `const { action, productId, data } = payload;` que existía en
> la línea 167 debe cambiarse a leer de `resolvedPayload`. El resto del body del lock
> no cambia.

**[2] Comentario D8 (línea ~308):**

```diff
-            // D8: preservar imagen local si el comando no la trae (nunca viaja base64)
+            // D8: preservar imagen local si el comando no la trae.
+            // Puede llegar base64 como fallback cuando el monitor estaba offline;
+            // en ese caso RC2 ya intentó subirlo antes del lock.
```

### Arnés — `tests/remoteInventoryEgress.test.js` (archivo nuevo)

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map();
vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, def) => store.get(key) ?? def),
        setItem: vi.fn(async (key, val) => { store.set(key, val); }),
    },
}));
vi.mock('../src/utils/withLock', () => ({
    withLock: vi.fn((_key, fn) => fn()),
}));
vi.mock('../src/utils/imageUpload', () => ({
    uploadProductImage: vi.fn().mockResolvedValue(
        'https://cdn.example.com/storage/v1/object/public/product-images/d/p.jpg'
    ),
    isStorageImageUrl: vi.fn(v => typeof v === 'string' && v.includes('product-images')),
}));
vi.mock('../src/services/auditService', () => ({ logEvent: vi.fn() }));
vi.mock('../src/services/kardexService', () => ({
    recordKardexMovementUnlocked: vi.fn().mockResolvedValue(undefined),
}));

import { applyInventoryCommand } from '../src/utils/remoteInventoryProcessor';

const BASE_PRODUCT = {
    id: 'p1', name: 'Prod', priceUsd: 5, stock: 10,
    image: 'https://old.url/img.jpg', updatedAt: '2025-01-01T00:00:00.000Z',
};

describe('remoteInventoryProcessor — EGRESS RC2', () => {
    beforeEach(() => {
        store.clear();
        vi.clearAllMocks();
        const { uploadProductImage } = require('../src/utils/imageUpload');
        uploadProductImage.mockResolvedValue(
            'https://cdn.example.com/storage/v1/object/public/product-images/d/p.jpg'
        );
    });

    it('RC2-01: add con base64 → imagen guardada como URL', async () => {
        store.set('bodega_products_v1', []);
        const result = await applyInventoryCommand({
            action: 'add', productId: 'new1',
            data: { id: 'new1', name: 'Nuevo', priceUsd: 3, stock: 0, image: 'data:image/jpeg;base64,AA==' },
        });
        expect(result.success).toBe(true);
        const saved = store.get('bodega_products_v1').find(p => p.id === 'new1');
        expect(saved.image).not.toMatch(/^data:/);
        expect(saved.image).toContain('product-images');
    });

    it('RC2-02: edit con base64 → imagen guardada como URL', async () => {
        store.set('bodega_products_v1', [{ ...BASE_PRODUCT }]);
        const result = await applyInventoryCommand({
            action: 'edit', productId: 'p1',
            data: { name: 'Editado', priceUsd: 6, image: 'data:image/jpeg;base64,BB==',
                    baseUpdatedAt: '2025-01-01T00:00:00.000Z' },
        });
        expect(result.success).toBe(true);
        const saved = store.get('bodega_products_v1').find(p => p.id === 'p1');
        expect(saved.image).not.toMatch(/^data:/);
    });

    it('RC2-03: upload falla → base64 conservado, comando igual exitoso', async () => {
        const { uploadProductImage } = await import('../src/utils/imageUpload');
        uploadProductImage.mockResolvedValueOnce(null);
        store.set('bodega_products_v1', []);
        const result = await applyInventoryCommand({
            action: 'add', productId: 'p2',
            data: { id: 'p2', name: 'Fallback', priceUsd: 1, stock: 0, image: 'data:image/jpeg;base64,CC==' },
        });
        expect(result.success).toBe(true);
        const saved = store.get('bodega_products_v1').find(p => p.id === 'p2');
        expect(saved.image).toMatch(/^data:/);
    });

    it('RC2-04: comando sin imagen no llama uploadProductImage', async () => {
        store.set('bodega_products_v1', [{ ...BASE_PRODUCT }]);
        const { uploadProductImage } = await import('../src/utils/imageUpload');
        await applyInventoryCommand({
            action: 'edit', productId: 'p1',
            data: { name: 'Solo precio', priceUsd: 7, baseUpdatedAt: '2025-01-01T00:00:00.000Z' },
        });
        expect(uploadProductImage).not.toHaveBeenCalled();
    });

    it('RC2-05: URL de Storage pasada directamente no se re-sube', async () => {
        store.set('bodega_products_v1', []);
        const { uploadProductImage } = await import('../src/utils/imageUpload');
        await applyInventoryCommand({
            action: 'add', productId: 'p3',
            data: { id: 'p3', name: 'URL directa', priceUsd: 2, stock: 0,
                    image: 'https://x.supabase.co/storage/v1/object/public/product-images/d/p.jpg' },
        });
        expect(uploadProductImage).not.toHaveBeenCalled();
    });
});
```

### Guarda raíles

- Verificar que `const { action, productId, data } = resolvedPayload` reemplaza
  el destructuring original de `payload` en la línea 167 — de lo contrario el upload
  no se propaga dentro del lock.
- El `batch_edit` no necesita cobertura aquí: sus ítems individuales no llevan `image`
  de base64 en el flujo actual del monitor.
- `adjust_stock` y `delete` nunca tienen `data.image` → el bloque EGRESS RC2 es un no-op.

---

## FX04 — Commit singleton guard `useSupervisorCommands.js`

### Diagnóstico

El singleton guard (`_activeSubscriberCount`) ya está escrito en el árbol de trabajo como
cambio unstaged. Impide que el hook cree un segundo canal Realtime y un segundo polling
cuando `ProductProvider` monta dos veces (monitor + modo normal). Sin él, cada comando
se ejecuta 3 veces (triplicación de stock, deltas × 3).

### Verificación antes de commitear

```bash
git diff src/hooks/useSupervisorCommands.js | grep "activeSubscriberCount" | wc -l
# Debe imprimir ≥ 3 (declaración + incremento + decremento)
```

### Arnés — verificación estática en el test existente o nuevo

Añadir al final de `tests/hooks.test.js` (o crear `tests/supervisorCommandsSingleton.test.js`):

```js
import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

describe('useSupervisorCommands — singleton guard (SEC estática)', () => {
    const src = readFileSync('src/hooks/useSupervisorCommands.js', 'utf8');

    it('SG-01: declara _activeSubscriberCount a nivel de módulo', () => {
        expect(src).toMatch(/let\s+_activeSubscriberCount\s*=/);
    });

    it('SG-02: incrementa el contador en el useEffect', () => {
        expect(src).toMatch(/_activeSubscriberCount\+\+/);
    });

    it('SG-03: decrementa en el cleanup del useEffect', () => {
        expect(src).toMatch(/_activeSubscriberCount--/);
    });

    it('SG-04: retorna early si el contador supera 1', () => {
        expect(src).toMatch(/_activeSubscriberCount\s*>\s*1/);
    });
});
```

### Guarda raíles

- El guard solo protege la instancia en memoria. Si el componente desmonta y remonta
  en un nuevo ciclo de vida (HMR, navegación), el contador vuelve a 0 → correcto.
- No commitear junto con FX01/FX02/FX03 — mantener commits separados por trazabilidad.

---

## FX05 — Migración de base64 existentes en Supabase

### Diagnóstico

Productos con foto creados desde el monitor antes de FX01/FX02 siguen con base64 embebido
en `bodega_products_v1` en Supabase. `migrateProductImagesToStorage` ya existe en
`imageUpload.js:125` y funciona en el browser. No se necesita un script Python externo
(que requeriría service role key y no puede usar `hasActiveCloudSession`).

### Método de ejecución (desde la caja o el monitor)

Llamar `migrateProductImagesToStorage` con el array de productos actual y la función
de guardado de `storageService`:

```js
import { migrateProductImagesToStorage } from '../utils/imageUpload';
import { storageService } from '../utils/storageService';

const products = await storageService.getItem('bodega_products_v1', []);
const result = await migrateProductImagesToStorage(
    products,
    (out) => storageService.setItem('bodega_products_v1', out)
);
console.log('[Migración]', result);
// { migrated: N, failed: 0, total: N, products: [...] }
```

Puede añadirse como botón en el DevPanel existente o ejecutarse una vez desde la consola
del navegador en la caja. No requiere cambios de código nuevos.

### Guarda raíles

- Si `failed > 0`, los productos fallidos conservan el base64 local — no pierden imagen.
- Ejecutar **después** de FX01 (que habilita el upload en la caja) y FX02/FX03.
- Verificar en Supabase Dashboard → Storage → product-images que aparecen archivos
  con paths `{deviceId}/{productId}.{ext}`.

---

## Orden de ejecución

```
FX01 → commit "fix(imageUpload): allow upload from caja context (RC2 EGRESS)"
FX02 → commit "fix(RemoteProductFormModal): upload image to Storage before payload (RC1 EGRESS)"
FX03 → commit "fix(remoteInventoryProcessor): upload base64 outside write lock (RC2 EGRESS)"
FX04 → commit "fix(useSupervisorCommands): singleton guard prevents triple execution"
FX05 → ejecutar migración desde DevPanel (no requiere commit)
```

---

## Arnés de regresión completo

```bash
# Después de cada FX:
npx vitest run 2>&1 | tail -6
# Línea base esperada: 284 passed | 1 failed | 10 skipped
# Los dos tests nuevos añaden 9 casos → objetivo: 293 passed | 1 failed | 10 skipped
```

El único fallo permitido sigue siendo `tests/security.test.js:336`
(`DJ-V2-E87306F1...` vs `/^PDA-V2-.../`) — preexistente, fuera de alcance.

---

## Checklist de verificación manual (post-deploy)

- [ ] Monitor → crear producto con foto → foto visible en caja sin recarga
- [ ] Monitor offline → crear producto con foto → caja recibe base64, lo sube a Storage
- [ ] Editar precio de ese producto → `bodega_products_v1` en Supabase no tiene `data:image`
- [ ] Supabase Storage → `product-images` → archivo `{deviceId}/{productId}.jpg` existe
- [ ] Supabase Dashboard → `supervisor_commands` → payload sin base64 (< 5 KB por comando)
- [ ] Tamaño de `bodega_products_v1` en sync_documents < 30 KB

