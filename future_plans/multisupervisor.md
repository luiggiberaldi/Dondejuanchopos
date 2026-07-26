# Plan de Ejecución — Multisupervisor y Vinculación Remota de Dispositivos

> **Audiencia:** LLM ejecutor. Sigue este documento al pie de la letra.
> **Regla de oro:** verificado contra el código y el SQL reales. Si algo no coincide, DETENTE y reporta.
> **Protocolo:** anclas de texto, no números de línea. Un commit por fase.
> **Harness por fase:** `npx eslint --no-cache <archivos>` (0 errores) + `npx vitest run <tests>` + `npm run build`.

---

## 0. Contexto y origen

Este plan **corrige** la propuesta original del usuario ("Gestión Multisupervisor y Conexión de Dispositivos Remotos"), que fue auditada end-to-end y resultó no implementable tal como estaba: describía UI sobre columnas inexistentes y omitía por completo la migración SQL que el 80% de la feature requiere.

**Hallazgos de la auditoría que este plan resuelve:**

| ID | Hallazgo | Fase |
|---|---|---|
| B1 | `device_pairings` es 1-a-1 (`monitor_device_id TEXT UNIQUE`); el plan asume N monitores | F0 |
| B2 | `generate_pairing_token` hace `SET monitor_device_id = NULL` → el monitor que genera el código se auto-expulsa | F0 |
| B3 | No existen columnas para nombre de dispositivo, `last_seen`, user-agent ni IP | F0 + F2 |
| B4 | Al revocar, la fila deja de ser visible por RLS → Realtime nunca entrega el UPDATE al revocado | F0 + F4 |
| R1 | `edit` remoto es last-write-wins sin versión: dos supervisores se pisan precios/nombre | F6 |
| R2 | Cada monitor abre su propia suscripción a *todos* los `sync_documents` → egress ×N | F5 |
| R3 | `unpair_monitor` es `SECURITY DEFINER` sin validar quién llama, concedido a `anon` | F0 |
| L1 | **Riesgo activo, independiente de esta feature:** el CHECK de `supervisor_commands` solo admite `rate_change`/`inventory_update`, pero el código ya inserta `void_sale` y `user_update` | F1 |
| L2 | Vigencia del token desfasada: plan 10 min / SQL 5 min / UI `setTimeLeft(300)` | F0 + F3 |

**Hallazgos de egress (auditoría aparte, ver sección 0.b):**

| ID | Hallazgo | Fase |
|---|---|---|
| E1 | `bodega_sales_mirror_v1` se sincroniza a la nube: es un **duplicado casi exacto** de `bodega_sales_v1`, y el monitor nunca lo lee | FE1 |
| E2 | `abasto_audit_log_v1` se sincroniza a la nube: crece hasta 15.000 entradas y **el monitor no lo renderiza en ningún sitio** | FE1 |
| E3 | El monitor re-descarga **la base completa** en cada `visibilitychange` (cambiar de app en el celular) | FE2 |
| E4 | `checkPosPresence` consulta cada 10 s por monitor, incluso con la suscripción sana | FE2 |
| E5 | El pull del monitor pide `.in('collection', ['store','local'])` — todos los documentos, incluidos los que no usa | FE2 |
| E6 | `bodega_pos_heartbeat` está en `SYNC_KEYS`/`LOCAL_KEYS` pero **nadie lo escribe** — configuración muerta | FE1 |

**Decisiones de diseño (D1–D12):** ver sección 3.

---

## 0.b Auditoría de egress — por qué estas fases van primero

**El costo dominante no son las imágenes** (eso ya se resolvió moviéndolas a Storage en `supabase_egress_optimization.sql`). Es la **granularidad de `sync_documents`**: cada clave se guarda como **un solo documento con el array completo**.

Consecuencia medida en el código (`checkoutProcessor.js`, ANCLA: `const updatedSales = [finalPersistedSale, ...existingSales];`), **una sola venta** dispara 4 upserts de arrays enteros, y cada upsert se retransmite por Realtime a **cada monitor conectado**:

| Documento | ¿Lo necesita el monitor? | Veredicto |
|---|---|---|
| `bodega_sales_v1` | Sí (historial de ventas) | Legítimo |
| `bodega_products_v1` | Sí (inventario, stock) | Legítimo |
| `bodega_sales_mirror_v1` | **No** — blindaje anti-pérdida local | **E1: desperdicio** |
| `abasto_audit_log_v1` | **No** — no se renderiza en el monitor | **E2: desperdicio** |

Es decir: **aproximadamente la mitad de los bytes por venta no le sirven a nadie del otro lado**, y el plan multisupervisor multiplicaría ese desperdicio por N monitores. Por eso las fases FE van **antes** que las fases de multisupervisor.

Además el costo **crece con el historial**: el array de ventas se retransmite completo en cada venta, así que el gasto por venta sube conforme se acumulan ventas. La poda de E1/E2 ataca justamente las dos claves de crecimiento no acotado que nadie consume.

> **Alcance acordado con el usuario:** solo cambios de bajo riesgo. **No** se reparticiona `bodega_sales_v1` en documentos por día/lote (esa era la opción de máximo ahorro pero toca el modelo de sync). Las fases FE no cambian el modelo de datos, no migran datos y no alteran la UX.

---

---

## 1. Diccionario de anclas

| Elemento | Archivo | Ancla |
|---|---|---|
| Tabla de emparejamientos | `supabase_pairing_setup.sql` | `CREATE TABLE IF NOT EXISTS public.device_pairings` |
| RPC generar token | `supabase_pairing_setup.sql` | `CREATE OR REPLACE FUNCTION public.generate_pairing_token` |
| RPC emparejar | `supabase_pairing_setup.sql` | `CREATE OR REPLACE FUNCTION public.pair_monitor_device` |
| RPC desvincular | `supabase_pairing_setup.sql` | `CREATE OR REPLACE FUNCTION public.unpair_monitor` |
| CHECK de command_type | `supabase_supervisor_commands_setup.sql` | `CHECK (command_type IN ('rate_change', 'inventory_update'))` |
| Vinculación desde la caja | `src/components/Settings/PairingManager.jsx` | `const handleGenerateQR = async () => {` |
| Expiración visual del token | `src/components/Settings/PairingManager.jsx` | `setTimeLeft(300); // 5 minutos (300 segundos)` |
| Pantalla de escaneo | `src/components/PairingScanScreen.jsx` | `const { data, error } = await supabaseCloud.rpc('pair_monitor_device'` |
| Hook de sync del monitor | `src/hooks/useMonitorSync.js` | `export function useMonitorSync(pairedDeviceId) {` |
| Suscripción realtime del monitor | `src/hooks/useMonitorSync.js` | `const channelName = \`monitor:${pairedDeviceId}:${Date.now()}\`` |
| Botón Usuarios (barra superior) | `src/views/OwnerMonitorView.jsx` | `title="Gestión de Usuarios, Roles y PINs"` |
| Estado de modales del monitor | `src/views/OwnerMonitorView.jsx` | `const [showUsersModal, setShowUsersModal] = useState(false);` |
| Desvinculación propia | `src/views/OwnerMonitorView.jsx` | `const handleDisconnect = async () => {` |
| Aplicador de comandos | `src/hooks/useSupervisorCommands.js` | `const processCommand = async (command) => {` |
| Aplicador de inventario | `src/utils/remoteInventoryProcessor.js` | `export async function applyInventoryCommand(payload)` |
| Claves de sync | `src/hooks/useCloudSync.js` | `const SYNC_KEYS = [...new Set([...IDB_KEYS, ...LS_KEYS,` |
| Guardia de push | `src/hooks/useCloudSync.js` | `if (!SYNC_KEYS.includes(key)) return;` |
| Catálogos de backup | `src/config/backupKeys.js` | `export const IDB_KEYS = Object.freeze([` |
| Espejo de ventas | `src/utils/checkoutProcessor.js` | `const MIRROR_KEY = 'bodega_sales_mirror_v1';` |
| Pull del monitor | `src/hooks/useMonitorSync.js` | `.in('collection', ['store', 'local']);` |
| Health-check del monitor | `src/hooks/useMonitorSync.js` | `reconnectTimer = setInterval(() => {` |
| Re-pull al volver a la app | `src/hooks/useMonitorSync.js` | `const handleVisibilityChange = () => {` |

---

## 2. Fases

> **Orden de ejecución:** FE1 → FE2 → F0 → F1 → … → F7.
> Las fases **FE** (egress) van primero: reducen el costo base antes de que el multisupervisor lo multiplique por N monitores.

---

### FASE FE1 — Sacar de la nube lo que nadie consume (E1, E2, E6)

**Archivos:** `src/hooks/useCloudSync.js`, `src/config/backupKeys.js`

> **La fase de mayor ahorro por unidad de riesgo de todo el plan.** Sin cambios de UI, sin migración, sin tocar el modelo de datos.

**FE1.1 — Lista de exclusión explícita para la nube.**
`IDB_KEYS`/`LS_KEYS` los comparten el **sync en la nube** y los **backups**. No se pueden recortar sin romper los backups (D9). Por eso se añade una lista de exclusión que aplica **solo** al sync, en `useCloudSync.js`, junto a ANCLA `const SYNC_KEYS = [...new Set([...IDB_KEYS, ...LS_KEYS,`:

```js
// EGRESS: claves que se respaldan pero NO se sincronizan a la nube.
// Cada upsert a sync_documents se retransmite por Realtime a CADA monitor
// conectado, así que sincronizar algo que el monitor no lee es egress puro.
//   • bodega_sales_mirror_v1 → duplicado casi exacto de bodega_sales_v1
//     (blindaje anti-pérdida LOCAL, ver checkoutProcessor.js). El monitor
//     nunca lo lee; sigue incluido en los backups vía IDB_KEYS.
//   • abasto_audit_log_v1 → hasta 15.000 entradas (auditService MAX_ENTRIES),
//     reescrito en cada evento auditado. El monitor no lo renderiza.
const CLOUD_SYNC_EXCLUDE = ['bodega_sales_mirror_v1', 'abasto_audit_log_v1'];
```

Restar esas claves al construir `SYNC_KEYS` (y en consecuencia también dejan de entrar por `LOCAL_KEYS`/`queueCloudSync`/`pushLocalSync`, que ya filtran contra `SYNC_KEYS`).

**FE1.2 — Verificar los recorridos de subida masiva.**
`forceSyncAllPOSData` y `forcePushLocalData` iteran sobre `IDB_KEYS`/`LOCAL_KEYS` directamente, no sobre `SYNC_KEYS`. Como ambos llaman a `pushCloudSync`, y ahí la guardia (ANCLA: `if (!SYNC_KEYS.includes(key)) return;`) ya rechaza las claves excluidas, **la exclusión se respeta sin tocar los bucles**. Confirmar esto leyendo el código; si algún camino escribe a `sync_documents` sin pasar por `pushCloudSync`, DETENTE y reporta.

**FE1.3 — E6: retirar `bodega_pos_heartbeat`.**
`grep -rn "bodega_pos_heartbeat" src/` demuestra que **solo aparece en las dos líneas de configuración de `useCloudSync.js`** — ningún punto del código lo escribe ni lo lee. Quitarlo de `SYNC_KEYS` y `LOCAL_KEYS`. Si el grep revela un escritor real, DETENTE: significaría que la presencia de la caja depende de él.

**FE1.4 — Limpieza opcional en el servidor (la ejecuta el humano, no el código).**
Las filas ya subidas siguen ocupando espacio y se re-descargan en cada pull del monitor. Documentar en la sección 4, **sin código de migración** (constraint del proyecto):
```sql
DELETE FROM public.sync_documents
WHERE doc_id IN ('bodega_sales_mirror_v1', 'abasto_audit_log_v1', 'bodega_pos_heartbeat');
```

**Verificación:** tras una venta, en el dashboard de Supabase `sync_documents` debe mostrar `updated_at` fresco **solo** en `bodega_sales_v1`, `bodega_products_v1` y las claves ligeras — nunca en las tres excluidas.

**Harness:** `npx eslint --no-cache src/hooks/useCloudSync.js src/config/backupKeys.js` + `npx vitest run tests/` (suite completa: se toca una ruta central) + `npm run build`.

**Commit:** `perf(egress): excluir espejo de ventas y log de auditoria del sync en la nube`.

---

### FASE FE2 — Recortar el tráfico del monitor (E3, E4, E5)

**Archivo:** `src/hooks/useMonitorSync.js`

Cada uno de estos puntos se multiplica por el número de monitores, así que el ahorro escala justo con la feature multisupervisor.

**FE2.1 — E3: no re-descargar todo al volver a la app.**
ANCLA: `const handleVisibilityChange = () => {`. Hoy cada vez que el supervisor vuelve a la app se dispara `initMonitor(true)`, que hace un pull completo. En un celular eso ocurre decenas de veces al día. Añadir una guardia de frescura (D10): si la suscripción Realtime está viva **y** `lastSync` tiene menos de **60 s**, omitir el pull — el WebSocket ya mantuvo los datos al día. Solo se re-sincroniza si el canal está caído o los datos están rancios.

**FE2.2 — E4: espaciar el health-check.**
ANCLA: `reconnectTimer = setInterval(() => {`. Hoy corre cada 10 s y siempre llama a `checkPosPresence()` (una query por monitor). Pasar a **30 s** cuando la suscripción está sana, manteniendo los 10 s solo mientras está caída (backoff simple, D11). El umbral de "caja en línea" (`diffMs <= 180000`, 3 min) tolera de sobra los 30 s.

**FE2.3 — E5: pedir solo los documentos que el monitor usa.**
ANCLA: `.in('collection', ['store', 'local']);`. Hoy el pull trae **todos** los documentos. Sustituir por un `.in('doc_id', MONITOR_DOC_IDS)` con la lista explícita de lo que el monitor realmente renderiza.

> **Obligatorio antes de escribir la lista:** derivarla del código, no de memoria. Revisar qué claves consume `OwnerMonitorView.jsx` y los contexts que monta (productos, ventas, clientes, categorías, tasas, nombre del negocio, catálogo de usuarios, cesta en vivo — el monitor muestra la cesta desde el commit `27d3ac5`). **Si hay duda sobre una clave, inclúyela**: omitir una clave que el monitor sí usa rompe funcionalidad, mientras que incluir una de más solo cuesta unos bytes. Documentar la lista con un comentario que explique el criterio.

**No se toca la suscripción Realtime.** El filtro de `postgres_changes` admite una sola cláusula (`device_id=eq.X`) y no puede filtrar por `doc_id`; filtrar en el cliente no ahorraría egress porque los bytes ya viajaron. El ahorro en Realtime viene de FE1 (no escribir esas claves), que es la vía correcta.

**Harness:** `npx eslint --no-cache src/hooks/useMonitorSync.js` + `npm run build`.

**Commit:** `perf(egress): pull selectivo y health-check espaciado en el monitor`.

---

### FASE 0 — Migración SQL: modelo 1-N, metadatos y RPCs seguros (B1, B2, B3, B4, R3, L2)

> ⚠️ **Fase de base de datos. Nada de UI aquí.** Ninguna fase posterior funciona sin esta.
> El humano debe ejecutar el script en el proyecto **CLOUD/SYNC** (el de `VITE_SUPABASE_CLOUD_URL`), no en el de licencias.

**Archivo nuevo:** `supabase_multisupervisor_setup.sql` (idempotente, mismo estilo que `supabase_supervisor_commands_setup.sql`).

**0.1 — Tabla nueva `device_monitors` (1 caja → N monitores).**
No se toca `device_pairings`: se mantiene intacta por compatibilidad con el monitor ya vinculado en producción (D1).
```sql
CREATE TABLE IF NOT EXISTS public.device_monitors (
    id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    primary_device_id  TEXT NOT NULL,
    monitor_device_id  TEXT NOT NULL,
    device_label       TEXT,               -- nombre legible: "Celular de Juan"
    user_agent         TEXT,               -- para distinguir dispositivos
    paired_at          TIMESTAMPTZ DEFAULT now(),
    last_seen_at       TIMESTAMPTZ DEFAULT now(),
    revoked_at         TIMESTAMPTZ,        -- NULL = activo (B4: la fila NO se borra)
    UNIQUE (primary_device_id, monitor_device_id)
);
CREATE INDEX IF NOT EXISTS idx_device_monitors_primary
    ON public.device_monitors (primary_device_id, revoked_at);
```

**0.2 — Backfill del monitor existente** (no es migración de datos de negocio, es alta de infraestructura — permitida):
```sql
INSERT INTO public.device_monitors (primary_device_id, monitor_device_id, device_label, paired_at)
SELECT primary_device_id, monitor_device_id, 'Supervisor principal', COALESCE(paired_at, now())
FROM public.device_pairings
WHERE monitor_device_id IS NOT NULL
ON CONFLICT (primary_device_id, monitor_device_id) DO NOTHING;
```

**0.3 — RPC `generate_monitor_token(p_requester_id TEXT)` (resuelve B2).**
A diferencia de `generate_pairing_token`, **nunca** pone `monitor_device_id = NULL`. Acepta que el solicitante sea la caja **o** un monitor ya vinculado, y resuelve la caja destino en ambos casos:
```sql
CREATE OR REPLACE FUNCTION public.generate_monitor_token(p_requester_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_primary TEXT;
    v_token   TEXT;
BEGIN
    -- El solicitante puede ser la caja misma o un monitor activo de esa caja
    SELECT primary_device_id INTO v_primary
    FROM public.device_monitors
    WHERE monitor_device_id = p_requester_id AND revoked_at IS NULL
    LIMIT 1;

    IF v_primary IS NULL THEN
        SELECT primary_device_id INTO v_primary
        FROM public.device_pairings WHERE primary_device_id = p_requester_id;
    END IF;

    IF v_primary IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Dispositivo no autorizado para generar códigos.');
    END IF;

    v_token := upper(substring(md5(random()::text) from 1 for 6));

    UPDATE public.device_pairings
    SET pairing_token = v_token,
        token_expires_at = now() + interval '10 minutes'   -- L2: 10 min, alineado en los 3 sitios
    WHERE primary_device_id = v_primary;

    RETURN json_build_object('success', true, 'token', v_token, 'primary_device_id', v_primary);
END; $$;
```

**0.4 — RPC `pair_additional_monitor(p_token TEXT, p_monitor_device_id TEXT, p_label TEXT, p_user_agent TEXT)`.**
Valida token vigente, inserta en `device_monitors` (o reactiva si estaba revocado poniendo `revoked_at = NULL`), aplica el tope de D2 (máx. 4 monitores activos por caja) y devuelve `primary_device_id`. **No** toca `device_pairings.monitor_device_id` salvo que esté NULL (primer monitor, compatibilidad).

**0.5 — RPC `revoke_monitor(p_requester_id TEXT, p_target_monitor_id TEXT)` (resuelve R3 y B4).**
Valida que `p_requester_id` sea la caja o un monitor activo **de la misma caja** antes de revocar. Marca `revoked_at = now()` en vez de borrar, para que el revocado pueda leer su propio estado:
```sql
UPDATE public.device_monitors
SET revoked_at = now()
WHERE primary_device_id = v_primary AND monitor_device_id = p_target_monitor_id;
```

**0.6 — RPC `touch_monitor_heartbeat(p_monitor_device_id TEXT)`** → `UPDATE ... SET last_seen_at = now()`. Devuelve `revoked_at` para que el monitor detecte su propia revocación en la misma llamada (D5 — un solo round-trip, sin realtime extra).

**0.7 — RLS de `device_monitors`.**
`SELECT` para `anon` de filas cuya `primary_device_id` exista en `device_pairings` — **incluidas las revocadas** (B4: si se ocultaran, el revocado no podría enterarse). Escritura: revocada a `anon`; todo pasa por los RPC `SECURITY DEFINER`. `GRANT EXECUTE` de los 4 RPC a `anon, authenticated`.

**Verificación:** el script corre dos veces seguidas sin error (idempotencia). No hay cambios de JS en esta fase.

**Commit:** `feat(db): esquema multisupervisor con device_monitors y RPCs seguros`.

---

### FASE 1 — Landmine L1: CHECK de `command_type` (riesgo activo)

> Independiente del resto de la feature. Se hace primero porque `supabase_supervisor_commands_setup.sql` **sigue pendiente de ejecutar** y correrlo tal como está hoy rompería la anulación remota y la gestión de usuarios en producción.

**Archivo:** `supabase_supervisor_commands_setup.sql`

En ANCLA `CHECK (command_type IN ('rate_change', 'inventory_update'))`, ampliar a los 4 tipos que el código realmente emite y maneja:
```sql
CHECK (command_type IN ('rate_change', 'inventory_update', 'void_sale', 'user_update'))
```
Como el `DO $$` solo crea el constraint si no existe, añadir antes un `ALTER TABLE ... DROP CONSTRAINT IF EXISTS supervisor_commands_command_type_check;` para que el script siga siendo idempotente y aplique el CHECK corregido aunque ya se hubiera creado el viejo.

**Verificación cruzada obligatoria:** confirmar con `grep -rn "command_type:" src/` que los tipos emitidos son exactamente esos 4 (hoy: `rate_change`, `void_sale`, y `commandType` que resuelve a `inventory_update` | `user_update`). Si aparece un quinto, DETENTE y reporta.

**Commit:** `fix(db): CHECK de command_type admite void_sale y user_update`.

---

### FASE 2 — Heartbeat del monitor (habilita "En línea / Hace X min")

**Archivo:** `src/hooks/useMonitorSync.js`

Sin esto, la lista de dispositivos de la F4 no puede mostrar estado en vivo (B3).

1. Añadir un `useEffect` con intervalo de **60 s** (D3 — no menos: es una escritura por monitor por minuto) que llame a `touch_monitor_heartbeat` con el `dj_device_id` local.
2. La respuesta trae `revoked_at`. Si no es NULL → disparar `CustomEvent('monitor_revoked')` y detener el heartbeat. (La reacción visual se implementa en F4.)
3. Llamar también al montar y en el `handleOnline` existente (ANCLA: `const handleOnline = () => {`), para que reconectar refresque el estado de inmediato.

**Harness:** `npx eslint --no-cache src/hooks/useMonitorSync.js`.

**Commit:** `feat(monitor): heartbeat de presencia y deteccion de revocacion`.

---

### FASE 3 — UI: generar código de vinculación desde el Monitor (Opción A)

**Archivos:** `src/components/Monitor/SupervisorPairingModal.jsx` [NUEVO], `src/views/OwnerMonitorView.jsx`

> Ubicación corregida: `components/Monitor/`, no `components/Settings/` — es UI del panel de monitor y ahí vive ya `RemoteProductFormModal.jsx`.

**3.1 — Componente nuevo, pestaña "Código":**
- Llama a `generate_monitor_token` con el `dj_device_id` del monitor (NO a `generate_pairing_token` — B2).
- Renderiza el QR con `qrcode` → `QRCode.toCanvas`, mismo patrón que `PairingManager.jsx` (ANCLA: `QRCode.toCanvas(`). Reusar tamaño/colores para consistencia visual.
- Cuenta regresiva de **600 s** (L2, alineado con el `interval '10 minutes'` de F0).
- Botón "Regenerar código" + copiar al portapapeles (mismo patrón que el botón "Código Manual" existente).
- **No** hace polling de vinculación: el alta aparece en la pestaña Dispositivos (F4) vía su propio refresco.

**3.2 — Botón en la barra superior de `OwnerMonitorView.jsx`:**
Junto al botón Usuarios (ANCLA: `title="Gestión de Usuarios, Roles y PINs"`), añadir un botón `title="Conectar otro dispositivo supervisor"` con icono `QrCode` de lucide, que haga `setShowPairingModal(true)`. Declarar el estado junto a ANCLA: `const [showUsersModal, setShowUsersModal] = useState(false);`.

**3.3 — Corregir el copy del PIN.** El token es **hexadecimal de 6 caracteres en mayúscula**, no "6 dígitos numéricos". Los textos de la UI deben decir "código de 6 caracteres".

**Harness:** eslint sobre ambos archivos + `npm run build`.

**Commit:** `feat(monitor): generar codigo y QR de vinculacion desde el panel supervisor`.

---

### FASE 4 — UI: lista de dispositivos y revocación remota (Opción B, B4)

**Archivos:** `src/components/Monitor/SupervisorPairingModal.jsx`, `src/components/PairingScanScreen.jsx`, `src/views/OwnerMonitorView.jsx`

**4.1 — Pestaña "Dispositivos":** `SELECT` de `device_monitors` filtrando `revoked_at IS NULL`, ordenado por `paired_at`. Por fila: `device_label`, "En línea" si `last_seen_at` está dentro de los últimos **3 minutos** (mismo umbral que `isPosOnline` en `useMonitorSync.js`, ANCLA: `diffMs <= 180000`) o "Hace X min" si no; badge "Este dispositivo" cuando `monitor_device_id === localStorage.getItem('dj_device_id')`.

**4.2 — Revocar:** botón por fila (deshabilitado en el propio dispositivo — para salir ya existe `handleDisconnect`) → modal de confirmación (reusar el patrón de `showConfirmUnpair` de `PairingManager.jsx`) → RPC `revoke_monitor` → refrescar lista.

**4.3 — Reacción del revocado (B4 — el punto crítico):**
La revocación **no** llega por Realtime, porque la política RLS filtra el evento. Se detecta por el heartbeat de F2. Al recibir `CustomEvent('monitor_revoked')`, `OwnerMonitorView.jsx` debe ejecutar la misma limpieza de credenciales que `handleDisconnect` (ANCLA: `const handleDisconnect = async () => {`) **omitiendo la llamada RPC** (ya fue revocado en el servidor) y mostrando un toast explicativo antes del reload.

**4.4 — Etiqueta del dispositivo:** en `PairingScanScreen.jsx` (ANCLA: `rpc('pair_monitor_device'`), pasar a llamar a `pair_additional_monitor` enviando `p_label` (input opcional "¿De quién es este dispositivo?", con fallback `Supervisor N`) y `p_user_agent: navigator.userAgent.slice(0, 200)`. **Mantener el fallback al RPC viejo** si el nuevo no existe todavía en el servidor (D6), para no romper dispositivos que actualicen la app antes de que el humano corra el SQL.

**Harness:** eslint de los 3 archivos + `npm run build`.

**Commit:** `feat(monitor): lista de dispositivos vinculados y revocacion remota`.

---

### FASE 5 — Notificaciones inter-supervisor (Opción C, con control de egress R2)

**Archivo:** `src/views/OwnerMonitorView.jsx`

**5.1 — Suscripción acotada.** Un canal realtime a `supervisor_commands` filtrado por `primary_device_id=eq.${pairedDeviceId}`, **solo evento `INSERT`** — mismo patrón que `useSupervisorCommands.js` (ANCLA: `event: 'INSERT',`). No se re-sincronizan `sync_documents`: el sync existente ya propaga los datos; esto es únicamente el aviso (D7, contención de R2).

**5.2 — Ignorar los propios comandos:** si `payload.new.monitor_device_id === localStorage.getItem('dj_device_id')`, no notificar.

**5.3 — Toast informativo** resolviendo `device_label` desde la lista de F4 (cacheada en estado; sin query por evento): "Celular de Juan anuló la venta #123", "Celular de Juan actualizó stock". Mapear los 4 `command_type`.

**Harness:** eslint + `npm run build`.

**Commit:** `feat(monitor): avisos en tiempo real entre supervisores`.

---

### FASE 6 — Concurrencia real: versionado optimista en `edit` (R1)

**Archivos:** `src/utils/remoteInventoryProcessor.js`, `tests/remoteInventory.test.js`

Hoy la protección anti-pisado cubre **solo `stock`** (`normalized.stock = existing.stock`). Con 2+ supervisores, un `edit` viejo encolado pisa precios y nombre editados por otro supervisor.

1. El monitor incluye en el payload de `edit` el `updatedAt` del producto tal como lo vio al encolar.
2. En `applyInventoryCommand` (ANCLA: `if (action === 'edit') {`), si `data.baseUpdatedAt` viene y es **anterior** al `existing.updatedAt` de la caja → rechazar con `{ success: false, error: 'El producto fue modificado por otro supervisor. Vuelve a encolar el cambio.' }`. El `error_reason` ya se muestra en la tabla, así que el supervisor se entera.
3. Toda escritura de producto sella `updatedAt = new Date().toISOString()`.
4. **Compatibilidad:** si el payload no trae `baseUpdatedAt` (comando viejo en cola), se aplica como hoy — sin romper nada.

**Tests nuevos** en `tests/remoteInventory.test.js`: (a) edit con `baseUpdatedAt` obsoleto → rechazado y producto intacto; (b) edit con `baseUpdatedAt` vigente → aplicado; (c) edit sin `baseUpdatedAt` → aplicado (compatibilidad).

**Harness:** `npx vitest run tests/remoteInventory.test.js` (verde) + eslint + `npm run build`.

**Commit:** `fix(supervisor): versionado optimista evita pisado entre supervisores`.

---

### FASE 7 — Cierre

1. `npx eslint --no-cache` sobre todos los archivos tocados — 0 errores.
2. `npx vitest run tests/remoteInventory.test.js tests/pricingMode.test.js` — todos verdes.
3. `npm run build` — ✓.
4. Crear `future_plans/PROGRESO_multisupervisor.md` con el checklist de verificación manual (sección 4).

**Commit:** `docs(multisupervisor): registro de implementacion`.

---

## 3. Decisiones de diseño

| ID | Decisión | Motivo |
|---|---|---|
| D1 | Tabla nueva `device_monitors`; `device_pairings` **no se modifica** | El monitor en producción sigue funcionando durante todo el rollout; sin ventana de rotura |
| D2 | Tope de **4 monitores activos** por caja | Cada monitor = una suscripción realtime a todos los `sync_documents` (R2). Sin tope, el egress crece sin control |
| D3 | Heartbeat cada **60 s**, no menos | 1 UPDATE/min/monitor. A 15 s serían 4× escrituras para una precisión que nadie percibe |
| D4 | Revocación con `revoked_at`, **nunca DELETE** | Si se borra la fila, la RLS la oculta y el dispositivo revocado no puede detectar su propia revocación (B4) |
| D5 | La revocación se detecta por **heartbeat**, no por Realtime | La política RLS filtra el evento UPDATE hacia el revocado; realtime aquí no es fiable |
| D6 | `PairingScanScreen` conserva fallback al RPC viejo | La app puede desplegarse antes de que el humano corra el SQL; sin fallback, vincular quedaría roto en esa ventana |
| D7 | Las notificaciones **solo** escuchan INSERTs de `supervisor_commands` | No re-sincronizar datos por notificación: eso multiplicaría el egress (R2) |
| D8 | Se mantiene la regla D8 del proyecto: **nunca base64 en payloads** | Coherencia con `inventario_remoto_supervisor.md` y `supabase_egress_optimization.sql` |
| D9 | La exclusión de egress es una lista **aparte**, no un recorte de `IDB_KEYS` | Esas listas también alimentan los backups. Recortarlas dejaría el espejo de ventas y la auditoría fuera de los respaldos — pérdida de datos, no ahorro |
| D10 | El re-pull al volver a la app se omite si el canal vive y `lastSync` < 60 s | El WebSocket ya mantuvo los datos frescos; re-descargar la base por cambiar de app es gasto sin información nueva |
| D11 | Health-check a 30 s con canal sano, 10 s con canal caído | El umbral de "en línea" es de 3 min: 30 s no degrada la precisión percibida y reduce las queries a un tercio |
| D12 | **No** se reparticiona `bodega_sales_v1` por día/lote | Es el ahorro máximo teórico, pero cambia el modelo de sync y exige pruebas amplias. Fuera del alcance de bajo riesgo acordado; queda anotado como trabajo futuro |

### Compensación asumida en FE1 (declarada de forma explícita)

`bodega_sales_mirror_v1` y `abasto_audit_log_v1` dejan de tener copia en `sync_documents`. Implicación real: si una caja se reinstala y restaura **desde la nube**, esas dos claves ya no vuelven por esa vía.

Por qué se considera aceptable:
- Ambas siguen en `IDB_KEYS`, así que **los backups las siguen incluyendo** — el camino de recuperación soportado sigue intacto.
- Las ventas en sí (`bodega_sales_v1`) se siguen sincronizando; el espejo protege contra corrupción **local**, escenario en el que el original local también se perdería y la restauración sería desde backup de todos modos.
- El log de auditoría es un registro histórico, no un dato operativo del que dependa la caja para funcionar.

Si el usuario prefiere conservar la copia en la nube de alguna de las dos, quitarla de `CLOUD_SYNC_EXCLUDE` es un cambio de una línea — pero conviene saber que `abasto_audit_log_v1` es, con diferencia, la más cara de las dos.

---

## 4. Verificación manual

### 4.a Egress (fases FE — se puede verificar con un solo dispositivo)

0. **Línea base:** anotar el egress actual en el dashboard de Supabase antes de desplegar.
1. Hacer una venta con la caja y el monitor conectados. En `sync_documents`, comprobar que `updated_at` se refresca **solo** en `bodega_sales_v1`, `bodega_products_v1` y claves ligeras — **nunca** en `bodega_sales_mirror_v1`, `abasto_audit_log_v1` ni `bodega_pos_heartbeat` (E1, E2, E6).
2. Confirmar que el espejo y la auditoría **sí siguen creciendo localmente** (Application → IndexedDB) y que un backup manual los incluye — la exclusión es solo de la nube (D9).
3. En el celular, salir y volver a la app varias veces seguidas: no debe dispararse un pull completo cada vez (E3, D10). Verificable en la pestaña Network / logs de `[useMonitorSync]`.
4. Ejecutar la limpieza opcional de FE1.4 y confirmar que el monitor sigue funcionando con normalidad tras ella.
5. Dejar el sistema operando un día normal y comparar el egress contra la línea base del punto 0.

### 4.b Multisupervisor (requiere 2+ dispositivos reales)

1. Ejecutar `supabase_multisupervisor_setup.sql` y el `supabase_supervisor_commands_setup.sql` corregido en el proyecto CLOUD/SYNC.
2. Confirmar que el monitor ya vinculado **sigue funcionando** tras la migración (backfill 0.2).
3. Monitor 1 → "Conectar otro dispositivo" → aparece código de 6 caracteres + QR; **verificar que el Monitor 1 NO se desconecta** (B2).
4. Dispositivo 2 → Modo Monitor → escanear/ingresar código + etiqueta → conecta.
5. Pestaña Dispositivos en Monitor 1: aparecen ambos, con "En línea" y badge "Este dispositivo" en el propio.
6. Monitor 1 anula una venta → Monitor 2 recibe el toast con la etiqueta correcta (y Monitor 1 **no** se auto-notifica).
7. Monitor 1 revoca al Monitor 2 → en ≤60 s el Monitor 2 vuelve a la pantalla de vinculación con toast explicativo (B4).
8. Concurrencia (R1): ambos monitores editan el mismo producto; el segundo en subir recibe `failed` con "modificado por otro supervisor" y el `error_reason` es visible.
9. Dejar 2 monitores abiertos 30 min y revisar el egress en el dashboard de Supabase contra la línea base.

---

## 5. Si algo no encaja

- Si `grep -rn "bodega_pos_heartbeat" src/` revela un **escritor real** (no solo las 2 líneas de configuración de `useCloudSync.js`), **DETENTE**: la presencia de la caja podría depender de esa clave y quitarla del sync la rompería.
- Si existe algún camino que escriba en `sync_documents` **sin pasar por `pushCloudSync`**, **DETENTE**: la exclusión de FE1 no lo cubriría y el ahorro sería parcial y silencioso.
- Si al derivar `MONITOR_DOC_IDS` (FE2.3) no queda claro si el monitor usa una clave, **inclúyela**: omitir una clave usada rompe funcionalidad; incluir una de más cuesta unos bytes.
- Si `device_pairings` ya tuviera columnas de multisupervisor (alguien corrió SQL a mano), **DETENTE** y reporta antes de crear `device_monitors`.
- Si `grep -rn "command_type:" src/` arroja un tipo fuera de los 4 conocidos, **DETENTE**: el CHECK de F1 lo bloquearía en producción.
- Si `qrcode` no estuviera en `package.json`, **DETENTE** — no instales dependencias sin autorización (hoy sí está: lo usa `PairingManager.jsx`).
- Si el humano no ha corrido el SQL de F0, las fases 3–5 fallarán en runtime con "function does not exist". Eso es esperado: F0 es un prerrequisito humano, no un bug.
