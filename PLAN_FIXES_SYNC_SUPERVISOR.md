# Plan de Fixeo — Auditoría de Sincronización Monitor (Supervisor) ↔ Caja Principal

> **Audiencia:** LLM ejecutor (incluido un modelo pequeño/rápido). Sigue este documento **al pie de la letra**.
> **Origen:** auditoría estática completa del canal de sincronización entre `OwnerMonitorView` / `useMonitorSync` (monitor) y `useCloudSync` / `useSupervisorCommands` (caja), más los 5 archivos SQL de Supabase.
> **Alcance:** 28 hallazgos → `S1–S7` (seguridad), `D1–D7` (pérdida de datos), `F1–F5` (deriva de esquema), `E1–E3` (egress), `R1–R6` (robustez).
> **Protocolo:** anclas de texto, **no números de línea**. Un commit por fase. Si el código no coincide byte a byte con el bloque `ANTES`, **DETENTE y reporta**.

---

## Índice

- [0. Reglas del ejecutor (leer primero)](#0-reglas-del-ejecutor-leer-primero)
- [1. Estado de partida](#1-estado-de-partida)
- [2. Tabla de los 28 hallazgos](#2-tabla-de-los-28-hallazgos)
- [3. Diccionario de anclas](#3-diccionario-de-anclas)
- [4. Orden de ejecución](#4-orden-de-ejecución)
- [5. Fases FX00 – FX18](#5-fases)
- [6. Arneses nuevos (tests)](#6-arneses-nuevos)
- [7. Guardarraíles — qué NO tocar](#7-guardarraíles--qué-no-tocar)
- [8. Despliegue SQL y verificación manual](#8-despliegue-sql-y-verificación-manual)
- [9. Checklist final](#9-checklist-final)

---

## 0. Reglas del ejecutor (leer primero)

Estas reglas son **absolutas**. Violarlas invalida la ejecución.

### R-0.1 — Anclas exactas
Cada edición trae un bloque `ANTES` y un bloque `DESPUÉS`. El bloque `ANTES` es el `old_string` **literal**, incluida la indentación. Si tu herramienta de edición no lo encuentra:
1. **NO** lo reescribas "aproximadamente".
2. **NO** uses números de línea.
3. Busca el ancla corta indicada en la fase (`grep -n`).
4. Si el ancla corta tampoco aparece, o aparece con texto distinto → **DETENTE**, reporta el ancla y el texto real encontrado, y **no continúes con esa fase**. Sigue con la siguiente fase solo si la tabla de dependencias lo permite.

### R-0.2 — Finales de línea (Windows)
Este checkout está en Windows y Git reporta `LF will be replaced by CRLF`. Los archivos en disco pueden tener **CRLF**. Si una edición multilínea falla y estás seguro del contenido:
- Reintenta el `old_string` de **una sola línea** (la más distintiva del bloque).
- **Nunca** conviertas finales de línea masivamente. Un `git diff` que muestre el archivo entero como modificado es un **fallo**: revierte con `git checkout -- <archivo>` y reporta.

### R-0.3 — Un commit por fase
Al terminar cada fase, y **solo si su arnés pasa**, haz commit con el mensaje indicado. No agrupes fases. No hagas `git push` salvo que el usuario lo pida.

### R-0.4 — Arnés obligatorio por fase
Ninguna fase se da por terminada sin ejecutar su bloque `HARNESS`. Si el arnés falla:
1. Revierte **solo esa fase**: `git checkout -- <archivos de la fase>`.
2. Reporta el error literal.
3. **No** intentes un arreglo creativo no descrito aquí.

### R-0.5 — SQL nunca se ejecuta automáticamente
Las fases SQL **solo escriben archivos `.sql`**. El ejecutor **jamás** se conecta a Supabase ni ejecuta DDL. El despliegue lo hace una persona siguiendo la [sección 8](#8-despliegue-sql-y-verificación-manual). Escribe el archivo, verifica que sea idempotente, haz commit, y **detente ahí**.

### R-0.6 — Prohibido el refactor oportunista
No renombres variables, no reordenes imports, no cambies formato, no "mejores" nada fuera del bloque `DESPUÉS`. El `git diff` de cada fase debe contener **solo** las líneas descritas.

### R-0.7 — Timeout de las pruebas
La suite completa **tarda más de 2 minutos**. Usa siempre timeout ≥ 600 s:
```bash
npx vitest run --reporter=dot --testTimeout=30000
```
Para arneses por fase, ejecuta **solo** los archivos de prueba indicados — es mucho más rápido.

### R-0.8 — Nada de secretos en el repo
Ninguna fase escribe claves, tokens ni URLs de Supabase en archivos versionados. Si una fase parece pedirlo, **DETENTE**.

### R-0.9 — Regla de duda
Si en algún punto tienes que **elegir** entre dos interpretaciones, la respuesta correcta es **DETENTE y pregunta**. Este plan está diseñado para no requerir juicio. Si lo requiere, es un defecto del plan, no una invitación a improvisar.

---

## 1. Estado de partida

### 1.1 Árbol de trabajo — IMPORTANTE

En el momento de escribir este plan hay **12 archivos modificados sin commitear** en `main`:

```
 M src/components/Dashboard/DashboardPaymentBreakdown.jsx
 M src/components/Dashboard/DashboardStats.jsx
 M src/components/Dashboard/SalesHistory.jsx
 M src/components/Reports/ReportsMetricsTab.jsx
 M src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
 M src/components/Sales/CheckoutModalPOS/index.jsx
 M src/core/FinancialEngine.js
 M src/hooks/useCheckoutCalculations.js
 M src/hooks/useCloudSync.js          ← central para este plan
 M src/hooks/useMonitorSync.js        ← central para este plan
 M src/utils/checkoutProcessor.js
 M src/views/OwnerMonitorView.jsx     ← central para este plan
```

**Todas las anclas de este plan se tomaron del árbol de trabajo actual, NO de `HEAD`.** Si `git stash` o `git checkout` revierte esos 3 archivos centrales, las anclas dejarán de coincidir.

La fase **FX00** resuelve esto y es **obligatoria antes que cualquier otra**.

### 1.2 Comandos de referencia

| Propósito | Comando |
|---|---|
| Suite completa | `npx vitest run --reporter=dot --testTimeout=30000` (≥ 600 s de timeout) |
| Un archivo de prueba | `npx vitest run tests/<archivo>.test.js` |
| Lint de archivos concretos | `npx eslint --no-cache <archivo> [<archivo>...]` |
| Build | `npm run build` |
| Tipos (no bloqueante) | `npm run typecheck` |

### 1.3 Convenciones del repo que este plan respeta

- `src/constants/commandStatus.js` es un **espejo exacto** de la constraint SQL, verificado por `tests/commandStatus.test.js`. Todo enum compartido con Postgres sigue ese patrón.
- `sanitizeUserCatalog` (`src/utils/userCatalog.js`) es la barrera **SEC-002**: ni `pin` ni `plainPin` salen del dispositivo.
- `runWithoutEco` (`src/utils/syncFlags.js`) es la barrera anti-eco.
- Los comentarios de código citan el ID del hallazgo (`S4`, `D1`, …) igual que el repo ya cita `HOOK-023`, `EGRESS-FIX RC5`, etc.

---

## 2. Tabla de los 28 hallazgos

### 2.1 Seguridad — `S`

| ID | Sev | Hallazgo | Fase |
|---|---|---|---|
| **S1** | 🔴 Crítico | `touch_pos_heartbeat(p_device_id)` está concedida a `anon` y hace `INSERT` en `device_pairings`. Cualquiera con la anon key crea la fila de emparejamiento de un `device_id` arbitrario. Esa fila es la **única** autorización que exigen `sync_documents_anon_access` e `is_authorized_monitor`. | FX01 |
| **S2** | 🔴 Crítico | `is_authorized_monitor` termina en `OR EXISTS (SELECT 1 FROM device_pairings dp WHERE dp.primary_device_id = p_primary)` — una cláusula que **ignora al monitor por completo**. Además acepta los comodines `p_monitor = 'monitor_web'` y `monitor_device_id IS NULL`. El chequeo es efectivamente `true`. | FX01 |
| **S3** | 🔴 Crítico | El *auto-healing* de `generate_monitor_token` y `pair_additional_monitor` cae a `SELECT device_id FROM sync_documents WHERE doc_id='bodega_sales_v1' ORDER BY updated_at DESC LIMIT 1`: entrega un token válido **de la caja más activa del sistema** a cualquier solicitante. | FX01 |
| **S4** | 🔴 Crítico | El PIN sale del dispositivo. (a) El adaptador `persist.storage.setItem` de `useAuthStore` copia `state.usuarios` **crudo** (con `pin` hash y `plainPin`) a `bodega_users_catalog_v1`, que es miembro de `LOCAL_KEYS` y se sube tal cual. (b) `UsersManager` escribe `plainPin` directo al catálogo en 5 sitios, saltándose `publishUserCatalog`. | FX05 |
| **S5** | 🔴 Crítico | `newPin` viaja **en claro** dentro de `supervisor_commands.payload`, y `supervisor_commands_pair_select` expone esa fila al rol `anon`. | FX06 |
| **S6** | 🟠 Importante | `supervisor_commands_pair_select` y `_pair_update` no validan al monitor: basta que exista **cualquier** fila en `device_pairings` para esa caja. Un `anon` lee todos los comandos y puede voltear su `status` (`pending`→`applied`), neutralizando órdenes del supervisor sin dejar rastro. | FX02 |
| **S7** | 🟠 Importante | La revocación no es exigible: `touch_monitor_heartbeat` devuelve `is_revoked:false` para dispositivos desconocidos, y `unpair_monitor` nunca escribe `revoked_at`, así que el monitor desvinculado sigue autorizado en `device_monitors`. | FX01 |

### 2.2 Pérdida o corrupción de datos — `D`

| ID | Sev | Hallazgo | Fase |
|---|---|---|---|
| **D1** | 🔴 Crítico | **Hash escrito ante fallo.** `pushCloudSync` deliberadamente **no** guarda el hash cuando Supabase devuelve error (`return; // No guardar hash para reintentar`). Pero **8 sitios de llamada** hacen `await pushCloudSync(...)` y acto seguido `localStorage.setItem(hashKey, currentHash)` **incondicionalmente**. Una subida fallida queda marcada como completada y **nunca se reintenta**: el monitor se queda con datos viejos para siempre, sin ningún error visible. | FX07 |
| **D2** | 🔴 Crítico | El bucle de aplicación del monitor `for (const doc of docs) { await applyDocToLocal(doc.doc_id, doc.collection, doc.data.payload); }` no tiene `try/catch` ni guarda contra `doc.data == null`. Un solo documento malformado lanza y **aborta los 21 restantes**, de forma permanente y recurrente. La caja ya tiene esta protección (`HOOK-023`); el monitor no. | FX08 |
| **D3** | 🔴 Crítico | El cursor del monitor se quema **antes** del query: `localStorage.setItem('dj_monitor_last_full_pull_ts', String(nowTs))` se ejecuta antes de `await query`. Si el query falla, el rate limiter de 5 minutos bloquea el reintento y el monitor se queda sin datos. | FX09 |
| **D4** | 🔴 Crítico | El pull de la caja descarta el error (`const { data: docs } = await query;` — sin `error`) y luego avanza el cursor **incondicionalmente** (`localStorage.setItem('dj_cloud_sync_ts', new Date().toISOString())`), incluso cuando `docs` es `undefined` por un fallo. Esos cambios no se vuelven a pedir jamás. | FX09 |
| **D5** | 🟠 Importante | **Deriva de reloj.** `updated_at` lo escribe el **cliente** (`new Date().toISOString()` dentro del upsert de `pushCloudSync`), pero el cursor del consumidor es su **propio** `new Date()`. Cualquier desfase de reloj entre caja y monitor descarta silenciosamente una ventana de escrituras. | FX10 |
| **D6** | 🟠 Importante | El monitor solo actualiza `monitor_last_sync` cuando `docs.length > 0`; combinado con D3/D5 produce pulls completos repetidos o un cursor congelado. | FX08 |
| **D7** | 🟠 Importante | `applyCloudBackup` escribe las claves LS con `localStorage.setItem` crudo bajo un comentario que afirma *"pasa por el interceptor de useCloudSync"* — ese interceptor **fue eliminado** (SEC-009 / HOOK-011). Además `registerCloudSyncSetter` **nunca se llama en producción** (solo en `tests/hooks.test.js`), así que `runWithoutEco` no silencia el `isSyncingFromCloud` local de `useCloudSync`. Restaurar un backup no republica nada: el monitor conserva el estado previo a la restauración. | FX11 |

### 2.3 Deriva de esquema — `F`

| ID | Sev | Hallazgo | Fase |
|---|---|---|---|
| **F1** | 🔴 Crítico | El status `'cancelled'` lo usan `cancelSingleCloudCmd`, `cancelAllCloudCmds` y 4 puntos de render de `OwnerMonitorView`, pero `supervisor_commands_status_check` **no lo admite** → error `23514`. **Cancelar un comando no funciona y falla en silencio.** | FX03 |
| **F2** | 🔴 Crítico | El tipo `'reopen_shift'` tiene handler completo en `useSupervisorCommands` y lo inserta `handleReopenRemoteShift`, pero `supervisor_commands_command_type_check` **no lo admite** → `23514` en el `INSERT`. **Reabrir turno remoto es una función muerta.** | FX03 |
| **F3** | 🟠 Importante | `src/constants/commandStatus.js` no tiene `CANCELLED`, y **no existe** mirror-test para `command_type` (solo para `status`). La deriva que causó F1 y F2 es invisible para CI. | FX04 |
| **F4** | 🟠 Importante | `updateCommandStatus` clasifica `23514` como no reintentable y agota los reintentos **en silencio**: un status rechazado por el esquema se ve como éxito en la UI. | FX04 |
| **F5** | 🟡 Menor | El versionado optimista (`baseUpdatedAt`) solo se envía para combos. Un `inventory_update` del monitor no lleva versión → sobrescribe ediciones concurrentes de la caja (*last-write-wins*). | FX18 |

### 2.4 Egress — `E`

| ID | Sev | Hallazgo | Fase |
|---|---|---|---|
| **E1** | 🟠 Importante | `PairingManager.handleGenerateQR` llama `forceSyncAllPOSData(deviceId)` **sin** `forceUnconditional`. Si el hash quedó envenenado por D1, el monitor recién emparejado recibe **cero datos** y ningún error. | FX12 |
| **E2** | 🟠 Importante | La compuerta de autenticación (`if (!hasAuth && !isRegisteredOrPaired)`) fue eliminada sin reemplazo: toda caja no emparejada sube su dataset completo al arrancar. Combinado con `bodega_sales_v1` fuera de `HEAVY_KEYS` y `DEBOUNCE_HEAVY_MS` 3000→2000, el egress sube de forma no acotada. | FX12 |
| **E3** | 🟡 Menor | El monitor mantiene 4 relojes simultáneos: heartbeat 60 s, health-check 10 s, catch-up de comandos 12 s y realtime. No hay backoff cuando la pestaña está oculta. | FX13 |

### 2.5 Robustez y UX — `R`

| ID | Sev | Hallazgo | Fase |
|---|---|---|---|
| **R1** | 🟠 Importante | `checkPosPresence` ignora `error`: un fallo de red o de RLS se pinta como *"Caja fuera de línea"*, indistinguible de una caída real. | FX14 |
| **R2** | 🟠 Importante | `uploadPendingChanges` hace un único `.insert(rowsToInsert)` por lote: una fila inválida rechaza el lote entero y la cola queda en estado ambiguo. | FX15 |
| **R3** | 🟠 Importante | El "francotirador" global de `initMonitor` y `handleAutoRepairPairing` (`sync_documents ORDER BY updated_at DESC LIMIT 1`) puede vincular el monitor al `device_id` de **otra tienda**. | FX16 |
| **R4** | 🟠 Importante | `loadLocalData` lee `abasto-auth-storage` y `abasto-device-session`, que **nunca** se sincronizan (y no deben hacerlo, SEC-002) → el monitor muestra información de operador vacía o rancia. | FX17 |
| **R5** | 🟡 Menor | `PairingScanScreen` sobrescribe `dj_device_id` con `'mon_' + …`. Si ese dispositivo alguna vez fue caja, sus documentos en la nube quedan huérfanos. | FX16 |
| **R6** | 🟡 Menor | `handleRemoteForceDailyClose` atribuye el cierre a `activeCashier?.nombre || 'Supervisión Remota'`; el `activeCashier` del monitor puede estar rancio → el cierre queda mal atribuido en la auditoría. | FX18 |

---

## 3. Diccionario de anclas

Ancla = fragmento **único** dentro del archivo. Localízala con `grep -n "<ancla>" <archivo>`.

| # | Elemento | Archivo | Ancla |
|---|---|---|---|
| A01 | Constraint de `command_type` | `supabase_supervisor_commands_setup.sql` | `supervisor_commands_command_type_check` |
| A02 | Constraint de `status` | `supabase_supervisor_commands_setup.sql` | `supervisor_commands_status_check` |
| A03 | Función de autorización | `supabase_supervisor_commands_setup.sql` | `CREATE OR REPLACE FUNCTION public.is_authorized_monitor` |
| A04 | Política SELECT de comandos | `supabase_supervisor_commands_setup.sql` | `"supervisor_commands_pair_select"` |
| A05 | Política UPDATE de comandos | `supabase_supervisor_commands_setup.sql` | `"supervisor_commands_pair_update"` |
| A06 | Heartbeat de caja | `supabase_multisupervisor_setup.sql` | `CREATE OR REPLACE FUNCTION public.touch_pos_heartbeat` |
| A07 | Auto-healing de token | `supabase_multisupervisor_setup.sql` | `CREATE OR REPLACE FUNCTION public.generate_monitor_token` |
| A08 | Auto-healing de emparejamiento | `supabase_multisupervisor_setup.sql` | `CREATE OR REPLACE FUNCTION public.pair_additional_monitor` |
| A09 | Heartbeat de monitor | `supabase_multisupervisor_setup.sql` | `CREATE OR REPLACE FUNCTION public.touch_monitor_heartbeat` |
| A10 | Enum de estados | `src/constants/commandStatus.js` | `export const COMMAND_STATUS` |
| A11 | Upsert de la caja | `src/hooks/useCloudSync.js` | `const { error } = await supabaseCloud.from('sync_documents').upsert({` |
| A12 | Hash tras push (IDB, force) | `src/hooks/useCloudSync.js` | `await pushCloudSync(key, val);` |
| A13 | Pull de la caja | `src/hooks/useCloudSync.js` | `const { data: docs } = await query;` |
| A14 | Cursor de la caja | `src/hooks/useCloudSync.js` | `localStorage.setItem('dj_cloud_sync_ts', new Date().toISOString());` |
| A15 | Rate limiter del monitor | `src/hooks/useMonitorSync.js` | `MONITOR_FULL_PULL_MIN_INTERVAL_MS` |
| A16 | Bucle de aplicación | `src/hooks/useMonitorSync.js` | `for (const doc of docs) {` |
| A17 | Presencia de la caja | `src/hooks/useMonitorSync.js` | `const checkPosPresence = useCallback(async () => {` |
| A18 | Francotirador del monitor | `src/hooks/useMonitorSync.js` | `.eq('doc_id', 'bodega_sales_v1')` |
| A19 | Adaptador persist | `src/hooks/store/useAuthStore.js` | `setItem: (name, value) => {` |
| A20 | Publicador de catálogo | `src/components/Settings/UsersManager.jsx` | `const publishUserCatalog = async (users) => {` |
| A21 | Escritura cruda del catálogo | `src/components/Settings/UsersManager.jsx` | `localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(fresh))` |
| A22 | Envío de PIN remoto | `src/components/Settings/UsersManager.jsx` | `pushRemoteUserCmd('change_pin'` |
| A23 | Handler `user_update` | `src/hooks/useSupervisorCommands.js` | `const { action, userId, newPin, nombre, rol, bypassPin } = command.payload \|\| {};` |
| A24 | Restauración de backup | `src/hooks/useCloudBackup.js` | `if (backup.data.ls) {` |
| A25 | Registro anti-eco | `src/utils/syncFlags.js` | `registerCloudSyncSetter` |
| A26 | Sync al generar QR | `src/components/Settings/PairingManager.jsx` | `forceSyncAllPOSData(deviceId).catch(() => {});` |
| A27 | Subida de cola | `src/views/OwnerMonitorView.jsx` | `const uploadPendingChanges` |
| A28 | Auto-reparación | `src/views/OwnerMonitorView.jsx` | `const handleAutoRepairPairing` |
| A29 | Cierre remoto | `src/views/OwnerMonitorView.jsx` | `const handleRemoteForceDailyClose` |
| A30 | Datos locales del monitor | `src/views/OwnerMonitorView.jsx` | `const loadLocalData` |

---

## 4. Orden de ejecución

El orden **no es negociable**. Cada fase asume que las anteriores están aplicadas.

```
FX00  Línea base y congelación del árbol           (sin cambios de código)
  │
  ├── BLOQUE SQL — solo escribe .sql, no despliega
  │   FX01  Cerrar suplantación de anon             S1 S2 S3 S7
  │   FX02  RLS de supervisor_commands por monitor  S6
  │   FX03  CHECKs: 'cancelled' y 'reopen_shift'    F1 F2
  │
  ├── BLOQUE ESPEJO — depende de FX03
  │   FX04  Constantes + mirror-tests               F3 F4
  │
  ├── BLOQUE PIN — independiente
  │   FX05  El PIN no sale del dispositivo (local)  S4
  │   FX06  El PIN no viaja en los comandos         S5
  │
  ├── BLOQUE CONTABILIDAD DE SYNC — el núcleo
  │   FX07  pushCloudSync dueño único del hash      D1
  │   FX08  Pull del monitor resiliente             D2 D6
  │   FX09  Los cursores no se queman ante fallo    D3 D4
  │   FX10  updated_at autoritativo del servidor    D5
  │   FX11  Anti-eco realmente conectado            D7
  │
  ├── BLOQUE EGRESS — depende de FX07
  │   FX12  Emparejamiento incondicional + tope     E1 E2
  │   FX13  Relojes del monitor consolidados        E3
  │
  └── BLOQUE ROBUSTEZ
      FX14  Errores visibles, no falso "offline"    R1
      FX15  Insert fila a fila con reporte          R2
      FX16  Eliminar el francotirador global        R3 R5
      FX17  El monitor no lee claves no sincronizadas R4
      FX18  Atribución y versionado optimista       R6 F5
```

**Dependencias duras:**
- `FX04` **requiere** `FX03` (el mirror-test lee el `.sql`).
- `FX12` **requiere** `FX07` (el `forceUnconditional` no sirve si el hash sigue envenenándose).
- `FX09` **requiere** `FX07` (comparten el bloque de auto-recuperación de `useCloudSync`).
- Todo lo demás es independiente y puede omitirse sin romper el resto.

---

## 5. Fases

---

### FX00 — Línea base y congelación del árbol de trabajo

**Hallazgos:** ninguno. **Cambios de código:** ninguno.
**Por qué es obligatoria:** las anclas de este plan se tomaron del árbol de trabajo actual, con 12 archivos modificados sin commitear. Sin este paso no hay forma de distinguir una regresión introducida por el plan de un cambio preexistente.

#### Pasos

**FX00.1 — Registrar el estado exacto**
```bash
git rev-parse HEAD > /tmp/dj_baseline_head.txt
git status --short > /tmp/dj_baseline_status.txt
git diff > /tmp/dj_baseline_uncommitted.patch
cat /tmp/dj_baseline_head.txt
```
Copia la salida al reporte final.

**FX00.2 — Rama de trabajo**
```bash
git checkout -b fix/sync-supervisor-audit
```
Si la rama ya existe, usa `git checkout fix/sync-supervisor-audit`. **No trabajes sobre `main`.**

**FX00.3 — Commitear los cambios preexistentes por separado**

Los 12 archivos modificados **no son parte de este plan**, pero deben quedar registrados para que los diffs posteriores sean legibles.
```bash
git add -A
git commit -m "chore: snapshot del arbol de trabajo previo a la auditoria de sync supervisor"
```
> Si el usuario prefiere no commitear ese trabajo en curso, la alternativa aceptable es `git stash push -m "pre-audit"` — **pero entonces DETENTE y reporta**, porque las anclas de `useCloudSync.js`, `useMonitorSync.js` y `OwnerMonitorView.jsx` dejarán de coincidir y el plan no es ejecutable tal cual.

**FX00.4 — Línea base de pruebas (puede tardar varios minutos)**
```bash
npx vitest run --reporter=dot --testTimeout=30000 2>&1 | tail -40
```
Registra **literalmente** el resumen (`N passed | M failed`). No asumas verde.
- Si hay fallos preexistentes: anótalos en una lista llamada **FALLOS-BASE**. Al final de cada fase, el criterio de éxito es *"no aparecen fallos nuevos respecto a FALLOS-BASE"*, no *"todo verde"*.

**FX00.5 — Línea base de lint y build**
```bash
npx eslint --no-cache src/hooks/useCloudSync.js src/hooks/useMonitorSync.js src/hooks/useSupervisorCommands.js src/views/OwnerMonitorView.jsx 2>&1 | tail -30
npm run build 2>&1 | tail -20
```
Registra los errores preexistentes como **LINT-BASE**.

> **Nota conocida:** `react-hooks/preserve-manual-memoization` en `OwnerMonitorView.jsx` (ancla `const projectedProducts = useMemo(() => {`) es un error de lint **preexistente y fuera de alcance**. No lo arregles.

#### HARNESS
Ninguno (esta fase *produce* la línea base).

#### COMMIT
`chore: snapshot del arbol de trabajo previo a la auditoria de sync supervisor`

---

### FX01 — SQL: cerrar el vector de suplantación de `anon`

**Hallazgos:** S1, S2, S3, S7 · **Severidad:** 🔴 Crítico
**Archivos:** crea `supabase_sync_supervisor_hardening.sql` (**archivo nuevo**). No modifica ningún `.sql` existente.

#### Contexto — la cadena de ataque completa

1. Un atacante con la anon key (que va embebida en el bundle del PWA, por diseño) llama `touch_pos_heartbeat('cualquier_id')`.
2. Esa RPC es `SECURITY DEFINER` y hace `INSERT INTO device_pairings`. Ahora existe la fila.
3. `sync_documents_anon_access` concede `FOR ALL TO anon` a los documentos de ese `device_id`.
4. `is_authorized_monitor(p_primary, p_monitor)` devuelve `true` por su tercera cláusula, que **solo** comprueba que exista la fila del paso 2.
5. → El atacante inserta comandos `rate_change`, `void_sale`, `user_update`, `inventory_update` y `force_daily_close` contra esa caja.

En paralelo, `generate_monitor_token('cualquier_cosa')` cae al *auto-healing* y devuelve un token de 6 caracteres **de la caja más activa del sistema**, con el que `pair_additional_monitor` convierte al atacante en supervisor legítimo.

#### Decisión de diseño

No se puede introducir Supabase Auth en este plan (la app entera opera como `anon` y eso está fuera de alcance). La mitigación consiste en:

- **Quitar la autoconcesión.** `touch_pos_heartbeat` deja de poder **crear** filas: solo actualiza filas ya existentes. El emparejamiento inicial pasa a ser el único camino que crea la fila.
- **Eliminar los comodines.** `is_authorized_monitor` exige una fila **real y no revocada** en `device_monitors`, o el par exacto en `device_pairings`.
- **Eliminar el auto-healing global.** Si la caja del token no está activa, se devuelve error, no otra caja.
- **Hacer exigible la revocación.** `touch_monitor_heartbeat` devuelve `is_revoked:true` cuando el dispositivo no está registrado, y `unpair_monitor` escribe `revoked_at`.

Crea el archivo con **exactamente** este contenido:

````sql
-- supabase_sync_supervisor_hardening.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Auditoría de sincronización Monitor ↔ Caja — endurecimiento del canal.
-- Cubre S1, S2, S3, S6 y S7 de PLAN_FIXES_SYNC_SUPERVISOR.md.
--
-- IDEMPOTENTE: puede ejecutarse tantas veces como haga falta.
-- ORDEN DE EJECUCIÓN: después de supabase_pairing_setup.sql,
--                     supabase_multisupervisor_setup.sql y
--                     supabase_supervisor_commands_setup.sql.
--
-- CONTEXTO: la aplicación opera íntegramente como el rol `anon` (no hay sesión
-- de Supabase Auth). La autorización se deriva de las filas de device_pairings
-- y device_monitors. Por eso ninguna RPC concedida a `anon` puede CREAR una
-- autorización: solo puede consumir una que ya exista.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- S1 — touch_pos_heartbeat deja de poder crear filas de emparejamiento.
--      Antes: INSERT ... ON CONFLICT DO UPDATE  → cualquier anon se autoconcedía
--             una fila en device_pairings y con ella acceso total a esa caja.
--      Ahora: UPDATE puro. Si la caja no está registrada, devuelve success:false
--             y la app debe pasar por el flujo de emparejamiento normal.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.touch_pos_heartbeat(p_device_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows INT;
BEGIN
    IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
        RETURN json_build_object('success', false, 'message', 'device_id requerido.');
    END IF;

    UPDATE public.device_pairings
    SET last_seen_at = now()
    WHERE primary_device_id = p_device_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 0 THEN
        -- S1: NO se crea la fila. Una caja sin registro previo no obtiene
        -- autorización por el simple hecho de latir.
        RETURN json_build_object('success', false, 'registered', false,
                                 'message', 'Dispositivo no registrado.');
    END IF;

    RETURN json_build_object('success', true, 'registered', true);
END; $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S1b — La caja se autorregistra UNA sola vez, de forma explícita y sin token.
--       Se separa del heartbeat para que el registro sea un acto deliberado y
--       auditable, y para que no ocurra en cada latido.
--       Sigue siendo alcanzable por anon (la caja no tiene otra identidad), pero
--       ya no es un efecto colateral silencioso: solo crea la fila si NO existe.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.register_pos_device(p_device_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
        RETURN json_build_object('success', false, 'message', 'device_id requerido.');
    END IF;

    INSERT INTO public.device_pairings (primary_device_id, last_seen_at, paired_at)
    VALUES (p_device_id, now(), now())
    ON CONFLICT (primary_device_id) DO UPDATE
    SET last_seen_at = now();

    RETURN json_build_object('success', true);
END; $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S2 — is_authorized_monitor sin comodines.
--      Antes terminaba en `OR EXISTS (SELECT 1 FROM device_pairings dp
--      WHERE dp.primary_device_id = p_primary)`, que ignora al monitor por
--      completo y hace que la función devuelva true para cualquiera.
--      También aceptaba p_monitor='monitor_web' y monitor_device_id IS NULL.
--      Ahora exige una pertenencia real y vigente.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.is_authorized_monitor(p_primary TEXT, p_monitor TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT
        p_primary IS NOT NULL
        AND p_monitor IS NOT NULL
        AND btrim(p_monitor) <> ''
        AND (
            -- Monitor multisupervisor vigente de esa caja
            EXISTS (
                SELECT 1 FROM public.device_monitors dm
                WHERE dm.primary_device_id = p_primary
                  AND dm.monitor_device_id = p_monitor
                  AND dm.revoked_at IS NULL
            )
            -- Monitor legacy 1-a-1, par exacto
            OR EXISTS (
                SELECT 1 FROM public.device_pairings dp
                WHERE dp.primary_device_id = p_primary
                  AND dp.monitor_device_id = p_monitor
            )
            -- La propia caja actuando sobre sus comandos
            OR p_primary = p_monitor
        );
$$;

GRANT EXECUTE ON FUNCTION public.is_authorized_monitor(TEXT, TEXT) TO anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- S3 — Se elimina el auto-healing que entrega la caja más activa del sistema.
--      Antes, si la caja solicitante estaba inactiva > 1 día, ambas funciones
--      caían a `SELECT device_id FROM sync_documents ORDER BY updated_at DESC
--      LIMIT 1` — es decir, la caja más activa de CUALQUIER tienda.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.generate_monitor_token(p_requester_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_primary TEXT;
    v_token   TEXT;
BEGIN
    IF p_requester_id IS NULL OR btrim(p_requester_id) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Solicitante no válido.');
    END IF;

    -- El solicitante debe ser la caja misma o un monitor vigente de esa caja.
    SELECT primary_device_id INTO v_primary
    FROM public.device_monitors
    WHERE monitor_device_id = p_requester_id AND revoked_at IS NULL
    LIMIT 1;

    IF v_primary IS NULL THEN
        SELECT primary_device_id INTO v_primary
        FROM public.device_pairings
        WHERE primary_device_id = p_requester_id;
    END IF;

    -- S3: sin fallback global. Si no hay pertenencia, se rechaza.
    IF v_primary IS NULL THEN
        RETURN json_build_object('success', false,
            'message', 'No autorizado para generar códigos de vinculación.');
    END IF;

    v_token := upper(substring(md5(random()::text) from 1 for 6));

    UPDATE public.device_pairings
    SET pairing_token = v_token,
        token_expires_at = now() + interval '10 minutes'
    WHERE primary_device_id = v_primary;

    RETURN json_build_object('success', true, 'token', v_token,
                             'primary_device_id', v_primary);
END; $$;

CREATE OR REPLACE FUNCTION public.pair_additional_monitor(
    p_token TEXT,
    p_monitor_device_id TEXT,
    p_label TEXT DEFAULT 'Supervisor Remoto',
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_primary      TEXT;
    v_active_count INT;
BEGIN
    IF p_monitor_device_id IS NULL OR btrim(p_monitor_device_id) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Dispositivo no válido.');
    END IF;

    SELECT primary_device_id INTO v_primary
    FROM public.device_pairings
    WHERE pairing_token = upper(btrim(p_token))
      AND token_expires_at > now();

    -- S3: sin auto-healing. Token inválido o expirado = rechazo.
    IF v_primary IS NULL THEN
        RETURN json_build_object('success', false,
            'message', 'Código de vinculación inválido o expirado.');
    END IF;

    SELECT count(*) INTO v_active_count
    FROM public.device_monitors
    WHERE primary_device_id = v_primary
      AND revoked_at IS NULL
      AND monitor_device_id != p_monitor_device_id;

    IF v_active_count >= 4 THEN
        RETURN json_build_object('success', false,
            'message', 'Límite de monitores activos alcanzado (máximo 4 por caja).');
    END IF;

    INSERT INTO public.device_monitors
        (primary_device_id, monitor_device_id, device_label, user_agent,
         paired_at, last_seen_at, revoked_at)
    VALUES
        (v_primary, p_monitor_device_id,
         COALESCE(nullif(btrim(p_label), ''), 'Supervisor Remoto'),
         p_user_agent, now(), now(), NULL)
    ON CONFLICT (primary_device_id, monitor_device_id) DO UPDATE
    SET device_label = COALESCE(nullif(btrim(EXCLUDED.device_label), ''),
                                device_monitors.device_label),
        user_agent   = COALESCE(EXCLUDED.user_agent, device_monitors.user_agent),
        last_seen_at = now(),
        revoked_at   = NULL;

    UPDATE public.device_pairings
    SET monitor_device_id = p_monitor_device_id,
        paired_at = now()
    WHERE primary_device_id = v_primary
      AND (monitor_device_id IS NULL OR monitor_device_id = p_monitor_device_id);

    -- Consumir el token: un token = un emparejamiento.
    UPDATE public.device_pairings
    SET pairing_token = NULL, token_expires_at = NULL
    WHERE primary_device_id = v_primary;

    RETURN json_build_object('success', true, 'primary_device_id', v_primary);
END; $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S7 — La revocación se vuelve exigible.
--      Antes, un dispositivo desconocido recibía is_revoked:false ("no revocar
--      por defecto"), de modo que borrar la fila NO expulsaba al monitor.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.touch_monitor_heartbeat(p_monitor_device_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_id UUID;
    v_revoked   TIMESTAMPTZ;
BEGIN
    IF p_monitor_device_id IS NULL OR btrim(p_monitor_device_id) = '' THEN
        RETURN json_build_object('success', false, 'is_revoked', true);
    END IF;

    SELECT id, revoked_at INTO v_target_id, v_revoked
    FROM public.device_monitors
    WHERE monitor_device_id = p_monitor_device_id
    ORDER BY (revoked_at IS NULL) DESC, last_seen_at DESC
    LIMIT 1;

    IF v_target_id IS NOT NULL THEN
        IF v_revoked IS NOT NULL THEN
            RETURN json_build_object('success', true, 'is_revoked', true);
        END IF;

        UPDATE public.device_monitors SET last_seen_at = now() WHERE id = v_target_id;
        RETURN json_build_object('success', true, 'is_revoked', false);
    END IF;

    -- Monitor legacy 1-a-1 registrado en device_pairings.
    IF EXISTS (
        SELECT 1 FROM public.device_pairings
        WHERE monitor_device_id = p_monitor_device_id
    ) THEN
        RETURN json_build_object('success', true, 'is_revoked', false);
    END IF;

    -- S7: desconocido = revocado. Es la única forma de que expulsar funcione.
    RETURN json_build_object('success', true, 'is_revoked', true);
END; $$;

-- S7b — unpair_monitor marca revoked_at para que device_monitors no siga
--       autorizando al dispositivo desvinculado.
CREATE OR REPLACE FUNCTION public.unpair_monitor(p_device_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_monitor TEXT;
BEGIN
    SELECT monitor_device_id INTO v_monitor
    FROM public.device_pairings
    WHERE primary_device_id = p_device_id;

    UPDATE public.device_pairings
    SET monitor_device_id = NULL,
        pairing_token = NULL,
        token_expires_at = NULL
    WHERE primary_device_id = p_device_id;

    -- S7: la desvinculación debe revocar también en device_monitors.
    UPDATE public.device_monitors
    SET revoked_at = now()
    WHERE primary_device_id = p_device_id
      AND revoked_at IS NULL;

    RETURN json_build_object('success', true, 'unpaired_monitor', v_monitor);
END; $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Permisos (idempotentes)
-- ═════════════════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.touch_pos_heartbeat(TEXT)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_pos_device(TEXT)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_monitor_token(TEXT)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_monitor_heartbeat(TEXT)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unpair_monitor(TEXT)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pair_additional_monitor(TEXT, TEXT, TEXT, TEXT)
    TO anon, authenticated;
````

#### HARNESS
```bash
# 1. El archivo existe y no quedó vacío
test -s supabase_sync_supervisor_hardening.sql && echo "OK: archivo presente"

# 2. Cada bloque $$ está cerrado (número PAR de delimitadores)
grep -c '\$\$' supabase_sync_supervisor_hardening.sql
#    → debe ser un número PAR. Si es impar, falta un cierre: DETENTE.

# 3. No queda ningún fallback global
grep -n "ORDER BY updated_at DESC" supabase_sync_supervisor_hardening.sql
#    → NO debe devolver nada.

# 4. No queda ningún comodín de autorización
grep -n "monitor_web" supabase_sync_supervisor_hardening.sql
#    → NO debe devolver nada.

# 5. Los .sql originales no fueron tocados
git diff --name-only | grep -E "supabase_(pairing|multisupervisor|supervisor_commands)_setup\.sql"
#    → NO debe devolver nada.
```
Si (2) es impar o (3)/(4)/(5) devuelven algo → **DETENTE**.

#### RIESGO Y ROLLBACK
- **Riesgo funcional:** al dejar de crear filas, una caja legítima que nunca se emparejó dejará de latir. Por eso se añade `register_pos_device`. La fase **FX12** conecta la app a esa RPC. Si despliegas FX01 sin FX12, las cajas nuevas no se registran.
- **Rollback:** el archivo es nuevo; `git revert` del commit lo elimina. En base de datos, reejecutar `supabase_multisupervisor_setup.sql` y `supabase_supervisor_commands_setup.sql` restaura las definiciones previas.

#### COMMIT
`fix(security): cerrar suplantacion anon en el canal monitor-caja (S1,S2,S3,S7)`

---

### FX02 — SQL: RLS de `supervisor_commands` por monitor

**Hallazgos:** S6 · **Severidad:** 🟠 Importante
**Archivo:** añade al final de `supabase_sync_supervisor_hardening.sql` (creado en FX01).

#### Contexto
`supervisor_commands_pair_select` y `_pair_update` solo comprueban `EXISTS (SELECT 1 FROM device_pairings dp WHERE dp.primary_device_id = supervisor_commands.primary_device_id)`. Es decir: **basta con que la caja exista**. Consecuencias:
- Cualquier `anon` lee todos los comandos de cualquier caja — incluido `payload.newPin` (ver S5).
- Cualquier `anon` puede hacer `UPDATE ... SET status='applied'` sobre comandos `pending`, neutralizando órdenes del supervisor sin que nadie lo note.

#### Edición

**ANCLA:** el final del archivo creado en FX01 (la última línea `    TO anon, authenticated;`).

Añade **al final** del archivo:

````sql

-- ═════════════════════════════════════════════════════════════════════════════
-- S6 — RLS de supervisor_commands ligada al par caja↔monitor real.
--      Antes bastaba que existiera la caja en device_pairings; ahora se exige
--      que el lector/escritor sea la propia caja o un monitor vigente de ella.
--      is_authorized_monitor ya está endurecida por S2 y es SECURITY DEFINER,
--      así que puede leer device_monitors aunque anon no tenga SELECT directo.
-- ═════════════════════════════════════════════════════════════════════════════

-- Lectura: la caja lee lo suyo; el monitor lee lo que él mismo emitió.
DROP POLICY IF EXISTS "supervisor_commands_pair_select" ON public.supervisor_commands;
CREATE POLICY "supervisor_commands_pair_select" ON public.supervisor_commands
    FOR SELECT
    TO anon, authenticated
    USING (
        public.is_authorized_monitor(
            supervisor_commands.primary_device_id,
            supervisor_commands.monitor_device_id
        )
    );

-- Escritura de status: solo la caja destinataria cierra sus comandos.
-- El monitor NO puede marcar 'applied'; solo puede cancelar los suyos (FX03).
DROP POLICY IF EXISTS "supervisor_commands_pair_update" ON public.supervisor_commands;
CREATE POLICY "supervisor_commands_pair_update" ON public.supervisor_commands
    FOR UPDATE
    TO anon, authenticated
    USING (
        public.is_authorized_monitor(
            supervisor_commands.primary_device_id,
            supervisor_commands.monitor_device_id
        )
    )
    WITH CHECK (
        public.is_authorized_monitor(
            supervisor_commands.primary_device_id,
            supervisor_commands.monitor_device_id
        )
    );

-- Inserción: solo un monitor vigente emite comandos hacia su caja.
DROP POLICY IF EXISTS "supervisor_commands_monitor_insert" ON public.supervisor_commands;
CREATE POLICY "supervisor_commands_monitor_insert" ON public.supervisor_commands
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        public.is_authorized_monitor(
            supervisor_commands.primary_device_id,
            supervisor_commands.monitor_device_id
        )
        AND supervisor_commands.status = 'pending'
    );

GRANT SELECT, INSERT, UPDATE ON public.supervisor_commands TO anon, authenticated;
````

#### HARNESS
```bash
# Las 3 políticas están definidas y cada una pasa por is_authorized_monitor
grep -c "is_authorized_monitor" supabase_sync_supervisor_hardening.sql
#   → debe ser >= 8  (1 definición + 1 grant + 6 usos en políticas)

grep -n "supervisor_commands_pair_select\|supervisor_commands_pair_update\|supervisor_commands_monitor_insert" \
  supabase_sync_supervisor_hardening.sql
#   → 6 líneas (DROP + CREATE por cada una)

grep -c '\$\$' supabase_sync_supervisor_hardening.sql
#   → sigue siendo PAR
```

#### RIESGO Y ROLLBACK
- **Riesgo:** si en producción hay filas con `monitor_device_id` nulo o con el valor literal `'monitor_web'`, dejarán de ser legibles. Ejecuta primero la consulta de diagnóstico de la [sección 8.3](#83-diagnóstico-previo-obligatorio).
- **Rollback:** reejecutar `supabase_supervisor_commands_setup.sql` restaura las políticas permisivas.

#### COMMIT
`fix(security): ligar RLS de supervisor_commands al par caja-monitor real (S6)`

---

### FX03 — SQL: admitir `cancelled` y `reopen_shift`

**Hallazgos:** F1, F2 · **Severidad:** 🔴 Crítico
**Archivo:** `supabase_supervisor_commands_setup.sql` (**modificación in situ** — es la fuente de verdad que leen los mirror-tests).

#### Contexto
Dos funciones de la UI están **muertas a nivel de esquema**:
- `cancelSingleCloudCmd` / `cancelAllCloudCmds` hacen `update({ status: 'cancelled' })` → Postgres responde `23514` porque el CHECK no lo admite. El botón "Cancelar" no hace nada y no reporta nada.
- `handleReopenRemoteShift` inserta `command_type: 'reopen_shift'`, que el CHECK tampoco admite → `23514` en el INSERT, pese a que `useSupervisorCommands` **sí** tiene el handler implementado.

#### Edición 1 — `command_type`

**ANCLA:** `supervisor_commands_command_type_check`

**ANTES**
```sql
    CHECK (command_type IN ('rate_change', 'inventory_update', 'void_sale', 'user_update', 'force_daily_close'));
```

**DESPUÉS**
```sql
    CHECK (command_type IN ('rate_change', 'inventory_update', 'void_sale', 'user_update', 'force_daily_close', 'reopen_shift'));
```

#### Edición 2 — `status`

**ANCLA:** `supervisor_commands_status_check`

**ANTES**
```sql
    CHECK (status IN ('pending', 'applied', 'applied_with_warnings', 'failed'));
```

**DESPUÉS**
```sql
    CHECK (status IN ('pending', 'applied', 'applied_with_warnings', 'failed', 'cancelled'));
```

> **Nota de formato crítica:** el mirror-test parsea estas líneas con una expresión regular. **No** las partas en varias líneas, **no** añadas comentarios dentro del paréntesis y **no** cambies las comillas simples por dobles.

#### HARNESS
```bash
grep -n "CHECK (command_type IN" supabase_supervisor_commands_setup.sql
#   → debe contener 'reopen_shift'
grep -n "CHECK (status IN" supabase_supervisor_commands_setup.sql
#   → debe contener 'cancelled'

# El mirror-test EXISTENTE debe FALLAR ahora (todavía no hemos tocado el JS).
npx vitest run tests/commandStatus.test.js
#   → SE ESPERA UN FALLO. Es la señal de que el espejo detecta la deriva.
#     Lo arregla FX04. Si PASA, el test no está leyendo el archivo: DETENTE.
```

> ⚠️ **Esta es la única fase del plan cuyo arnés espera un fallo.** No hagas commit de FX03 en solitario si tu flujo exige verde: encadena inmediatamente con FX04 y haz los dos commits seguidos.

#### RIESGO Y ROLLBACK
- Ampliar un CHECK nunca invalida filas existentes: la migración es segura y no requiere ventana de mantenimiento.
- **Rollback:** `git revert` del commit + reejecutar el `.sql` (los `DROP CONSTRAINT IF EXISTS` lo hacen idempotente).

#### COMMIT
`fix(schema): admitir status cancelled y command_type reopen_shift (F1,F2)`

---

### FX04 — Constantes espejo y arneses anti-deriva

**Hallazgos:** F3, F4 · **Severidad:** 🟠 Importante · **Depende de:** FX03
**Archivos:** `src/constants/commandStatus.js`, `src/constants/commandType.js` (**nuevo**), `tests/commandStatus.test.js`, `tests/commandType.test.js` (**nuevo**), `src/hooks/useSupervisorCommands.js`

Esta fase es el **guardarraíl permanente**: impide que F1 y F2 vuelvan a ocurrir. Sin ella, cualquier futuro cambio del CHECK vuelve a pasar desapercibido.

#### Edición 1 — `src/constants/commandStatus.js`

**ANCLA:** `export const COMMAND_STATUS`

**ANTES**
```js
export const COMMAND_STATUS = Object.freeze({
    PENDING: 'pending',
    APPLIED: 'applied',
    APPLIED_WITH_WARNINGS: 'applied_with_warnings',
    FAILED: 'failed',
});
```

**DESPUÉS**
```js
export const COMMAND_STATUS = Object.freeze({
    PENDING: 'pending',
    APPLIED: 'applied',
    APPLIED_WITH_WARNINGS: 'applied_with_warnings',
    FAILED: 'failed',
    // F1: la UI del monitor ya emitía 'cancelled' (cancelSingleCloudCmd /
    // cancelAllCloudCmds); el CHECK de Postgres lo rechazaba con 23514.
    CANCELLED: 'cancelled',
});
```

#### Edición 2 — `src/constants/commandType.js` (archivo nuevo)

Crea el archivo con **exactamente** este contenido:

```js
/**
 * src/constants/commandType.js
 *
 * ESPEJO EXACTO de `supervisor_commands_command_type_check`
 * en `supabase_supervisor_commands_setup.sql`.
 *
 * F2/F3: 'reopen_shift' tenía handler en useSupervisorCommands y emisor en
 * OwnerMonitorView, pero el CHECK de Postgres lo rechazaba (23514) y nadie
 * lo notaba porque no existía un test espejo para command_type.
 *
 * REGLA: si añades un tipo aquí, añádelo también al CHECK del .sql.
 * `tests/commandType.test.js` falla si ambos se separan.
 */
export const COMMAND_TYPE = Object.freeze({
    RATE_CHANGE: 'rate_change',
    INVENTORY_UPDATE: 'inventory_update',
    VOID_SALE: 'void_sale',
    USER_UPDATE: 'user_update',
    FORCE_DAILY_CLOSE: 'force_daily_close',
    REOPEN_SHIFT: 'reopen_shift',
});

export const VALID_COMMAND_TYPES = Object.freeze(Object.values(COMMAND_TYPE));
```

#### Edición 3 — `tests/commandType.test.js` (archivo nuevo)

Copia literal del patrón ya validado en `tests/commandStatus.test.js`:

```js
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { VALID_COMMAND_TYPES } from '../src/constants/commandType';

describe('Command Type Mirror Test', () => {
    test('VALID_COMMAND_TYPES matches PostgreSQL supervisor_commands_command_type_check constraint 1-to-1', () => {
        const sqlPath = path.resolve(__dirname, '../supabase_supervisor_commands_setup.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

        const match = sqlContent.match(/supervisor_commands_command_type_check[\s\S]*?CHECK\s*\(\s*command_type\s+IN\s*\(([^)]+)\)\s*\)/i);
        expect(match).not.toBeNull();

        const sqlTypes = match[1]
            .split(',')
            .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);

        expect(sqlTypes.sort()).toEqual([...VALID_COMMAND_TYPES].sort());
    });
});
```

#### Edición 4 — Guardarraíl: nadie emite literales fuera del enum

Añade **al final** de `tests/commandStatus.test.js`, **dentro** del `describe` existente (justo antes de la última línea `});`):

**ANCLA:** `expect(sqlStatuses.sort()).toEqual([...VALID_COMMAND_STATUSES].sort());`

**ANTES**
```js
        expect(sqlStatuses.sort()).toEqual([...VALID_COMMAND_STATUSES].sort());
    });
});
```

**DESPUÉS**
```js
        expect(sqlStatuses.sort()).toEqual([...VALID_COMMAND_STATUSES].sort());
    });

    // F3: ningún literal de status emitido por el código puede quedar fuera del
    // enum. Este test es el que habría cazado F1 ('cancelled') el primer día.
    test('no source file writes a supervisor_commands status literal outside the enum', () => {
        const roots = [
            path.resolve(__dirname, '../src/views/OwnerMonitorView.jsx'),
            path.resolve(__dirname, '../src/hooks/useSupervisorCommands.js'),
        ];
        const emitted = new Set();
        for (const file of roots) {
            const src = fs.readFileSync(file, 'utf-8');
            for (const m of src.matchAll(/status:\s*'([a-z_]+)'/g)) emitted.add(m[1]);
            for (const m of src.matchAll(/updateCommandStatus\([^,]+,\s*'([a-z_]+)'/g)) emitted.add(m[1]);
        }
        const unknown = [...emitted].filter(s => !VALID_COMMAND_STATUSES.includes(s));
        expect(unknown).toEqual([]);
    });
});
```

#### Edición 5 — F4: no tragarse el `23514`

**Archivo:** `src/hooks/useSupervisorCommands.js`
**ANCLA:** `23514`

Localiza el bloque que clasifica los códigos no reintentables:
```bash
grep -n "23514" src/hooks/useSupervisorCommands.js
```

Añade un log explícito **inmediatamente después** de la comprobación que trata `23514` como no reintentable. El objetivo es que una deriva de esquema deje rastro en consola en vez de fingir éxito:

```js
                    // F4: 23514 = CHECK violado. Casi siempre significa que el
                    // .sql y el JS se separaron (ver tests/commandStatus.test.js
                    // y tests/commandType.test.js). Nunca es un fallo transitorio.
                    console.error(
                        `[SupervisorCommands] DERIVA DE ESQUEMA: Postgres rechazó ` +
                        `status='${status}' para el comando ${commandId} (23514). ` +
                        `Revisa supervisor_commands_status_check.`
                    );
```

> Ajusta los nombres `status` y `commandId` a los identificadores reales de esa función (léelos del código; son los parámetros de `updateCommandStatus`). Si los nombres no coinciden, **usa los reales** — es la única sustitución de nombres permitida en todo el plan.

#### HARNESS
```bash
npx vitest run tests/commandStatus.test.js tests/commandType.test.js
#   → 3 tests, todos en verde. Si commandType falla, revisa que FX03 esté aplicada.

npx eslint --no-cache src/constants/commandStatus.js src/constants/commandType.js src/hooks/useSupervisorCommands.js
#   → sin errores nuevos respecto a LINT-BASE

# Guardarraíl invertido: rompe el espejo a propósito y confirma que el test lo caza.
sed -i "s/, 'cancelled'));/));/" supabase_supervisor_commands_setup.sql
npx vitest run tests/commandStatus.test.js   # DEBE FALLAR
git checkout -- supabase_supervisor_commands_setup.sql
npx vitest run tests/commandStatus.test.js   # DEBE PASAR
```
Si el test **no** falla al romper el espejo, el arnés no sirve → **DETENTE y reporta**.

#### COMMIT
`test(guardrail): espejo SQL-JS para command_type y status (F3,F4)`

---

### FX05 — El PIN no sale del dispositivo (lado local)

**Hallazgos:** S4 · **Severidad:** 🔴 Crítico
**Archivos:** `src/hooks/store/useAuthStore.js`, `src/components/Settings/UsersManager.jsx`, `tests/userSanitization.test.js`

#### Contexto
`bodega_users_catalog_v1` es miembro de `LOCAL_KEYS`: `forcePushLocalData` lo sube **crudo** a `sync_documents` cada 60 s, y `sync_documents_anon_access` lo hace legible por `anon`. Existe la barrera correcta (`sanitizeUserCatalog`, que elimina `pin` y `plainPin`) y existe el único camino correcto (`publishUserCatalog`), pero **seis** escrituras lo esquivan:

1. El adaptador `persist.storage.setItem` de `useAuthStore` copia `state.usuarios` **completo** al catálogo — con el hash PBKDF2 y con `plainPin`.
2. Cinco llamadas en `UsersManager` hacen `localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(fresh))` justo antes de `publishUserCatalog(fresh)`, donde `fresh` contiene `plainPin` (lo inyectan `handleAdd` y `handleChangePin`).

**La solución es estructural: `publishUserCatalog` pasa a ser el único escritor de esa clave.**

#### Edición 1 — `src/hooks/store/useAuthStore.js`

**ANCLA:** `setItem: (name, value) => {`

**ANTES**
```js
                setItem: (name, value) => {
                    localStorage.setItem(name, JSON.stringify(value));
                    if (value && value.state && Array.isArray(value.state.usuarios)) {
                        try {
                            localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(value.state.usuarios));
                        } catch {}
                    }
                },
```

**DESPUÉS**
```js
                setItem: (name, value) => {
                    localStorage.setItem(name, JSON.stringify(value));
                    // S4/SEC-002: `bodega_users_catalog_v1` se publica en
                    // sync_documents y es legible por el rol anon. Escribir aquí
                    // `state.usuarios` en crudo filtraba el hash PBKDF2 y el PIN
                    // en claro (`plainPin`). El catálogo se escribe SANEADO y en
                    // un único lugar: `publishUserCatalog` en UsersManager.jsx.
                    if (value && value.state && Array.isArray(value.state.usuarios)) {
                        try {
                            localStorage.setItem(
                                'bodega_users_catalog_v1',
                                JSON.stringify(sanitizeUserCatalog(value.state.usuarios))
                            );
                        } catch {}
                    }
                },
```

**Import necesario.** Localiza `import { hashPin, verifyPin } from '../../utils/crypto';` y añade **justo debajo**:
```js
import { sanitizeUserCatalog } from '../../utils/userCatalog';
```
Verifica que no exista ya: `grep -n "sanitizeUserCatalog" src/hooks/store/useAuthStore.js`.

#### Edición 2 — `src/components/Settings/UsersManager.jsx`: escritor único

**ANCLA:** `const publishUserCatalog = async (users) => {`

**ANTES**
```js
    // Helper para publicar el catálogo sanitizado de usuarios en la nube (caja principal)
    const publishUserCatalog = async (users) => {
        try {
            const { pushLocalSync } = await import('../../hooks/useCloudSync');
            const { sanitizeUserCatalog } = await import('../../utils/userCatalog');
            pushLocalSync('bodega_users_catalog_v1', sanitizeUserCatalog(users));
        } catch (e) {
            console.warn('[UsersManager] No se pudo publicar el catálogo de usuarios:', e);
        }
    };
```

**DESPUÉS**
```js
    // S4/SEC-002: ÚNICO escritor de `bodega_users_catalog_v1`.
    // Esta clave viaja a sync_documents y es legible por anon, así que solo
    // puede contener la forma saneada (sin `pin` ni `plainPin`). Cualquier
    // `localStorage.setItem('bodega_users_catalog_v1', ...)` fuera de aquí es
    // una fuga; `tests/userSanitization.test.js` lo impide.
    const publishUserCatalog = async (users) => {
        try {
            const { sanitizeUserCatalog } = await import('../../utils/userCatalog');
            const safe = sanitizeUserCatalog(users);
            try {
                localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(safe));
            } catch {}
            const { pushLocalSync } = await import('../../hooks/useCloudSync');
            pushLocalSync('bodega_users_catalog_v1', safe);
        } catch (e) {
            console.warn('[UsersManager] No se pudo publicar el catálogo de usuarios:', e);
        }
    };
```

#### Edición 3 — Eliminar las 5 escrituras crudas

Son idénticas salvo la indentación. **Usa `replace_all`** — borrarlas todas es exactamente lo que se busca.

**3a.** `old_string` (12 espacios de indentación, incluye el salto de línea final) → `new_string` **vacío**, con `replace_all: true`:
```
            try { localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(fresh)); } catch {}
```

**3b.** La misma línea con **16 espacios** de indentación, `replace_all: true`, `new_string` vacío:
```
                try { localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(fresh)); } catch {}
```

**Verificación obligatoria:**
```bash
grep -n "localStorage.setItem('bodega_users_catalog_v1'" src/components/Settings/UsersManager.jsx
#   → EXACTAMENTE 1 resultado, y debe estar dentro de publishUserCatalog.
grep -c "publishUserCatalog(fresh);" src/components/Settings/UsersManager.jsx
#   → 5. Si es menos, borraste una línea de más: git checkout -- <archivo> y repite.
```

#### Edición 4 — No inyectar `plainPin` en el catálogo

`handleAdd` y `handleChangePin` construyen `fresh` con `plainPin`. Ahora `publishUserCatalog` lo sanea, así que ya no se filtra — pero `fresh` también alimenta el estado de React `syncedUsers`, y `displayUsers` se usa para detectar PINs duplicados (`u.plainPin === newPin`). **No toques esa lógica.** El saneamiento en el escritor único es suficiente y esta separación es intencional: en memoria sí, en disco y en la nube no.

#### Edición 5 — Guardarraíl

Añade al final de `tests/userSanitization.test.js`, dentro del `describe` existente:

```js
    // S4: `bodega_users_catalog_v1` viaja a sync_documents y lo lee el rol anon.
    // Solo `publishUserCatalog` puede escribirlo, y siempre saneado.
    test('bodega_users_catalog_v1 tiene un unico escritor y siempre saneado', () => {
        const files = [
            'src/components/Settings/UsersManager.jsx',
            'src/hooks/store/useAuthStore.js',
        ];
        for (const rel of files) {
            const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf-8');
            const writes = [...src.matchAll(
                /localStorage\.setItem\(\s*'bodega_users_catalog_v1'\s*,\s*([^)]*)\)/g
            )];
            for (const w of writes) {
                expect(w[1]).toContain('sanitizeUserCatalog');
            }
        }
    });

    test('sanitizeUserCatalog elimina pin y plainPin', async () => {
        const { sanitizeUserCatalog } = await import('../src/utils/userCatalog');
        const out = sanitizeUserCatalog([
            { id: 1, nombre: 'Admin', rol: 'ADMIN', pin: 'pbkdf2$x', plainPin: '123456' },
        ]);
        expect(out[0]).not.toHaveProperty('pin');
        expect(out[0]).not.toHaveProperty('plainPin');
        expect(out[0].nombre).toBe('Admin');
    });
```
Si `tests/userSanitization.test.js` no importa `fs`/`path`, añádelos arriba:
```js
import fs from 'fs';
import path from 'path';
```

#### HARNESS
```bash
npx vitest run tests/userSanitization.test.js tests/security.test.js tests/userCommandsValidation.test.js
npx eslint --no-cache src/hooks/store/useAuthStore.js src/components/Settings/UsersManager.jsx

# El catálogo ya no puede escribirse en crudo en ningún punto del código fuente
grep -rn "localStorage.setItem('bodega_users_catalog_v1'" src/ | grep -v sanitizeUserCatalog
#   → NO debe devolver nada.
```

#### RIESGO Y ROLLBACK
- **Riesgo:** los dispositivos que ya tienen un catálogo envenenado en disco seguirán teniéndolo hasta la siguiente escritura. La fase **FX12** añade una purga en el arranque.
- **Rollback:** `git revert` del commit. No hay migración de datos que deshacer.

#### COMMIT
`fix(security): el catalogo de usuarios se escribe saneado y desde un unico punto (S4)`

---

### FX06 — El PIN no viaja dentro de los comandos

**Hallazgos:** S5 · **Severidad:** 🔴 Crítico
**Archivos:** `src/components/Settings/UsersManager.jsx`, `src/hooks/useSupervisorCommands.js`, `src/hooks/store/useAuthStore.js`

#### Contexto
`pushRemoteUserCmd('change_pin', { userId, newPin: pinValue })` mete el PIN **en claro** en `supervisor_commands.payload`. Esa fila es legible por `anon` (mitigado, no eliminado, por FX02) y queda **persistida indefinidamente** en la tabla. Lo mismo ocurre en `action: 'add'`.

#### Decisión de diseño
El monitor hashea el PIN **antes** de emitir el comando, usando `hashPin` de `src/utils/crypto.js` — el mismo helper PBKDF2 que usa la caja, disponible en ambos dispositivos porque es WebCrypto puro. El comando transporta `newPinHash`. La caja recibe un hash y lo almacena tal cual.

Se conserva la lectura de `newPin` **solo** para comandos ya encolados antes del despliegue (compatibilidad de una versión), con un aviso en consola.

#### Edición 1 — Nueva acción en `useAuthStore`

**ANCLA:** `cambiarPin: (userId, nuevoPin) => {`

Añade **justo antes** de `cambiarPin`:

```js
            /**
             * S5: aplica un PIN ya hasheado (PBKDF2) recibido de un supervisor
             * remoto. El PIN en claro nunca entra en supervisor_commands.payload,
             * que es legible por anon y persiste indefinidamente.
             * @param {number|string} userId
             * @param {string} hashedPin - salida de hashPin(), formato `pbkdf2$...`
             * @returns {{ ok: boolean, error?: string }}
             */
            setPinHash: (userId, hashedPin) => {
                if (typeof hashedPin !== 'string' || !hashedPin.startsWith('pbkdf2$')) {
                    return { ok: false, error: 'Hash de PIN inválido' };
                }
                const target = get().usuarios.find(u => u.id === userId);
                if (!target) return { ok: false, error: 'Usuario no encontrado' };

                set((state) => ({
                    usuarios: state.usuarios.map(u =>
                        // `plainPin` se elimina: la caja no conoce el PIN en claro
                        // de un cambio remoto, y no debe inventárselo.
                        u.id === userId ? { ...u, pin: hashedPin, plainPin: undefined } : u
                    )
                }));
                logEvent('AUTH', 'PIN_CAMBIADO', `PIN cambiado remotamente para ${target.nombre}`, get().usuarioActivo);
                return { ok: true };
            },

```

#### Edición 2 — El monitor hashea antes de emitir

**Archivo:** `src/components/Settings/UsersManager.jsx`
**ANCLA:** `pushRemoteUserCmd('change_pin', { userId: changePinUser.id, newPin: pinValue });`

**ANTES**
```js
        pushRemoteUserCmd('change_pin', { userId: changePinUser.id, newPin: pinValue });
```

**DESPUÉS**
```js
        // S5: el PIN en claro NO entra en supervisor_commands.payload (fila
        // legible por anon y persistente). Se transmite el hash PBKDF2.
        (async () => {
            try {
                const { hashPin } = await import('../../utils/crypto');
                const newPinHash = await hashPin(String(pinValue));
                pushRemoteUserCmd('change_pin', { userId: changePinUser.id, newPinHash });
            } catch (e) {
                console.error('[UsersManager] No se pudo hashear el PIN para el comando remoto:', e);
                showToast('No se pudo preparar el cambio de PIN remoto', 'error');
            }
        })();
```

**ANCLA:** `pushRemoteUserCmd('add', {`

Haz la misma transformación para el alta: sustituye `newPin: newBypassPin ? '' : newPin` por `newPinHash`, calculado con `newBypassPin ? '' : await hashPin(String(newPin))`. Si `bypassPin` es `true`, envía `newPinHash: ''`.

#### Edición 3 — La caja acepta el hash

**Archivo:** `src/hooks/useSupervisorCommands.js`
**ANCLA:** `const { action, userId, newPin, nombre, rol, bypassPin } = command.payload || {};`

**ANTES**
```js
                    const { action, userId, newPin, nombre, rol, bypassPin } = command.payload || {};
```

**DESPUÉS**
```js
                    const { action, userId, newPin, newPinHash, nombre, rol, bypassPin } = command.payload || {};
                    // S5: `newPin` (en claro) queda solo por compatibilidad con
                    // comandos encolados antes del despliegue de esta versión.
                    // Se eliminará en la siguiente. El camino vigente es newPinHash.
                    if (newPin) {
                        console.warn('[SupervisorCommands] Comando legacy con PIN en claro; migra el monitor a newPinHash.');
                    }
```

**ANCLA:** `res = store.cambiarPin(userId, newPin);`

**ANTES**
```js
                            res = store.cambiarPin(userId, newPin);
                            applied = true;
```

**DESPUÉS**
```js
                            // S5: ruta preferente = hash; `cambiarPin` (claro) es legacy.
                            res = newPinHash
                                ? store.setPinHash(userId, newPinHash)
                                : store.cambiarPin(userId, newPin);
                            applied = true;
```

**ANCLA:** `if (action === 'change_pin' && userId && newPin) {`

**ANTES**
```js
                    if (action === 'change_pin' && userId && newPin) {
```

**DESPUÉS**
```js
                    if (action === 'change_pin' && userId && (newPinHash || newPin)) {
```

> **Detalle importante:** la comprobación de PIN duplicado (`store.usuarios.some(u => u.id !== userId && (u.plainPin === newPin || u.pin === newPin))`) **no puede funcionar con un hash** — PBKDF2 lleva sal, así que dos hashes del mismo PIN difieren. Envuélvela para que solo se aplique en la ruta legacy:
> ```js
> } else if (newPin && store.usuarios.some(u => u.id !== userId && (u.plainPin === newPin || u.pin === newPin))) {
> ```
> Con `newPinHash` la deduplicación de PINs se hace en el monitor, antes de emitir (ya existe: `displayUsers.some(u => u.id !== changePinUser.id && u.plainPin === pinValue)`).

#### HARNESS
```bash
npx vitest run tests/userCommandsValidation.test.js tests/security.test.js tests/crypto.test.js
npx eslint --no-cache src/components/Settings/UsersManager.jsx src/hooks/useSupervisorCommands.js src/hooks/store/useAuthStore.js

# Ningún emisor de comandos manda ya un PIN en claro
grep -rn "newPin:" src/components/ src/views/
#   → NO debe devolver nada. Solo debe aparecer `newPinHash:`.

npm run build 2>&1 | tail -5
```

#### RIESGO Y ROLLBACK
- **Riesgo:** un monitor actualizado contra una caja **sin** actualizar envía `newPinHash` y la caja lo ignora → el cambio de PIN falla en silencio. Despliega **caja antes que monitor**, o acepta una ventana en la que los cambios remotos de PIN no se apliquen.
- **Rollback:** `git revert`. `setPinHash` puede quedarse: es aditivo.

#### COMMIT
`fix(security): transmitir hash PBKDF2 en vez de PIN en claro en user_update (S5)`

---

### FX07 — `pushCloudSync` es el dueño único del hash de egress

**Hallazgos:** D1 · **Severidad:** 🔴 Crítico · **Es la fase más importante del plan.**
**Archivos:** `src/hooks/useCloudSync.js`, `tests/cloudSyncFlush.test.js`

#### Contexto — por qué esto causa pérdida de datos silenciosa

`pushCloudSync` es correcta. Cuando Supabase devuelve error hace:
```js
            return; // No guardar hash para reintentar cuando Supabase responda
```
No escribe el hash, precisamente para que el siguiente ciclo reintente.

Pero **ocho** sitios de llamada deshacen esa protección:
```js
                await pushCloudSync(key, val);
                localStorage.setItem(hashKey, currentHash);   // ← incondicional
```
`pushCloudSync` devuelve `undefined` tanto en éxito como en fallo, así que el llamador no puede distinguirlos y escribe el hash igualmente. A partir de ese momento:
- el guard `if (localStorage.getItem(hashKey) === currentHash) continue;` **omite la clave para siempre**;
- el monitor conserva la versión antigua de forma indefinida;
- **no hay ningún error visible en ninguna parte**.

Es el mecanismo detrás del síntoma *"el monitor no se actualiza y no dice por qué"*.

#### Decisión de diseño
`pushCloudSync` pasa a **devolver un booleano** y a ser la **única** que escribe el hash. Todos los llamadores dejan de escribirlo. Es un cambio pequeño y mecánico, pero elimina la clase entera de fallo.

#### Edición 1 — Valor de retorno explícito

**ANCLA:** `const { error } = await supabaseCloud.from('sync_documents').upsert({`

**ANTES**
```js
        if (error) {
            if (error.code === '42501' || error.status === 401) {
                // RLS rechazó el upsert porque el dispositivo no está registrado en device_pairings ni autenticado.
                // Pausar sync activo para evitar peticiones fallidas repetitivas.
                isCloudSyncActive = false;
            } else {
                console.warn(`[CloudSync] Error ${error.code || error.status} al subir ${key}:`, error.message);
            }
            return; // No guardar hash para reintentar cuando Supabase responda
        }

        // Update local hash to prevent periodic push from re-uploading
        localStorage.setItem(hashKey, currentHash);

    } catch (e) {
        // Silencioso en producción
    }
};
```

**DESPUÉS**
```js
        if (error) {
            if (error.code === '42501' || error.status === 401) {
                // RLS rechazó el upsert porque el dispositivo no está registrado en device_pairings ni autenticado.
                // Pausar sync activo para evitar peticiones fallidas repetitivas.
                isCloudSyncActive = false;
            } else {
                console.warn(`[CloudSync] Error ${error.code || error.status} al subir ${key}:`, error.message);
            }
            return false; // No guardar hash para reintentar cuando Supabase responda
        }

        // D1: `pushCloudSync` es el ÚNICO punto que escribe el hash de egress.
        // Los llamadores NO deben escribirlo: si lo hacen, una subida fallida
        // queda marcada como completada y esa clave no se reintenta nunca más.
        localStorage.setItem(hashKey, currentHash);
        return true;

    } catch (e) {
        // Silencioso en producción
        return false;
    }
};
```

**Salidas tempranas.** La función tiene varios `return;` antes del `try`. Conviértelos todos en `return false;`. Localízalos:
```bash
grep -n "^    if (.*) return;\|    return;" src/hooks/useCloudSync.js | head -20
```
Los conocidos son, entre otros:
- `if (key === 'abasto-auth-storage') return;` → `return false;`
- `if (!isCloudSyncActive) return;` → `return false;`
- el guard de hash `if (!forceUnconditional && localStorage.getItem(hashKey) === currentHash) { return; }` → **`return true;`** (no hay nada que subir, pero el estado remoto **sí** es correcto — devolver `false` provocaría reintentos infinitos).

> Esta distinción es la única sutileza de la fase. Grábala: **"ya estaba subido" es éxito, no fallo.**

#### Edición 2 — Los 8 llamadores dejan de escribir el hash

Localiza todos:
```bash
grep -n "await pushCloudSync" src/hooks/useCloudSync.js
```

Para **cada** resultado, el patrón es siempre el mismo. Elimina la línea `localStorage.setItem(hashKey, currentHash);` que sigue a la llamada. Los cuatro pares concretos:

**2a — `forceSyncAllPOSData`, bucle de IndexedDB**

**ANTES**
```js
                await pushCloudSync(key, val);
                localStorage.setItem(hashKey, currentHash);
```
**DESPUÉS**
```js
                // D1: el hash lo escribe pushCloudSync solo si el upsert tuvo éxito.
                await pushCloudSync(key, val, forceUnconditional);
```

**2b — `forceSyncAllPOSData`, bucle de localStorage**

**ANTES**
```js
                await pushCloudSync(key, parsed);
                localStorage.setItem(hashKey, currentHash);
```
**DESPUÉS**
```js
                // D1: el hash lo escribe pushCloudSync solo si el upsert tuvo éxito.
                await pushCloudSync(key, parsed, forceUnconditional);
```

**2c — Auto-recuperación, bucle de IndexedDB**

**ANTES**
```js
                        await pushCloudSync(key, localValue);
                        localStorage.setItem(hashKey, currentHash);
```
**DESPUÉS**
```js
                        // D1: el hash lo escribe pushCloudSync solo si el upsert tuvo éxito.
                        await pushCloudSync(key, localValue);
```

**2d — Auto-recuperación, bucle de localStorage** (y los equivalentes en `forcePushLocalData`)

**ANTES**
```js
                        await pushCloudSync(key, parsed);
                        localStorage.setItem(hashKey, currentHash);
```
**DESPUÉS**
```js
                        // D1: el hash lo escribe pushCloudSync solo si el upsert tuvo éxito.
                        await pushCloudSync(key, parsed);
```

> Las variables `hashKey` y `currentHash` **siguen usándose** en el guard `if (... === currentHash) continue;` de cada bucle: **no las borres**. Solo desaparece la escritura posterior.

**Verificación exhaustiva** (el criterio de aceptación de la fase):
```bash
grep -n "localStorage.setItem(hashKey" src/hooks/useCloudSync.js
```
→ **Debe devolver exactamente 1 resultado**, y debe estar dentro de `pushCloudSync`, después del `if (error)`.

Habrá también algún `localStorage.setItem(hashKey, quickHash(...))` en el camino de importación/aplicación desde la nube. Esos **no** son subidas: marcan "lo que acabo de recibir ya está sincronizado". Reescríbelos así para que sigan siendo distinguibles:
```js
                            // D1: no es un push. Sella el valor recién recibido de la
                            // nube para que el ciclo periódico no lo re-suba en eco.
                            localStorage.setItem(LAST_PUSH_HASH_PREFIX + key, quickHash(localValue));
```
Es decir: **prohibida** la variable intermedia `hashKey` fuera de `pushCloudSync`. Así el `grep` de arriba sigue siendo un invariante comprobable.

#### Edición 3 — Guardarraíl permanente

Crea `tests/egressHashOwnership.test.js`:

```js
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '../src/hooks/useCloudSync.js'), 'utf-8'
);

describe('D1 — pushCloudSync es el unico dueno del hash de egress', () => {
    test('solo existe una escritura de localStorage.setItem(hashKey, ...)', () => {
        const writes = [...SRC.matchAll(/localStorage\.setItem\(\s*hashKey\s*,/g)];
        expect(writes).toHaveLength(1);
    });

    test('esa escritura vive dentro de pushCloudSync', () => {
        const start = SRC.indexOf('const pushCloudSync');
        expect(start).toBeGreaterThan(-1);
        // El final de la función: la siguiente declaracion exportada de nivel superior.
        const end = SRC.indexOf('export const forceSyncAllPOSData', start);
        expect(end).toBeGreaterThan(start);
        const body = SRC.slice(start, end);
        expect(body).toMatch(/localStorage\.setItem\(\s*hashKey\s*,/);
    });

    test('ningun await pushCloudSync va seguido de una escritura de hash', () => {
        const lines = SRC.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            if (!/await\s+pushCloudSync\(/.test(lines[i])) continue;
            const next = (lines[i + 1] || '') + (lines[i + 2] || '');
            expect(next).not.toMatch(/localStorage\.setItem\(\s*hashKey/);
        }
    });

    test('pushCloudSync devuelve un booleano en todos sus caminos', () => {
        const start = SRC.indexOf('const pushCloudSync');
        const end = SRC.indexOf('export const forceSyncAllPOSData', start);
        const body = SRC.slice(start, end);
        // No debe quedar ningun `return;` desnudo.
        expect(body).not.toMatch(/\breturn\s*;/);
    });
});
```

#### HARNESS
```bash
npx vitest run tests/egressHashOwnership.test.js tests/cloudSyncFlush.test.js tests/hooks.test.js tests/storageGuard.test.js
npx eslint --no-cache src/hooks/useCloudSync.js

# Invariante central
grep -c "localStorage.setItem(hashKey" src/hooks/useCloudSync.js
#   → EXACTAMENTE 1

# No quedan `return;` desnudos dentro de pushCloudSync
sed -n "/const pushCloudSync/,/^export const forceSyncAllPOSData/p" src/hooks/useCloudSync.js | grep -n "return;"
#   → NO debe devolver nada

npm run build 2>&1 | tail -5
```

#### VERIFICACIÓN MANUAL (recomendada)
1. Abre la caja con DevTools.
2. `Network → Offline`.
3. Modifica un producto. En consola debe verse el warning de `[CloudSync]`.
4. `localStorage.getItem('bodega_last_periodic_push_hash_bodega_products_v1')` → **debe seguir siendo el valor anterior** (o `null`), **no** el hash del valor nuevo.
5. `Network → Online`, espera ≤ 60 s → el producto llega al monitor.

Antes de este arreglo, el paso 5 no ocurría nunca.

#### RIESGO Y ROLLBACK
- **Riesgo:** un dispositivo con hashes ya envenenados no se recupera solo hasta que el valor vuelva a cambiar. La fase **FX12** añade la purga de arranque.
- **Rollback:** `git revert` del commit. Es un cambio autocontenido en un archivo.

#### COMMIT
`fix(sync): pushCloudSync es el unico dueno del hash de egress (D1)`

---

### FX08 — Pull del monitor resiliente

**Hallazgos:** D2, D6 · **Severidad:** 🔴 Crítico
**Archivo:** `src/hooks/useMonitorSync.js`

#### Contexto
La caja ya protege su bucle de aplicación documento a documento (comentario `HOOK-023`). El monitor **no**:
```js
                for (const doc of docs) {
                    await applyDocToLocal(doc.doc_id, doc.collection, doc.data.payload);
                }
```
Si `doc.data` es `null` (fila creada por un camino distinto al upsert normal), `doc.data.payload` lanza `TypeError`, el `for` aborta, y **los documentos restantes no se aplican**. Como el pull siempre trae el mismo lote, el fallo es **permanente**. Además `monitor_last_sync` solo avanza cuando `docs.length > 0`, lo que interactúa mal con el rate limiter (D6).

#### Edición

**ANCLA:** `for (const doc of docs) {`

**ANTES**
```js
            if (docs && docs.length > 0) {
                for (const doc of docs) {
                    await applyDocToLocal(doc.doc_id, doc.collection, doc.data.payload);
                }
                const now = new Date();
                setLastSync(now);
                localStorage.setItem('monitor_last_sync', now.toISOString());
```

**DESPUÉS**
```js
            if (docs && docs.length > 0) {
                // D2: try/catch por documento — igual que HOOK-023 en la caja.
                // Un solo documento malformado no puede abortar los otros 20, y
                // menos aún de forma permanente (el pull trae siempre el mismo lote).
                let appliedCount = 0;
                let failedCount = 0;
                for (const doc of docs) {
                    try {
                        if (!doc || doc.data == null) {
                            failedCount++;
                            console.warn(`[useMonitorSync] Documento sin data, omitido: ${doc?.doc_id}`);
                            continue;
                        }
                        await applyDocToLocal(doc.doc_id, doc.collection, doc.data.payload);
                        appliedCount++;
                    } catch (e) {
                        failedCount++;
                        console.warn(`[useMonitorSync] Error aplicando doc ${doc?.doc_id}:`, e);
                    }
                }

                if (failedCount > 0) {
                    console.warn(`[useMonitorSync] Pull parcial: ${appliedCount} aplicados, ${failedCount} fallidos.`);
                }

                // D5/D6: el cursor se deriva del `updated_at` MÁXIMO realmente
                // recibido, no del reloj local. El `updated_at` lo escribe el
                // servidor (ver FX10), así que ambos lados comparten referencia
                // temporal y un desfase de reloj ya no descarta ventanas.
                const maxUpdatedAt = docs.reduce((acc, d) => {
                    const t = d?.updated_at ? new Date(d.updated_at).getTime() : 0;
                    return t > acc ? t : acc;
                }, 0);
                const now = maxUpdatedAt > 0 ? new Date(maxUpdatedAt) : new Date();
                setLastSync(now);
                localStorage.setItem('monitor_last_sync', now.toISOString());
```

> El `select` ya pide `updated_at` (`.select('collection, doc_id, data, updated_at')`), así que el campo está disponible. **Verifícalo** antes de editar:
> ```bash
> grep -n "collection, doc_id, data, updated_at" src/hooks/useMonitorSync.js
> ```
> Si no aparece, **DETENTE**: el `select` cambió y el plan no es aplicable tal cual.

#### D6 — El cursor también avanza con lote vacío

**ANCLA:** la llave de cierre del bloque `if (docs && docs.length > 0) { ... }`, seguida de `setIsConnected(true);`

**ANTES**
```js
            }

            setIsConnected(true);
```

**DESPUÉS**
```js
            } else if (docs) {
                // D6: lote vacío = ya estamos al día. Marcar la sincronización como
                // exitosa evita que el health-check la interprete como "sin datos"
                // y dispare pulls completos repetidos.
                setLastSync(prev => prev || new Date());
            }

            setIsConnected(true);
```

#### HARNESS
```bash
npx vitest run tests/hooks.test.js
npx eslint --no-cache src/hooks/useMonitorSync.js

# El bucle está protegido
sed -n "/for (const doc of docs)/,/^                }/p" src/hooks/useMonitorSync.js | grep -c "try {"
#   → >= 1

# No queda ningún acceso desprotegido a doc.data.payload
grep -n "doc.data.payload" src/hooks/useMonitorSync.js
#   → solo dentro del try

npm run build 2>&1 | tail -5
```

#### COMMIT
`fix(sync): el pull del monitor tolera documentos malformados y avanza el cursor por updated_at (D2,D6)`

---

### FX09 — Los cursores no se queman ante un fallo

**Hallazgos:** D3, D4 · **Severidad:** 🔴 Crítico · **Depende de:** FX07
**Archivos:** `src/hooks/useMonitorSync.js`, `src/hooks/useCloudSync.js`

#### Contexto
Dos variantes del mismo error: **avanzar el cursor sin haber confirmado que los datos llegaron.**

- **D3 (monitor):** `localStorage.setItem('dj_monitor_last_full_pull_ts', String(nowTs))` se ejecuta **antes** de `await query`. Si el query falla, el rate limiter de 5 minutos bloquea el reintento — sin datos y sin poder recuperarlos.
- **D4 (caja):** `const { data: docs } = await query;` **descarta el `error`**, y después `localStorage.setItem('dj_cloud_sync_ts', new Date().toISOString())` avanza el cursor **pase lo que pase**. Los cambios de esa ventana no se vuelven a pedir jamás.

#### Edición 1 — D3, monitor

**ANCLA:** `MONITOR_FULL_PULL_MIN_INTERVAL_MS`

**ANTES**
```js
            if (lastSyncIso) {
                query = query.gt('updated_at', lastSyncIso);
            } else if (nowTs - lastFullPullTs < MONITOR_FULL_PULL_MIN_INTERVAL_MS) {
                console.log('[useMonitorSync] Full-Pull del Monitor omitido por Rate Limiter (< 5 min). Usando datos locales.');
                query = query.gt('updated_at', new Date(lastFullPullTs).toISOString());
            } else {
                localStorage.setItem('dj_monitor_last_full_pull_ts', String(nowTs));
            }

            const { data: docs, error } = await query;

            if (error) throw error;
```

**DESPUÉS**
```js
            // D3: el rate limiter se marca DESPUÉS de un pull exitoso, nunca antes.
            // Antes se escribía aquí y un query fallido dejaba al monitor 5 minutos
            // bloqueado, sin datos y sin posibilidad de reintentar.
            let isFullPull = false;
            if (lastSyncIso) {
                query = query.gt('updated_at', lastSyncIso);
            } else if (nowTs - lastFullPullTs < MONITOR_FULL_PULL_MIN_INTERVAL_MS) {
                console.log('[useMonitorSync] Full-Pull del Monitor omitido por Rate Limiter (< 5 min). Usando datos locales.');
                query = query.gt('updated_at', new Date(lastFullPullTs).toISOString());
            } else {
                isFullPull = true;
            }

            const { data: docs, error } = await query;

            if (error) throw error;

            // D3: solo ahora sabemos que el pull completo se realizó de verdad.
            if (isFullPull) {
                localStorage.setItem('dj_monitor_last_full_pull_ts', String(nowTs));
            }
```

#### Edición 2 — D4, caja: no descartar el error

**ANCLA:** `const { data: docs } = await query;`

**ANTES**
```js
                    const { data: docs } = await query;

                    if (docs?.length > 0) {
```

**DESPUÉS**
```js
                    // D4: antes se descartaba `error` y el cursor avanzaba igual,
                    // de modo que un pull fallido hacía perder esa ventana de
                    // cambios para siempre.
                    const { data: docs, error: pullError } = await query;

                    if (pullError) {
                        console.warn('[CloudSync] Pull incremental falló; el cursor NO avanza:', pullError.message);
                        throw pullError;
                    }

                    if (docs?.length > 0) {
```

> `throw` es correcto aquí: el bloque ya está dentro del `try` de `initSync`, que registra el error y reintenta en el siguiente ciclo. **Verifícalo** localizando el `catch` que envuelve esta sección antes de editar. Si no hubiese `try`, sustituye el `throw pullError;` por `return;` y **repórtalo**.

#### Edición 3 — D4, caja: cursor derivado de los datos

**ANCLA:** `localStorage.setItem('dj_cloud_sync_ts', new Date().toISOString());` — la ocurrencia que va **inmediatamente después** del bucle `for (const doc of docs)` y antes del `}` que cierra el `else`.

**ANTES**
```js
                        console.log(`[CloudSync] Pull incremental (${lastSyncIso ? 'cambios' : 'inicial'}): ${docs.length} documentos aplicados.`);
                    }
                    localStorage.setItem('dj_cloud_sync_ts', new Date().toISOString());
```

**DESPUÉS**
```js
                        console.log(`[CloudSync] Pull incremental (${lastSyncIso ? 'cambios' : 'inicial'}): ${docs.length} documentos aplicados.`);
                    }
                    // D4/D5: el cursor sale del `updated_at` máximo REALMENTE recibido.
                    // Usar el reloj local hacía que cualquier desfase con el servidor
                    // saltase una ventana de escrituras de forma silenciosa.
                    const maxUpdatedAt = (docs || []).reduce((acc, d) => {
                        const t = d?.updated_at ? new Date(d.updated_at).getTime() : 0;
                        return t > acc ? t : acc;
                    }, 0);
                    if (maxUpdatedAt > 0) {
                        localStorage.setItem('dj_cloud_sync_ts', new Date(maxUpdatedAt).toISOString());
                    } else if (!lastSyncIso) {
                        // Primer pull sin resultados: sellar para no repetir el full pull.
                        localStorage.setItem('dj_cloud_sync_ts', new Date().toISOString());
                    }
                    // D3: el rate limiter del full pull también se marca aquí, ya con éxito.
                    if (!lastSyncIso && nowTs - lastFullPullTs >= FULL_PULL_MIN_INTERVAL_MS) {
                        localStorage.setItem('dj_last_full_pull_ts', String(nowTs));
                    }
```

#### Edición 4 — El `select` debe traer `updated_at`

**ANCLA:** `.select('collection, doc_id, data')`

**ANTES**
```js
                        .select('collection, doc_id, data')
```
**DESPUÉS**
```js
                        .select('collection, doc_id, data, updated_at')
```

> Sin esto, `maxUpdatedAt` sería siempre `0` y el cursor no avanzaría nunca → pull completo en cada ciclo y explosión de egress. **Esta edición no es opcional.**

#### Edición 5 — Quitar la marca prematura del rate limiter de la caja

**ANCLA:** `localStorage.setItem('dj_last_full_pull_ts', String(nowTs));`

**ANTES**
```js
                    } else {
                        localStorage.setItem('dj_last_full_pull_ts', String(nowTs));
                    }
```
**DESPUÉS**
```js
                    }
                    // D3: `dj_last_full_pull_ts` ya no se marca aquí. Se escribe
                    // después del pull exitoso (ver más abajo), para que un fallo
                    // no bloquee el reintento durante 5 minutos.
```

#### HARNESS
```bash
npx vitest run tests/hooks.test.js tests/cloudSyncFlush.test.js tests/egressHashOwnership.test.js
npx eslint --no-cache src/hooks/useCloudSync.js src/hooks/useMonitorSync.js

# Ningún pull descarta ya el error
grep -n "const { data: docs } = await query" src/hooks/useCloudSync.js src/hooks/useMonitorSync.js
#   → NO debe devolver nada

# Ambos selects traen updated_at
grep -n "select('collection, doc_id, data" src/hooks/useCloudSync.js src/hooks/useMonitorSync.js
#   → las 2 líneas deben terminar en `updated_at')`

npm run build 2>&1 | tail -5
```

#### VERIFICACIÓN MANUAL
1. Monitor con DevTools abierto, `Network → Offline`.
2. Fuerza un refresco. Debe aparecer el error, y **`dj_monitor_last_full_pull_ts` no debe cambiar**.
3. `Network → Online`, refresca de nuevo → el pull completo se ejecuta **de inmediato**, sin esperar 5 minutos.

#### COMMIT
`fix(sync): los cursores solo avanzan tras un pull confirmado (D3,D4)`

---

### FX10 — `updated_at` autoritativo del servidor

**Hallazgos:** D5 · **Severidad:** 🟠 Importante · **Depende de:** FX09
**Archivos:** `supabase_sync_supervisor_hardening.sql`, `src/hooks/useCloudSync.js`

#### Contexto
Hoy `updated_at` lo escribe el **cliente**:
```js
            updated_at: new Date().toISOString()
```
…mientras el consumidor filtra con `.gt('updated_at', <su propio reloj>)`. Si el reloj de la caja va 40 s adelantado respecto al del monitor, el monitor pide `> T` con su `T` y **nunca ve** los documentos que la caja escribió con marcas entre `T` y `T+40s`. El fallo es silencioso, intermitente y prácticamente imposible de reproducir en desarrollo. En tablets baratas sin NTP fiable, es la norma.

FX09 ya eliminó la mitad del problema (el cursor ahora sale de los datos, no del reloj local). FX10 elimina la otra mitad: **una sola fuente de verdad temporal, el servidor.**

#### Edición 1 — Trigger en la base de datos

Añade **al final** de `supabase_sync_supervisor_hardening.sql`:

````sql

-- ═════════════════════════════════════════════════════════════════════════════
-- D5 — `updated_at` lo escribe el servidor, no el cliente.
--      Antes lo enviaba la caja con su propio reloj mientras el monitor filtraba
--      con el suyo: cualquier desfase descartaba una ventana de escrituras.
--      Con el trigger, ambos lados comparten la referencia temporal de Postgres.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.sync_documents_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_documents_updated_at ON public.sync_documents;
CREATE TRIGGER trg_sync_documents_updated_at
    BEFORE INSERT OR UPDATE ON public.sync_documents
    FOR EACH ROW EXECUTE FUNCTION public.sync_documents_set_updated_at();

ALTER TABLE public.sync_documents
    ALTER COLUMN updated_at SET DEFAULT now();
````

#### Edición 2 — El cliente deja de enviar `updated_at`

**Archivo:** `src/hooks/useCloudSync.js`
**ANCLA:** `updated_at: new Date().toISOString()`

**ANTES**
```js
        const { error } = await supabaseCloud.from('sync_documents').upsert({
            device_id: activeDeviceId,
            collection: collectionType,
            doc_id: key,
            data: { payload: payloadToUpload },
            updated_at: new Date().toISOString()
        }, { onConflict: 'device_id,collection,doc_id' });
```

**DESPUÉS**
```js
        // D5: `updated_at` lo pone el trigger `trg_sync_documents_updated_at`
        // (supabase_sync_supervisor_hardening.sql). Enviarlo desde el cliente
        // mezclaba dos relojes: el de quien escribe y el de quien lee el cursor,
        // y cualquier desfase descartaba escrituras en silencio.
        const { error } = await supabaseCloud.from('sync_documents').upsert({
            device_id: activeDeviceId,
            collection: collectionType,
            doc_id: key,
            data: { payload: payloadToUpload }
        }, { onConflict: 'device_id,collection,doc_id' });
```

#### ORDEN DE DESPLIEGUE — crítico

El trigger **debe desplegarse antes** que el bundle JS. Si sale primero el JS, los upserts dejarán de enviar `updated_at` mientras la columna aún no tiene `DEFAULT now()` → si es `NOT NULL`, **todos los upserts fallarán**.

Comprueba primero si la columna admite nulos:
```sql
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'sync_documents' AND column_name = 'updated_at';
```
- `is_nullable = 'NO'` y sin default → **el orden es obligatorio: SQL primero.**
- Con default → el orden es indiferente, pero mantenlo igual por prudencia.

Anota esto en el reporte final y en la [sección 8](#8-despliegue-sql-y-verificación-manual).

#### HARNESS
```bash
npx vitest run tests/cloudSyncFlush.test.js tests/hooks.test.js tests/egressHashOwnership.test.js
npx eslint --no-cache src/hooks/useCloudSync.js

# El cliente ya no envía updated_at en el upsert
grep -n "updated_at: new Date().toISOString()" src/hooks/useCloudSync.js
#   → NO debe devolver nada

# El trigger está en el .sql
grep -n "trg_sync_documents_updated_at" supabase_sync_supervisor_hardening.sql
#   → 2 líneas (DROP + CREATE)

grep -c '\$\$' supabase_sync_supervisor_hardening.sql
#   → sigue siendo PAR

npm run build 2>&1 | tail -5
```

#### RIESGO Y ROLLBACK
- **Riesgo alto si se invierte el orden de despliegue.** Ver arriba.
- **Rollback:** `DROP TRIGGER trg_sync_documents_updated_at ON public.sync_documents;` + `git revert` del commit JS. Ambos lados vuelven al comportamiento previo sin pérdida de datos.

#### COMMIT
`fix(sync): updated_at autoritativo del servidor para eliminar la deriva de reloj (D5)`

---

### FX11 — El anti-eco queda realmente conectado

**Hallazgos:** D7 · **Severidad:** 🟠 Importante
**Archivos:** `src/hooks/useCloudSync.js`, `src/hooks/useCloudBackup.js`

#### Contexto
Dos piezas rotas que se refuerzan entre sí:

1. `src/utils/syncFlags.js` expone `registerCloudSyncSetter`, pensado para que `runWithoutEco` pueda silenciar el flag `isSyncingFromCloud` **local del módulo** `useCloudSync`. En producción **nunca se llama**: la única invocación está en `tests/hooks.test.js`. Así que hay dos banderas anti-eco independientes que no se hablan.
2. `applyCloudBackup` escribe las claves LS con `localStorage.setItem` crudo bajo un comentario que afirma *"pasa por el interceptor de useCloudSync"* — ese interceptor (el *monkeypatch* de `localStorage.setItem`) **fue eliminado** en SEC-009/HOOK-011. Resultado: restaurar un backup en la caja **no republica nada**, y el monitor sigue mostrando el estado previo a la restauración.

#### Edición 1 — Registrar el setter en producción

**Archivo:** `src/hooks/useCloudSync.js`
**ANCLA:** `import` de `syncFlags` (localízalo con `grep -n "syncFlags" src/hooks/useCloudSync.js`).

Añade, en el ámbito de módulo y **después** de la declaración de `isSyncingFromCloud`:

```js
// D7: conectar la bandera local del módulo con `runWithoutEco` de syncFlags.
// Sin este registro había DOS banderas anti-eco independientes: la de este
// módulo y la de syncFlags.js, y `runWithoutEco` no silenciaba a esta.
// La única llamada existente estaba en tests/hooks.test.js — nunca en producción.
registerCloudSyncSetter((v) => { isSyncingFromCloud = v; });
```

Y añade `registerCloudSyncSetter` al import existente de `../utils/syncFlags`. Si no existe tal import, créalo:
```js
import { registerCloudSyncSetter } from '../utils/syncFlags';
```

> Antes de editar, confirma el nombre exacto de la variable:
> ```bash
> grep -n "isSyncingFromCloud" src/hooks/useCloudSync.js | head -3
> ```
> Si se llama distinto, **usa el nombre real**.

#### Edición 2 — La restauración de backup vuelve a publicar

**Archivo:** `src/hooks/useCloudBackup.js`
**ANCLA:** `if (backup.data.ls) {`

**ANTES**
```js
            if (backup.data.ls) {
                for (const [key, value] of Object.entries(backup.data.ls)) {
                    // localStorage.setItem pasa por el interceptor de useCloudSync;
                    // el flag global también lo silencia (doble protección).
                    localStorage.setItem(key, value);
                }
            }
```

**DESPUÉS**
```js
            if (backup.data.ls) {
                // D7: el interceptor de localStorage.setItem fue eliminado en
                // SEC-009/HOOK-011; el comentario anterior describía un mecanismo
                // que ya no existe. Escribir aquí NO republicaba nada, así que tras
                // restaurar un backup el monitor conservaba el estado anterior.
                for (const [key, value] of Object.entries(backup.data.ls)) {
                    localStorage.setItem(key, value);
                    window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key } }));
                }
            }
```

Y **después** del `await runWithoutEco(async () => { ... });` que envuelve toda la restauración, añade la republicación explícita:

**ANCLA:** el cierre `        });` de ese `runWithoutEco`, seguido de `    };`

**ANTES**
```js
        });
    };
```

**DESPUÉS**
```js
        });

        // D7: la restauración es un cambio de estado legítimo que DEBE propagarse
        // a los monitores. Se hace fuera de runWithoutEco (el anti-eco solo debe
        // cubrir la escritura, no la publicación) y de forma incondicional, porque
        // los hashes de egress corresponden al estado previo a la restauración.
        try {
            const { forceSyncAllPOSData } = await import('./useCloudSync');
            await forceSyncAllPOSData(undefined, true);
        } catch (e) {
            console.warn('[applyCloudBackup] No se pudo republicar tras la restauración:', e);
        }
    };
```

> El segundo argumento `true` es `forceUnconditional`: sin él, el guard de hash omitiría todas las claves cuyo hash coincide con el estado **previo** a la restauración — que es justo el caso que hay que superar.

#### HARNESS
```bash
npx vitest run tests/hooks.test.js tests/compression.test.js tests/storageGuard.test.js
npx eslint --no-cache src/hooks/useCloudSync.js src/hooks/useCloudBackup.js

# El setter se registra en producción, no solo en tests
grep -rn "registerCloudSyncSetter" src/
#   → al menos 2 resultados: la definición en syncFlags.js y la llamada en useCloudSync.js

# Ya no queda el comentario que describía el interceptor eliminado
grep -n "pasa por el interceptor de useCloudSync" src/
#   → NO debe devolver nada

npm run build 2>&1 | tail -5
```

#### COMMIT
`fix(sync): conectar runWithoutEco en produccion y republicar tras restaurar backup (D7)`

---

### FX12 — Emparejamiento incondicional, registro explícito y tope de egress

**Hallazgos:** E1, E2 · **Severidad:** 🟠 Importante · **Depende de:** FX07, FX01
**Archivos:** `src/components/Settings/PairingManager.jsx`, `src/hooks/useCloudSync.js`

#### Contexto
Tres cabos sueltos de egress y arranque:

- **E1:** `handleGenerateQR` llama `forceSyncAllPOSData(deviceId)` **sin** `forceUnconditional`. Justo en el momento en que un monitor nuevo necesita el dataset completo, el guard de hash lo omite todo si los hashes ya existen. Combinado con D1 (hash envenenado), el monitor recién emparejado ve **una pantalla vacía y ningún error**.
- **E2:** la compuerta `if (!hasAuth && !isRegisteredOrPaired)` fue eliminada sin reemplazo, así que cualquier caja no emparejada sube su dataset completo al arrancar. Tras FX01, esas subidas además **fallarán** (`42501`) porque ya no existe la fila autoconcedida.
- Se necesita la purga de los hashes envenenados que dejaron las versiones anteriores.

#### Edición 1 — E1: emparejar siempre sube todo

**Archivo:** `src/components/Settings/PairingManager.jsx`
**ANCLA:** `forceSyncAllPOSData(deviceId).catch(() => {});`

**ANTES**
```js
            // Asegurar que todos los datos del POS estén en la nube para el nuevo monitor
            forceSyncAllPOSData(deviceId).catch(() => {});
```

**DESPUÉS**
```js
            // E1: `forceUnconditional = true`. Sin él, el guard de hash omite las
            // claves cuyo hash coincide — incluidas las que quedaron envenenadas por
            // D1 — y el monitor recién emparejado arranca vacío, sin ningún error.
            // Se espera el resultado: el QR no debe mostrarse antes de que los datos
            // estén arriba, o el supervisor verá una pantalla en blanco.
            try {
                await forceSyncAllPOSData(deviceId, true);
            } catch (e) {
                console.warn('[PairingManager] La subida previa al emparejamiento falló:', e);
            }
```

> `handleGenerateQR` ya es `async` (usa `await supabaseCloud.rpc(...)` más abajo). **Verifícalo:** `grep -n "handleGenerateQR" src/components/Settings/PairingManager.jsx`. Si no lo fuera, **DETENTE**.

#### Edición 2 — E2: registro explícito de la caja

Tras FX01, `touch_pos_heartbeat` ya no crea la fila. La caja debe registrarse una vez, de forma explícita.

**Archivo:** `src/hooks/useCloudSync.js`
**ANCLA:** `pingPosPresence` (localiza la función con `grep -n "pingPosPresence" src/hooks/useCloudSync.js`)

Dentro de esa función, donde llama `touch_pos_heartbeat`, añade el registro condicional:

```js
            const { data: hb } = await supabaseCloud.rpc('touch_pos_heartbeat', {
                p_device_id: deviceId
            });

            // E2/S1: `touch_pos_heartbeat` ya no crea la fila de emparejamiento
            // (era el vector de suplantación S1). Si la caja aún no está registrada,
            // se registra UNA vez, de forma explícita y auditable.
            if (hb && hb.registered === false) {
                await supabaseCloud.rpc('register_pos_device', { p_device_id: deviceId });
                console.log('[CloudSync] Dispositivo POS registrado en la nube:', deviceId);
            }
```

> Ajusta la desestructuración al estilo real de la función (puede que ya use `const { data, error }`). Mantén el nombre de variable existente si lo hay.

#### Edición 3 — E2: tope de tamaño con aviso

**Archivo:** `src/hooks/useCloudSync.js`
**ANCLA:** `const payloadToUpload = sanitizePayloadForSync(key, value);`

**ANTES**
```js
    const payloadToUpload = sanitizePayloadForSync(key, value);
```

**DESPUÉS**
```js
    const payloadToUpload = sanitizePayloadForSync(key, value);

    // E2: tope duro de egress por documento. No trunca ni recorta datos — solo
    // rechaza y avisa, para que un documento desbocado sea visible en vez de
    // convertirse en una factura sorpresa. 2 MB está muy por encima del mayor
    // documento real observado (~1.1 MB para el dataset completo).
    const MAX_DOC_BYTES = 2 * 1024 * 1024;
    try {
        const approxBytes = JSON.stringify(payloadToUpload)?.length ?? 0;
        if (approxBytes > MAX_DOC_BYTES) {
            console.error(
                `[CloudSync] E2: documento '${key}' de ${(approxBytes / 1048576).toFixed(2)} MB ` +
                `supera el tope de ${MAX_DOC_BYTES / 1048576} MB. NO se sube. ` +
                `Revisa por qué creció (¿histórico sin podar?).`
            );
            return false;
        }
    } catch {
        // Si no es serializable, que falle el upsert y lo reporte por el camino normal.
    }
```

> El `return false` respeta el contrato de FX07: fallo ⇒ el hash **no** se escribe ⇒ se reintentará. Es lo correcto: el documento sigue siendo demasiado grande, así que el aviso se repetirá hasta que alguien lo arregle. Eso es intencional.

#### Edición 4 — Purga de hashes envenenados en el arranque

**Archivo:** `src/hooks/useCloudSync.js`
**ANCLA:** `const initSync` (o el punto donde se establece `isCloudSyncActive = true` al iniciar).

Añade, **una sola vez por versión**, al principio de `initSync`:

```js
    // D1/E1: las versiones anteriores escribían el hash de egress aunque el
    // upsert hubiese fallado, dejando claves marcadas como "ya subidas" que en
    // realidad nunca llegaron. Se purgan una única vez para forzar una
    // reconciliación completa. La marca evita repetirlo en cada arranque.
    const HASH_PURGE_FLAG = 'dj_egress_hash_purge_v1';
    if (!localStorage.getItem(HASH_PURGE_FLAG)) {
        try {
            const stale = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(LAST_PUSH_HASH_PREFIX)) stale.push(k);
            }
            stale.forEach(k => localStorage.removeItem(k));
            localStorage.setItem(HASH_PURGE_FLAG, '1');
            console.log(`[CloudSync] Purga única de ${stale.length} hashes de egress potencialmente envenenados (D1).`);
        } catch (e) {
            console.warn('[CloudSync] No se pudo purgar los hashes de egress:', e);
        }
    }
```

> Esto provoca **una** subida completa por dispositivo, una sola vez. Es el coste de recuperarse de D1 y es deliberado: sin la purga, las claves envenenadas siguen sin subir hasta que su valor vuelva a cambiar por sí solo.

#### HARNESS
```bash
npx vitest run tests/cloudSyncFlush.test.js tests/hooks.test.js tests/egressHashOwnership.test.js
npx eslint --no-cache src/hooks/useCloudSync.js src/components/Settings/PairingManager.jsx

# El emparejamiento sube de forma incondicional
grep -n "forceSyncAllPOSData(deviceId, true)" src/components/Settings/PairingManager.jsx
#   → 1 resultado

# El registro explícito está conectado
grep -n "register_pos_device" src/hooks/useCloudSync.js
#   → 1 resultado

npm run build 2>&1 | tail -5
```

#### VERIFICACIÓN MANUAL
1. En la caja: `localStorage.removeItem('dj_egress_hash_purge_v1')` y recarga.
2. Consola: debe aparecer el mensaje de purga con el número de hashes.
3. Genera un QR nuevo. La consola debe mostrar `Sincronización POS verificada/completada`.
4. Empareja un monitor limpio → debe traer **todos** los datos, no una pantalla vacía.

#### COMMIT
`fix(egress): emparejamiento incondicional, registro explicito de la caja y tope por documento (E1,E2)`

---

### FX13 — Relojes del monitor consolidados

**Hallazgos:** E3 · **Severidad:** 🟡 Menor
**Archivo:** `src/hooks/useMonitorSync.js`

#### Contexto
El monitor mantiene cuatro relojes simultáneos: heartbeat de 60 s, health-check de 10 s, catch-up de comandos de 12 s y la suscripción de realtime. Ninguno reduce su ritmo cuando la pestaña está oculta, así que un monitor olvidado en segundo plano genera tráfico constante durante horas.

#### Edición — Backoff cuando la pestaña está oculta

**ANCLA:** el `useEffect` que instala el health-check de 10 s (`grep -n "10000\|10 \* 1000" src/hooks/useMonitorSync.js`).

Añade en el ámbito del hook, **antes** de los `useEffect` de temporizadores:

```js
    // E3: cuando la pestaña está oculta, el supervisor no está mirando. Los
    // relojes se ralentizan x6 en vez de mantener el ritmo de primer plano.
    // Al volver a primer plano se refresca de inmediato, así que la latencia
    // percibida no cambia: solo se deja de pagar tráfico por una pantalla que
    // nadie ve.
    const hiddenRef = useRef(false);

    useEffect(() => {
        const onVisibility = () => {
            const wasHidden = hiddenRef.current;
            hiddenRef.current = document.visibilityState === 'hidden';
            if (wasHidden && !hiddenRef.current) {
                initMonitor(true);
                sendHeartbeat();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [initMonitor, sendHeartbeat]);
```

Y dentro de **cada** callback de `setInterval` del hook, añade como primera línea:
```js
            if (hiddenRef.current && (Date.now() % 6000) > 1000) return;
```

> **Alternativa preferible si tu edición lo permite** — un guard explícito por contador, más legible y determinista:
> ```js
>     const tickRef = useRef(0);
>     // ...dentro del intervalo:
>             tickRef.current++;
>             // E3: en segundo plano, 1 de cada 6 ticks.
>             if (hiddenRef.current && tickRef.current % 6 !== 0) return;
> ```
> Usa **esta** variante. La del módulo del reloj está solo como referencia de intención.

Asegúrate de que `useRef` esté importado desde `react`:
```bash
grep -n "^import.*useRef" src/hooks/useMonitorSync.js
```

#### HARNESS
```bash
npx vitest run tests/hooks.test.js
npx eslint --no-cache src/hooks/useMonitorSync.js
grep -c "hiddenRef" src/hooks/useMonitorSync.js
#   → >= 3
npm run build 2>&1 | tail -5
```

#### RIESGO
Bajo. Si el backoff resultara molesto en uso real, se revierte solo esta fase sin tocar nada más.

#### COMMIT
`perf(monitor): reducir el ritmo de los relojes cuando la pestana esta oculta (E3)`

---

### FX14 — Errores visibles, no un falso "fuera de línea"

**Hallazgos:** R1 · **Severidad:** 🟠 Importante
**Archivo:** `src/hooks/useMonitorSync.js`

#### Contexto
`checkPosPresence` desestructura solo `data` y descarta `error`:
```js
            const { data: pairing } = await supabaseCloud
                .from('device_pairings')
                ...
```
Un fallo de red, un `42501` de RLS o un emparejamiento roto acaban todos en `setIsPosOnline(false)`. El supervisor ve *"Caja fuera de línea"* y va a la tienda a comprobar una caja que estaba funcionando perfectamente. **El síntoma de un problema de permisos es indistinguible del de un corte de luz.** Esto empeora tras FX01/FX02, que introducen rechazos legítimos.

#### Edición

**ANCLA:** `const checkPosPresence = useCallback(async () => {`

**ANTES**
```js
    const checkPosPresence = useCallback(async () => {
        if (!supabaseCloud || !pairedDeviceId) return;
        try {
            const { data: pairing } = await supabaseCloud
                .from('device_pairings')
                .select('last_seen_at, paired_at')
                .eq('primary_device_id', pairedDeviceId)
                .maybeSingle();

            const stamp = pairing?.last_seen_at || pairing?.paired_at || null;

            if (stamp) {
                const lastDate = new Date(stamp);
                setPosLastSeen(lastDate);
                const diffMs = Date.now() - lastDate.getTime();
                // Considerar la caja En Línea si reportó actividad en los últimos 3 minutos (180,000 ms)
                setIsPosOnline(diffMs <= 180000);
            } else {
                setIsPosOnline(false);
            }
        } catch {
            setIsPosOnline(false);
        }
    }, [pairedDeviceId]);
```

**DESPUÉS**
```js
    const checkPosPresence = useCallback(async () => {
        if (!supabaseCloud || !pairedDeviceId) return;
        try {
            // R1: antes se descartaba `error`, así que un fallo de red o de RLS se
            // pintaba como "Caja fuera de línea" — indistinguible de un corte real.
            const { data: pairing, error } = await supabaseCloud
                .from('device_pairings')
                .select('last_seen_at, paired_at')
                .eq('primary_device_id', pairedDeviceId)
                .maybeSingle();

            if (error) {
                console.warn('[useMonitorSync] No se pudo consultar la presencia de la caja:', error.message);
                // No es "la caja está apagada": es "no lo sabemos". Se conserva el
                // último estado conocido y se marca el motivo para la UI.
                setPresenceError(error.message || 'Error consultando presencia');
                return;
            }
            setPresenceError(null);

            if (!pairing) {
                // R1: el emparejamiento no existe. Es un fallo de configuración,
                // no una caja apagada, y la UI debe poder distinguirlo.
                setPresenceError('Este monitor no está vinculado a ninguna caja.');
                setIsPosOnline(false);
                return;
            }

            const stamp = pairing.last_seen_at || pairing.paired_at || null;

            if (stamp) {
                const lastDate = new Date(stamp);
                setPosLastSeen(lastDate);
                const diffMs = Date.now() - lastDate.getTime();
                // Considerar la caja En Línea si reportó actividad en los últimos 3 minutos (180,000 ms)
                setIsPosOnline(diffMs <= 180000);
            } else {
                setIsPosOnline(false);
            }
        } catch (e) {
            console.warn('[useMonitorSync] checkPosPresence lanzó:', e?.message ?? e);
            setPresenceError(e?.message || 'Error de red');
        }
    }, [pairedDeviceId]);
```

**Nuevo estado.** Junto a los demás `useState` del hook, añade:
```js
    // R1: distingue "la caja está apagada" de "no pudimos averiguarlo".
    const [presenceError, setPresenceError] = useState(null);
```

**Exponerlo.** Añade `presenceError` al objeto que retorna el hook. Localiza el `return {` final:
```bash
grep -n "return {" src/hooks/useMonitorSync.js | tail -1
```

#### Nota sobre la UI
`OwnerMonitorView` puede consumir `presenceError` para mostrar *"Sin conexión con el servidor"* en vez de *"Caja fuera de línea"*. **Esa edición de UI no forma parte de esta fase** — exponer el dato es suficiente y mantiene el diff acotado. Anótalo como seguimiento.

#### HARNESS
```bash
npx vitest run tests/hooks.test.js
npx eslint --no-cache src/hooks/useMonitorSync.js
grep -c "presenceError" src/hooks/useMonitorSync.js
#   → >= 5 (declaración + 4 usos)
npm run build 2>&1 | tail -5
```

#### COMMIT
`fix(monitor): distinguir fallo de consulta de caja apagada en la presencia (R1)`

---

### FX15 — Subida de la cola fila a fila, con reporte

**Hallazgos:** R2 · **Severidad:** 🟠 Importante
**Archivo:** `src/views/OwnerMonitorView.jsx`

> ⚠️ Este archivo tiene **4167 líneas / ~297 KB**. **No lo leas entero** — supera el límite de las herramientas de lectura. Usa siempre `grep -n` para localizar y lee ventanas acotadas (`offset`/`limit`, o `sed -n 'A,Bp'`).

#### Contexto
`uploadPendingChanges` construye `rowsToInsert` y lo envía en un único `.insert(rowsToInsert)`. Postgres es todo-o-nada: **una** fila que viole el CHECK de `command_type` (por ejemplo `reopen_shift` antes de FX03) o la RLS (tras FX02) rechaza el lote **entero**. El supervisor pulsa "Subir al Sistema", ve un error genérico, y no sabe cuál de sus 8 cambios lo provocó.

#### Edición

**ANCLA:** `const uploadPendingChanges`

Localiza el `insert` del lote:
```bash
grep -n "rowsToInsert" src/views/OwnerMonitorView.jsx
```

Sustituye el `.insert(rowsToInsert)` único por una subida fila a fila con acumulación de resultados:

**ANTES** (patrón; adáptalo al texto literal que encuentres)
```js
            const { error } = await supabaseCloud
                .from('supervisor_commands')
                .insert(rowsToInsert);

            if (error) throw error;
```

**DESPUÉS**
```js
            // R2: inserción fila a fila. Antes iba en un único .insert(), y como
            // Postgres es todo-o-nada, una sola fila inválida (CHECK de
            // command_type, o RLS) rechazaba el lote entero. El supervisor veía un
            // error genérico sin saber cuál de sus cambios lo causó, y la cola
            // quedaba en un estado ambiguo.
            const okRows = [];
            const failedRows = [];

            for (const row of rowsToInsert) {
                const { error: rowError } = await supabaseCloud
                    .from('supervisor_commands')
                    .insert(row);

                if (rowError) {
                    failedRows.push({ row, message: rowError.message, code: rowError.code });
                    console.warn(
                        `[OwnerMonitor] Comando '${row.command_type}' rechazado ` +
                        `(${rowError.code || 's/c'}): ${rowError.message}`
                    );
                } else {
                    okRows.push(row);
                }
            }

            if (failedRows.length > 0) {
                const detalle = failedRows
                    .map(f => `${f.row.command_type}${f.code ? ` (${f.code})` : ''}`)
                    .join(', ');
                // Éxito parcial: los que pasaron ya están en la nube y NO deben
                // reintentarse; solo los fallidos se quedan en la cola.
                showToast(
                    `${okRows.length} de ${rowsToInsert.length} cambios enviados. Fallaron: ${detalle}`,
                    okRows.length > 0 ? 'warning' : 'error'
                );
            }

            if (okRows.length === 0 && rowsToInsert.length > 0) {
                throw new Error(`Ningún comando pudo enviarse: ${failedRows[0]?.message || 'error desconocido'}`);
            }
```

**Limpieza selectiva de la cola.** Localiza dónde se vacía la cola tras el envío. Debe pasar a eliminar **solo** los elementos correspondientes a `okRows`, no la cola completa. Si el mapeo entre `rowsToInsert` y los elementos de la cola no es directo (por índice o por una clave estable), **DETENTE y reporta**: vaciar la cola entera tras un éxito parcial pierde los cambios fallidos, que es exactamente el daño que esta fase evita.

> Comprueba también el nombre del helper de notificación (`showToast` u otro):
> ```bash
> grep -n "showToast\|toast(" src/views/OwnerMonitorView.jsx | head -5
> ```
> Usa el que ya exista en el archivo.

#### HARNESS
```bash
npx eslint --no-cache src/views/OwnerMonitorView.jsx 2>&1 | tail -20
#   → sin errores NUEVOS respecto a LINT-BASE
#     (recuerda: `react-hooks/preserve-manual-memoization` en projectedProducts es preexistente)

grep -n "insert(rowsToInsert)" src/views/OwnerMonitorView.jsx
#   → NO debe devolver nada

npm run build 2>&1 | tail -5
npx vitest run 2>&1 | tail -20   # timeout >= 600 s
```

#### COMMIT
`fix(monitor): subir la cola de comandos fila a fila con reporte por comando (R2)`

---

### FX16 — Eliminar el francotirador global de dispositivo

**Hallazgos:** R3, R5 · **Severidad:** 🟠 Importante / 🟡 Menor
**Archivos:** `src/hooks/useMonitorSync.js`, `src/views/OwnerMonitorView.jsx`, `src/components/PairingScanScreen.jsx`

#### Contexto
Dos sitios adivinan a qué caja pertenece el monitor consultando **globalmente**:
```js
                const { data } = await supabaseCloud
                    .from('sync_documents')
                    .select('device_id')
                    .eq('doc_id', 'bodega_sales_v1')
                    .order('updated_at', { ascending: false })
                    .limit(1);
```
No hay filtro por tienda. En una instalación con varias cajas —o si otro cliente comparte el proyecto Supabase— el monitor se vincula a la **caja más activa del sistema**, que puede ser de otra tienda, y persiste esa elección en `dj_paired_device_id`. A partir de ahí muestra ventas ajenas y **puede enviarles comandos**. Es la contrapartida en el cliente del S3 que FX01 cerró en el servidor.

#### Edición 1 — `useMonitorSync`

**ANCLA:** `.eq('doc_id', 'bodega_sales_v1')`

**ANTES**
```js
        if (!activeDeviceId && supabaseCloud) {
            try {
                const { data } = await supabaseCloud
                    .from('sync_documents')
                    .select('device_id')
                    .eq('doc_id', 'bodega_sales_v1')
                    .order('updated_at', { ascending: false })
                    .limit(1);
                if (data?.[0]?.device_id) {
                    activeDeviceId = data[0].device_id;
                    localStorage.setItem('dj_paired_device_id', activeDeviceId);
                }
            } catch (e) {}
        }
```

**DESPUÉS**
```js
        // R3: eliminado el "francotirador" global. Consultaba sync_documents SIN
        // filtro de tienda y se quedaba con la caja más activa del sistema, que
        // puede pertenecer a OTRO comercio; después persistía esa elección en
        // `dj_paired_device_id` y le enviaba comandos. La pertenencia solo puede
        // venir del emparejamiento, nunca de una heurística.
        if (!activeDeviceId) {
            console.warn('[useMonitorSync] Monitor sin caja vinculada. Se requiere emparejar con un código.');
            setLoading(false);
            return;
        }
```

#### Edición 2 — `OwnerMonitorView.handleAutoRepairPairing`

**ANCLA:** `const handleAutoRepairPairing`

```bash
grep -n "handleAutoRepairPairing" src/views/OwnerMonitorView.jsx
sed -n '<inicio>,<fin>p' src/views/OwnerMonitorView.jsx
```

Sustituye la consulta global de `sync_documents` por la RPC autorizada `list_monitors`, que **sí** valida la pertenencia (es `SECURITY DEFINER` y comprueba `device_monitors`):

```js
            // R3: la auto-reparación no puede adivinar la caja mirando qué
            // device_id escribió más recientemente — eso puede ser otra tienda.
            // `list_monitors` valida la pertenencia en el servidor y solo responde
            // si este dispositivo es un monitor vigente de esa caja.
            const monitorId = localStorage.getItem('dj_device_id');
            const { data: res, error } = await supabaseCloud.rpc('list_monitors', {
                p_requester_id: monitorId
            });

            if (error || !res?.success) {
                showToast('No se pudo reparar el vínculo: este dispositivo no está autorizado en ninguna caja.', 'error');
                return;
            }
```

> El `primary_device_id` correcto se obtiene del emparejamiento, no de una búsqueda. Si la respuesta de `list_monitors` no lo trae directamente, **DETENTE y reporta**: es preferible que la auto-reparación falle a que vincule la tienda equivocada.

#### Edición 3 — R5: no destruir el `dj_device_id` de una caja

**Archivo:** `src/components/PairingScanScreen.jsx`
**ANCLA:** `'mon_'`

**ANTES** (patrón; usa el texto literal del archivo)
```js
            localStorage.setItem('dj_device_id', 'mon_' + ...);
```

**DESPUÉS**
```js
            // R5: si este dispositivo alguna vez operó como caja, sobrescribir su
            // `dj_device_id` deja huérfanos todos sus documentos en la nube (nadie
            // volverá a consultarlos con ese id). Se conserva el original.
            const previousDeviceId = localStorage.getItem('dj_device_id');
            if (previousDeviceId && !previousDeviceId.startsWith('mon_')) {
                localStorage.setItem('dj_previous_pos_device_id', previousDeviceId);
                console.warn(
                    `[PairingScan] Este dispositivo tenía id de caja (${previousDeviceId}). ` +
                    `Se conserva en 'dj_previous_pos_device_id' antes de pasar a modo monitor.`
                );
            }
            localStorage.setItem('dj_device_id', 'mon_' + ...);
```
> Mantén **idéntica** la expresión original que genera el sufijo; solo se añade la preservación previa.

#### HARNESS
```bash
npx vitest run tests/hooks.test.js
npx eslint --no-cache src/hooks/useMonitorSync.js src/components/PairingScanScreen.jsx src/views/OwnerMonitorView.jsx 2>&1 | tail -20

# Ya no queda ninguna búsqueda global de dispositivo
grep -rn "eq('doc_id', 'bodega_sales_v1')" src/
#   → NO debe devolver nada

grep -n "dj_previous_pos_device_id" src/components/PairingScanScreen.jsx
#   → 1 resultado

npm run build 2>&1 | tail -5
```

#### RIESGO Y ROLLBACK
- **Riesgo:** los monitores que hoy dependen del francotirador para "auto-repararse" dejarán de hacerlo y pedirán emparejamiento explícito. **Es el comportamiento correcto**, pero es un cambio visible para el usuario: avísalo.
- **Rollback:** `git revert` de esta fase, sin efectos sobre las demás.

#### COMMIT
`fix(security): eliminar la deteccion global de caja y preservar el device_id previo (R3,R5)`

---

### FX17 — El monitor no lee claves que nunca se sincronizan

**Hallazgos:** R4 · **Severidad:** 🟠 Importante
**Archivo:** `src/views/OwnerMonitorView.jsx`

#### Contexto
`loadLocalData` lee `abasto-auth-storage` y `abasto-device-session`. Ninguna de las dos se sincroniza nunca — y **`abasto-auth-storage` está explícitamente bloqueada en tres sitios** por SEC-002 (`pushCloudSync`, `_applyFromCloud` y `applyDocToLocal`). En el monitor esas claves contienen la sesión **del propio monitor**, no la de la caja, así que la información de operador que se muestra es vacía o pertenece a otra persona.

`bodega_users_catalog_v1` **sí** se sincroniza y es la fuente correcta para nombres y roles (y, tras FX05, está garantizadamente saneada).

#### Edición

**ANCLA:** `const loadLocalData`

```bash
grep -n "abasto-auth-storage\|abasto-device-session" src/views/OwnerMonitorView.jsx
```

**ANTES** (patrón)
```js
        const authRaw = localStorage.getItem('abasto-auth-storage');
        const sessionRaw = localStorage.getItem('abasto-device-session');
```

**DESPUÉS**
```js
        // R4: `abasto-auth-storage` y `abasto-device-session` NUNCA se sincronizan
        // (la primera está bloqueada por SEC-002 en pushCloudSync, _applyFromCloud
        // y applyDocToLocal). En el monitor contienen su PROPIA sesión, no la de la
        // caja, así que leerlas mostraba datos de operador vacíos o ajenos.
        // La fuente correcta es `bodega_users_catalog_v1`, que sí se sincroniza y
        // va saneada (sin `pin` ni `plainPin`) desde FX05.
        let usersCatalog = [];
        try {
            const rawCatalog = localStorage.getItem('bodega_users_catalog_v1');
            const parsed = rawCatalog ? JSON.parse(rawCatalog) : null;
            if (Array.isArray(parsed)) usersCatalog = parsed;
        } catch {}
```

Después, sustituye cada uso de los datos derivados de `authRaw` / `sessionRaw` por su equivalente sobre `usersCatalog`. Localiza todos los consumidores:
```bash
grep -n "authRaw\|sessionRaw\|activeCashier" src/views/OwnerMonitorView.jsx
```

> **Si `activeCashier` procede de esas claves**, su valor en el monitor **nunca fue fiable**. Reemplázalo por el cajero derivado del turno abierto en `bodega_shift_v1` / `bodega_register_closes_v1` (ambos sí se sincronizan; están en `MONITOR_DOC_IDS`). Si no encuentras un origen sincronizado equivalente, **DETENTE y reporta** en vez de inventar uno: FX18 depende de esta decisión.

#### HARNESS
```bash
npx eslint --no-cache src/views/OwnerMonitorView.jsx 2>&1 | tail -20

# El monitor ya no lee claves no sincronizadas
grep -n "abasto-auth-storage\|abasto-device-session" src/views/OwnerMonitorView.jsx
#   → NO debe devolver nada

# La barrera SEC-002 sigue intacta en los 3 puntos
grep -rn "abasto-auth-storage" src/hooks/useCloudSync.js src/hooks/useMonitorSync.js
#   → 3 resultados (los bloqueos), ninguno eliminado

npm run build 2>&1 | tail -5
npx vitest run 2>&1 | tail -20   # timeout >= 600 s
```

#### COMMIT
`fix(monitor): leer los datos de operador del catalogo sincronizado, no de claves locales (R4)`

---

### FX18 — Atribución del cierre remoto y versionado optimista

**Hallazgos:** R6, F5 · **Severidad:** 🟡 Menor / 🟡 Menor · **Depende de:** FX17
**Archivos:** `src/views/OwnerMonitorView.jsx`, `src/utils/remoteInventoryProcessor.js`

#### Contexto
- **R6:** `handleRemoteForceDailyClose` atribuye el cierre a `activeCashier?.nombre || 'Supervisión Remota'`. Tras FX17 sabemos que el `activeCashier` del monitor puede ser rancio o ajeno. Un cierre forzado a distancia queda registrado en la auditoría a nombre de una persona que quizá ni estaba en el turno.
- **F5:** el versionado optimista existe (`baseUpdatedAt`) pero **solo se envía para combos**. Un `inventory_update` corriente del monitor no lleva versión, así que sobrescribe sin avisar cualquier edición que la caja haya hecho entretanto (*last-write-wins* silencioso).

#### Edición 1 — R6: atribución honesta

**ANCLA:** `activeCashier?.nombre || 'Supervisión Remota'`

**ANTES**
```js
                cashierName: activeCashier?.nombre || 'Supervisión Remota',
```
> El nombre exacto de la propiedad puede diferir; usa el que aparezca en el archivo.

**DESPUÉS**
```js
                // R6: un cierre forzado en remoto SIEMPRE se atribuye a la
                // supervisión. El `activeCashier` que conoce el monitor puede estar
                // rancio (ver R4), y firmar el cierre con el nombre de un cajero que
                // quizá no estaba en el turno corrompe la auditoría.
                cashierName: 'Supervisión Remota',
                // Se conserva a título informativo quién creía el monitor que estaba
                // en caja, sin usarlo como autor del cierre.
                observedCashier: activeCashier?.nombre || null,
```

> Si el consumidor del comando (`force_daily_close` en `useSupervisorCommands`) valida la forma del payload, añade `observedCashier` a su desestructuración. Compruébalo:
> ```bash
> grep -n "force_daily_close" src/hooks/useSupervisorCommands.js
> ```

#### Edición 2 — F5: enviar la versión base en todo `inventory_update`

**ANCLA:** `baseUpdatedAt`

```bash
grep -n "baseUpdatedAt" src/views/OwnerMonitorView.jsx src/utils/remoteInventoryProcessor.js
```

Hoy solo aparece en el camino de combos. Extiéndelo a `queueInventoryChange`, para que **todo** cambio de inventario lleve la versión del producto tal como el monitor lo vio:

```js
        // F5: versionado optimista para TODO inventory_update, no solo combos.
        // Sin `baseUpdatedAt` el procesador remoto no puede detectar que la caja
        // modificó el producto entre que el supervisor lo vio y pulsó "Subir":
        // el cambio del monitor pisaba el de la caja sin avisar a nadie.
        const baseProduct = (projectedProducts || []).find(p => p.id === productId);
        const baseUpdatedAt = baseProduct?.updatedAt ?? null;
```
…e inclúyelo en el payload del comando encolado.

Del lado de la caja, `applyInventoryCommand` (en `src/utils/remoteInventoryProcessor.js`) ya sabe comparar `baseUpdatedAt`. **Verifica** que la rama de conflicto exista y devuelva un resultado que acabe en `applied_with_warnings`:
```bash
grep -n "baseUpdatedAt\|applied_with_warnings" src/utils/remoteInventoryProcessor.js
```
- Si la comparación ya está implementada: **no toques nada más**, con enviar el campo basta.
- Si **no** está: **DETENTE y reporta**. Implementar la detección de conflictos desde cero excede el alcance de este plan y necesita una decisión de producto (¿gana la caja, gana el monitor, o se pide confirmación?).

#### HARNESS
```bash
npx vitest run tests/remoteInventory.test.js tests/remoteInventoryD4.test.js tests/commandReapply.test.js
npx eslint --no-cache src/views/OwnerMonitorView.jsx src/utils/remoteInventoryProcessor.js 2>&1 | tail -20

# El cierre remoto ya no se firma con el cajero observado
grep -n "activeCashier?.nombre || 'Supervisión Remota'" src/views/OwnerMonitorView.jsx
#   → NO debe devolver nada

npm run build 2>&1 | tail -5
npx vitest run 2>&1 | tail -20   # timeout >= 600 s
```

#### COMMIT
`fix(monitor): atribuir el cierre remoto a supervision y versionar todo inventory_update (R6,F5)`

---

## 6. Arneses nuevos

Resumen de todo lo que este plan añade a `tests/`. Estos archivos **son el valor duradero del trabajo**: los arreglos puntuales se pueden volver a romper; los arneses avisan cuando ocurre.

| Archivo | Fase | Qué protege | Cómo falla si se rompe |
|---|---|---|---|
| `tests/commandType.test.js` | FX04 | `VALID_COMMAND_TYPES` es espejo 1-a-1 del CHECK `command_type` | El array de constantes y el CHECK del `.sql` divergen |
| `tests/commandStatus.test.js` (ampliado) | FX04 | Ningún `status:` literal del código queda fuera del enum | Aparece un `'cancelled'`-like nuevo sin registrar |
| `tests/egressHashOwnership.test.js` | FX07 | `pushCloudSync` es el único que escribe el hash de egress | Alguien vuelve a poner `localStorage.setItem(hashKey, …)` tras un `await pushCloudSync` |
| `tests/userSanitization.test.js` (ampliado) | FX05 | `bodega_users_catalog_v1` solo se escribe saneado | Aparece una escritura sin `sanitizeUserCatalog` |

### 6.1 Por qué estos cuatro y no más

Cada arnés cubre un **invariante estructural verificable leyendo el código fuente**, sin necesidad de simular Supabase. Eso los hace rápidos, deterministas y ejecutables por un LLM sin infraestructura. Los hallazgos que **no** llevan arnés (D3, D4, R1–R6) requerirían mocks de red que este plan no introduce; su verificación es la sección `VERIFICACIÓN MANUAL` de cada fase.

### 6.2 Verificación de que un arnés sirve

Un test que no falla cuando el defecto está presente es peor que ningún test. Para cada arnés nuevo, ejecuta el ciclo **romper → confirmar fallo → restaurar**:

```bash
# Ejemplo con FX07
git stash                                    # guarda el arreglo
npx vitest run tests/egressHashOwnership.test.js   # DEBE FALLAR
git stash pop                                # restaura
npx vitest run tests/egressHashOwnership.test.js   # DEBE PASAR
```

Si el test pasa en ambos estados, **no sirve**: repórtalo.

---

## 7. Guardarraíles — qué NO tocar

Estas afirmaciones se **verificaron** durante la auditoría. Son correctas. Modificarlas es una regresión, no una mejora.

### 7.1 Barreras de seguridad ya correctas

| Elemento | Archivo | Por qué es correcto |
|---|---|---|
| `CLOUD_SYNC_EXCLUDE` | `useCloudSync.js` | `['bodega_sales_mirror_v1','abasto_audit_log_v1','bodega_pos_heartbeat']` — el guard `if (!SYNC_KEYS.includes(key)) return;` de `pushCloudSync` lo hace efectivo también para `forceSyncAllPOSData` y `forcePushLocalData` |
| Bloqueo de `abasto-auth-storage` | 3 sitios | `pushCloudSync`, `_applyFromCloud` y `applyDocToLocal`. **Los tres son necesarios**: cubren egress, ingress en la caja e ingress en el monitor |
| `sanitizeUserCatalog` | `userCatalog.js` | Elimina `pin` y `plainPin`. La función es correcta; el problema (S4) era que se **esquivaba** |
| `sanitizeRateMode` | aplicado en `applyDocToLocal` | Impide que un `bodega_rate_mode` corrupto llegue al monitor |
| `withLock('pos_write_lock')` | `remoteInventoryProcessor.js` | Serializa el read-modify-write. **No lo quites ni lo anides** — `tests/lockNesting.guard.test.js` lo vigila |
| `isReappliableCommand` | `remoteInventoryProcessor.js` | Idempotencia de los comandos. Cubierto por `tests/commandReapply.test.js` |
| `REPLICA IDENTITY DEFAULT` | `supabase_egress_optimization.sql` | **No lo cambies a `FULL`**: duplicaría el payload de cada mensaje de realtime |
| Circuit Breaker de inventario | `storageService.js` | Protege contra escrituras que vacíen el inventario. Cubierto por `tests/storageGuard.test.js` |
| Dedup `dj_applied_supervisor_cmds_v1` | `useSupervisorCommands.js` | Tope de 200 ids; evita reaplicar comandos |

### 7.2 Deuda técnica preexistente, fuera de alcance

- **`react-hooks/preserve-manual-memoization`** en `OwnerMonitorView.jsx`, ancla `const projectedProducts = useMemo(() => {`. Preexistente. **No lo arregles en este plan.**
- La política contradictoria `sync_documents_device_isolation` de `supabase_rls_hardening.sql` (solo `authenticated`, usa `payload->>'owner_id'`, y hace `REVOKE ... FROM anon`) **contradice** `sync_documents_anon_access` de `supabase_pairing_setup.sql`. Si ambas se despliegan, el orden decide qué gana. **Esto merece un plan propio** (migrar la app a Supabase Auth) y queda **explícitamente fuera de alcance**. Anótalo en el reporte.
- La duplicidad `useCloudSync.isSyncingFromCloud` vs `syncFlags.js`: FX11 los **conecta**, no los unifica. Unificarlos es un refactor mayor, fuera de alcance.

### 7.3 Prohibiciones absolutas

1. **No ejecutes SQL contra Supabase.** Las fases SQL solo escriben archivos.
2. **No toques** `supabase_rls_hardening.sql` ni `supabase_cloud_schema.sql`.
3. **No conviertas finales de línea** masivamente (ver R-0.2).
4. **No amplíes `MONITOR_DOC_IDS`** — cada entrada es egress recurrente y ya está afinada.
5. **No elimines** `bodega_pending_cart_v1` de `MONITOR_DOC_IDS`: el monitor lo consume.
6. **No cambies** `DEBOUNCE_HEAVY_MS` ni el contenido de `HEAVY_KEYS` — están en el diff sin commitear de FX00 y **su ajuste es una decisión aparte** (ver seguimiento en la [sección 9.3](#93-seguimiento-pendiente)).
7. **No introduzcas dependencias nuevas.** Ninguna fase lo requiere.

---

## 8. Despliegue SQL y verificación manual

> Esta sección la ejecuta **una persona**, no el LLM. El LLM la deja escrita y se detiene.

### 8.1 Orden obligatorio

```
1. Diagnóstico previo (8.3)  ← NO SALTAR
2. supabase_supervisor_commands_setup.sql       (FX03: CHECKs ampliados)
3. supabase_sync_supervisor_hardening.sql       (FX01+FX02+FX10: nuevo)
4. Despliegue del bundle JS
```

**El paso 3 va antes que el 4.** Motivo: FX10 elimina `updated_at` del upsert del cliente y el `DEFAULT now()` + trigger deben existir ya. Si `sync_documents.updated_at` es `NOT NULL` sin default, invertir el orden **rompe todos los upserts**.

### 8.2 Ventana y reversibilidad

- Los pasos 2 y 3 son **idempotentes** y no bloquean tablas de forma prolongada (`ALTER TABLE ... ADD CONSTRAINT` sobre un CHECK ampliado no revalida filas).
- No hace falta ventana de mantenimiento, pero **sí** conviene hacerlo con la tienda cerrada: FX01 cambia el comportamiento de emparejamiento.

### 8.3 Diagnóstico previo (obligatorio)

Ejecuta en el SQL Editor de Supabase (proyecto `sodgzkablshladvbtnes`) y **guarda la salida** antes de aplicar nada:

```sql
-- (a) ¿updated_at admite nulos? Decide el orden de despliegue de FX10.
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'sync_documents' AND column_name = 'updated_at';

-- (b) ¿Hay filas que FX02 dejaría ilegibles? (monitor_device_id nulo o comodín)
SELECT monitor_device_id, status, count(*)
FROM public.supervisor_commands
WHERE monitor_device_id IS NULL OR monitor_device_id = 'monitor_web'
GROUP BY 1, 2;

-- (c) ¿Cuántas filas de device_pairings NO tienen monitor?
--     Estas son las candidatas a haberse creado por el vector S1.
SELECT count(*) AS sin_monitor
FROM public.device_pairings
WHERE monitor_device_id IS NULL;

-- (d) ¿Hay monitores activos que quedarían fuera tras S2?
SELECT dp.primary_device_id, dp.monitor_device_id,
       EXISTS (SELECT 1 FROM public.device_monitors dm
               WHERE dm.primary_device_id = dp.primary_device_id
                 AND dm.monitor_device_id = dp.monitor_device_id
                 AND dm.revoked_at IS NULL) AS en_device_monitors
FROM public.device_pairings dp
WHERE dp.monitor_device_id IS NOT NULL;

-- (e) Cajas registradas y su última presencia.
SELECT primary_device_id, monitor_device_id, last_seen_at, paired_at
FROM public.device_pairings
ORDER BY last_seen_at DESC NULLS LAST;
```

**Reglas de decisión:**
- Si **(b)** devuelve filas → esos comandos dejarán de ser legibles tras FX02. Decide si migrarlos (asignándoles el `monitor_device_id` real) o darlos por cerrados. **No apliques FX02 sin resolver esto.**
- Si **(c)** devuelve un número mayor que el de tus cajas reales → hay filas creadas por el vector S1. Investígalas antes de continuar.
- Si **(d)** muestra `en_device_monitors = false` para un monitor en uso → tras FX01 ese monitor dejará de estar autorizado. Vuelve a emparejarlo, o inserta su fila en `device_monitors` **antes** de aplicar.

### 8.4 Verificación posterior al despliegue

Con el SQL aplicado y el bundle desplegado, comprueba cada mitigación:

```sql
-- S1: el heartbeat NO crea filas.
SELECT public.touch_pos_heartbeat('dispositivo_inexistente_xyz');
--   → { "success": false, "registered": false, ... }
SELECT count(*) FROM public.device_pairings WHERE primary_device_id = 'dispositivo_inexistente_xyz';
--   → 0

-- S2: la autorización exige un monitor real.
SELECT public.is_authorized_monitor('<caja_real>', 'atacante_xyz');
--   → false
SELECT public.is_authorized_monitor('<caja_real>', 'monitor_web');
--   → false   (el comodín desapareció)
SELECT public.is_authorized_monitor('<caja_real>', '<monitor_real>');
--   → true

-- S3: sin fallback global.
SELECT public.generate_monitor_token('solicitante_no_autorizado_xyz');
--   → { "success": false, "message": "No autorizado para generar códigos..." }

-- S7: desconocido = revocado.
SELECT public.touch_monitor_heartbeat('monitor_inexistente_xyz');
--   → { "success": true, "is_revoked": true }

-- F1/F2: los nuevos valores se aceptan.
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN ('supervisor_commands_status_check',
                  'supervisor_commands_command_type_check');
--   → deben incluir 'cancelled' y 'reopen_shift'

-- D5: el trigger está activo.
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_sync_documents_updated_at';
--   → 1 fila, tgenabled = 'O'
```

### 8.5 Prueba de humo funcional (con dispositivos reales)

Ejecútalas **en este orden**. Cada una valida un hallazgo distinto.

| # | Prueba | Resultado esperado | Valida |
|---|---|---|---|
| 1 | Emparejar un monitor limpio con un QR nuevo | Trae **todos** los datos, no una pantalla vacía | E1, D1 |
| 2 | Caja: poner el navegador offline, editar un producto, volver online | El cambio llega al monitor en ≤ 60 s | **D1** |
| 3 | Monitor: pulsar "Cancelar" en un comando pendiente | El comando pasa a `cancelled`, sin error en consola | F1 |
| 4 | Monitor: "Reabrir turno" | El comando se inserta y la caja lo aplica | F2 |
| 5 | Monitor: cambiar el PIN de un usuario | Funciona, y en `supervisor_commands.payload` **no** aparece el PIN en claro | **S5** |
| 6 | Consultar `sync_documents` con `doc_id='bodega_users_catalog_v1'` | Ningún objeto contiene `pin` ni `plainPin` | **S4** |
| 7 | Monitor: revocarlo desde la caja | El monitor queda expulsado en ≤ 60 s | S7 |
| 8 | Monitor: 5 cambios de inventario, uno inválido | Se suben 4 y el toast dice **cuál** falló | R2 |
| 9 | Monitor: cortar la red y forzar refresco | Mensaje de error, **no** "Caja fuera de línea", y `dj_monitor_last_full_pull_ts` sin cambiar | R1, D3 |
| 10 | Restaurar un backup en la caja | El monitor refleja el estado restaurado | D7 |
| 11 | Adelantar el reloj del monitor 5 min y editar un producto en la caja | El cambio llega igualmente | **D5** |

Las pruebas **2**, **5**, **6** y **11** son las que cubren los defectos más graves y difíciles de detectar. No las omitas.

---

## 9. Checklist final

### 9.1 Por fase

Marca cada fase solo cuando **las cuatro** condiciones se cumplan.

| Fase | Hallazgos | Arnés OK | Sin fallos nuevos vs FALLOS-BASE | Sin lint nuevo vs LINT-BASE | Commit hecho |
|---|---|---|---|---|---|
| FX00 | — (línea base) | n/a | ☐ | ☐ | ☐ |
| FX01 | S1 S2 S3 S7 | ☐ | ☐ | n/a (SQL) | ☐ |
| FX02 | S6 | ☐ | ☐ | n/a (SQL) | ☐ |
| FX03 | F1 F2 | ☐ (falla a propósito) | n/a | n/a (SQL) | ☐ |
| FX04 | F3 F4 | ☐ | ☐ | ☐ | ☐ |
| FX05 | S4 | ☐ | ☐ | ☐ | ☐ |
| FX06 | S5 | ☐ | ☐ | ☐ | ☐ |
| FX07 | D1 | ☐ | ☐ | ☐ | ☐ |
| FX08 | D2 D6 | ☐ | ☐ | ☐ | ☐ |
| FX09 | D3 D4 | ☐ | ☐ | ☐ | ☐ |
| FX10 | D5 | ☐ | ☐ | ☐ | ☐ |
| FX11 | D7 | ☐ | ☐ | ☐ | ☐ |
| FX12 | E1 E2 | ☐ | ☐ | ☐ | ☐ |
| FX13 | E3 | ☐ | ☐ | ☐ | ☐ |
| FX14 | R1 | ☐ | ☐ | ☐ | ☐ |
| FX15 | R2 | ☐ | ☐ | ☐ | ☐ |
| FX16 | R3 R5 | ☐ | ☐ | ☐ | ☐ |
| FX17 | R4 | ☐ | ☐ | ☐ | ☐ |
| FX18 | R6 F5 | ☐ | ☐ | ☐ | ☐ |

**Cobertura: 28 / 28 hallazgos.**

### 9.2 Cierre global

```bash
# 1. Suite completa (timeout >= 600 s)
npx vitest run --reporter=dot --testTimeout=30000 2>&1 | tail -30

# 2. Lint del conjunto afectado
npx eslint --no-cache \
  src/hooks/useCloudSync.js \
  src/hooks/useMonitorSync.js \
  src/hooks/useSupervisorCommands.js \
  src/hooks/useCloudBackup.js \
  src/hooks/store/useAuthStore.js \
  src/components/Settings/UsersManager.jsx \
  src/components/Settings/PairingManager.jsx \
  src/components/PairingScanScreen.jsx \
  src/constants/commandStatus.js \
  src/constants/commandType.js \
  src/views/OwnerMonitorView.jsx 2>&1 | tail -30

# 3. Build
npm run build 2>&1 | tail -10

# 4. Tipos (informativo, no bloqueante)
npm run typecheck 2>&1 | tail -10

# 5. Invariantes estructurales — TODOS deben cumplirse
grep -c "localStorage.setItem(hashKey" src/hooks/useCloudSync.js          # → 1
grep -rn "eq('doc_id', 'bodega_sales_v1')" src/                            # → vacío
grep -rn "newPin:" src/components/ src/views/                              # → vacío
grep -rn "localStorage.setItem('bodega_users_catalog_v1'" src/ | grep -v sanitizeUserCatalog   # → vacío
grep -n "const { data: docs } = await query" src/hooks/*.js                # → vacío
grep -n "updated_at: new Date().toISOString()" src/hooks/useCloudSync.js   # → vacío
grep -c '\$\$' supabase_sync_supervisor_hardening.sql                      # → PAR

# 6. Historial: 19 commits, uno por fase
git log --oneline fix/sync-supervisor-audit ^main | wc -l                  # → 19
```

### 9.3 Seguimiento pendiente

Deja constancia de estos puntos en el reporte final. **Ninguno se resuelve en este plan.**

1. **`sync_documents_device_isolation` contradice `sync_documents_anon_access`.** El arreglo real es migrar la app a Supabase Auth y derivar la autorización de `auth.uid()` en vez de la existencia de filas. Es el único cambio que cierra S1–S6 de raíz en lugar de mitigarlos. **Requiere su propio plan.**
2. **`HEAVY_KEYS` y `DEBOUNCE_HEAVY_MS`.** El diff sin commitear quitó `bodega_sales_v1` de `HEAVY_KEYS` y bajó el debounce de 3000 a 2000 ms. Ambos cambios **aumentan** el egress. Este plan no los revierte porque son una decisión de producto (latencia frente a coste), pero deben decidirse explícitamente.
3. **La compuerta de autenticación eliminada.** FX12 la sustituye por `register_pos_device` + tope por documento, no por la compuerta original. Si el egress sigue siendo alto tras FX12, el siguiente paso es reintroducir una compuerta con reintento.
4. **UI de `presenceError`.** FX14 expone el dato; `OwnerMonitorView` todavía no lo muestra. Es una mejora de UX de una sola línea, pendiente.
5. **`newPin` legacy.** FX06 lo mantiene por compatibilidad de una versión. Elimínalo en el despliegue siguiente, junto con su `console.warn`.
6. **Purga `dj_egress_hash_purge_v1`.** Es de un solo uso y su bandera queda en `localStorage` para siempre. Si en el futuro hace falta otra purga, usa `_v2`.
7. **Dos banderas anti-eco.** FX11 las conecta; unificarlas en un único módulo sigue pendiente.

### 9.4 Formato del reporte final

Al terminar, entrega **exactamente** esto:

```
LÍNEA BASE
  HEAD:            <sha>
  FALLOS-BASE:     <N passed | M failed>  (o "ninguno")
  LINT-BASE:       <lista de errores preexistentes>

FASES
  FX00 … FX18: APLICADA | OMITIDA (motivo) | DETENIDA (ancla que no coincidió + texto real)

INVARIANTES (sección 9.2, punto 5)
  <cada comando y su salida>

RESULTADO FINAL
  Tests:  <N passed | M failed>   ← comparado con FALLOS-BASE
  Lint:   <errores>               ← comparado con LINT-BASE
  Build:  OK | FALLO

PENDIENTE PARA UNA PERSONA
  - Desplegar los .sql en el orden de la sección 8.1
  - Ejecutar el diagnóstico previo de 8.3 ANTES de aplicar
  - Ejecutar la prueba de humo de 8.5

SEGUIMIENTO
  <los 7 puntos de 9.3 que sigan abiertos>
```

**No declares nada como terminado que no hayas ejecutado y verificado.** Si una fase quedó detenida, dilo con esas palabras y con el ancla exacta que falló. Un reporte honesto de 14 fases aplicadas y 5 detenidas es útil; uno que dice "todo listo" sin haberlo comprobado, no.

---

*Fin del plan. 28 hallazgos, 19 fases, 4 arneses nuevos.*
