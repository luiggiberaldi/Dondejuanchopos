# Supervisor Product Name Sync Race Implementation Plan

> **Para Claude:** REQUERIDO: usar `superpowers:executing-plans` para implementar este plan tarea por tarea.

**Objetivo:** Eliminar la intermitencia en la zona de supervisor donde el nombre de un producto alterna entre el valor nuevo y el antiguo después de editarlo y subirlo a la caja.

**Arquitectura:** Mantener una única proyección optimista mientras el comando está en vuelo, aplicar los catálogos sincronizados únicamente si su versión `updated_at` es igual o más reciente que la última aplicada, y serializar las subidas del catálogo para impedir que una petición antigua termine después de una nueva. La confirmación del cambio ocurrirá cuando la sincronización de la caja contenga los valores esperados; hasta entonces el cambio permanecerá como `inFlight` y no será reemplazado por un payload viejo.

**Tech Stack:** React 19, Vite, Vitest, Supabase Realtime/PostgREST, `localforage`, `storageService`, `useMonitorSync`, `ProductContext` y `OwnerMonitorView`.

---

## Diagnóstico confirmado

El cambio de nombre sí se genera correctamente en `RemoteProductFormModal` y se aplica correctamente en `remoteInventoryProcessor`:

1. `RemoteProductFormModal` envía `name: form.name.trim()` junto con `baseUpdatedAt`.
2. `OwnerMonitorView.queueInventoryChange` conserva la edición y la coloca en la cola.
3. `uploadPendingChanges` inserta el comando, pero inmediatamente copia `projectedProducts` a `products`.
4. `useMonitorSync` puede aplicar después un documento antiguo desde `sync_documents`.
5. `ProductContext` escucha `app_storage_update` y reemplaza todo el catálogo sin comparar versión.
6. La caja procesa el comando y vuelve a publicar el catálogo nuevo, provocando la segunda transición.

La combinación actual permite esta secuencia:

```text
catálogo viejo
  → proyección optimista con nombre nuevo
  → payload cloud viejo aplicado
  → payload cloud nuevo aplicado
```

También debe auditarse una segunda carrera: `pushCloudSync` puede tener una petición antigua en vuelo mientras otra petición más nueva publica el catálogo actualizado. Sin un serializador por clave, la respuesta antigua puede sobrescribir el nombre nuevo en Supabase.

## Archivos relevantes

| Archivo | Responsabilidad | Riesgo actual |
|---|---|---|
| `src/views/OwnerMonitorView.jsx` | Cola, proyección y subida de ediciones | Confirma visualmente antes de la confirmación de la caja |
| `src/hooks/useMonitorSync.js` | Pull inicial, catch-up y Realtime | Aplica documentos sin guardarraíl monotónico |
| `src/context/ProductContext.jsx` | Estado global del catálogo | Reemplaza `products` ante cualquier evento |
| `src/hooks/useCloudSync.js` | Publicación del catálogo | Debe impedir escrituras concurrentes fuera de orden |
| `src/utils/remoteInventoryProcessor.js` | Aplicación del comando en la caja | La lógica de `name` parece correcta; se debe conservar como regresión |
| `src/components/Monitor/RemoteProductFormModal.jsx` | Formulario de edición | Debe conservar `baseUpdatedAt` y el nombre esperado |

## Guardarraíles obligatorios

| ID | Invariante | Comportamiento esperado |
|---|---|---|
| NAME-SYNC-01 | Nombre enviado | El payload de edición contiene el nombre nuevo, limpio y no vacío |
| NAME-SYNC-02 | Versionado monotónico | Un `updated_at` menor que el último aplicado nunca modifica el catálogo |
| NAME-SYNC-03 | Igualdad idempotente | Reaplicar el mismo documento no cambia el estado ni genera efectos secundarios |
| NAME-SYNC-04 | Proyección estable | Un cambio `queued`/`inFlight` continúa visible mientras espera confirmación |
| NAME-SYNC-05 | Confirmación real | Una edición solo sale de `inFlight` cuando el catálogo remoto contiene el valor esperado |
| NAME-SYNC-06 | No rollback falso | Un payload viejo no puede devolver el nombre anterior a la UI |
| NAME-SYNC-07 | Realtime/pull convergente | Pull inicial, catch-up y Realtime usan la misma función de aceptación |
| NAME-SYNC-08 | Escritura serializada | Las publicaciones de `bodega_products_v1` se procesan en orden |
| NAME-SYNC-09 | Comando idempotente | El mismo comando no se aplica dos veces ni genera dos transiciones |
| NAME-SYNC-10 | Conflicto explícito | Si otro supervisor modificó el producto, se conserva el rechazo por `baseUpdatedAt` |
| NAME-SYNC-11 | Persistencia coherente | El estado React y `localforage` reflejan el mismo documento aceptado |
| NAME-SYNC-12 | Sin pérdida de campos | El cambio de nombre no elimina precios, stock, imagen, barcodes ni metadatos |
| NAME-SYNC-13 | Feedback honesto | La UI diferencia “enviado”, “confirmado” y “conflicto” |
| NAME-SYNC-14 | Final determinista | Después de `viejo → nuevo → viejo`, prevalece el documento nuevo |

## Modelo de estado propuesto

Separar tres conceptos que actualmente se mezclan:

```js
{
  products: [],              // último catálogo confirmado por sync
  pendingChanges: [],        // aún no enviados
  inFlightChanges: [],       // enviados, esperando reflejo remoto
  lastProductSyncVersion: '' // updated_at del documento aceptado
}
```

La vista seguirá usando una proyección:

```text
productos confirmados
  + cambios pendientes
  + cambios inFlight
  = catálogo mostrado al supervisor
```

El nombre no debe desaparecer de la proyección hasta que el payload confirmado contenga el mismo nombre y el mismo `productId`.

## Fase 0 — Línea base y reproducción

### Tarea 0.1: Crear fixture de edición de nombre

**Archivos:** Crear `tests/supervisorProductNameSync.test.js`.

Fixture mínimo:

```js
const oldProduct = {
  id: 'p-solera',
  name: 'Cerveza Solera',
  updatedAt: '2026-08-07T10:00:00.000Z',
  stock: 100,
  priceUsd: 14,
};

const renamedProduct = {
  ...oldProduct,
  name: 'Cerveza Solera Pilsen',
  updatedAt: '2026-08-07T10:01:00.000Z',
};
```

Cubrir la secuencia `old → renamed → old` y documentar que el estado actual puede terminar mostrando el nombre viejo si el documento viejo se aplica después.

**Comando:**

```powershell
npx.cmd vitest run tests/supervisorProductNameSync.test.js
```

**Resultado esperado antes del fix:** la prueba de aceptación monotónica debe fallar o evidenciar que el segundo documento viejo sobrescribe el nuevo.

### Tarea 0.2: Capturar línea base del repositorio

**Archivos:** Ninguno.

Ejecutar y registrar resultados sin modificar cambios existentes:

```powershell
npm.cmd test -- --run
npm.cmd run build
```

## Fase 1 — Guard de versión monotónica

### Tarea 1.1: Extraer helper puro de aceptación de documentos

**Archivos:** Crear `src/utils/syncVersionGuard.js`.

Implementar una función sin efectos secundarios:

```js
export function shouldApplySyncVersion(currentVersion, incomingVersion) {
  if (!incomingVersion) return currentVersion == null;
  if (!currentVersion) return true;

  const current = Date.parse(currentVersion);
  const incoming = Date.parse(incomingVersion);
  if (!Number.isFinite(current) || !Number.isFinite(incoming)) return false;
  return incoming >= current;
}
```

Reglas adicionales:

- Rechazar fechas inválidas cuando ya existe una versión válida.
- Aceptar el mismo timestamp para idempotencia.
- No permitir que un documento sin timestamp reemplace uno versionado.
- Mantener la versión por `docId`, no una versión global para todos los documentos.

### Tarea 1.2: Testear el helper

**Archivos:** `tests/supervisorProductNameSync.test.js`.

Casos:

- Sin versión actual + versión válida: aceptar.
- Versión nueva + versión vieja: rechazar.
- Versión vieja + versión nueva: aceptar.
- Misma versión dos veces: aceptar sin mutación adicional.
- Timestamp inválido entrante: rechazar si existe una versión válida.
- Documento sin timestamp durante una sesión ya versionada: rechazar.

### Tarea 1.3: Integrar el guard en `useMonitorSync`

**Archivos:** Modificar `src/hooks/useMonitorSync.js`.

Crear refs por documento:

```js
const appliedVersionsRef = useRef(new Map());
```

Centralizar pull y Realtime en una única función, por ejemplo `applySyncedDocument(doc, source)`:

1. Leer `doc.doc_id`, `doc.collection`, `doc.updated_at` y `doc.data.payload`.
2. Consultar `appliedVersionsRef.current`.
3. Ignorar el documento si la versión entrante es anterior.
4. Persistir el payload solo si la versión es aceptada.
5. Actualizar la versión después de que `localforage.setItem` termine correctamente.
6. Emitir `app_storage_update` con `{ source: 'monitor-sync', syncVersion, payload }`.

El pull inicial, el catch-up y el callback Realtime deben llamar exactamente a esta función. No debe existir un camino alternativo que escriba `bodega_products_v1` sin comparar versión.

### Tarea 1.4: Persistir la versión aceptada

**Archivos:** `src/hooks/useMonitorSync.js`.

Guardar la última versión de `bodega_products_v1` en una clave pequeña, por ejemplo `dj_monitor_sync_versions_v1`, para que una reconexión o recarga no permita que un pull viejo vuelva a entrar.

Guardas:

- Escribir la versión solo después de persistir el payload.
- Si falla IndexedDB, no avanzar el cursor.
- Al cambiar de `pairedDeviceId`, limpiar o particionar la versión por dispositivo.

## Fase 2 — Evitar sobrescrituras ciegas en ProductContext

### Tarea 2.1: Aceptar payload y versión en el evento de almacenamiento

**Archivos:** Modificar `src/context/ProductContext.jsx` y `src/hooks/useMonitorSync.js`.

Cuando el evento provenga de `useMonitorSync`, el evento debe incluir el payload ya aceptado. `ProductContext` no debe hacer una segunda lectura ambigua de IndexedDB para ese evento, porque una lectura concurrente puede devolver otro documento.

Contrato recomendado:

```js
window.dispatchEvent(new CustomEvent('app_storage_update', {
  detail: {
    key: 'bodega_products_v1',
    source: 'monitor-sync',
    syncVersion: doc.updated_at,
    payload,
  },
}));
```

### Tarea 2.2: Añadir guard local de versión

**Archivos:** `src/context/ProductContext.jsx`.

Mantener `productSyncVersionRef` y aplicar estas reglas:

- Si `source === 'monitor-sync'` y la versión es anterior, ignorar.
- Si la versión es igual, no reemplazar el estado si el payload ya está aplicado.
- Si la versión es nueva, sanitizar y aplicar el payload.
- Los eventos locales sin `syncVersion` no deben degradar un catálogo confirmado en modo monitor.
- No alterar el comportamiento normal de la caja principal fuera de modo monitor.

### Tarea 2.3: Testear convergencia del contexto

**Archivos:** `tests/supervisorProductNameSync.test.js` o crear `tests/productSyncVersion.test.js`.

Probar:

- Evento nuevo seguido de evento viejo conserva el nombre nuevo.
- Realtime nuevo duplicado es idempotente.
- Payload viejo sin versión no pisa uno versionado.
- Eventos de ventas/categorías no afectan el cursor de productos.

## Fase 3 — Proyección optimista y confirmación del comando

### Tarea 3.1: Separar cambios enviados de cambios confirmados

**Archivos:** Modificar `src/views/OwnerMonitorView.jsx`.

Actualmente `uploadPendingChanges` elimina los cambios de la cola y llama a `setProducts(updatedLocal)` inmediatamente. Sustituirlo por estados explícitos:

- `pendingChanges`: aún no insertados.
- `inFlightChanges`: insertados en `supervisor_commands`, no confirmados por la caja.
- `confirmedChanges`: no persistente; solo puede usarse para feedback temporal si hace falta.

Al insertar correctamente:

1. Mover el cambio de `pendingChanges` a `inFlightChanges`.
2. Conservarlo en la proyección.
3. No ejecutar `setProducts(updatedLocal)` para simular confirmación.
4. Mostrar estado “Enviado, esperando confirmación”.

### Tarea 3.2: Confirmar contra el catálogo remoto

**Archivos:** `src/views/OwnerMonitorView.jsx`.

Crear `isInventoryChangeConfirmed(change, syncedProducts)`:

- Para `edit`, comparar `productId` y los campos realmente enviados, empezando por `name`.
- Para `delete`, confirmar que el producto ya no existe.
- Para `add`, confirmar que el ID existe.
- Para `adjust_stock`, confirmar el `targetStock` o validar el delta según el contrato actual.

Después de aceptar un payload nuevo desde sync:

1. Confirmar cambios inFlight coincidentes.
2. Retirar solo los confirmados.
3. Mantener los no confirmados en la proyección.
4. Si llega un conflicto, marcarlo como rechazado y mostrar la razón.

### Tarea 3.3: Evitar doble fuente de verdad local

**Archivos:** `src/views/OwnerMonitorView.jsx` y `src/context/ProductContext.jsx`.

La UI de inventario debe renderizar siempre `projectedProducts`, pero `products` debe representar exclusivamente el último catálogo confirmado. No copiar proyecciones a `products` después de insertar comandos.

### Tarea 3.4: Persistir inFlight de forma recuperable

**Archivos:** `src/views/OwnerMonitorView.jsx`.

Guardar `inFlightChanges` en una clave separada, por ejemplo `dj_inflight_inventory_changes_v1`, para que una recarga no elimine la proyección antes de que llegue la confirmación. Limpiar entradas solo cuando exista confirmación o rechazo definitivo.

## Fase 4 — Serialización de publicaciones cloud

### Tarea 4.1: Auditar `queueCloudSync` y `pushCloudSync`

**Archivos:** `src/hooks/useCloudSync.js`.

Implementar un serializador por clave para `bodega_products_v1`:

- No iniciar una publicación nueva mientras otra publicación de la misma clave esté en vuelo.
- Conservar únicamente el último valor pendiente.
- Al terminar la publicación actual, leer el valor más reciente de `storageService` antes de publicar el siguiente.
- Mantener el hash solo después de recibir confirmación exitosa de Supabase.
- No usar `forceUnconditional` para permitir que una petición vieja gane por orden de llegada.

Si el proyecto admite cambios del lado SQL, añadir una condición de versión en la escritura de `sync_documents`; si no, el serializador cliente es obligatorio como mínimo.

### Tarea 4.2: Testear escrituras fuera de orden

**Archivos:** Crear o modificar `tests/cloudSyncOrdering.test.js`.

Usar promesas diferidas para simular:

1. Push viejo inicia y queda pendiente.
2. Push nuevo se solicita.
3. Push viejo termina después del nuevo.
4. El catálogo final debe ser el nuevo.

Cubrir reintentos, fallo del push y `forceUnconditional`.

## Fase 5 — Conservar versionado y conflictos

### Tarea 5.1: Validar `baseUpdatedAt`

**Archivos:** `src/components/Monitor/RemoteProductFormModal.jsx`, `src/views/OwnerMonitorView.jsx`, `src/utils/remoteInventoryProcessor.js`.

Confirmar que:

- Toda edición incluye `baseUpdatedAt` de la versión confirmada, no de la proyección.
- Una edición inFlight no se usa como nueva base para otra edición sin advertencia.
- El rechazo por conflicto no elimina silenciosamente el cambio pendiente.
- El usuario recibe “Producto modificado en la caja; vuelve a sincronizar” cuando corresponde.

### Tarea 5.2: Test de conflicto entre supervisores

**Archivos:** `tests/remoteInventory.test.js` y `tests/supervisorProductNameSync.test.js`.

Probar dos ediciones con la misma base:

- La primera se aplica.
- La segunda se rechaza por `baseUpdatedAt` antiguo.
- El nombre aplicado por la primera no vuelve al valor previo.
- La cola del supervisor conserva información suficiente para reintentar manualmente.

## Fase 6 — UI/UX y observabilidad

### Tarea 6.1: Estados visibles de sincronización

**Archivos:** `src/views/OwnerMonitorView.jsx` y componentes de inventario.

Mostrar estados diferenciados:

- `Pendiente de enviar`.
- `Enviado; esperando caja`.
- `Confirmado`.
- `Rechazado por conflicto`.

El nombre nuevo debe permanecer visible durante `Pendiente` y `Enviado`, sin alternar con el anterior.

### Tarea 6.2: Logging diagnóstico controlado

**Archivos:** `src/hooks/useMonitorSync.js`, `src/hooks/useCloudSync.js`.

Agregar logs estructurados en modo desarrollo o diagnóstico:

```text
[ProductSync] doc=bodega_products_v1 source=realtime version=... action=accepted|ignored
[ProductSync] product=p-solera name="..." command=... state=inFlight|confirmed|conflict
```

No registrar imágenes base64 ni datos sensibles.

### Tarea 6.3: Accesibilidad y feedback

- Usar `aria-live="polite"` para el estado de sincronización.
- No depender solo de color.
- Mantener el nombre visible y el estado en la misma fila.
- Deshabilitar doble envío mientras el lote actual se inserta.

## Fase 7 — Matriz de pruebas de aceptación

### Caso A: Renombrado normal

1. Abrir producto con nombre viejo.
2. Cambiar a nombre nuevo.
3. Encolar y subir.
4. Verificar que el nombre nuevo permanece visible.
5. Confirmar que la caja lo recibe.
6. Recargar supervisor y confirmar persistencia.

### Caso B: Payload viejo después del nuevo

1. Aplicar documento nuevo.
2. Inyectar Realtime viejo.
3. Confirmar que la UI conserva el nombre nuevo.

### Caso C: Realtime duplicado

1. Emitir el mismo documento dos veces.
2. Confirmar una sola transición y ningún rollback.

### Caso D: Pull y Realtime cruzados

1. Iniciar pull con catálogo viejo.
2. Recibir Realtime nuevo.
3. Finalizar pull viejo.
4. El estado final debe ser nuevo.

### Caso E: Dos supervisores

1. Supervisor A y B parten de la misma versión.
2. A cambia el nombre y se aplica.
3. B intenta cambiarlo usando `baseUpdatedAt` antiguo.
4. B recibe conflicto, no alternancia.

### Caso F: Recarga durante inFlight

1. Enviar cambio.
2. Recargar antes de que la caja confirme.
3. El nombre nuevo permanece por `inFlightChanges`.
4. Al llegar confirmación, se limpia el estado inFlight.

## Comandos de verificación

Suite focalizada:

```powershell
npx.cmd vitest run tests/supervisorProductNameSync.test.js tests/productSyncVersion.test.js tests/cloudSyncOrdering.test.js tests/remoteInventory.test.js tests/remoteInventoryD4.test.js
```

Suite financiera relacionada:

```powershell
npx.cmd vitest run tests/financialEngine.test.js tests/checkoutBsManual.test.js tests/changeShortage.test.js
```

Suite completa:

```powershell
npm.cmd test -- --run
```

Validación de build:

```powershell
npm.cmd run build
```

Lint de alcance:

```powershell
npx.cmd eslint src/views/OwnerMonitorView.jsx src/hooks/useMonitorSync.js src/context/ProductContext.jsx src/hooks/useCloudSync.js src/components/Monitor/RemoteProductFormModal.jsx src/utils/remoteInventoryProcessor.js src/utils/syncVersionGuard.js tests/supervisorProductNameSync.test.js tests/productSyncVersion.test.js tests/cloudSyncOrdering.test.js
```

## Criterios de aceptación

- El nombre nuevo nunca vuelve a mostrar el nombre viejo por una respuesta cloud retrasada.
- Un documento con `updated_at` menor se ignora antes de tocar IndexedDB o React.
- Pull inicial, catch-up y Realtime comparten el mismo guard de versión.
- Una edición enviada permanece visible hasta confirmarse o rechazarse.
- Una publicación cloud vieja no puede ganar después de una publicación nueva.
- La edición normal sigue respetando `baseUpdatedAt` y conflictos entre supervisores.
- No se pierden stock, precios, imágenes, barcodes ni otros campos.
- La suite focalizada y la suite completa quedan en verde.
- El build termina correctamente.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Documentos antiguos sin `updated_at` | No permitir que reemplacen un catálogo ya versionado |
| Recarga antes de confirmación | Persistir `inFlightChanges` y mantener la proyección |
| Dos fuentes escriben catálogo | Serializador por clave y lectura del valor más reciente |
| Rechazo por conflicto | Estado explícito y acción manual de reintento |
| Payload grande | Mantener sanitización actual de imágenes y no duplicar documentos |
| Realtime duplicado | Versión por documento + idempotencia |
| Cambios ajenos en el worktree | Revisar diff por archivo y no revertir modificaciones existentes |

## Orden recomendado de implementación

1. Fase 0: reproducir y congelar el bug.
2. Fase 1: helper y guard monotónico.
3. Fase 2: integración en `useMonitorSync` y `ProductContext`.
4. Fase 3: estados `pending/inFlight/confirmed` del supervisor.
5. Fase 4: serialización de publicaciones cloud.
6. Fase 5: conflictos y `baseUpdatedAt`.
7. Fase 6: estados UI y logging.
8. Fase 7: regresión final, build y revisión del diff.

No crear commits intermedios hasta que las pruebas de cada fase estén en verde y el diff sea revisado contra los cambios existentes del workspace.
