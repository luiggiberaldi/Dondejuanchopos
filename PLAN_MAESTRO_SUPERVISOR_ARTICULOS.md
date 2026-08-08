# PLAN MAESTRO — Supervisor: Crear y Editar Artículos
> Fecha: 2026-08-08 | Alcance: egress de imágenes + fixes de auditoría + commit de todo

Este plan consolida dos capas de trabajo:
- **Bloque A**: los cuatro fixes de egress (FX01–FX04) ya están escritos en el árbol de
  trabajo pero sin commitear. Este bloque los valida y los consolida.
- **Bloque B**: seis correcciones del audit posterior (FA01–FA06), desde triviales hasta
  una mejora de UX en el rechazo de conflictos.

---

## Línea base antes de empezar

```bash
# Verificar estado actual del árbol
git status --short
# Debe mostrar M en imageUpload.js, RemoteProductFormModal.jsx,
# remoteInventoryProcessor.js, useSupervisorCommands.js, ProductContext.jsx
# y ?? en los tres test files nuevos.

# Correr suite completa
npx vitest run 2>&1 | tail -6
# Esperado: 284 passed | 1 failed | 10 skipped
# (el fallo de security.test.js:336 es preexistente, fuera de alcance)
```

---

## Tabla de fases

| Fase | Descripción | Archivo principal | Severidad |
|------|-------------|-------------------|-----------|
| FA-C1 | Commit egress fixes (FX01–FX04) + tests | múltiples | — |
| FA01 | Actualizar comentario D8 | `remoteInventoryProcessor.js` | trivial |
| FA02 | Guard de tamaño antes de FileReader | `RemoteProductFormModal.jsx` | medium |
| FA03 | Catch en `handleSubmit` | `RemoteProductFormModal.jsx` | minor |
| FA04 | Eliminar variable `data` muerta | `remoteInventoryProcessor.js` | cosmético |
| FA05 | Mejor mensaje en rechazo de conflicto | `remoteInventoryProcessor.js` | medium |
| FA06 | Documentar limitación de `batch_edit` | `remoteInventoryProcessor.js` | low |

---

## Bloque A — Consolidar cambios aplicados

### FA-C1 — Verificar y commitear FX01–FX04 + tests

#### Verificación antes de commitear

```bash
# FX01: hasActiveCloudSession tiene el check de dj_device_id
grep -n "dj_device_id" src/utils/imageUpload.js
# Debe imprimir una línea en ~46 con `if (localStorage.getItem('dj_device_id')) return true`

# FX02: handleSubmit tiene productId antes del payload
grep -n "productId = editingProduct" src/components/Monitor/RemoteProductFormModal.jsx
# Debe imprimir línea ~176

# FX03: resolvedPayload existe antes del withLock
grep -n "resolvedPayload" src/utils/remoteInventoryProcessor.js
# Debe imprimir ≥ 3 líneas (declaración + asignación + uso dentro del lock)

# FX04: singleton guard presente
grep -n "_activeSubscriberCount" src/hooks/useSupervisorCommands.js
# Debe imprimir ≥ 3 líneas (declaración + incremento + decremento)

# Tests nuevos existen y pasan
npx vitest run tests/imageUpload.test.js tests/remoteInventoryEgress.test.js \
    tests/supervisorCommandsSingleton.test.js 2>&1 | tail -6
# Esperado: 13 passed (3)
```

#### Orden de commits (3 commits separados por trazabilidad)

```bash
# Commit 1 — fix de egress en imageUpload + modal
git add src/utils/imageUpload.js src/components/Monitor/RemoteProductFormModal.jsx
git commit -m "fix(egress): upload image to Storage before supervisor command payload (RC1)

- hasActiveCloudSession ahora retorna true para la caja principal (dj_device_id)
- handleSubmit determina productId antes del payload para ruta determinística
- uploadProductImage se llama antes de construir data; fallback a base64 si falla

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"

# Commit 2 — fix de egress en remoteInventoryProcessor + singleton guard
git add src/utils/remoteInventoryProcessor.js src/hooks/useSupervisorCommands.js \
    src/context/ProductContext.jsx
git commit -m "fix(egress): upload base64 image outside write lock; singleton guard for commands (RC2)

- resolvedPayload bloque extrae upload de imagen antes de withLock
- _activeSubscriberCount previene canales Realtime duplicados

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"

# Commit 3 — tests
git add tests/imageUpload.test.js tests/remoteInventoryEgress.test.js \
    tests/supervisorCommandsSingleton.test.js
git commit -m "test: harnesses for egress image upload and supervisor singleton guard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

#### Guarda raíles FA-C1

- Correr `npx vitest run` completo ANTES de hacer `git add`. Si algún test nuevo falla, no commitear.
- Los commits van en la rama `main` actual — no crear rama nueva (decisión del usuario).
- Objetivo post-commit: **293 passed | 1 failed | 10 skipped**.

---

## Bloque B — Fixes del audit

---

### FA01 — Actualizar comentario D8

**Severidad:** trivial  
**Ancla:** `src/utils/remoteInventoryProcessor.js:319`

#### Cambio exacto

```diff
-            // D8: preservar imagen local si el comando no la trae (nunca viaja base64)
+            // D8: preservar imagen local si el comando no la trae.
+            // Puede llegar base64 como fallback offline (RC2 lo intenta antes del lock).
             if (normalized.image === undefined) normalized.image = existing.image;
```

#### Arnés — verificación estática

Añadir al final de `tests/remoteInventoryEgress.test.js`:

```js
import { readFileSync } from 'fs';

describe('remoteInventoryProcessor — comentarios de diseño', () => {
    const src = readFileSync('src/utils/remoteInventoryProcessor.js', 'utf8');

    it('FA01: D8 no afirma "nunca viaja base64" (assertion obsoleta)', () => {
        expect(src).not.toMatch(/nunca viaja base64/);
    });
});
```

#### Guarda raíles

- Solo toca el comentario, no la lógica. Build y tests no pueden romper.

---

### FA02 — Guard de tamaño antes del FileReader

**Severidad:** medium — bloqueo de hilo en imágenes grandes  
**Ancla:** `src/components/Monitor/RemoteProductFormModal.jsx:86`

#### Cambio exacto

```diff
 const handleImageUpload = (e) => {
     const file = e.target.files?.[0];
     if (!file) return;
+    // EGRESS RC1-guard: rechazar antes de leer el archivo completo.
+    // 8 MB crudos → canvas comprime a ≤ 300 KB. Más de 8 MB bloquea el hilo.
+    if (file.size > 8 * 1024 * 1024) {
+        const { showToast } = require('../Toast');
+        showToast('La imagen es demasiado grande (máx 8 MB). Recórtala antes de subir.', 'warning');
+        return;
+    }
 
     const reader = new FileReader();
```

> Nota: el import dinámico con `require` no funciona en ESM — en su lugar importar
> `showToast` al inicio del archivo si no está ya importado. Verificar si ya existe.

#### Arnés — verificación estática

```js
// tests/remoteProductFormGuards.test.js  (archivo nuevo)
import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

describe('RemoteProductFormModal — guards estáticos', () => {
    const src = readFileSync('src/components/Monitor/RemoteProductFormModal.jsx', 'utf8');

    it('FA02: tiene guard de tamaño antes de FileReader', () => {
        expect(src).toMatch(/file\.size\s*>/);
    });

    it('FA03: handleSubmit tiene bloque catch', () => {
        // La función handleSubmit debe tener try/catch, no solo try/finally
        const fnMatch = src.match(/const handleSubmit[\s\S]+?^\s{4}\};/m);
        expect(fnMatch).not.toBeNull();
        expect(fnMatch[0]).toMatch(/\}\s*catch\s*\(/);
    });
});
```

#### Guarda raíles

- El toast importado debe ser el de `'../Toast'` (ruta relativa desde `components/Monitor`),
  no de `'../../components/Toast'`.
- No cambiar el canvas ni la lógica de compresión — solo el early return.

---

### FA03 — Catch en `handleSubmit`

**Severidad:** minor — fallo silencioso si localStorage está lleno  
**Ancla:** `src/components/Monitor/RemoteProductFormModal.jsx:222`

#### Cambio exacto

```diff
+        } catch (err) {
+            console.error('[RemoteProductFormModal] Error al encolar cambio:', err);
+            showToast('No se pudo guardar el cambio. Comprueba el almacenamiento.', 'error');
         } finally {
             setSending(false);
         }
     };
```

> El bloque va entre el cierre del `try` y el `finally` existente.
> Requiere que `showToast` esté importado (verificar si ya lo está; si no, importarlo).

#### Guarda raíles

- El `finally` siempre libera el spinner. El `catch` agrega el toast sin reemplazar el `finally`.
- `onClose()` sigue sin llamarse cuando hay error — el modal permanece abierto para que el usuario reintente.
- El test estático de FA02/FA03 ya cubre este fix (verifica `} catch (`).

---

### FA04 — Eliminar variable `data` muerta

**Severidad:** cosmético  
**Ancla:** `src/utils/remoteInventoryProcessor.js:168`

#### Cambio exacto

```diff
-    const { action, productId, data } = payload;
+    const { action, productId } = payload;
     if (action !== 'add' && action !== 'batch_edit' && !productId) {
         return { success: false, error: 'productId requerido' };
     }
```

La `data` declarada aquí jamás se lee: está ensombrecida por `const { action, productId, data } = resolvedPayload` dentro del callback del lock. Los `const` del scope externo no se ven desde dentro del callback.

#### Arnés — verificación estática

Añadir al final de `tests/remoteInventoryEgress.test.js`:

```js
describe('remoteInventoryProcessor — dead code', () => {
    const src = readFileSync('src/utils/remoteInventoryProcessor.js', 'utf8');

    it('FA04: destructuring externo no declara `data` (variable muerta)', () => {
        // Buscar el patrón específico del destructuring externo de payload
        // antes de resolvedPayload. No debe incluir `data`.
        expect(src).not.toMatch(/const\s*\{\s*action\s*,\s*productId\s*,\s*data\s*\}\s*=\s*payload/);
    });
});
```

#### Guarda raíles

- Verificar que el build y los tests pasan después del cambio — `data` dentro del lock
  lee de `resolvedPayload`, no del scope externo, así que ninguna ruta lógica cambia.

---

### FA05 — Mejor mensaje en rechazo de conflicto

**Severidad:** medium — UX: el supervisor no sabe qué producto fue rechazado  
**Ancla:** `src/utils/remoteInventoryProcessor.js:293-298`

#### Diagnóstico

Cuando `baseUpdatedAt < existing.updatedAt`, la caja rechaza el edit. El `error_reason`
que llega al monitor dice "El producto fue modificado por otro supervisor..." sin mencionar
el nombre del producto. El toast que aparece en el monitor (`❌ La caja rechazó los cambios:
Error desconocido`) no ayuda al supervisor a saber qué acción tomar.

#### Cambio exacto

```diff
             if (!isNaN(baseTime) && !isNaN(existingTime) && baseTime < existingTime) {
                 return {
                     success: false,
-                    error: 'El producto fue modificado por otro supervisor. Vuelve a encolar el cambio.'
+                    conflictRejection: true,
+                    productName: existing.name,
+                    error: `Conflicto en "${existing.name}": fue editado por otro supervisor mientras esperaba. Reabre el producto y vuelve a encolar.`
                 };
             }
```

#### Arnés — test en `tests/remoteInventoryEgress.test.js`

Añadir al bloque `describe('remoteInventoryProcessor — EGRESS RC2')`:

```js
    it('FA05: rechazo de conflicto incluye nombre del producto', async () => {
        const existingProduct = {
            ...BASE_PRODUCT,
            updatedAt: '2025-06-01T12:00:00.000Z',   // más reciente que el baseUpdatedAt
        };
        store.set('bodega_products_v1', [existingProduct]);

        const result = await applyInventoryCommand({
            action: 'edit',
            productId: 'p1',
            data: {
                name: 'Intento de edición',
                priceUsd: 9,
                baseUpdatedAt: '2025-01-01T00:00:00.000Z',  // stale
            },
        });

        expect(result.success).toBe(false);
        expect(result.conflictRejection).toBe(true);
        expect(result.productName).toBe('Prod');
        expect(result.error).toContain('Prod');
        expect(result.error).toContain('conflicto' || 'Conflicto');
    });
```

#### Guarda raíles

- El campo `conflictRejection: true` es adicional — no rompe ningún caller existente
  que solo mire `success` y `error`.
- `useSupervisorCommands` ya pasa `result.error` como `error_reason` a Supabase
  (línea 204): `await updateCommandStatus(command.id, 'failed', result.error)`.
  El nuevo mensaje es más largo pero sigue siendo < 500 chars (límite del UPDATE).

---

### FA06 — Documentar limitación de `batch_edit` sin imágenes

**Severidad:** low — no es un bug activo, pero es una trampa para el futuro  
**Ancla:** `src/utils/remoteInventoryProcessor.js:176`

#### Cambio exacto

```diff
     // EGRESS RC2: si el monitor no pudo subir la imagen (offline), la caja lo intenta.
     // Se hace ANTES del withLock — un upload de red no puede sostener el write-lock
     // porque bloquearía el checkout durante segundos.
     // El upload es idempotente (upsert:true, ruta determinística por ID).
+    // LIMITACIÓN: batch_edit tiene data.items[].data.image — esos no pasan por aquí.
+    // En el flujo actual esto no ocurre (cada ítem pasó por handleSubmit antes de
+    // ser encolado), pero si en el futuro se añade otro origen de batch_edit con
+    // imágenes, este bloque debe extenderse para iterar sobre los ítems.
     let resolvedPayload = payload;
```

#### Arnés

No requiere test de código. Aplica inmediatamente con la anotación.

---

## Bloque C — Arnés de regresión completo

### Tests nuevos a crear

| Archivo | Casos que cubre |
|---------|----------------|
| `tests/imageUpload.test.js` | IM-01 a IM-04: `hasActiveCloudSession` y `isStorageImageUrl` |
| `tests/remoteInventoryEgress.test.js` | RC2-01 a RC2-05: upload base64 en add/edit, fallback, sin imagen, URL directa |
| `tests/supervisorCommandsSingleton.test.js` | SG-01 a SG-04: guard singleton estático |
| `tests/remoteProductFormGuards.test.js` | FA02/FA03: guards estáticos del modal |

### Casos adicionales a añadir en `tests/remoteInventoryEgress.test.js`

```js
// Al final del archivo, después de los tests RC2-xx:

import { readFileSync } from 'fs';

describe('remoteInventoryProcessor — comentarios y dead code', () => {
    const src = readFileSync('src/utils/remoteInventoryProcessor.js', 'utf8');

    it('FA01: D8 no afirma "nunca viaja base64"', () => {
        expect(src).not.toMatch(/nunca viaja base64/);
    });

    it('FA04: destructuring externo de payload no declara `data`', () => {
        expect(src).not.toMatch(/const\s*\{\s*action\s*,\s*productId\s*,\s*data\s*\}\s*=\s*payload/);
    });
});

describe('remoteInventoryProcessor — rechazo de conflicto (FA05)', () => {
    beforeEach(() => {
        store.clear();
        vi.clearAllMocks();
    });

    it('FA05: rechazo incluye nombre del producto y flag conflictRejection', async () => {
        store.set('bodega_products_v1', [{
            id: 'pConflict', name: 'Café Molido', priceUsd: 3,
            stock: 10, updatedAt: '2025-06-01T12:00:00.000Z',
        }]);
        const result = await applyInventoryCommand({
            action: 'edit', productId: 'pConflict',
            data: { name: 'Café Molido', priceUsd: 4, baseUpdatedAt: '2025-01-01T00:00:00.000Z' },
        });
        expect(result.success).toBe(false);
        expect(result.conflictRejection).toBe(true);
        expect(result.productName).toBe('Café Molido');
        expect(result.error).toContain('Café Molido');
    });

    it('FA05: edición sin conflicto no incluye conflictRejection', async () => {
        store.set('bodega_products_v1', [{
            id: 'pOk', name: 'Arroz', priceUsd: 1,
            stock: 5, updatedAt: '2025-01-01T00:00:00.000Z',
        }]);
        const result = await applyInventoryCommand({
            action: 'edit', productId: 'pOk',
            data: { name: 'Arroz', priceUsd: 2, baseUpdatedAt: '2025-01-01T00:00:00.000Z' },
        });
        expect(result.success).toBe(true);
        expect(result.conflictRejection).toBeUndefined();
    });
});
```

### Objetivo de tests post-fix completo

```bash
npx vitest run 2>&1 | tail -6
# Esperado: 299 passed | 1 failed | 10 skipped
# (293 de Bloque A + 6 casos nuevos de Bloque B)
```

---

## Orden de ejecución

```
FA-C1  → verificar + commitear (3 commits separados)
FA01   → 1 línea de comentario
FA02   → early return en handleImageUpload
FA03   → catch en handleSubmit
FA04   → quitar `data` del destructuring externo
FA05   → mejorar mensaje de rechazo de conflicto
FA06   → comentario de documentación
       → correr suite completa: 299 passed | 1 failed | 10 skipped
```

**Regla de parada:** si en cualquier punto la suite pasa de **1 failed** a **más de 1 failed**,
detener y diagnosticar antes de continuar.

---

## Checklist de verificación manual (post-deploy)

- [ ] Monitor → crear producto con foto → Storage tiene el archivo, modal cierra
- [ ] Monitor → editar producto, cambiar foto → Storage actualiza (mismo path, upsert)
- [ ] Monitor offline → crear producto con foto → caja recibe base64, lo sube a Storage ella
- [ ] Monitor → intentar subir imagen de 20 MB → toast de error inmediato, sin bloqueo
- [ ] Monitor → dos supervisores editan el mismo producto a la vez → el segundo recibe toast
      con nombre del producto ("Conflicto en 'Café Molido': fue editado por otro supervisor")
- [ ] Supabase → `bodega_products_v1` doc → campo `image` no contiene `data:image`
- [ ] Tamaño de `bodega_products_v1` en `sync_documents` < 30 KB
- [ ] Supabase → `supervisor_commands` → payloads sin base64 (< 5 KB cada uno)




