# Plan de Ejecución — Edición Remota de Inventario (Supervisor → Caja)

> **Versión:** 2.0 · Corregida tras auditoría del código real (reemplaza el "Enfoque 1" original).
> **Audiencia:** un LLM ejecutor. Sigue este documento **al pie de la letra**.
> **Regla de oro:** este plan fue verificado contra el código. Si algo que ves en el código **no coincide** con lo que este plan describe, **DETENTE y reporta** — NO improvises.

---

## 0. Protocolo obligatorio (idéntico al plan de rediseño de artículos)

1. **Localiza por búsqueda de texto (`ANCLA:`), NUNCA por número de línea.** Si un ancla no aparece o es ambigua → DETENTE y reporta.
2. Una fase a la vez. No toques nada fuera del alcance listado.
3. Harness por fase: `npm run lint && npm run test && npm run build` — los 3 deben pasar antes de dar la fase por hecha.
4. Un commit por fase con el mensaje indicado. Trabaja en la rama indicada en la Fase 0. No hagas push salvo que el humano lo pida.
5. NUNCA inventes nombres de campos/funciones. Usa solo los del **Diccionario (§1)**.
6. Actualiza `future_plans/PROGRESO_inventario_remoto.md` al cerrar cada fase.

## 1. Diccionario (verificado en código — usar EXACTAMENTE estos nombres)

### Infraestructura existente
| Elemento | Ubicación | Notas |
|---|---|---|
| `useSupervisorCommands` | `src/hooks/useSupervisorCommands.js` | Hoy SOLO procesa `command_type === 'rate_change'` y SOLO escucha INSERT en vivo (sin catch-up). |
| Canal realtime | ANCLA: `` .channel(`supervisor_commands:${deviceId}`) `` | Filtro `primary_device_id=eq.${deviceId}`. |
| Emisor de comandos (patrón a imitar) | `src/components/SupervisorRateModal.jsx` ANCLA: `.from('supervisor_commands')` seguido de `.insert({` | Inserta `{ primary_device_id, monitor_device_id, command_type, payload, status: 'pending' }`. |
| Banner de notificación (patrón a clonar) | `src/components/SupervisorRateNotification.jsx` | Escucha CustomEvent `supervisor_rate_applied`; montado en `App.jsx` (ANCLA: `SupervisorRateNotification`). |
| `adjustStock(productId, delta)` | `src/context/ProductContext.jsx` ANCLA: `const adjustStock = useCallback` | Reutilizable, pero opera en estado React SIN lock — ver D3. |
| Evento de refresco | `app_storage_update` (CustomEvent con `detail.key`) | `ProductContext` ya lo escucha y re-lee `bodega_products_v1`. |
| Lock de escritura | `withLock('pos_write_lock', fn)` de `src/utils/withLock.js` | Patrón de referencia: `checkoutProcessor.js` ANCLA: `withLock('pos_write_lock'` (re-lee productos frescos dentro del lock). |
| Storage | `storageService.getItem/setItem('bodega_products_v1')` | `setItem` ya dispara `app_storage_update`. |
| Normalización de producto | `buildProductPayload` en `src/utils/productProcessor.js` | Genera `priceUsdt` (canónico) + `priceUsd` (alias) + campos de formatos. |
| Monitor | `src/views/OwnerMonitorView.jsx` ANCLA: `searchTermInventario` | Pestaña Inventario read-only; recibe productos por blob de `useMonitorSync`. |

### Modelo de producto (lógica NUEVA ya implementada — el formulario remoto DEBE cubrirla)
`priceUsd` + `priceUsdt` (alias canónico, escribir ambos), `priceBsManual` (Bs manual independiente), `costUsd`, `costBs`, `stock` (en unidades), `barcode`, `sellByBox`, `boxUnits`, `boxBarcode`, `boxPriceUsd`, `boxPriceBs`, `sellByHalfBox`, `halfBoxUnits`, `halfBoxBarcode`, `halfBoxPriceUsd`, `halfBoxPriceBs`, `category`, `lowStockAlert`, `unit`, `packagingType`.

### Payload del comando `inventory_update` (contrato NUEVO — fuente única de verdad)
```js
{
  action: 'add' | 'edit' | 'delete' | 'adjust_stock',
  productId: string,          // requerido salvo 'add' (en add va dentro de data.id)
  data: object | null,        // add/edit: objeto producto completo normalizado; adjust_stock: { delta: number }
  issuedAt: string,           // ISO timestamp del monitor
}
```
Reglas: `adjust_stock` usa **delta** PERO con deduplicación estricta por `command.id` (D2). `add`/`edit` llevan el producto **completo ya normalizado** (el monitor lo construye con la misma normalización que `buildProductPayload`; la caja re-valida).

## 2. Decisiones de diseño BLOQUEADAS

- **D1 — Catch-up obligatorio.** El realtime de Supabase NO re-emite INSERTs perdidos. Al montar el hook y en cada reconexión (`status === 'SUBSCRIBED'`), hacer `select` de comandos `status='pending'` del propio `primary_device_id`, ordenados por `created_at`, y procesarlos ANTES de confiar en el stream en vivo.
- **D2 — Idempotencia por ID.** Mantener un registro de IDs de comandos ya aplicados (`Set` en memoria + persistido en localStorage `dj_applied_supervisor_cmds_v1`, capado a los últimos 200 IDs). Todo comando (catch-up o en vivo) se salta si su `id` ya está registrado. Se registra ANTES de marcar `applied` en Supabase (así un fallo del UPDATE remoto no causa re-aplicación local).
- **D3 — Mutación bajo lock.** Los comandos de inventario NO usan `adjustStock` del context ni `setProducts`. Se aplican con el patrón del checkout: dentro de `withLock('pos_write_lock')`, re-leer `bodega_products_v1` fresco con `storageService.getItem`, mutar, `storageService.setItem` (que ya dispara `app_storage_update` → el ProductContext se refresca solo). Nunca desde estado React.
- **D4 — Validación en la caja (fuente de verdad).** La caja re-valida cada comando al aplicarlo: barcode único (los 3: `barcode`, `boxBarcode`, `halfBoxBarcode`, entre sí y contra el resto del inventario), `name` no vacío, precios ≥ 0, producto existente (edit/delete/adjust). Si falla → `status='failed'` con columna/campo `error_reason` en el UPDATE y NO se aplica nada.
- **D5 — DDL versionado.** El DDL + RLS de `supervisor_commands` se versiona en el repo ANTES de extender el canal. La tabla ya existe en Supabase (creada a mano): el SQL usa `CREATE TABLE IF NOT EXISTS` + `ALTER` idempotentes para no romper producción.
- **D6 — El monitor NUNCA escribe el blob.** El monitor solo inserta en `supervisor_commands`. Prohibido usar `storageService.setItem('bodega_products_v1')` en modo monitor (la vía blob está muerta: la caja no se suscribe a su propio sync y su push periódico pisaría todo).
- **D7 — Formulario remoto = versión ligera.** NO reutilizar `ProductFormModal` (acoplado a ~35 props de ProductsView). Crear un formulario compacto propio del monitor que cubra la lógica nueva: nombre, categoría, barcode, precios duales USD/Bs de Unidad, toggles Caja/½Caja con sus unidades/barcodes/precios duales, costo, stock y alerta. ½ Caja requiere Caja activa (misma regla que la caja).
- **D8 — PROHIBIDO base64 en el payload (egress).** El payload de `inventory_update` NUNCA lleva imágenes en base64 (un comando pasaría de ~2 KB a MB y viajaría 2 veces: insert + realtime, deshaciendo el EGRESS-FIX). El formulario remoto v1 NO incluye campo de foto; en `edit`, el campo `image` del producto existente se PRESERVA en la caja (el aplicador no lo toca si `data.image` es `undefined`). Si en el futuro se quiere foto remota, se sube primero al bucket `product-images` (patrón de `src/utils/imageUpload.js`) y el payload lleva solo la URL.

## 3. Fases

### FASE 0 — Rama y línea base
1. `git checkout -b feat/inventario-remoto` (desde la rama actual de trabajo o main, según indique el humano).
2. `npm run lint && npm run test && npm run build` — si algo falla YA, reporta y detente.
3. Crea `future_plans/PROGRESO_inventario_remoto.md` con checklist de Fases 0–6.
**Commit:** `chore(remote-inventory): rama y linea base`.

### FASE 1 — DDL + RLS versionados (D5)
**Archivo NUEVO:** `supabase_supervisor_commands_setup.sql` (raíz, junto a los demás SQL).
1. `CREATE TABLE IF NOT EXISTS public.supervisor_commands` con: `id uuid pk default gen_random_uuid()`, `primary_device_id text not null`, `monitor_device_id text not null`, `command_type text not null`, `payload jsonb not null default '{}'`, `status text not null default 'pending'`, `error_reason text`, `created_at timestamptz default now()`, `applied_at timestamptz`.
2. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS error_reason text;` (la tabla ya existe en prod sin esa columna).
3. CHECKs idempotentes (usar `DO $$ ... IF NOT EXISTS`): `command_type IN ('rate_change','inventory_update')`, `status IN ('pending','applied','failed')`.
4. RLS: habilitar; políticas para `anon` condicionadas a que el `device_id` esté emparejado — **copia el patrón exacto** de `supabase_pairing_setup.sql` (ANCLA: `sync_documents_anon_access`). INSERT: solo si `monitor_device_id` está emparejado con `primary_device_id`. SELECT/UPDATE: solo filas del propio `primary_device_id` o `monitor_device_id`.
5. Asegurar publicación realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE public.supervisor_commands;` envuelto en manejo de "ya existe".
6. Encabezado del SQL: comentario explicando que refleja una tabla creada a mano y es idempotente.
**Verificación:** el humano lo ejecuta en el SQL editor de Supabase y confirma sin errores. NO lo ejecutes tú.
**Commit:** `feat(db): versionar DDL y RLS de supervisor_commands (idempotente)`.

### FASE 2 — Endurecer el hook: catch-up (D1) + idempotencia (D2)
**Archivo:** `src/hooks/useSupervisorCommands.js` (ANCLA: `` .channel(`supervisor_commands:${deviceId}`) ``).
1. Extrae el cuerpo del handler actual a una función `processCommand(command)` reutilizable (mismo comportamiento para `rate_change`).
2. **Dedup:** módulo-nivel o ref: carga `dj_applied_supervisor_cmds_v1` de localStorage (array de IDs, máx 200). En `processCommand`, si `appliedIds.has(command.id)` → return. Añade el ID al set y persiste ANTES del UPDATE `status='applied'` a Supabase.
3. **Catch-up:** función `catchUpPending()` que hace `supabaseCloud.from('supervisor_commands').select('*').eq('primary_device_id', deviceId).eq('status','pending').order('created_at')` y pasa cada fila por `processCommand`. Llámala: (a) al montar tras crear el canal, y (b) en el callback de `.subscribe((status) => ...)` cuando `status === 'SUBSCRIBED'` (cubre reconexiones). Maneja errores con `console.error` sin romper el canal.
4. NO cambies aún el manejo de `inventory_update` (Fase 3). Comandos de tipo desconocido: ignóralos como hoy.
**Guardarraíl:** prueba unitaria nueva `tests/supervisorCommands.test.js` que verifique el dedup (procesar dos veces el mismo `id` aplica una sola vez) — mockea supabase como en `tests/checkoutBsManual.test.js`.
**Commit:** `fix(supervisor): catch-up de comandos pendientes y deduplicacion por id`.

### FASE 3 — Aplicador de inventario con lock en la caja (D3, D4)
**Archivo NUEVO:** `src/utils/remoteInventoryProcessor.js`.
1. Exporta `async function applyInventoryCommand(payload)` → `{ success, error? }`:
   - Valida forma del payload (action/productId/data según §1). Inválido → `{ success:false, error:'...' }`.
   - Todo dentro de `withLock('pos_write_lock', async () => { ... })` (patrón e import iguales a `checkoutProcessor.js`).
   - Dentro del lock: `const products = await storageService.getItem('bodega_products_v1', [])` (fresco).
   - `add`: valida unicidad de los 3 barcodes contra TODO el inventario y entre sí (ignora vacíos/null); valida `name` y precios; push del producto (asegura `priceUsdt = priceUsd` si falta). `edit`: igual pero reemplaza por `id` (excluyéndose a sí mismo en la validación de barcodes); si no existe → error. `delete`: filtra por `id`; si no existe → error. `adjust_stock`: `stock = max(0, stock + delta)` salvo `allow_negative_stock === 'true'` en localStorage (misma regla que `adjustStock` del context — verifica el ancla `allow_negative_stock` en `ProductContext.jsx`).
   - `await storageService.setItem('bodega_products_v1', updated)` — esto ya dispara `app_storage_update` y el ProductContext se refresca solo. NO llames a setProducts ni adjustStock del context.
   - Auditoría: registra con el mismo mecanismo que usa la caja para ajustes (ANCLA en `ProductsView.jsx`: `auditLog('INVENTARIO'`) — usa `auditLog('INVENTARIO', 'REMOTO_<ACTION>', ...)` importando de `src/services/auditService`.
2. En `useSupervisorCommands.js`: en `processCommand`, añade la rama `command.command_type === 'inventory_update'` → `applyInventoryCommand(command.payload)`. Si `success` → UPDATE `status='applied', applied_at`; si no → UPDATE `status='failed', error_reason`. Después de aplicar OK, dispara `window.dispatchEvent(new CustomEvent('supervisor_inventory_applied', { detail: { action, productName } }))`.
**Guardarraíl:** pruebas en `tests/remoteInventory.test.js`: add válido, add con barcode duplicado → failed, edit inexistente → failed, adjust_stock con delta negativo no baja de 0, y dedup end-to-end (mismo comando 2 veces → stock cambia 1 vez).
**Commit:** `feat(supervisor): aplicador de comandos de inventario con lock y validacion en caja`.

### FASE 4 — Banner de notificación en la caja
**Archivo NUEVO:** `src/components/SupervisorInventoryNotification.jsx` — **clona** `SupervisorRateNotification.jsx` (estructura, sonido `soundService.playAlert()`, cierre por tap) cambiando: evento escuchado → `supervisor_inventory_applied`; texto → según `detail.action`: "El supervisor agregó/editó/eliminó «{productName}»" / "ajustó el stock de «{productName}»".
Móntalo en `App.jsx` junto al de tasa (ANCLA: `SupervisorRateNotification`).
**Commit:** `feat(ui): banner de inventario modificado por supervisor en la caja`.

### FASE 5 — UI del monitor: emisión de comandos (D6, D7)
**Archivos:** `src/views/OwnerMonitorView.jsx` (ANCLA: `searchTermInventario`) + NUEVO `src/components/Monitor/RemoteProductFormModal.jsx`.
1. **Emisor común** en OwnerMonitorView: `sendInventoryCommand(action, productId, data)` que inserta en `supervisor_commands` **copiando el patrón exacto** de `SupervisorRateModal.jsx` (mismos nombres de IDs de pairing que ya usa ese archivo — verifica cómo obtiene `primary_device_id`/`monitor_device_id` y replica). `payload` según contrato §1 con `issuedAt`. Toast: "Enviado a la caja" / error si falla el insert.
2. **Ajuste rápido:** botones `+`/`-` en cada tarjeta de la pestaña Inventario → `sendInventoryCommand('adjust_stock', p.id, { delta: ±1 })`. Deshabilitados si no hay conexión.
3. **Tarjetas actualizadas a la lógica nueva:** mostrar `priceUsd` y Bs (usa `priceBsManual` si existe, si no `priceUsd × tasa`), badges 📦 Caja / ½ Caja si `sellByBox`/`sellByHalfBox`, stock con equivalente en cajas (`≈ stock/boxUnits`).
4. **Formulario remoto ligero** (`RemoteProductFormModal.jsx`): campos del Diccionario §1 (identidad, precios duales de Unidad, toggles Caja/½Caja con unidades/barcode/precios duales, costo, stock, alerta). Reglas: ½ Caja deshabilitada si Caja está apagada; al guardar construye el objeto producto completo (para `edit`, partir del producto existente y sobreescribir; asegurar `priceUsdt = priceUsd`) y llama `sendInventoryCommand('edit'|'add', ...)`. Para `add`, genera `id` con `crypto.randomUUID()`. Botón "Nuevo producto" + botón editar por tarjeta + eliminar con confirmación (`sendInventoryCommand('delete', p.id, null)`).
5. **No optimista:** el monitor NO modifica su copia local; el cambio le llegará por el sync del blob de la caja (~20s). Muestra en el toast "se reflejará al sincronizar".
**Guardarraíl manual:** con celular+PC emparejados: editar precio Bs manual desde el celular → la caja lo aplica y el banner suena; `+1` stock → stock sube en caja; apagar la PC, enviar un cambio, encenderla → el catch-up lo aplica al conectar.
**Commit:** `feat(monitor): edicion remota de inventario con precios duales y formatos`.

### FASE 6 — Cierre
1. Harness completo verde. 2. Checklist de `PROGRESO_inventario_remoto.md` completa, incluyendo el resultado de las 3 pruebas de flujo del plan original (edición en vivo, stock, offline→catch-up). 3. Reporta al humano commits y pruebas pendientes de hardware real.
**Commit:** `docs(remote-inventory): cierre del plan con verificaciones`.

## 4. Si algo no encaja
Ante cualquier discrepancia (ancla ausente, columna inexistente en Supabase, patrón distinto), DETENTE y reporta qué esperabas vs qué encontraste. En especial: si la tabla `supervisor_commands` en producción tiene columnas distintas a las de la Fase 1, reporta antes de tocar el hook.
