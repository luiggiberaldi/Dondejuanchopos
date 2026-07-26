# Plan de Fixes — Presencia de Caja y RLS de Comandos (Ronda 3)

**Fecha:** 2026-07-25
**Alcance:** commits `9ff8854`, `17ebfd7`, `373f76c`, `262e51c` (posteriores al plan `PLAN_FIXES_MULTISUPERVISOR.md`)
**Estado del harness al momento de la revisión:** `npm run build` ✓ · `vitest run` 27/27 ✓ · 1 error de lint preexistente (`react-hooks/preserve-manual-memoization` en `OwnerMonitorView.jsx`)

---

## 1. Veredicto sobre los 3 hallazgos anteriores

| # | Hallazgo de la ronda 2 | Estado hoy |
|---|---|---|
| 1 | Escritura directa del cliente a `device_pairings` (violación SEC-010) | **Corregido a medias.** El `upsert` directo desapareció y ahora se usa `rpc('touch_pos_heartbeat')` ✓ — pero la RPC creada para ello abre dos agujeros nuevos (N1 y N2 abajo). |
| 2 | Consulta extra por chequeo de presencia | **Persiste y empeoró.** Pasó de 2 a 3 consultas por chequeo, y la tercera mide algo incorrecto. |
| 3 | Ventana de "en línea" de 10 minutos | **Persiste sin cambios.** `useMonitorSync.js` sigue con `setIsPosOnline(diffMs <= 600000)`. |

Y aparecieron **4 defectos nuevos**, dos de ellos de seguridad y más graves que los 3 originales.

---

## 2. Hallazgos nuevos

### 🔴 N1 — La política INSERT de `supervisor_commands` quedó abierta

Commit `373f76c` ("permitir insercion de comandos ... RLS 42501") reemplazó la validación positiva de FX2.1 por:

```sql
WITH CHECK (
    EXISTS (SELECT 1 FROM public.device_pairings dp
            WHERE dp.primary_device_id = supervisor_commands.primary_device_id)
    AND NOT EXISTS (SELECT 1 FROM public.device_monitors dm
            WHERE dm.monitor_device_id = supervisor_commands.monitor_device_id
              AND dm.revoked_at IS NOT NULL)
)
```

Ya no se exige ninguna relación entre el monitor y la caja. Con eso:

- `primary_device_id` de cualquier tienda es **públicamente legible** (política SELECT de `device_pairings`: `USING (... OR monitor_device_id IS NOT NULL)`).
- Cualquier cliente `anon` puede insertar `void_sale`, `inventory_update`, `user_update` o `rate_change` contra **cualquier caja**, pasando un `monitor_device_id` inventado.
- La segunda mitad (`NOT EXISTS ... revoked`) es un **no-op**: FX6 eliminó la política SELECT de `device_monitors`, y las subconsultas de una política RLS se evalúan con los permisos del *llamante* (`anon`), que ve 0 filas. Un monitor revocado tampoco queda bloqueado.

### 🔴 N2 — `touch_pos_heartbeat` es un INSERT sin validación abierto a `anon`

```sql
CREATE OR REPLACE FUNCTION public.touch_pos_heartbeat(p_device_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO public.device_pairings (primary_device_id, paired_at)
    VALUES (p_device_id, now())
    ON CONFLICT (primary_device_id) DO UPDATE SET paired_at = now();
    RETURN json_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.touch_pos_heartbeat(TEXT) TO anon, authenticated;
```

Es `SECURITY DEFINER` (salta RLS), no valida al llamante y **crea filas nuevas**. Cualquiera puede poblar `device_pairings` con identificadores arbitrarios. Combinado con N1, es la llave exacta que la política debilitada exige (`EXISTS (device_pairings ...)`): un atacante crea su propia fila y desde ahí inserta comandos.

Además pisa `paired_at`, cuya semántica es "cuándo se vinculó el monitor" — se sobrescribe cada 60 s.

### 🟠 N3 — La compuerta de CloudSync quedó muerta

En [useCloudSync.js:293-303](src/hooks/useCloudSync.js#L293-L303) las dos ramas asignan lo mismo:

```js
if (!rpcErr && rpcRes && rpcRes.success) {
    isRegisteredOrPaired = true;
} else {
    // Si la RPC aún no ha sido corrida en SQL, asumimos verdadero para cajas locales activas
    isRegisteredOrPaired = true;
}
```

La guarda `if (!hasAuth && !isRegisteredOrPaired) { isCloudSyncActive = false; ... }` nunca se dispara: **cualquier dispositivo activa la sincronización a la nube**, incluido uno nunca vinculado. Es exactamente la protección de egreso que el plan original introdujo.

Justo arriba hay además una consulta a `device_monitors` que siempre devuelve 0 filas (sin política SELECT desde FX6): egreso puro sin efecto.

### 🟠 N4 — Notificaciones duplicadas entre supervisores

Commit `262e51c` revirtió `event: 'INSERT'` a `event: '*'` en el canal de `supervisor_commands` de [OwnerMonitorView.jsx:390](src/views/OwnerMonitorView.jsx#L390). El refetch en UPDATE es legítimo (limpia el banner de pendientes), pero el handler del *toast* no distingue el tipo de evento: cada comando notifica dos veces — al insertarse y cuando la caja lo marca aplicado.

### 🟡 N5 — `checkPosPresence` mide al monitor, no a la caja

[useMonitorSync.js:80-93](src/hooks/useMonitorSync.js#L80-L93) agregó una tercera consulta que lee `device_monitors.last_seen_at` — que es el heartbeat **de los propios monitores**, no de la caja. Si se restaurara la lectura de esa tabla, el monitor se vería a sí mismo y reportaría "caja en línea" permanentemente. Hoy no rompe nada sólo porque la consulta devuelve 0 filas: es egreso desperdiciado y un bug de corrección latente.

### Causa raíz real del 42501 que se intentaba resolver

No era que la política fuera "demasiado estricta". La versión FX2.1 era correcta, pero su segunda rama leía `device_monitors`, y **FX6 había eliminado la política SELECT de esa tabla en el commit anterior**. Como las subconsultas de RLS corren con los permisos de `anon`, esa rama siempre daba falso. Resultado: el monitor #1 pasaba (rama de `device_pairings`, que sí es legible) y el monitor #2 en adelante recibía 42501. La corrección correcta es evaluar la pertenencia mediante una función `SECURITY DEFINER`, no aflojar la política.

---

## 3. Plan de fixeo

Orden obligatorio: **FP1 y FP2 (SQL) antes que FP3–FP6 (JS)**. Una fase = un commit. Tras cada fase: `npx eslint --no-cache <archivos>`, `npx vitest run`, `npm run build`. Si el código no coincide con lo descrito aquí, **DETENERSE y reportar** en vez de improvisar.

Reglas vigentes que este plan no puede violar: SEC-002, SEC-009, SEC-010, guarda FIN-022, no borrar métodos de pago COP de fábrica, **sin código de migración de datos**, y no hacer push salvo pedido explícito.

---

### FP1 🔴 — Restaurar la política INSERT de `supervisor_commands`

**Archivo:** `supabase_supervisor_commands_setup.sql`
**Ancla:** el bloque `CREATE POLICY "supervisor_commands_monitor_insert"`.

**1.1** Agregar, antes de las políticas, un validador que salte RLS:

```sql
-- Valida pertenencia monitor↔caja saltando RLS (device_monitors no es legible por anon desde FX6).
CREATE OR REPLACE FUNCTION public.is_authorized_monitor(p_primary TEXT, p_monitor TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.device_monitors dm
        WHERE dm.primary_device_id = p_primary
          AND dm.monitor_device_id = p_monitor
          AND dm.revoked_at IS NULL
    ) OR EXISTS (
        SELECT 1 FROM public.device_pairings dp
        WHERE dp.primary_device_id = p_primary
          AND dp.monitor_device_id = p_monitor
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_authorized_monitor(TEXT, TEXT) TO anon, authenticated;
```

**1.2** Reemplazar el `WITH CHECK` por la validación positiva:

```sql
DROP POLICY IF EXISTS "supervisor_commands_monitor_insert" ON public.supervisor_commands;
CREATE POLICY "supervisor_commands_monitor_insert" ON public.supervisor_commands
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        public.is_authorized_monitor(
            supervisor_commands.primary_device_id,
            supervisor_commands.monitor_device_id
        )
    );
```

**Qué queda fuera a propósito:** las políticas SELECT y UPDATE de `supervisor_commands` siguen validando sólo que la caja exista. No se pueden endurecer hoy: bajo el rol `anon` la base **no tiene forma de saber qué dispositivo es el llamante** (no hay claim de identidad en el JWT), y la caja necesita leer y actualizar sus propios comandos. Endurecerlas requiere mover esas operaciones a RPC `SECURITY DEFINER` con `p_requester_id`, que es un cambio de arquitectura fuera de esta ronda. Se deja anotado.

**Honestidad sobre el alcance de FP1:** no vuelve el sistema inexpugnable — quien conozca un par `(primary_device_id, monitor_device_id)` válido puede seguir insertando. Pero `monitor_device_id` dejó de ser legible públicamente tras FX6, así que se restaura la defensa en profundidad que el commit `373f76c` eliminó.

**Verificación (SQL Editor de Supabase, sesión `anon`):**
1. Con un `primary_device_id` real y un `monitor_device_id` inventado → el INSERT debe fallar con 42501.
2. Con un par real de `device_monitors` (monitor #2) → debe pasar. *Este es el caso que daba 42501 y que motivó el commit; debe quedar resuelto.*
3. Revocar el monitor #2 (`revoke_monitor`) y reintentar → debe fallar con 42501.

---

### FP2 🔴 — Endurecer `touch_pos_heartbeat`

**Archivo:** `supabase_multisupervisor_setup.sql`
**Ancla:** el bloque `-- 8. RPC: Heartbeat de presencia de la caja principal`.

**2.1** Columna dedicada, para dejar de pisar `paired_at`:

```sql
ALTER TABLE public.device_pairings ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
```

(Es una adición de esquema, no una migración de datos: no se reescribe ninguna fila existente.)

**2.2** La RPC pasa a ser **sólo UPDATE**, nunca INSERT:

```sql
CREATE OR REPLACE FUNCTION public.touch_pos_heartbeat(p_device_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.device_pairings
    SET last_seen_at = now()
    WHERE primary_device_id = p_device_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Dispositivo no registrado.');
    END IF;

    RETURN json_build_object('success', true);
END; $$;
```

**Por qué no necesita crear filas:** la fila de una caja en `device_pairings` la crea `generate_pairing_token` cuando el usuario genera un PIN. Una caja que nunca se vinculó no tiene monitor observándola, así que no tiene presencia que reportar. Eliminar el INSERT cierra N2 sin romper ningún flujo real.

**Costo de egreso:** 1 RPC cada 60 s por caja. Verificado que **ningún cliente se suscribe a `device_pairings` por Realtime** (las suscripciones activas son a `sync_documents`, `supervisor_commands` y `backup_requests`), por lo que el UPDATE no genera fan-out.

**Verificación:** ejecutar `select public.touch_pos_heartbeat('id-inventado-xyz')` → `success:false` y **cero filas nuevas** en `device_pairings`. Con el id real de la caja → `success:true` y `last_seen_at` actualizado.

---

### FP3 🟠 — Restaurar la compuerta de CloudSync

**Archivo:** [src/hooks/useCloudSync.js](src/hooks/useCloudSync.js)
**Ancla:** `let isRegisteredOrPaired = false;` dentro de `initSync`.

**3.1** Borrar la consulta redundante a `device_monitors` (siempre 0 filas) y todo el bloque de autorregistro `if (!isRegisteredOrPaired && deviceId) { ... }`. El bloque queda:

```js
let isRegisteredOrPaired = false;
try {
    const { data: pairing } = await supabaseCloud
        .from('device_pairings')
        .select('primary_device_id')
        .eq('primary_device_id', deviceId)
        .maybeSingle();
    isRegisteredOrPaired = !!pairing;
} catch (e) {
    console.warn('[CloudSync] Error verificando registro de la caja:', e);
}
```

**3.2** Para que vincular la caja durante la sesión no exija recargar, la rama en pausa reintenta una vez por minuto (1 consulta/min y sólo mientras el dispositivo esté sin vincular):

```js
if (!hasAuth && !isRegisteredOrPaired) {
    isCloudSyncActive = false;
    isInitialized.current = true;
    console.log('[CloudSync] Dispositivo sin sesión ni vinculación remota. Sincronización en la nube pausada (Modo Local/Offline).');
    if (!gateRetryTimer) {
        gateRetryTimer = setTimeout(() => {
            gateRetryTimer = null;
            isInitialized.current = false;
            initSync();
        }, 60000);
    }
    return;
}
```

Declarar `let gateRetryTimer = null;` junto a las otras variables de módulo (`isCloudSyncActive`, `globalSubscription`) y limpiarlo en el cleanup del efecto (`clearTimeout(gateRetryTimer); gateRetryTimer = null;`), igual que se hace con `presenceIntervalId`.

**Verificación manual:** en un navegador limpio (sin fila en `device_pairings`) debe aparecer en consola "Sincronización en la nube pausada" y **ninguna** petición a `sync_documents` en la pestaña Network. Al generar un PIN de vinculación desde Ajustes, la sincronización debe activarse sola en ≤60 s.

---

### FP4 🟠 — `checkPosPresence`: una sola fuente de verdad

**Archivo:** [src/hooks/useMonitorSync.js](src/hooks/useMonitorSync.js)
**Ancla:** la función `checkPosPresence`, desde la consulta a `sync_documents` hasta `setIsPosOnline`.

Reemplazar las **3 consultas** por **1**, apoyada en la columna dedicada de FP2:

```js
const { data: pairing } = await supabaseCloud
    .from('device_pairings')
    .select('last_seen_at, paired_at')
    .eq('primary_device_id', pairedDeviceId)
    .maybeSingle();

const stamp = pairing?.last_seen_at || pairing?.paired_at || null;
```

Eliminar por completo el bloque `device_monitors` (mide el heartbeat de los monitores, no de la caja) y el bloque `sync_documents` (redundante: la caja late cada 60 s vía `touch_pos_heartbeat`, mientras que `sync_documents.updated_at` sólo se mueve cuando hay cambios de datos).

**Dependencia dura:** FP4 exige FP2 aplicado en la base. Sin `last_seen_at`, el fallback a `paired_at` haría ver la caja fuera de línea. Si FP2 no está corrido en SQL, **no aplicar FP4**.

**Ahorro:** de 3 a 1 consulta por chequeo, y el chequeo corre cada 30 s (FX9) por cada monitor conectado.

---

### FP5 🟡 — Ventana de presencia a 3 minutos

**Archivo:** [src/hooks/useMonitorSync.js:100](src/hooks/useMonitorSync.js#L100)

```js
// Considerar la caja En Línea si reportó actividad en los últimos 3 minutos (3 latidos perdidos)
setIsPosOnline(diffMs <= 180000);
```

Con el heartbeat de 60 s de FP2/FP3, 3 minutos equivalen a tres latidos perdidos: suficiente tolerancia para un corte breve de red y honesto para el usuario. Los 600000 ms actuales muestran "en línea" una caja apagada hace 9 minutos.

---

### FP6 🟡 — Toast sólo en INSERT

**Archivo:** [src/views/OwnerMonitorView.jsx:390](src/views/OwnerMonitorView.jsx#L390)

Mantener `event: '*'` (el refetch en UPDATE limpia el banner de pendientes — es el comportamiento que buscaba `262e51c`) y condicionar únicamente la notificación:

```js
const newCmd = payload.new;
if (payload.eventType === 'INSERT' && newCmd && newCmd.monitor_device_id !== myDeviceId) {
    // ... toast de "otro supervisor hizo X"
}
// El refetch del banner de pendientes se ejecuta en todos los eventos.
```

**Verificación manual:** con dos monitores conectados, una acción del monitor A debe producir **una sola** notificación en el monitor B, y el banner de pendientes debe limpiarse solo cuando la caja aplique el comando.

---

## 4. Decisiones

| ID | Decisión | Motivo |
|---|---|---|
| E1 | Validar pertenencia con `is_authorized_monitor()` `SECURITY DEFINER` en vez de subconsultas en la política | Las subconsultas de RLS corren como `anon`, que no ve `device_monitors` desde FX6. Es la causa raíz real del 42501. |
| E2 | No endurecer las políticas SELECT/UPDATE de `supervisor_commands` | Bajo `anon` la base no puede identificar al llamante. Requiere migrar a RPC; fuera de alcance, queda anotado. |
| E3 | `touch_pos_heartbeat` sólo UPDATE, jamás INSERT | La fila la crea `generate_pairing_token`. Un INSERT abierto a `anon` es escalada de privilegios. |
| E4 | Columna `last_seen_at` nueva en lugar de reusar `paired_at` | `paired_at` significa "cuándo se vinculó"; pisarlo cada 60 s destruye información y confunde a `list_monitors`. |
| E5 | Compuerta de CloudSync con reintento de 60 s, no autorregistro | Preserva el ahorro de egreso sin obligar a recargar tras vincular. |
| E6 | Presencia = sólo `device_pairings` | 1 consulta en vez de 3; `sync_documents.updated_at` mide cambios de datos, no presencia. |
| E7 | Ventana de 3 min | Tres latidos de 60 s. |
| E8 | `event: '*'` se queda; se filtra el toast | El refetch en UPDATE es necesario para el banner. |

---

## 5. Riesgos y orden

- **FP1 y FP2 son SQL puro** y deben correrse en Supabase antes de desplegar el JS. FP4 no funciona sin FP2.
- **FP3 endurece la activación de la nube.** Si alguna caja en producción llegó a sincronizar sin tener fila en `device_pairings` (posible con el bug N3 activo), dejará de sincronizar hasta que se genere un PIN de vinculación. Verificar en la tabla antes de desplegar cuántas cajas están en esa situación.
- Ninguna fase toca lógica financiera, `parseFloat`, la guarda FIN-022 ni los métodos de pago COP.

## 6. Si algo no encaja

Si al abrir un archivo el código no coincide con las anclas descritas aquí (por ejemplo, si el bloque de autorregistro de `useCloudSync.js` ya fue modificado, o si la política INSERT tiene otra forma), **detenerse y reportar la diferencia** antes de editar. Este plan describe el estado del repo en `fdf6ef7`.
