# Plan de Fixes — Gestión de Usuarios y Cambio de PIN (Ronda 5)

**Fecha:** 2026-07-26
**Alcance:** el modal «Usuarios, Roles y PINs» ([UsersManager.jsx](src/components/Settings/UsersManager.jsx)), que se monta **en los dos modos**: sistema principal ([SettingsTabUsuarios.jsx:17](src/components/Settings/tabs/SettingsTabUsuarios.jsx#L17)) y modo supervisor ([OwnerMonitorView.jsx:3261](src/views/OwnerMonitorView.jsx#L3261)).

**Veredicto: el cambio de PIN no funciona correctamente en ninguno de los dos modos.** Ninguna de las tres rutas de propagación llega a destino, y hay una fuga de PINs en claro a la nube.

---

## 1. Hallazgos

| # | Hallazgo | Severidad |
|---|---|---|
| P1 | Un PIN cambiado en el **sistema principal** nunca se publica en la nube: el monitor sigue mostrando el viejo indefinidamente | 🔴 |
| P2 | Un PIN cambiado en el **monitor** no entra en la cola de «Subir al sistema»; si hay otro cambio después, se destruye en silencio | 🔴 |
| P3 | Cuando el comando sí llega, la caja publica el catálogo **anterior al cambio** (carrera con el hash asíncrono) | 🔴 |
| P4 | `bodega_users_catalog_v1` sube a `sync_documents` con el PIN **en claro** (`plainPin`) y el hash PBKDF2 | 🔴 |
| P5 | Los IDs de usuario divergen entre monitor y caja: un `change_pin` o `delete` posterior apunta a un usuario inexistente | 🟠 |
| P6 | En el sistema principal, el modal encola comandos en la cola del monitor, que nadie drena | 🟠 |
| P7 | `user_update` se marca `applied` aunque no coincida ninguna acción ni usuario | 🟡 |
| P8 | El chequeo de «PIN ya en uso» compara texto claro contra el campo hasheado: nunca detecta nada | 🟡 |

### P1 — El PIN del sistema principal no sale del dispositivo

`cambiarPin` actualiza el store; el hook de persistencia espeja el array completo a `bodega_users_catalog_v1`:

```js
// useAuthStore.js:611-616
setItem: (name, value) => {
    localStorage.setItem(name, JSON.stringify(value));
    if (value && value.state && Array.isArray(value.state.usuarios)) {
        localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(value.state.usuarios));
    }
}
```

Son dos `localStorage.setItem` **directos**. Desde que se eliminó el monkeypatch global (SEC-009), escribir directo **no** empuja nada a la nube: hay que llamar a `storageService.setItem` o a `pushLocalSync` ([useCloudSync.js:44-53](src/hooks/useCloudSync.js#L44-L53)). El único `pushCloudSync('bodega_users_catalog_v1', …)` de todo el repo está en [useSupervisorCommands.js:155](src/hooks/useSupervisorCommands.js#L155), es decir **sólo** cuando el cambio vino de un comando del supervisor.

Consecuencia: cambiar un PIN desde la caja funciona en la caja y **jamás** llega al monitor.

### P2 — El PIN del monitor no entra en la cola

`pushRemoteUserCmd` ([UsersManager.jsx:228-246](src/components/Settings/UsersManager.jsx#L228-L246)) escribe el comando **directamente** en `localStorage['dj_pending_inventory_changes_v1']`, sin pasar por `queueInventoryChange`. Pero `OwnerMonitorView` mantiene esa cola en estado de React (`pendingChanges`), inicializado **una sola vez** al montar, y su único listener de `app_storage_update` llama a `loadLocalData()`, que no toca `pendingChanges` ([OwnerMonitorView.jsx:873-888](src/views/OwnerMonitorView.jsx#L873-L888)).

Dos consecuencias, ambas observadas:

1. Si la cola estaba vacía, la barra flotante de «Subir al sistema» **no aparece** → no hay forma de enviar el cambio de PIN.
2. Cualquier acción posterior (`+`/`−` de stock, editar un producto) ejecuta `setPendingChanges(prev => …)` con `prev` obsoleto y reescribe el localStorage **sin** el `user_update` → **el cambio de PIN se destruye sin aviso**.

El aviso amarillo del modal — «Los cambios se enviarán y aplicarán en la caja automáticamente apenas vuelva a estar en línea» — hoy no se cumple.

### P3 — La caja publica el catálogo viejo

`cambiarPin` es síncrona por fuera pero hace el hash en una IIFE asíncrona ([useAuthStore.js:432-445](src/hooks/store/useAuthStore.js#L432-L445)): el `set()` ocurre **después** de que `hashPin` resuelve. El consumidor no espera:

```js
// useSupervisorCommands.js:141-155
store.cambiarPin(userId, newPin);          // el set() aún no ocurrió
...
const freshUsers = useAuthStore.getState().usuarios;   // ← array VIEJO
localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(freshUsers));
await pushCloudSync('bodega_users_catalog_v1', freshUsers);
```

Se publica el catálogo **sin** el PIN nuevo. El monitor lo recibe y revierte su vista al PIN anterior, aunque la caja sí quedó cambiada. Lo mismo aplica a `add` (`agregarUsuario`) y a `edit` con PIN (`editarUsuario`), que usan el mismo patrón.

### P4 — PINs en claro en la nube

`cambiarPin` guarda `plainPin: String(nuevoPin)` junto al hash, y el hook de persistencia espeja **el objeto completo** a `bodega_users_catalog_v1`, que está en `SYNC_KEYS` ([useCloudSync.js:19](src/hooks/useCloudSync.js#L19)). No hay sanitización en ningún punto del push.

Resultado: `sync_documents` guarda, para cada usuario, el PIN en texto plano **y** su hash PBKDF2. La tabla es legible por el rol `anon`. El comentario de [useCloudSync.js:49](src/hooks/useCloudSync.js#L49) cita justamente «filtrado de hashes de PIN a una tabla pública (SEC-002)» como uno de los motivos para eliminar el monkeypatch — el catálogo de usuarios lo reintroduce por otra vía, y agravado.

El monitor **necesita** `plainPin` para la función de revelar el PIN con el ojo ([UsersManager.jsx:149](src/components/Settings/UsersManager.jsx#L149)), así que esto es una decisión de producto, no una corrección obvia. Ver **E1**.

### P5 — IDs divergentes

| Origen | ID asignado |
|---|---|
| `agregarUsuario` del store | `maxId + 1` |
| Actualización optimista del modal ([:282](src/components/Settings/UsersManager.jsx#L282)) | `Date.now()` |
| La caja al aplicar el comando `add` | su propio `maxId + 1` |

Los tres difieren. Un `change_pin` o `delete` emitido después contra el ID que muestra el monitor no encuentra a nadie en la caja. Además el comando queda marcado `applied` (ver P7), así que no hay ni un error visible.

---

## 2. Plan de fixeo

Una fase = un commit. Tras cada fase: `npx eslint --no-cache <archivos tocados>`, `npx vitest run`, `npm run build`. Si el código no coincide con las anclas, **detenerse y reportar**.

Reglas vigentes: SEC-002, SEC-009, SEC-010, guarda FIN-022, sin `parseFloat` en código financiero, sin código de migración de datos, no hacer push salvo pedido explícito.

**Orden:** PU1 → PU2 → PU3 → PU4 → PU5 → PU6 → PU7 → PU8. PU4 requiere una decisión del usuario antes de escribirse.

---

### PU1 🔴 — Publicar el catálogo cuando el PIN cambia en la caja

**Archivo:** [src/components/Settings/UsersManager.jsx](src/components/Settings/UsersManager.jsx)

El hook de persistencia de Zustand **no** es el lugar para empujar a la nube: se dispara en cada `set()` del store (login, logout, intentos fallidos, lockout) y provocaría un push por cada uno. La publicación va en los handlers, que son cuatro y ya están identificados.

Agregar un helper único cerca de `pushRemoteUserCmd`:

```js
// Publica el catálogo de usuarios en la nube. El hook de persistencia de
// useAuthStore escribe `bodega_users_catalog_v1` con localStorage directo, que
// desde SEC-009 ya NO empuja nada: hay que publicarlo explícitamente.
const publishUserCatalog = async (users) => {
    try {
        const { pushLocalSync } = await import('../../hooks/useCloudSync');
        pushLocalSync('bodega_users_catalog_v1', sanitizeUserCatalog(users));
    } catch (e) {
        console.warn('[UsersManager] No se pudo publicar el catálogo de usuarios:', e);
    }
};
```

(`sanitizeUserCatalog` se define en PU4; hasta entonces, pasar `users` tal cual y dejar el `TODO`.)

Llamarlo al final de `handleAdd`, `handleToggleBypassPin`, `handleChangePin` y `handleDelete`, **con el array recién calculado** (`fresh`), no con `usuarios`.

En `handleDelete` no existe hoy actualización optimista: agregarla por simetría con los otros tres.

`pushLocalSync` pasa por el debounce de 300 ms de las claves ligeras y por la compuerta `isCloudSyncActive`, así que en modo monitor no empuja nada — correcto: en el monitor la propagación es por comando (PU2), no por push.

**Verificación manual:** en la caja, cambiar el PIN de un usuario. En ≤3 s el monitor debe mostrar el PIN nuevo sin recargar.

---

### PU2 🔴 — Que la cola del monitor vea los comandos de usuario

**Archivos:** [src/views/OwnerMonitorView.jsx](src/views/OwnerMonitorView.jsx), [src/components/Settings/UsersManager.jsx](src/components/Settings/UsersManager.jsx)

Dos partes; ambas necesarias.

**2.1 — El monitor recarga la cola ante cambios externos.** En el efecto que registra `handleUpdate` (~línea 873), añadir la relectura:

```js
const handleUpdate = (e) => {
    loadLocalData();
    // La cola puede ser modificada desde fuera de este componente (UsersManager
    // escribe comandos user_update directamente en localStorage). Sin esto, el
    // estado de React queda obsoleto y el siguiente persistPending los borra.
    if (!e?.detail?.key || e.detail.key === PENDING_KEY) {
        try {
            const raw = localStorage.getItem(PENDING_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            if (Array.isArray(arr)) setPendingChanges(arr);
        } catch { /* cola corrupta: se ignora */ }
    }
};
```

**2.2 — Eliminar la escritura directa.** Es la causa raíz: dos dueños para la misma cola. `UsersManager` debe encolar a través del mismo camino que el resto. Añadir una prop opcional:

```js
export default function UsersManager({ triggerHaptic, onQueueChange }) {
```

y en `pushRemoteUserCmd`, usarla cuando exista:

```js
const changeItem = { action: 'user_update', productId: 'user_' + (payload.userId || Date.now()), data: { action: userAction, ...payload }, queuedAt: new Date().toISOString() };
if (onQueueChange) {
    onQueueChange('user_update', changeItem.productId, changeItem.data);
    return;
}
// Fallback (sistema principal): ver PU6 — allí no se encola nada.
```

En `OwnerMonitorView.jsx:3261` pasar `onQueueChange={queueInventoryChange}`.

`queueInventoryChange` cae en la rama `else` (`next.push(...)`) para `user_update`, que es el comportamiento correcto: no fusiona, encola cada cambio.

**Verificación manual:** con la cola vacía, en el monitor cambiar un PIN. La barra flotante debe aparecer con «1 cambio pendiente». Después tocar `+` en un producto: debe decir 2, no 1. Subir y comprobar que llegan los dos comandos.

---

### PU3 🔴 — Esperar el hash antes de publicar

**Archivos:** [src/hooks/store/useAuthStore.js](src/hooks/store/useAuthStore.js), [src/hooks/useSupervisorCommands.js](src/hooks/useSupervisorCommands.js)

**3.1** Que las tres acciones devuelvan la promesa además del resultado síncrono, sin romper a los llamadores actuales (`ConfigView`, `UsersManager`) que ignoran el retorno:

```js
cambiarPin: (userId, nuevoPin) => {
    const err = validatePin(String(nuevoPin ?? ''));
    if (err) return { ok: false, error: err };

    // `done` permite a los llamadores que SÍ necesitan el estado ya actualizado
    // (useSupervisorCommands, que publica el catálogo) esperar al hash.
    const done = (async () => { /* cuerpo actual de la IIFE */ })();
    return { ok: true, done };
},
```

Mismo patrón en `agregarUsuario` y en la rama con PIN de `editarUsuario`. La rama sin PIN de `editarUsuario` y `eliminarUsuario` son síncronas: devolver `done: Promise.resolve()` para que el consumidor no tenga que distinguir.

**3.2** En `useSupervisorCommands.js`, esperar antes de leer el estado:

```js
let res;
if (action === 'change_pin' && userId && newPin) {
    res = store.cambiarPin(userId, newPin);
} else if (action === 'add' && nombre) {
    res = store.agregarUsuario(nombre, rol || 'CAJERO', newPin || '000000', bypassPin);
} else if (action === 'edit' && userId) {
    res = store.editarUsuario(userId, { nombre, rol, bypassPin });
} else if (action === 'delete' && userId) {
    res = store.eliminarUsuario(userId);
}
// El hash del PIN es asíncrono: sin esto se publicaría el catálogo ANTERIOR.
await res?.done;

const freshUsers = useAuthStore.getState().usuarios;
```

**Verificación manual:** desde el monitor, cambiar un PIN y subirlo. Tras aplicarse, el monitor debe mostrar el PIN **nuevo** de forma estable, sin revertir al viejo al segundo siguiente.

---

### PU4 🔴 — Ningún PIN sale del dispositivo · «Restablecer PIN» en un paso

**Decisión E1 resuelta: no se publica `plainPin` ni el hash `pin`, y el flujo pasa de *leer* el PIN a *establecerlo*.** El razonamiento está en E1; esta fase lo implementa. Son cuatro sub-fases y conviene un commit por cada una.

#### PU4.1 — Sanitización (cierra la fuga)

Helper nuevo, en `src/utils/` porque lo usan dos puntos de publicación:

```js
// src/utils/userCatalog.js
// SEC-002: ni el hash PBKDF2 (`pin`) ni el PIN en claro (`plainPin`) salen del
// dispositivo. `bodega_users_catalog_v1` se publica en sync_documents, que es
// legible por el rol anon. El monitor sólo necesita id, nombre, rol y bypassPin.
export function sanitizeUserCatalog(users) {
    return (users || []).map(({ pin, plainPin, ...rest }) => rest);
}
```

Aplicarlo en `publishUserCatalog` (PU1) **y** en [useSupervisorCommands.js:152-155](src/hooks/useSupervisorCommands.js#L152-L155), tanto en el `localStorage.setItem` como en el `pushCloudSync`.

`plainPin` **sigue existiendo en el store local** (`abasto-auth-storage`, que SEC-002 ya impide sincronizar). Lo necesita la validación de PIN duplicado de PU8, que se ejecuta en la caja.

#### PU4.2 — Fuera el ojo, dentro el estado

**Archivo:** [UsersManager.jsx:145-155](src/components/Settings/UsersManager.jsx#L145-L155)

Los puntos `••••••` con un ojo que ya no revela nada son peores que no mostrar nada: prometen información oculta. Sustituir el bloque `PIN: ••••••` + botón de ojo por un chip de estado, alineado con el que ya existe para «Sin PIN (Entra directo)»:

```jsx
{user.bypassPin ? (
    <span className="...verde...">🔓 Sin PIN (Entra directo)</span>
) : (
    <span className="...gris...">🔒 PIN activo</span>
)}
```

Eliminar el estado `showPin` y el `showUserPin` asociados a la fila. El `showPin` de los pasos del teclado numérico es otro y se conserva.

#### PU4.3 — «Restablecer PIN»: un paso, no tres

El flujo de 3 pasos (actual → nuevo → confirmar) tiene sentido **sólo** cuando alguien cambia su propio PIN. Cuando un admin restablece el de otro, exigir el PIN actual es fricción pura y es justo lo que hoy obliga a usar el ojo.

Bifurcar por quién es el objetivo:

```js
const isSelf = usuarioActivo?.id === user.id;
// Cambiar el PIN propio conserva la verificación de 3 pasos.
// Restablecer el de otro (acción de admin) entra directo al paso 2.
setChangePinStep(isSelf ? 1 : 2);
```

Y en el paso 2, cuando `!isSelf`, precargar un PIN sugerido con el generador que ya existe:

```js
// _generateRandomPin ya se exporta desde useAuthStore (useAuthStore.js:624)
setPinValue(_generateRandomPin());
```

El paso 3 (confirmar) también se omite cuando `!isSelf`: el PIN está visible en pantalla en ese momento, así que teclearlo dos veces no aporta nada. Un solo botón «Guardar PIN».

Renombrar el botón de la fila: «CAMBIAR PIN» cuando `isSelf`, «RESTABLECER PIN» cuando no.

#### PU4.4 — Mostrar una vez y compartir

En la hoja de restablecer, el PIN es visible **antes** de guardar y no vuelve a mostrarse nunca — el patrón «se muestra una sola vez» que la gente ya conoce de las claves de aplicación. Junto al campo:

- **«Generar otro»** (🎲) → `setPinValue(_generateRandomPin())`
- **«Copiar»** → `navigator.clipboard.writeText(pinValue)` + toast
- **«Enviar por WhatsApp»** → mismo patrón que los 8 sitios que ya existen en el repo (`SupervisorPairingModal.jsx:33`, `ProductShareModal.jsx:143`, …):

```js
const msg = `Tu nuevo PIN de acceso para ${businessName || 'la caja'} es: ${pinValue}`;
window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
```

Si el dueño no lo copió, restablecer de nuevo cuesta un toque. Ese es el punto: el PIN deja de ser un dato que hay que custodiar y consultar, y pasa a ser desechable.

**Verificación manual:**
1. En el monitor, restablecer el PIN de un cajero: debe ser **una** pantalla con un PIN sugerido, «Generar otro», «Copiar», «Enviar por WhatsApp» y «Guardar».
2. Subirlo, y comprobar que el cajero entra en la caja con el PIN nuevo.
3. En Supabase: `SELECT data FROM sync_documents WHERE doc_id = 'bodega_users_catalog_v1'` — **no** debe aparecer ni `pin` ni `plainPin` en ningún elemento.
4. Con la sesión del propio admin, «Cambiar PIN» sobre sí mismo debe seguir pidiendo el PIN actual.

---

### PU5 🟠 — Un solo criterio de ID de usuario

**Archivo:** [src/components/Settings/UsersManager.jsx:282](src/components/Settings/UsersManager.jsx#L282)

La actualización optimista de `handleAdd` inventa `id: Date.now()`. Debe usar la misma regla que el store y que la caja:

```js
const nextId = current.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0) + 1;
const fresh = [...current, { id: nextId, nombre: newName.trim(), rol: newRole, plainPin: newBypassPin ? '' : newPin, bypassPin: newBypassPin }];
```

Esto **no** elimina la posibilidad de colisión (si la caja crea un usuario a la vez que el monitor, ambos reclaman el mismo número), pero alinea el caso normal, que es el que hoy falla siempre. La solución de fondo — IDs `crypto.randomUUID()` para usuarios, como ya hacen los productos — es un cambio de esquema con datos existentes: **fuera de alcance**, anotado como deuda.

---

### PU6 🟠 — El sistema principal no debe encolar comandos de monitor

**Archivo:** [src/components/Settings/UsersManager.jsx](src/components/Settings/UsersManager.jsx)

Con PU2.2, `pushRemoteUserCmd` sólo encola si recibe `onQueueChange`, que únicamente pasa `OwnerMonitorView`. Queda entonces eliminar el cuerpo de respaldo: en el sistema principal la función es un no-op.

```js
const pushRemoteUserCmd = (userAction, payload) => {
    // Sólo el monitor encola comandos hacia la caja. En el sistema principal el
    // cambio ya se aplicó localmente y se publica vía publishUserCatalog (PU1).
    if (!onQueueChange) return;
    onQueueChange('user_update', 'user_' + (payload.userId || Date.now()), { action: userAction, ...payload });
};
```

Se puede dejar de ser `async` y desaparecen los dos `dispatchEvent` manuales.

**Nota:** la cola basura que ya existe en las cajas donde se usó el modal no se limpia aquí — sería código de migración. Si el usuario quiere limpiarla, es un borrado manual de `dj_pending_inventory_changes_v1` en ese dispositivo.

---

### PU7 🟡 — No marcar `applied` lo que no se aplicó

**Archivo:** [src/hooks/useSupervisorCommands.js:136-158](src/hooks/useSupervisorCommands.js#L136-L158)

La cadena `if/else if` no tiene rama final: una acción desconocida, un `userId` que no existe o un `newPin` ausente caen al vacío y el comando se marca `applied`. Con FS4 del plan de propagación, un `failed` con motivo sí sería visible en el monitor.

```js
let applied = false;
if (action === 'change_pin' && userId && newPin) {
    const target = useAuthStore.getState().usuarios.find(u => u.id === userId);
    if (!target) {
        await updateCommandStatus(command.id, 'failed', `Usuario ${userId} no existe en la caja`);
        return;
    }
    res = store.cambiarPin(userId, newPin);
    applied = true;
} else if (...) { ... }

if (!applied) {
    await updateCommandStatus(command.id, 'failed', `Acción de usuario no reconocida: ${action}`);
    return;
}
```

`eliminarUsuario` además devuelve `false` cuando se rechaza (último admin, o usuario con sesión activa) y hoy ese `false` se descarta: propagarlo como `failed` con el motivo.

**Test:** en `tests/`, un caso que verifique que un `user_update` con `action: 'change_pin'` y un `userId` inexistente termina en `failed` y no en `applied`.

---

### PU8 🟡 — El chequeo de PIN duplicado está muerto

**Archivo:** [src/components/Settings/UsersManager.jsx:273](src/components/Settings/UsersManager.jsx#L273)

```js
if (displayUsers.some(u => u.pin === newPin)) return showToast('Ese PIN ya esta en uso', 'error');
```

`u.pin` es el hash PBKDF2 y `newPin` es texto claro: la comparación nunca es verdadera. Comparar contra `plainPin`, que es el campo que sí contiene el valor en claro:

```js
if (displayUsers.some(u => !u.bypassPin && u.plainPin && u.plainPin === newPin)) {
    return showToast('Ese PIN ya está en uso', 'error');
}
```

Aplicar la misma validación en `handleChangePin`, donde hoy no existe en absoluto.

**Dónde vive esta validación tras E1.** El monitor ya no recibe `plainPin`, así que en el monitor la comprobación no puede hacerse y hay que quitarla del camino remoto (con un PIN aleatorio sugerido de 6 dígitos, la colisión es despreciable). La validación real va **en la caja**, al aplicar el comando, donde `plainPin` sí está en el store local:

```js
// useSupervisorCommands.js, rama change_pin/add, antes de aplicar
const dup = useAuthStore.getState().usuarios
    .find(u => u.id !== userId && !u.bypassPin && u.plainPin && u.plainPin === newPin);
if (dup) {
    await updateCommandStatus(command.id, 'failed', `Ese PIN ya lo usa "${dup.nombre}"`);
    return;
}
```

Con PU7 aplicado, ese rechazo llega al monitor como `failed` con el motivo visible, así que el dueño se entera y genera otro PIN de un toque. Es el reparto correcto: la caja es la fuente de verdad (misma regla D4 que el inventario remoto).

---

## 3. Decisiones

| ID | Decisión | Estado |
|---|---|---|
| **E1** | **Ningún PIN se publica en la nube. El supervisor pasa de *leer* PINs a *establecerlos*:** «Restablecer PIN» en una sola pantalla, con PIN aleatorio sugerido, copiar y enviar por WhatsApp. El ojo desaparece y se sustituye por un chip «PIN activo» / «Sin PIN». Se descarta cifrar `plainPin`: no hay secreto estable compartido entre caja y monitor (el token de emparejamiento son 6 caracteres y expira en 10 min, y `primary_device_id` es públicamente legible por la política SELECT de `device_pairings`), habría que inventar un intercambio de claves y el modo de fallo — PINs ilegibles tras re-emparejar — es peor UX que no mostrarlos. | **Resuelta.** Implementada en PU4. |
| E2 | La publicación del catálogo va en los handlers del modal, no en el hook de persistencia de Zustand | El hook se dispara en cada `set()` (login, logout, intento fallido, lockout): publicaría decenas de veces por sesión. |
| E3 | `UsersManager` deja de escribir la cola directamente y la recibe por prop | Dos dueños para la misma cola es la causa raíz de P2. La prop mantiene el componente reutilizable en ambos modos. |
| E4 | Las acciones del store devuelven `{ ok, done }` en vez de volverse `async` | No rompe a los llamadores actuales, que ignoran el retorno; sólo `useSupervisorCommands` espera. |
| E5 | Los IDs de usuario siguen siendo numéricos | Migrar a UUID tocaría datos existentes. Se alinea el criterio y se anota como deuda. |
| E6 | La cola basura ya acumulada en las cajas no se limpia por código | Sería migración de datos. Borrado manual si el usuario lo quiere. |

---

## 4. Riesgos

- **PU1** introduce un push por cada operación de usuario. Son claves ligeras (debounce 300 ms) y operaciones poco frecuentes: impacto de egreso despreciable.
- **PU3** cambia la firma de retorno de tres acciones del store. Verificar con una búsqueda de `cambiarPin(`, `agregarUsuario(`, `editarUsuario(` que ningún llamador dependa de que el objeto tenga exactamente dos claves.
- **PU2.2** cambia la firma de `UsersManager`. Se monta en exactamente dos sitios, ambos citados arriba.
- **PU4.2 quita una función existente** (revelar el PIN con el ojo), en los dos modos. Es intencional y E1 lo justifica, pero es el único cambio del plan que el usuario va a *notar como pérdida* antes de notar la ganancia. Conviene aplicar PU4.3 y PU4.4 en el mismo despliegue que PU4.2: quitar el ojo sin dar el restablecer en un paso sí sería un retroceso de UX.
- **PU4.1 no borra los PINes ya publicados.** El documento en `sync_documents` conserva los `pin`/`plainPin` subidos hasta ahora; se sobrescribe en la siguiente publicación (el primer cambio de usuario tras el despliegue). Para no esperar, basta cualquier operación en el modal. Borrar la fila a mano también vale — no se agrega código de migración.
- **PU8** puede empezar a rechazar PINs duplicados que hoy se aceptan. Es el comportamiento buscado, pero conviene avisar: si dos usuarios ya comparten PIN, editar a cualquiera de ellos fallará hasta cambiar uno.
- Ninguna fase toca lógica financiera, `parseFloat`, la guarda FIN-022 ni los métodos de pago COP.

## 5. Si algo no encaja

Si al abrir un archivo el código no coincide con las anclas descritas — por ejemplo si `pushRemoteUserCmd` ya recibe la cola por prop, o si `cambiarPin` ya devuelve una promesa — **detenerse y reportar la diferencia** antes de editar. Este plan describe el árbol de trabajo sobre `41d9c42`, con los cambios sin commitear de la ronda 4 aplicados.
