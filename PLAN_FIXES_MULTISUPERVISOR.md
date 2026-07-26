# Plan de Fixeo — Auditoría de la Implementación Multisupervisor + Egress

> **Audiencia:** LLM ejecutor. Sigue este documento al pie de la letra.
> **Origen:** auditoría de los 9 commits `7d84ef4..8f3bef2`, que implementaron [PLAN_MULTISUPERVISOR_Y_EGRESS.md](PLAN_MULTISUPERVISOR_Y_EGRESS.md).
> **Protocolo:** anclas de texto, no números de línea. Un commit por fase. Si el código no coincide con lo que este plan describe, **DETENTE y reporta**.
> **Harness por fase:** `npx eslint --no-cache <archivos>` + `npx vitest run tests/remoteInventory.test.js tests/pricingMode.test.js` + `npm run build`.

**Estado de la implementación auditada:** build ✓, tests 25/25 ✓, lint sin regresiones. Pero **3 defectos bloqueantes**, **4 importantes** y **2 menores**. Nada de esto está corregido todavía.

---

## Índice

- [0. Estado de partida](#0-estado-de-partida)
- [1. Tabla de hallazgos](#1-tabla-de-hallazgos)
- [2. Diccionario de anclas](#2-diccionario-de-anclas)
- [3. Fases](#3-fases) — FX1 … FX9
- [4. Decisiones de diseño](#4-decisiones-de-diseño)
- [5. Verificación manual](#5-verificación-manual)
- [6. Si algo no encaja](#6-si-algo-no-encaja)

---

## 0. Estado de partida

**Lo que quedó bien y NO se debe tocar:**

- **FE1** (`useCloudSync.js`): la exclusión `CLOUD_SYNC_EXCLUDE` está correcta, y la guardia `if (!SYNC_KEYS.includes(key)) return;` de `pushCloudSync` la hace efectiva también para `forceSyncAllPOSData`/`forcePushLocalData`. Verificado.
- **F1** (`supabase_supervisor_commands_setup.sql`): el `CHECK` de `command_type` ya admite los 4 tipos y el `DROP CONSTRAINT IF EXISTS` lo hace idempotente. Correcto.
- **F0** (`supabase_multisupervisor_setup.sql`): la tabla `device_monitors`, el backfill y los 4 RPC siguen el diseño acordado. Solo requieren los endurecimientos de FX2 y FX6.
- El refactor inmutable de `projectedProducts` (commit `6b707de`) es correcto en sí mismo.

**Error de lint preexistente — fuera del alcance de este plan:**
`react-hooks/preserve-manual-memoization` en `OwnerMonitorView.jsx`, ancla `const projectedProducts = useMemo(() => {`. **Ya existía antes de esta implementación** (verificado contra `df3a6d0`); el commit `6b707de` intentó resolverlo y no lo consiguió. No es una regresión y no se aborda aquí. Anotarlo como deuda técnica.

---

## 1. Tabla de hallazgos

| ID | Severidad | Hallazgo | Fase |
|---|---|---|---|
| A1 | 🔴 Bloqueante | El QR generado por el monitor codifica JSON; el escáner espera el token pelado de 6 caracteres → vincular por QR **falla siempre** | FX1 |
| A2 | 🔴 Bloqueante | La RLS de `supervisor_commands` exige que `monitor_device_id` sea el único de `device_pairings`; el código lo fuerza, y por eso las notificaciones quedan **invertidas** | FX2 |
| A3 | 🔴 Bloqueante | El versionado optimista es **código muerto**: nadie envía `baseUpdatedAt` y nada fuera del procesador remoto escribe `updatedAt` | FX3 |
| A4 | 🟠 Importante | Revocar no borra los datos locales del dispositivo revocado (sin `localforage.clear()`) | FX4 |
| A5 | 🟠 Importante | `handleDisconnect` sigue en el modelo 1-a-1: rompe el vínculo compartido y deja al monitor "activo" en `device_monitors` | FX5 |
| A6 | 🟠 Importante | `device_monitors` tiene `SELECT USING (true)`: cualquiera lee todos los monitores de todas las tiendas y puede expulsarlos vía `revoke_monitor` | FX6 |
| A7 | 🟠 Importante | `MONITOR_DOC_IDS` omite `cop_enabled`, `cop_primary` y `auto_cop_enabled`, que el monitor consume; además el pull y el realtime ya no aplican el mismo conjunto | FX7 |
| A8 | 🟡 Menor | `touch_monitor_heartbeat` devuelve `is_revoked: true` cuando no encuentra la fila → autoexpulsión de cualquier monitor sin registro | FX8 |
| A9 | 🟡 Menor | El health-check quedó en 15 s fijos en vez de 30 s / 10 s con backoff | FX9 |

---

## 2. Diccionario de anclas

| Elemento | Archivo | Ancla |
|---|---|---|
| QR del monitor | `src/components/Monitor/SupervisorPairingModal.jsx` | `const qrPayload = JSON.stringify({` |
| Lista de dispositivos | `src/components/Monitor/SupervisorPairingModal.jsx` | `.from('device_monitors')` |
| Decodificación del QR | `src/components/PairingScanScreen.jsx` | `const cleanToken = decodedText.trim().toUpperCase();` |
| Identidad al emitir comandos | `src/views/OwnerMonitorView.jsx` | `let monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';` |
| Identidad al cambiar tasa | `src/components/SupervisorRateModal.jsx` | `.select('monitor_device_id')` |
| Filtro de autonotificación | `src/views/OwnerMonitorView.jsx` | `if (newCmd && newCmd.monitor_device_id !== myDeviceId) {` |
| Encolado de cambios | `src/views/OwnerMonitorView.jsx` | `const queueInventoryChange = useCallback((action, productId, data) => {` |
| Envío del form remoto | `src/components/Monitor/RemoteProductFormModal.jsx` | `await onSubmit(editingProduct ? 'edit' : 'add', data.id, data);` |
| Encolado de combos | `src/views/OwnerMonitorView.jsx` | `queueInventoryChange(editingCombo ? 'edit' : 'add', comboData.id, comboData);` |
| Guardia de concurrencia | `src/utils/remoteInventoryProcessor.js` | `if (data?.baseUpdatedAt && existing.updatedAt) {` |
| Sello en ajuste de stock | `src/utils/remoteInventoryProcessor.js` | `const updated = products.map(p => p.id === productId ? { ...p, stock: next, updatedAt: nowIso } : p);` |
| Guardado de producto en la caja | `src/views/ProductsView.jsx` | `p.id === editingId ? { ...p, ...productData, image: finalImage !== undefined ? finalImage : p.image } : p` |
| Alta de producto en la caja | `src/views/ProductsView.jsx` | `createdAt: new Date().toISOString()` |
| Reacción a revocación | `src/views/OwnerMonitorView.jsx` | `const handleRevoked = () => {` |
| Desvinculación propia | `src/views/OwnerMonitorView.jsx` | `const handleDisconnect = async () => {` |
| RLS de inserción de comandos | `supabase_supervisor_commands_setup.sql` | `CREATE POLICY "supervisor_commands_monitor_insert"` |
| RLS de `device_monitors` | `supabase_multisupervisor_setup.sql` | `CREATE POLICY "Permitir lectura publica de device_monitors"` |
| Heartbeat en el servidor | `supabase_multisupervisor_setup.sql` | `IF NOT FOUND THEN` |
| Allowlist de documentos | `src/hooks/useMonitorSync.js` | `const MONITOR_DOC_IDS = [` |
| Aplicación por realtime | `src/hooks/useMonitorSync.js` | `if (!doc \|\| !['store', 'local'].includes(doc.collection)) return;` |
| Health-check | `src/hooks/useMonitorSync.js` | `reconnectTimer = setInterval(() => {` |

---

## 3. Fases

> **Orden obligatorio:** FX1 → FX2 → FX3 → FX4 → FX5 → FX6 → FX7 → FX8 → FX9.
> FX2 y FX6 incluyen cambios de SQL que **el humano debe ejecutar antes** de que el JS correspondiente llegue a producción. Está señalado en cada fase.

---

### FASE FX1 — El QR del monitor no se puede escanear (A1) 🔴

**Archivo:** `src/components/Monitor/SupervisorPairingModal.jsx`

**Diagnóstico.** El modal nuevo codifica un objeto:
```js
const qrPayload = JSON.stringify({ type: 'dj_pair', token, primaryDeviceId: pairedDeviceId });
QRCode.toCanvas(canvasRef.current, qrPayload, { ... });
```
Pero el escáner (ANCLA: `const cleanToken = decodedText.trim().toUpperCase();`) **no parsea JSON**: toma el texto crudo y exige `cleanToken.length === 6`. El JSON mide ~80 caracteres, así que la rama de éxito nunca se alcanza y el usuario recibe *"Formato de código QR inválido"*. El QR de la caja (`PairingManager.jsx`) codifica el token pelado — ese es el contrato real.

**Corrección.** Codificar **solo el token**, igual que `PairingManager.jsx`:
```js
QRCode.toCanvas(canvasRef.current, token, { ... });
```
Eliminar `qrPayload` y su `JSON.stringify`. Las opciones de render (`width`, `margin`, `color`) se conservan tal cual.

> **No hacer lo contrario** (enseñar JSON al escáner). El contrato "el QR contiene el token y nada más" ya está desplegado en producción en la caja; cambiarlo obligaría a que ambos lados se actualicen a la vez, y los dispositivos no se actualizan sincronizados.

**Verificación:** generar un QR desde el monitor y escanearlo con un segundo dispositivo — debe vincular.

**Harness:** eslint del archivo + `npm run build`.

**Commit:** `fix(monitor): el QR de vinculacion codifica el token plano que espera el escaner`.

---

### FASE FX2 — Identidad del supervisor emisor: RLS + notificaciones invertidas (A2) 🔴

**Archivos:** `supabase_supervisor_commands_setup.sql`, `src/views/OwnerMonitorView.jsx`, `src/components/SupervisorRateModal.jsx`

> ⚠️ **Esta fase tiene una dependencia dura: el SQL debe estar aplicado ANTES de desplegar el cambio de JS.** Si se despliega el JS primero, el monitor secundario deja de poder enviar comandos (la RLS los rechaza). Ver FX2.4.

**Diagnóstico — el hallazgo más profundo de la auditoría.** La política de inserción exige que el emisor sea *el* monitor único registrado en `device_pairings`:
```sql
WITH CHECK (EXISTS (SELECT 1 FROM public.device_pairings dp
    WHERE dp.primary_device_id = supervisor_commands.primary_device_id
      AND dp.monitor_device_id = supervisor_commands.monitor_device_id))
```
Por eso el JS **pisa deliberadamente** su propia identidad (ANCLA: `let monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';`, seguido de la consulta a `device_pairings` que lo sobrescribe): es un apaño para pasar esa RLS. Esa política **nunca se actualizó al modelo 1-N**.

Consecuencias con 2 monitores:
- Ambos firman sus comandos con el id del monitor #1.
- El monitor #1 ve los comandos del #2 como propios → **no recibe aviso**.
- El monitor #2 ve los suyos como ajenos → **se autonotifica**.
- Y si se "arreglara" solo el JS, el monitor #2 **perdería la capacidad de enviar cualquier comando**.

**FX2.1 — Ampliar la RLS de inserción al modelo 1-N.** En ANCLA `CREATE POLICY "supervisor_commands_monitor_insert"`, aceptar también a un monitor activo de `device_monitors`:
```sql
WITH CHECK (
    EXISTS (SELECT 1 FROM public.device_pairings dp
            WHERE dp.primary_device_id = supervisor_commands.primary_device_id
              AND dp.monitor_device_id = supervisor_commands.monitor_device_id)
    OR
    EXISTS (SELECT 1 FROM public.device_monitors dm
            WHERE dm.primary_device_id = supervisor_commands.primary_device_id
              AND dm.monitor_device_id = supervisor_commands.monitor_device_id
              AND dm.revoked_at IS NULL)
);
```
Mantener la primera rama: preserva la compatibilidad con cajas donde aún no se corrió `supabase_multisupervisor_setup.sql`. Conservar el `DROP POLICY IF EXISTS` previo para que siga siendo idempotente.

> Si `device_monitors` no existiera todavía en ese proyecto, la política fallaría al crearse. Envolver esta parte en un `DO $$ ... IF to_regclass('public.device_monitors') IS NOT NULL THEN ... END IF; END $$;` o documentar explícitamente que `supabase_multisupervisor_setup.sql` se corre **antes**. Elegir una de las dos y dejarlo escrito en la cabecera del script.

**FX2.2 — Que cada monitor firme con su propia identidad.** En `OwnerMonitorView.jsx` (ANCLA: `let monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';`), **eliminar** la consulta a `device_pairings` que lo sobrescribe. El `dj_device_id` local es la identidad correcta. Aplicar el mismo cambio en `SupervisorRateModal.jsx` (ANCLA: `.select('monitor_device_id')`).

**FX2.3 — El filtro de autonotificación queda correcto solo.** ANCLA `if (newCmd && newCmd.monitor_device_id !== myDeviceId) {` no requiere cambios: una vez que cada comando lleva la identidad real de quien lo emitió, la comparación hace exactamente lo que debe.

**FX2.4 — Compatibilidad durante el despliegue.** Un dispositivo que ya emitía con el id de `device_pairings` y pasa a emitir con el suyo propio necesita tener fila activa en `device_monitors`. El backfill de `supabase_multisupervisor_setup.sql` cubre al monitor original. Para el resto, la vinculación vía `pair_additional_monitor` ya crea la fila. **Confirmar ambos caminos antes de dar la fase por cerrada.**

**Harness:** eslint de los dos `.jsx` + `npm run build`.

**Commit:** `fix(supervisor): cada monitor firma sus comandos con su propia identidad`.

---

### FASE FX3 — El versionado optimista está desconectado (A3) 🔴

**Archivos:** `src/components/Monitor/RemoteProductFormModal.jsx`, `src/views/OwnerMonitorView.jsx`, `src/views/ProductsView.jsx`, `src/utils/remoteInventoryProcessor.js`, `tests/remoteInventory.test.js`

**Diagnóstico.** `grep -rn "baseUpdatedAt" src/` devuelve **una sola coincidencia**: la propia guardia en `remoteInventoryProcessor.js`. Y `grep -rn "updatedAt" src/` devuelve **solo ese mismo archivo**. Es decir:
1. El monitor nunca envía `baseUpdatedAt` → la guardia jamás se evalúa.
2. La caja nunca sella `updatedAt` al editar un producto → aunque el monitor lo enviara, `existing.updatedAt` sería `undefined` en cualquier producto que no haya pasado por el flujo remoto, y la condición se saltaría igual.

Los tests pasan porque construyen el payload a mano. **La protección contra pisado no existe en runtime.** Hay que cerrar los tres extremos.

**FX3.1 — El monitor envía la versión que vio.** En `RemoteProductFormModal.jsx` (ANCLA: `await onSubmit(editingProduct ? 'edit' : 'add', data.id, data);`), adjuntar la versión base solo en las ediciones:
```js
await onSubmit(
    editingProduct ? 'edit' : 'add',
    data.id,
    editingProduct ? { ...data, baseUpdatedAt: editingProduct.updatedAt } : data
);
```
Hacer lo equivalente para combos en `OwnerMonitorView.jsx`, ANCLA `queueInventoryChange(editingCombo ? 'edit' : 'add', comboData.id, comboData);`.

**FX3.2 — La caja sella `updatedAt` al editar.** En `ProductsView.jsx`, ancla de edición:
```js
p.id === editingId ? { ...p, ...productData, image: finalImage !== undefined ? finalImage : p.image } : p
```
añadir `updatedAt: new Date().toISOString()` al objeto resultante. Y en la rama de alta (ANCLA: `createdAt: new Date().toISOString()`), añadir también `updatedAt` con el mismo valor.

**FX3.3 — NO sellar `updatedAt` en movimientos de stock.** Esto es lo que evita que el remedio sea peor que la enfermedad.
El stock **ya está protegido aparte** en el procesador remoto (`normalized.stock = existing.stock;`, que preserva el stock de la caja frente a un `edit` viejo). Si además cada movimiento de stock avanzara `updatedAt`, toda venta o ajuste posterior al encolado invalidaría la edición pendiente y el supervisor vería *"El producto fue modificado por otro supervisor"* constantemente — la función remota se volvería inservible en una tienda con movimiento.

Por lo tanto:
- **Revertir** el sello introducido en `adjust_stock` (ANCLA: `const updated = products.map(p => p.id === productId ? { ...p, stock: next, updatedAt: nowIso } : p);`) para que vuelva a ser `{ ...p, stock: next }`.
- **No** añadir `updatedAt` a `adjustStock` de `ProductContext.jsx` ni a `checkoutProcessor.js`.

**Regla:** `updatedAt` representa *"cuándo cambiaron los atributos del producto"* (nombre, precio, costo, categoría), **no** *"cuándo se movió el stock"*.

**FX3.4 — Tests.** Ampliar `tests/remoteInventory.test.js` con dos casos que hoy no existen:
- Un `adjust_stock` **no** debe modificar `updatedAt` del producto.
- Un `edit` encolado antes de un `adjust_stock` **sí** debe aplicarse (no es conflicto real).
Conservar los tres tests actuales de la Fase 6.

**Harness:** `npx vitest run tests/remoteInventory.test.js` (todos verdes) + eslint de los 4 archivos + `npm run build`.

**Commit:** `fix(supervisor): conectar el versionado optimista de extremo a extremo`.

---

### FASE FX4 — Revocar debe borrar los datos del dispositivo (A4) 🟠

**Archivo:** `src/views/OwnerMonitorView.jsx`

**Diagnóstico.** `handleRevoked` (ANCLA: `const handleRevoked = () => {`) solo elimina 4 claves de `localStorage`. `handleDisconnect` además hace `localforage.clear()` y borra `business_name`/`business_rif`. Resultado: el teléfono revocado vuelve a la pantalla de vinculación **conservando el inventario, las ventas y los clientes completos en IndexedDB**. Revocar es justamente la acción de *"no quiero que este dispositivo siga teniendo mis datos"*.

**Corrección.** Extraer la limpieza de `handleDisconnect` a un helper compartido (p. ej. `wipeMonitorSession()`) que ejecute el borrado de claves + `localforage.clear()`, y llamarlo desde ambos sitios. La única diferencia entre los dos flujos debe ser la llamada RPC:
- `handleDisconnect` → llama al RPC (FX5) y luego limpia.
- `handleRevoked` → **no** llama a ningún RPC (el servidor ya lo revocó); solo muestra el toast y limpia.

Mantener el `setTimeout(..., 1500)` antes del `window.location.reload()` para que el toast alcance a verse.

**Harness:** eslint + `npm run build`.

**Commit:** `fix(monitor): la revocacion remota borra los datos locales del dispositivo`.

---

### FASE FX5 — `handleDisconnect` sigue en el modelo 1-a-1 (A5) 🟠

**Archivo:** `src/views/OwnerMonitorView.jsx`

**Diagnóstico.** ANCLA `await supabaseCloud.rpc('unpair_monitor', { p_device_id: pairedDeviceId });` — el RPC legacy limpia `device_pairings` para la caja entera. Si el monitor #2 se desconecta a sí mismo:
- rompe el vínculo compartido de `device_pairings`, que sigue siendo la base de la RLS y del monitor #1;
- y queda con `revoked_at IS NULL` en `device_monitors`, o sea **"activo" para siempre** en la lista de dispositivos.

**Corrección.** Que la desvinculación propia use el RPC del modelo 1-N:
```js
await supabaseCloud.rpc('revoke_monitor', {
    p_requester_id: localStorage.getItem('dj_device_id'),
    p_target_monitor_id: localStorage.getItem('dj_device_id')
});
```
Un monitor activo revocándose a sí mismo pasa la validación de `revoke_monitor` sin cambios en el SQL.

**Fallback (D6, se mantiene).** Si el RPC no existe (SQL sin correr), caer a `unpair_monitor` como hoy. Envolver en `try/catch` y no bloquear la limpieza local si ambos fallan: el usuario pidió salir y debe salir.

> **No tocar `unpair_monitor` ni el flujo de `PairingManager.jsx` en la caja.** Sigue siendo el camino correcto para que la caja rompa el emparejamiento por completo.

**Harness:** eslint + `npm run build`.

**Commit:** `fix(monitor): la desvinculacion propia usa revoke_monitor y no rompe el par compartido`.

---

### FASE FX6 — Endurecer el acceso a `device_monitors` (A6) 🟠

**Archivos:** `supabase_multisupervisor_setup.sql`, `src/components/Monitor/SupervisorPairingModal.jsx`

> ⚠️ **El SQL debe aplicarse antes o a la vez que el JS**, porque el JS pasa a consumir un RPC nuevo.

**Diagnóstico.** ANCLA `CREATE POLICY "Permitir lectura publica de device_monitors"` usa `USING (true)`: lectura pública total de la tabla — ids de dispositivo, etiquetas y user-agents de **todas** las tiendas. Combinado con `revoke_monitor`, que autoriza con solo presentar un `p_requester_id` de monitor activo, cualquiera puede leer la tabla, tomar un id cualquiera y **expulsar a todos los supervisores de cualquier tienda**. El id de dispositivo funciona como credencial portadora, y aquí quedó publicado.

**FX6.1 — Quitar el `SELECT` directo de `anon`.** Sustituir la política permisiva por la ausencia de política de lectura para `anon` (con RLS activa, sin política no hay filas visibles) y `REVOKE SELECT ON public.device_monitors FROM anon;`.

**FX6.2 — RPC de listado con validación de llamante.** Añadir, en el mismo estilo `SECURITY DEFINER` que los otros cuatro:
```sql
CREATE OR REPLACE FUNCTION public.list_monitors(p_requester_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_primary TEXT;
BEGIN
    -- Mismo patrón de validación que revoke_monitor: caja o monitor activo
    SELECT primary_device_id INTO v_primary
    FROM public.device_monitors
    WHERE monitor_device_id = p_requester_id AND revoked_at IS NULL
    LIMIT 1;

    IF v_primary IS NULL THEN
        SELECT primary_device_id INTO v_primary
        FROM public.device_pairings WHERE primary_device_id = p_requester_id;
    END IF;

    IF v_primary IS NULL THEN
        RETURN json_build_object('success', false, 'devices', '[]'::json);
    END IF;

    RETURN json_build_object('success', true, 'devices', COALESCE((
        SELECT json_agg(row_to_json(t) ORDER BY t.paired_at)
        FROM (
            SELECT id, monitor_device_id, device_label, user_agent, paired_at, last_seen_at
            FROM public.device_monitors
            WHERE primary_device_id = v_primary AND revoked_at IS NULL
        ) t
    ), '[]'::json));
END; $$;

GRANT EXECUTE ON FUNCTION public.list_monitors(TEXT) TO anon, authenticated;
```

**FX6.3 — El modal consume el RPC.** En `SupervisorPairingModal.jsx`, ANCLA `.from('device_monitors')`, reemplazar la consulta directa por `supabaseCloud.rpc('list_monitors', { p_requester_id: myDeviceId })` y leer `data.devices`. Mantener el `try/catch` con `console.warn` que ya tiene.

> **Alcance declarado.** Esto **no** convierte el id de dispositivo en una credencial fuerte — sigue siendo un secreto portador, igual que en `device_pairings`. Lo que elimina es la parte grave: que ese secreto estuviera **publicado para cualquiera**. Un endurecimiento real (tokens firmados, rotación) es un rediseño aparte y queda anotado como trabajo futuro.

**Harness:** eslint del `.jsx` + `npm run build`. El SQL se verifica corriéndolo dos veces (idempotencia).

**Commit:** `fix(db): device_monitors deja de ser legible publicamente y se lista via RPC validado`.

---

### FASE FX7 — Coherencia del conjunto de documentos del monitor (A7) 🟠

**Archivo:** `src/hooks/useMonitorSync.js`

**Diagnóstico.** `MONITOR_DOC_IDS` omite 12 de las claves sincronizadas. Tres de ellas importan de verdad: **`cop_enabled`, `cop_primary` y `auto_cop_enabled`**, que `ProductContext` lee para decidir cómo renderizar precios — y `OwnerMonitorView` consume `copEnabled` directamente del contexto (ANCLA: `const { products, setProducts, effectiveRate, copEnabled, tasaCop, rates, categories } = useProductContext();`). Un monitor recién vinculado renderiza con COP desactivado aunque la tienda lo tenga activo.

Hay además una **incoherencia estructural**: el pull filtra por `doc_id`, pero el handler de realtime (ANCLA: `if (!doc || !['store', 'local'].includes(doc.collection)) return;`) sigue aplicando **todos** los documentos. El estado del monitor pasa a depender de si el cambio ocurrió con el dispositivo conectado o no.

**FX7.1 — Completar la allowlist.** Añadir como mínimo `cop_enabled`, `cop_primary`, `auto_cop_enabled` y `bodega_use_auto_rate`. Antes de fijar la lista definitiva, **derivarla del código**, no de memoria: revisar qué claves lee `ProductContext.jsx` y qué consume `OwnerMonitorView.jsx`. Regla del plan original, que sigue vigente: **ante la duda, incluir la clave** — omitir una que sí se usa rompe funcionalidad de forma silenciosa; incluir una de más cuesta unos bytes.

**FX7.2 — Alinear el realtime con el pull.** En el handler de realtime, descartar los documentos fuera de `MONITOR_DOC_IDS`:
```js
if (!doc || !['store', 'local'].includes(doc.collection)) return;
if (!MONITOR_DOC_IDS.includes(doc.doc_id)) return;
```
Esto **no ahorra egress** (los bytes ya viajaron por el WebSocket), pero garantiza que el monitor converja al mismo estado por ambos caminos. El ahorro real de esas claves ya lo consiguió FE1 al no escribirlas.

**FX7.3 — Documentar el criterio.** Dejar en el comentario de `MONITOR_DOC_IDS` la regla: *"toda clave que el monitor lea, directamente o vía ProductContext, debe estar aquí; al añadir una clave sincronizada nueva, evaluar si el monitor la necesita"*.

**Harness:** eslint + `npm run build`.

**Commit:** `fix(monitor): completar la allowlist de documentos y alinearla con el realtime`.

---

### FASE FX8 — El heartbeat no debe expulsar por ausencia de fila (A8) 🟡

**Archivo:** `supabase_multisupervisor_setup.sql`

**Diagnóstico.** ANCLA `IF NOT FOUND THEN` devuelve `is_revoked: true` cuando el `UPDATE` no encuentra fila. El JS interpreta eso como revocación y expulsa al dispositivo. Cualquier monitor sin registro en `device_monitors` —vinculado por el fallback legacy, o si su fila se borra manualmente— **se autoexpulsa a los 60 segundos**, y al re-vincularse vuelve a caer en el mismo ciclo.

**Corrección.** Distinguir *"revocado"* de *"desconocido"*:
```sql
IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'is_revoked', false, 'is_unknown', true);
END IF;
```
El JS ya solo reacciona a `data.is_revoked`, así que no requiere cambios: un dispositivo desconocido deja de ser expulsado. Añadir un comentario explicando por qué **no** se falla cerrado aquí: una fila ausente es un problema de registro, no una decisión del dueño de revocar, y expulsar por ello genera un bucle del que el usuario no puede salir.

**Verificación:** llamar al RPC con un `p_monitor_device_id` inventado debe devolver `is_revoked: false`.

**Commit:** `fix(db): el heartbeat distingue monitor revocado de monitor desconocido`.

---

### FASE FX9 — Backoff del health-check según lo planeado (A9) 🟡

**Archivo:** `src/hooks/useMonitorSync.js`

**Diagnóstico.** Quedó en `setInterval(..., 15000)` fijo. El plan pedía **30 s con la suscripción sana y 10 s mientras está caída**. Funciona, pero ahorra la mitad de lo previsto, y el costo se multiplica por cada monitor conectado.

**Corrección.** Mantener el intervalo base en 10 s y ejecutar `checkPosPresence()` solo una de cada tres iteraciones cuando `isConnectedRef.current && monitorSubscription` (≈30 s efectivos); cuando el canal está caído, ejecutar en cada iteración e intentar `initMonitor(true)` como ahora. Un contador con `useRef` basta; **no** añadir estado de React (provocaría re-render por tick).

El umbral de "caja en línea" (`diffMs <= 180000`, 3 min) tolera de sobra los 30 s.

**Harness:** eslint + `npm run build`.

**Commit:** `perf(monitor): backoff del health-check a 30s con canal sano`.

---

## 4. Decisiones de diseño

| ID | Decisión | Motivo |
|---|---|---|
| E1 | El QR transporta **solo el token**, no JSON | Es el contrato ya desplegado en la caja; cambiarlo exigiría actualizar ambos lados a la vez, y los dispositivos no se actualizan sincronizados |
| E2 | La RLS de `supervisor_commands` conserva la rama vieja **además** de la nueva | Cajas sin `supabase_multisupervisor_setup.sql` aplicado siguen funcionando; sin esa rama, el despliegue tendría una ventana de rotura |
| E3 | `updatedAt` = cambio de **atributos**, nunca de **stock** | Si el stock avanzara la versión, toda venta invalidaría las ediciones encoladas y la gestión remota sería inutilizable en una tienda con movimiento |
| E4 | El stock se sigue protegiendo con `normalized.stock = existing.stock`, no con versionado | Son mecanismos complementarios: el versionado cubre atributos; el stock necesita preservación incondicional porque cambia por ventas ajenas al supervisor |
| E5 | Revocar borra los datos locales; desconectarse también | Un dispositivo revocado que conserva inventario, ventas y clientes vacía de sentido la revocación |
| E6 | Un monitor se desvincula con `revoke_monitor` sobre sí mismo, no con `unpair_monitor` | En el modelo 1-N, `unpair_monitor` rompe el par compartido de toda la caja |
| E7 | `device_monitors` no es legible por `anon`; se lista vía RPC validado | La lectura pública convertía un secreto portador en información publicada, permitiendo expulsar supervisores de cualquier tienda |
| E8 | El heartbeat falla **abierto** ante fila desconocida | Fallar cerrado crea un bucle expulsión → re-vinculación → expulsión del que el usuario no puede salir por sí mismo |
| E9 | El realtime filtra por `MONITOR_DOC_IDS` aunque no ahorre egress | Sin ello, el estado del monitor depende de si estaba conectado cuando ocurrió el cambio |
| E10 | El error de lint de `projectedProducts` **no** se aborda aquí | Es preexistente a esta implementación y ortogonal a la feature; mezclarlo enturbiaría la revisión de estos fixes |

---

## 5. Verificación manual

**Requisitos:** proyecto CLOUD/SYNC con `supabase_multisupervisor_setup.sql` y `supabase_supervisor_commands_setup.sql` (ambos ya con los cambios de FX2, FX6 y FX8) aplicados. Dos dispositivos monitor + la caja.

1. **FX1** — Generar QR desde el Monitor 1 y escanearlo con el dispositivo 2. Debe vincular. *(Antes fallaba siempre con "Formato de código QR inválido".)*
2. **FX2** — Monitor 2 encola un cambio y lo sube: debe **insertarse sin error de RLS**. El Monitor 1 recibe el toast; el Monitor 2 **no** se autonotifica. Repetir al revés. Comprobar en Supabase que cada fila de `supervisor_commands` lleva el `monitor_device_id` real de quien la emitió.
3. **FX3** — Monitor 1 y Monitor 2 editan el mismo producto sin refrescar; el segundo en subir recibe `failed` con *"modificado por otro supervisor"*. **Después:** encolar una edición, hacer una venta de ese producto en la caja, y subir la edición → **debe aplicarse** (una venta no es conflicto).
4. **FX4** — Revocar el Monitor 2 desde el Monitor 1. En ≤60 s vuelve a la pantalla de vinculación. Revisar en DevTools → Application → IndexedDB: `bodega_app_data` debe estar **vacía**.
5. **FX5** — Monitor 2 se desconecta por sí mismo. El Monitor 1 **sigue funcionando**; el Monitor 2 desaparece de la lista de dispositivos.
6. **FX6** — Desde una pestaña anónima sin vincular, intentar `select` directo sobre `device_monitors`: debe devolver 0 filas. La pestaña Dispositivos del monitor debe seguir listando correctamente.
7. **FX7** — Activar COP en la caja, vincular un monitor **nuevo** y confirmar que muestra precios en COP sin necesidad de volver a togglear el ajuste.
8. **FX8** — Llamar `touch_monitor_heartbeat` con un id inventado: `is_revoked: false`. El monitor no debe expulsarse.
9. **FX9** — Dejar el monitor abierto 10 minutos con el canal sano y contar las consultas de presencia: ~20, no ~40.
10. **Regresión de egress** — Repetir el punto 1 de la sección 4.a del plan original: tras una venta, `sync_documents` no debe refrescar `bodega_sales_mirror_v1`, `abasto_audit_log_v1` ni `bodega_pos_heartbeat`.

---

## 6. Si algo no encaja

- Si `supabase_supervisor_commands_setup.sql` **ya se corrió en producción** con la política vieja, la nueva la reemplaza gracias al `DROP POLICY IF EXISTS`. Pero confirma que el `DROP` esté presente **antes** de correrlo; sin él, el script no actualiza nada y FX2 falla en silencio.
- Si al llegar a FX2 el código ya no tiene la consulta a `device_pairings` que pisa `monitorDeviceId`, **DETENTE**: alguien lo cambió sin actualizar la RLS y el monitor secundario puede llevar tiempo sin poder enviar comandos.
- Si `grep -rn "updatedAt" src/` devuelve escrituras en `checkoutProcessor.js` o en `adjustStock`, **DETENTE**: contradice E3 y provocará rechazos en cascada de todas las ediciones encoladas.
- Si al derivar la lista de FX7.1 aparece una clave dudosa, **inclúyela**. Omitir una clave usada rompe funcionalidad de forma silenciosa.
- Si `device_monitors` no existe en el proyecto donde se corre el SQL de FX2, la política nueva fallará al crearse. Corre primero `supabase_multisupervisor_setup.sql`.
- Si tras FX6 la pestaña Dispositivos deja de listar, verifica que el `GRANT EXECUTE` de `list_monitors` se aplicó: sin él, `anon` recibe *"permission denied for function"*.
- Si algún test de `tests/remoteInventory.test.js` falla tras FX3, revisa primero si el test asume el sello de `updatedAt` en `adjust_stock` que FX3.3 revierte — en ese caso el test es el que debe actualizarse, no el código.
