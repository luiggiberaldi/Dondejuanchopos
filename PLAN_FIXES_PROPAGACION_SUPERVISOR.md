# Plan de Fixes — Propagación de Cambios del Supervisor (Ronda 4)

**Fecha:** 2026-07-25
**Síntoma reportado:** algunos cambios hechos desde la zona de supervisor no se hacen efectivos de inmediato al pulsar «Subir al sistema».
**Diagnóstico:** cuatro causas independientes que se combinan. Ninguna es la cola de comandos en sí — la cola funciona; lo que falla es el eco de vuelta, la visibilidad de los rechazos y el guard del botón.

Este plan es independiente de `PLAN_FIXES_PRESENCIA_Y_RLS.md` (ronda 3) y puede aplicarse antes, después o en paralelo — no comparten archivos salvo `useMonitorSync.js`, y en zonas distintas.

---

## 1. Causas confirmadas

| # | Causa | Efecto observable |
|---|---|---|
| C1 🔴 | El handler de Realtime descarta en silencio los documentos que superan el tope de tamaño | Productos y ventas **nunca** llegan por tiempo real; sólo al refrescar o recargar |
| C2 🟠 | El estado `failed` no se renderiza en ninguna parte | Un cambio rechazado por la caja es indistinguible de uno aplicado |
| C3 🟠 | La escritura optimista del monitor deja `updatedAt` viejo y persiste valores calculados | El segundo cambio sobre el mismo producto se rechaza por conflicto de versión |
| C4 🟠 | `setUploading(true)` no se llama nunca | Doble toque en «Subir al sistema» duplica toda la cola: stock aplicado dos veces |

### C1 — Detalle

[useMonitorSync.js:152](src/hooks/useMonitorSync.js#L152), introducido por el commit `373f76c` ("corregir nulos en Realtime"):

```js
if (!doc || !doc.data || !['store', 'local'].includes(doc.collection)) return;
```

Los nulos eran reales, pero la causa no se atacó. Supabase Realtime tiene un tope de bytes por registro (`max_record_bytes`, 1 MB por defecto). Cuando `sync_documents.data` lo supera, el evento llega con `record` vacío y `errors: ['Error 413: Payload Too Large']`. Antes eso reventaba con TypeError; ahora se descarta sin log ni fallback.

El documento que lo supera es `bodega_products_v1`, porque las imágenes vuelven a quedar en base64 dentro del producto: [imageUpload.js:78](src/utils/imageUpload.js#L78) aborta la subida a Storage si `hasActiveCloudSession()` es falso, y [ProductsView.jsx:483-485](src/views/ProductsView.jsx#L483-L485) deja el data-URI tal cual cuando la subida devuelve `null`. En una caja normal (rol `anon`, sin `sb-*-auth-token` y sin `dj_paired_device_id`) ese es el camino habitual, no la excepción.

Los documentos pequeños (tasa, `cop_enabled`, `business_name`) sí llegan al instante — de ahí que el usuario perciba que "algunos" cambios no se hacen efectivos.

### C3 — Detalle

[OwnerMonitorView.jsx:551-558](src/views/OwnerMonitorView.jsx#L551-L558) persiste `projectedProducts` en `bodega_products_v1` tras subir. Esa proyección:
- conserva el `updatedAt` viejo (la caja pondrá uno nuevo al aplicar, [remoteInventoryProcessor.js:151](src/utils/remoteInventoryProcessor.js#L151));
- persiste stock **calculado** (`Math.max(0, base + delta)` y el stock dinámico de combos);
- persiste `costUsd: p.costUsd || effCost`, sustituyendo el costo real por el efectivo.

El siguiente `edit` viaja con `baseUpdatedAt` viejo ([RemoteProductFormModal.jsx:205](src/components/Monitor/RemoteProductFormModal.jsx#L205)) y la guarda de versionado lo rechaza ([remoteInventoryProcessor.js:130-139](src/utils/remoteInventoryProcessor.js#L130-L139)). Normalmente el eco de la caja corregiría el `updatedAt` en segundos — pero por C1 ese eco no llega, así que el producto queda **bloqueado para siempre** hasta recargar, y el rechazo es invisible por C2.

---

## 2. Plan de fixeo

Una fase = un commit. Tras cada fase: `npx eslint --no-cache <archivos tocados>`, `npx vitest run`, `npm run build`. Si el código no coincide con las anclas descritas, **detenerse y reportar**.

Reglas vigentes: SEC-002, SEC-009 (nada de `localStorage.setItem` directo en código nuevo — usar `storageService`), SEC-010, guarda FIN-022, sin `parseFloat` en código financiero, sin código de migración de datos, no hacer push salvo pedido explícito.

**Orden recomendado:** FS1 → FS3 → FS4 → FS5 → FS6 → FS2. FS1 es el arreglo durable; FS2 sólo reduce la frecuencia del problema y depende de una verificación en Supabase.

---

### FS1 🔴 — El Realtime nunca debe descartar en silencio

**Archivo:** [src/hooks/useMonitorSync.js](src/hooks/useMonitorSync.js)
**Ancla:** el callback de `.on('postgres_changes', { ... table: 'sync_documents' ... })`.

Cuando el registro llega vacío no sabemos **qué** documento cambió, así que la única respuesta correcta es un pull completo con throttle.

**1.1** Junto a `let monitorSubscription = null;` (nivel de módulo) agregar:

```js
let oversizePullTimer = null;
```

**1.2** Dentro de `useMonitorSync`, una ref para poder llamar a `initMonitor` desde el callback sin caer en TDZ (el callback se crea **dentro** de `initMonitor`):

```js
const initMonitorRef = useRef(null);
useEffect(() => { initMonitorRef.current = initMonitor; }, [initMonitor]);
```

Declarar `initMonitorRef` antes de `initMonitor` y el `useEffect` después de su definición.

**1.3** Reemplazar el guard por:

```js
}, async (payload) => {
    // DELETE no entrega `new`; los documentos no se borran en el flujo normal.
    if (payload?.eventType === 'DELETE') return;

    const doc = payload?.new;

    // Realtime entrega el registro VACÍO cuando supera max_record_bytes
    // (payload.errors → 'Error 413: Payload Too Large'). No sabemos qué doc_id
    // cambió, así que forzamos un pull completo en vez de perder el cambio.
    if (!doc || !doc.doc_id || !doc.data) {
        console.warn('[useMonitorSync] Evento de Realtime sin cuerpo (posible 413). Forzando pull completo.', payload?.errors);
        if (!oversizePullTimer) {
            oversizePullTimer = setTimeout(() => {
                oversizePullTimer = null;
                initMonitorRef.current?.(true); // pull silencioso
            }, 3000);
        }
        return;
    }

    if (!['store', 'local'].includes(doc.collection)) return;
    if (!MONITOR_DOC_IDS.includes(doc.doc_id)) return;
    await applyDocToLocal(doc.doc_id, doc.collection, doc.data?.payload);
    ...
```

**1.4** En el cleanup del efecto que ya limpia `reconnectTimer`, agregar:

```js
if (oversizePullTimer) { clearTimeout(oversizePullTimer); oversizePullTimer = null; }
```

**Por qué 3 s de throttle:** la caja empuja `bodega_products_v1` y a veces `bodega_sales_v1` en la misma operación. Un solo pull cubre ambos y evita una tormenta de `select` si llegan cinco eventos grandes seguidos. `initMonitor` ya se protege con `isSyncingRef`.

**Costo de egreso:** un pull completo por ráfaga de cambios grandes, en vez de perder el cambio. Es el mismo pull que ya ocurre al reconectar.

**Verificación manual:** con la caja y el monitor abiertos, editar un producto desde el monitor y subirlo. En la consola del monitor debe aparecer, o bien el cambio aplicado por realtime, o bien el aviso "Evento de Realtime sin cuerpo (posible 413). Forzando pull completo" seguido del cambio visible en ≤3 s. **En ningún caso debe quedarse sin actualizar.**

---

### FS3 🟠 — Bloquear «Subir al sistema» mientras sube

**Archivo:** [src/views/OwnerMonitorView.jsx](src/views/OwnerMonitorView.jsx)
**Ancla:** `const uploadPendingChanges = async () => {`

El guard `if (pendingChanges.length === 0 || uploading) return;` (línea ~517) lee un estado que nunca se pone en `true`: `setUploading(true)` no existe en el archivo, sólo el `setUploading(false)` de la línea ~560. El botón nunca se deshabilita ni muestra «Subiendo…», y dos toques insertan la cola completa dos veces. La deduplicación de la caja es por `id` de comando, así que **no filtra los duplicados**: los `adjust_stock` se aplican dos veces.

```js
if (pendingChanges.length === 0 || uploading) return;
setUploading(true);
const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';

try {
    // ... todo el cuerpo actual, incluido persistPending(remaining) y los showToast
} finally {
    setUploading(false);
}
```

El `setUploading(false)` suelto de la línea ~560 se elimina: queda sólo el del `finally`.

**Nota:** el guard por estado de React no protege contra dos toques dentro del mismo frame. Si en pruebas aparece igual, añadir un `uploadingRef` (`useRef(false)`) comprobado y fijado de forma síncrona en la primera línea. Documentarlo si se llega a necesitar.

**Verificación manual:** encolar 3 cambios y pulsar «Subir al sistema» dos veces rápido. En la pestaña «Cambios» deben aparecer **3** comandos, no 6, y el botón debe mostrar «Subiendo…» deshabilitado.

---

### FS4 🟠 — Hacer visibles los comandos rechazados

**Archivo:** [src/views/OwnerMonitorView.jsx](src/views/OwnerMonitorView.jsx)

La caja marca `status:'failed'` con `error_reason` ([useSupervisorCommands.js:126](src/hooks/useSupervisorCommands.js#L126)), pero el monitor no lo muestra en ningún lado.

**4.1** Badge. En la cadena de `statusBadge` (~línea 2602), después de la rama `cancelled`:

```js
} else if (cmd.status === 'failed') {
    statusBadge = (
        <span className="text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
            RECHAZADO POR LA CAJA
        </span>
    );
}
```

**4.2** Motivo. Debajo del `actionLabel` (~línea 2634):

```js
{cmd.status === 'failed' && cmd.error_reason && (
    <p className="text-[11px] font-bold text-orange-600 dark:text-orange-400">{cmd.error_reason}</p>
)}
```

**4.3** Pestaña y contador. Agregar `'failed'` al comentario de `cmdTabFilter` (~línea 351), un botón «Rechazados ({allCloudCmds.filter(c => c.status === 'failed').length})» junto a los de Aplicados/Anulados (~línea 2489), y la rama correspondiente en el filtro (~línea 2530):

```js
if (cmdTabFilter === 'failed') return cmd.status === 'failed';
```

**4.4** Reintento. Junto al botón «Anular» (~línea 2637), para los rechazados:

```js
{cmd.status === 'failed' && (
    <button
        onClick={() => {
            const p = cmd.payload || {};
            queueInventoryChange(p.action, p.productId, p.data);
            showToast('Cambio devuelto a la cola local', 'info');
        }}
        className="px-3.5 py-2 rounded-xl bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/40 text-orange-600 dark:text-orange-300 border border-orange-200 dark:border-orange-800 text-xs font-black uppercase transition-colors shrink-0 cursor-pointer"
    >
        Reintentar ↺
    </button>
)}
```

El reintento reconstruye el cambio desde el payload; al volver a subirlo, `baseUpdatedAt` se toma del producto ya actualizado en el monitor (gracias a FS1), así que el conflicto no se repite. Sólo tiene sentido para `command_type === 'inventory_update'` — condicionar también a eso.

**Verificación manual:** provocar un rechazo (editar un producto con un código de barras que ya pertenece a otro) y comprobar que aparece el badge naranja, el motivo del conflicto, el contador en la pestaña «Rechazados» y que «Reintentar» lo devuelve a la cola local.

---

### FS5 🟠 — La escritura optimista no debe persistir valores calculados

**Archivo:** [src/views/OwnerMonitorView.jsx:551-558](src/views/OwnerMonitorView.jsx#L551-L558)

```js
if (sent > 0) {
    const updatedLocal = projectedProducts.map(p => { ...strip...; return clean; });
    if (setProducts) setProducts(updatedLocal);
    storageService.setItem('bodega_products_v1', updatedLocal).catch(() => {});
}
```

Mantener la actualización **en memoria** (evita que la vista revierta el stock antes de que llegue el eco) y **eliminar la escritura persistente**:

```js
if (sent > 0) {
    // Actualización optimista SÓLO en memoria: la copia durable de bodega_products_v1
    // debe venir siempre del eco de la caja (fuente de verdad). Persistir la proyección
    // guardaba stock calculado, costUsd efectivo y un updatedAt viejo que hacía
    // rechazar la siguiente edición por conflicto de versión.
    const updatedLocal = projectedProducts.map(p => {
        const { _rawStock, _stockDelta, _isQueuedDelete, _isQueuedEdit, _isQueuedNew, _isCombo, _effectiveCost, ...clean } = p;
        return clean;
    });
    if (setProducts) setProducts(updatedLocal);
}
```

Retirar el `import` de `storageService` en este archivo **sólo si** no queda ningún otro uso — comprobarlo con una búsqueda antes de borrar la línea.

**Por qué no basta con estampar un `updatedAt` nuevo:** la caja pone su propio `updatedAt` al aplicar, y siempre será posterior al que estampe el monitor. Cualquier sello local seguiría siendo menor y el conflicto persistiría. La única solución correcta es que el `updatedAt` venga del eco — que es justo lo que FS1 garantiza.

**Verificación manual:** editar el mismo producto **dos veces seguidas** desde el monitor, subiendo entre una y otra. Ambos cambios deben quedar `applied`. Antes de este plan, el segundo quedaba `failed` con "El producto fue modificado por otro supervisor" y sin ningún aviso.

---

### FS6 🟡 — No enviar campos auxiliares de la proyección a la caja

**Archivos:** [src/components/Monitor/RemoteProductFormModal.jsx:173](src/components/Monitor/RemoteProductFormModal.jsx#L173) y [src/utils/remoteInventoryProcessor.js](src/utils/remoteInventoryProcessor.js)

`editingProduct` es una fila de `projectedProducts`, así que el `...(editingProduct || {})` de la línea 173 arrastra `_rawStock`, `_stockDelta`, `_isQueuedEdit`, `_isCombo` y `_effectiveCost` al comando, y `normalizeProduct` los conserva con su `{ ...data }` → quedan guardados dentro del producto en la caja y vuelven en el siguiente eco.

**6.1 (origen)** En `RemoteProductFormModal`, antes de construir `payloadData`:

```js
// Los campos con prefijo _ son de la proyección del monitor, no del producto.
for (const k of Object.keys(data)) {
    if (k.startsWith('_')) delete data[k];
}
```

**6.2 (defensa en profundidad, D4: la caja es la fuente de verdad)** En `normalizeProduct` de `remoteInventoryProcessor.js`, tras `const normalized = { ...data };`:

```js
delete normalized.baseUpdatedAt;
for (const k of Object.keys(normalized)) {
    if (k.startsWith('_')) delete normalized[k];
}
```

`baseUpdatedAt` es metadato de control de versión y hoy también se está guardando dentro del producto.

**6.3 (test)** En `tests/remoteInventory.test.js`, añadir un caso: un comando `edit` cuyo `data` incluya `_stockDelta`, `_isCombo` y `baseUpdatedAt` válido debe aplicarse y el producto resultante **no** debe contener ninguna de esas tres claves.

---

### FS2 🟡 — Reducir el tamaño de `bodega_products_v1` (raíz de C1)

FS1 ya evita perder cambios aunque el documento sea grande. FS2 ataca la causa para que el camino rápido (realtime) vuelva a ser el habitual.

**2.1 Diagnóstico primero — no editar código todavía.** En Supabase, medir el tamaño real:

```sql
SELECT doc_id, pg_column_size(data) AS bytes
FROM public.sync_documents
WHERE device_id = '<id de la caja>'
ORDER BY bytes DESC
LIMIT 10;
```

Si `bodega_products_v1` está por debajo de ~900 KB, **C1 no viene de las imágenes** y FS2 se cierra aquí: bastará con FS1 y con vigilar el crecimiento del catálogo. Anotar el resultado antes de seguir.

**2.2** Si está por encima, verificar si el rol `anon` puede escribir en el bucket `product-images` (Storage → Policies). De eso depende la solución:

- **Si `anon` puede subir:** relajar `hasActiveCloudSession()` en [imageUpload.js:39](src/utils/imageUpload.js#L39) para que también devuelva `true` cuando la caja esté registrada (existe fila propia en `device_pairings`, el mismo criterio que la compuerta de CloudSync). Con eso `uploadProductImage` deja de devolver `null` y el producto guarda una URL en vez de un data-URI.
- **Si `anon` NO puede subir:** no tocar el gate. La opción es subir el `max_record_bytes` de Realtime en el proyecto, o convivir con el pull de FS1. **No** filtrar las imágenes en el push a `sync_documents`: el pull inicial de `useCloudSync` reaplica el documento de la nube sobre el local, así que filtrar en el push **borraría las imágenes de la caja** en la siguiente recarga.

**2.3** Existe ya `migrateProductImagesToStorage` en [imageUpload.js:138](src/utils/imageUpload.js#L138) para las imágenes base64 ya guardadas. Ejecutarla es **decisión del usuario**, no parte de este plan: toca datos existentes.

---

## 3. Decisiones

| ID | Decisión | Motivo |
|---|---|---|
| D1 | Ante un evento de Realtime sin cuerpo, hacer pull completo con throttle de 3 s | No se puede saber qué `doc_id` cambió; perder el cambio es peor que un `select` extra. |
| D2 | Mantener `event: '*'` y filtrar `DELETE` explícitamente | Los documentos no se borran en el flujo normal; el `return` temprano evita confundir un DELETE con un 413. |
| D3 | La actualización optimista se queda en memoria, no en storage | La copia durable debe venir del eco de la caja. Persistir la proyección guardaba stock calculado y un `updatedAt` viejo. |
| D4 | No estampar `updatedAt` local al subir | El sello de la caja siempre será posterior; el conflicto persistiría igual. |
| D5 | «Reintentar» reencola en la cola local en vez de reinsertar el comando | Reutiliza toda la validación y el `baseUpdatedAt` fresco; no duplica filas en `supervisor_commands`. |
| D6 | Limpiar los campos `_*` en el origen **y** en la caja | D4 del diseño original: la caja es la fuente de verdad y no debe confiar en el monitor. |
| D7 | FS2 empieza por medir, no por editar | Si el documento no supera el tope, tocar el gate de imágenes sería trabajo sin efecto y con riesgo. |

---

## 4. Riesgos

- **FS1** es el único cambio que agrega tráfico (un pull por ráfaga grande). Es el mismo pull que ya ocurre al reconectar, y sólo se dispara cuando hoy se pierde el cambio.
- **FS5** cambia el comportamiento tras recargar el monitor: la proyección local deja de sobrevivir a un refresco. Es lo correcto — tras recargar se debe ver lo que dice la caja — pero conviene avisarlo.
- **FS2** es el único que toca el camino de imágenes; si se relaja `hasActiveCloudSession()` sin que el bucket lo permita, las subidas fallarán en silencio y todo seguirá igual (sin romper nada). Por eso el diagnóstico va primero.
- Ninguna fase toca lógica financiera, `parseFloat`, la guarda FIN-022 ni los métodos de pago COP.

## 5. Si algo no encaja

Si al abrir un archivo el código no coincide con las anclas descritas (por ejemplo, si `uploadPendingChanges` ya tiene `setUploading(true)`, o si el guard de Realtime cambió de forma), **detenerse y reportar la diferencia** antes de editar. Este plan describe el estado del repo en `fdf6ef7`.
