# Plan de implementación — Backup y Kardex remoto del Supervisor

**Fecha:** 2026-08-12
**Estado:** auditoría completada; este documento no aplica cambios de producción.
**Objetivo:** permitir que un Supervisor autorizado descargue un backup de la caja emparejada y consulte/exporte su Kardex usando la misma semántica del dispositivo central, sin sincronizar permanentemente históricos pesados al navegador del Supervisor.

---

## 1. Resultado de la auditoría actual

### 1.1 Supervisor / Monitor

- `src/views/OwnerMonitorView.jsx` ya tiene pestañas para turno, cierres, reportes, gastos, inventario y cambios, pero **no tiene Backup ni Kardex**.
- `useMonitorSync` sincroniza continuamente `bodega_products_v1`, `bodega_sales_v1` y documentos financieros/configuración. **No incluye** `bodega_kardex_v1`, `bodega_kardex_snapshots_v1` ni `bodega_inventory_operations_v1` en `MONITOR_DOC_IDS`.
- `OwnerMonitorView` lee `bodega_sales_v1` desde el almacenamiento local del monitor, que es correcto para el dashboard actual, pero no sirve por sí solo para auditar el Kardex remoto.
- `useCloudBackup` ya tiene un recolector canónico v2 (`IDB_KEYS` + `LS_KEYS`) y compresión, pero el Supervisor solo usa `recoverProductImagesOnly`. `uploadLocalBackup` está diseñado para el dispositivo propietario y además intenta escribir `cloud_backups` y `sync_documents`; **no debe reutilizarse para descargar datos de otra caja**.
- `SettingsModal` tiene un exportador legacy que solo incluye productos, cuentas, categorías y algunas preferencias. No debe copiarse al Supervisor: omite ventas, Kardex, operaciones, clientes y proveedores.

### 1.2 Kardex central

- `src/views/KardexView.jsx` carga `getKardexHistory()` desde IndexedDB y, si está vacío, puede sembrar movimientos `INICIAL`. El Supervisor remoto **no debe sembrar ni escribir** datos en su propio IndexedDB.
- La vista central ya tiene filtros por producto/tipo/texto/rango y fecha exacta por día local, además de CSV.
- La semántica exacta por día usa `getLocalISODate`, pero el rango `Desde/Hasta` todavía construye límites UTC. La implementación remota debe reutilizar un adaptador común y corregir esta diferencia antes de declarar que ambos Kardex son equivalentes.
- `calculateInventoryValue()` usa el costo actual del producto. La UI lo etiqueta como promedio ponderado, aunque ese valor no se reconstruye históricamente. El Supervisor debe conservar la misma fórmula mientras se corrige el etiquetado o se implementa la valorización histórica en una fase separada.

### 1.3 Contrato de inventario y E2E

La implementación local reciente ya dispone de:

- `inventoryMovementModel.js` para traducir ventas/combos/modulares a deducciones físicas.
- `inventoryOperationService.js` para aplicar stock + Kardex con lock, snapshots explícitos e idempotencia.
- pruebas de venta, combo, devolución, consumo diferido, operaciones pendientes y caso Tercio.

La auditoría remota debe leer esos resultados, no recalcular una venta desde una interpretación distinta del carrito. La referencia canónica será:

```text
stock_antes + cantidad = stock_despues
stock_actual = stock_inicial + Σ movimientos Kardex
```

Para ventas con combo/modular o consumo diferido, la comprobación debe basarse en `referencia_id`, `operation_id` y metadata de los movimientos físicos, no en el nombre del ítem comercial.

### 1.4 Egress y autorización

- `useCloudSync` ya aplica hash por documento, debounce, límite de 2 MB y compuerta Auth para la caja.
- `bodega_kardex_v1` y `bodega_inventory_operations_v1` están en `IDB_KEYS` y, por tanto, pueden publicarse como documentos completos desde la caja. Es un egress de subida existente y debe medirse antes de ampliarlo.
- **No se debe agregar Kardex a `MONITOR_DOC_IDS`**: eso convertiría cada actualización del array histórico en tráfico Realtime y persistencia local permanente en cada Supervisor.
- La opción recomendada es una lectura **bajo demanda**, una sola consulta PostgREST, con `select` mínimo, `eq(device_id, pairedDeviceId)` e `in(doc_id, whitelist)`. No usar `select('*')`, no abrir Realtime para el histórico y no guardar el resultado remoto en IndexedDB del monitor.
- `supabase_cloud_schema.sql` y `supabase_rls_hardening.sql` describen RLS estricto con Auth; `supabase_pairing_setup.sql` conserva un modelo legacy `anon` basado en pairing. Antes de desplegar se debe elegir y verificar un solo modelo. El frontend no debe recibir tokens, anon keys adicionales ni `service_role`.

---

## 2. Arquitectura propuesta

### 2.1 Servicio remoto de auditoría

Crear un servicio puro de acceso, por ejemplo `src/services/remoteAuditService.js`, con una API pequeña:

```js
fetchRemoteDocuments(deviceId, docIds)
fetchRemoteKardex(deviceId)
buildRemoteBackup(deviceId, rows)
downloadJsonFile(filename, payload)
```

Reglas:

1. `deviceId` solo puede ser el `pairedDeviceId` vigente en la sesión del Supervisor.
2. `docIds` se intersecta con listas constantes; nunca acepta claves arbitrarias desde la UI.
3. La consulta solo devuelve `collection, doc_id, data, updated_at`.
4. El servicio no escribe `localforage`, `localStorage`, `sync_documents`, comandos ni `cloud_backups`.
5. Devuelve `{ success, data, fetchedAt, maxUpdatedAt, missingDocIds, error }` para distinguir datos incompletos de un backup válido.
6. Si una fila está comprimida, se descomprime únicamente en memoria.

Whitelist recomendada:

```text
Backup completo: IDB_KEYS + LS_KEYS
Kardex: bodega_products_v1,
        bodega_kardex_v1,
        bodega_kardex_snapshots_v1,
        bodega_inventory_operations_v1
```

### 2.2 Backup remoto

El botón **Descargar backup de la caja** debe:

- mostrar la caja destino y la hora de lectura;
- hacer una única lectura bajo demanda;
- convertir `sync_documents` a formato backup v2:

```json
{
  "version": "2.0",
  "timestamp": "...",
  "sourceDeviceId": "PDA-...",
  "source": "supervisor_remote_read",
  "data": { "idb": {}, "ls": {} },
  "metadata": {
    "missingDocIds": [],
    "maxUpdatedAt": "..."
  }
}
```

- descargar JSON legible, sin incluir sesiones `sb-*`, PINs, `abasto-auth-storage`, `service_role` ni secretos;
- bloquear la descarga si faltan documentos críticos (`products`, `sales`, `kardex`, `inventory_operations`), o marcarla explícitamente como **backup parcial**;
- no llamar `forceSyncAllPOSData`, no subir de nuevo el backup y no crear una segunda copia en Supabase.

La compresión es opcional para transporte, no para el archivo descargado: el backup final debe poder abrirse y restaurarse con el importador v2 existente.

### 2.3 Kardex remoto con lógica central

No duplicar la tabla ni los filtros. Extraer de `KardexView` una capa compartida de datos/presentación, por ejemplo:

```text
KardexView
  └── KardexPanel / KardexTable
       ├── filters: filterKardex + date helpers
       ├── stats: calculateInventoryValue
       └── export: CSV común
```

Modos:

- **Central:** fuente `getKardexHistory()`, permite seed inicial.
- **Supervisor remoto:** fuente `fetchRemoteKardex()`, solo lectura, nunca seed ni persistencia local.

El Supervisor debe mostrar:

- dispositivo, `maxUpdatedAt` y estado de lectura;
- productos y movimientos recibidos;
- filtros por producto, tipo, texto y fecha local;
- botón CSV con nombre que incluya el `deviceId` sanitizado;
- indicador de datos parciales o desactualizados;
- `operation_id`, `referencia_id`, `referencia_tipo`, `usuario`, motivo y metadata en el detalle.

### 2.4 Conciliación visible

Añadir un módulo puro, reutilizando `kardexScope`, que produzca un reporte sin mutar datos:

```js
reconcileRemoteInventory({ products, sales, kardex, operations })
// { ok, totals, discrepancies, warnings, checkedAt }
```

Mínimos:

- cada movimiento satisface `stock_antes + cantidad === stock_despues`;
- continuidad del stock por producto;
- stock actual del producto coincide con el último `stock_despues` válido;
- suma desde el movimiento `INICIAL` coincide con stock actual, cuando el historial es completo;
- movimientos duplicados por `operation_id`/`movementId`;
- movimientos sin producto o sin referencia cuando deberían tenerla;
- ventas anuladas y devoluciones enlazadas;
- operaciones `PENDING`/`FAILED_RETRYABLE` visibles como advertencia;
- datos faltantes distinguidos de una discrepancia real.

Para Tercio Polar, el caso de aceptación será:

```text
stock 327
venta de 1 → movimiento VENTA -1, 327 → 326
anulación → DEVOLUCION +1, 326 → 327
conciliación: OK, sin doble movimiento ni venta fantasma
```

---

## 3. Fases de implementación

### Fase 0 — Congelación y baseline

**P0 · Dependencias:** ninguna.

- No tocar ni sobrescribir los cambios ajenos ya presentes en el checkout.
- Registrar baseline de `git status`, lint, tests de inventario/Kardex y build.
- Confirmar en Supabase el modelo de autorización real con `auth.uid()`, rol de la petición y políticas de `sync_documents`.
- Medir tamaño y frecuencia actuales de `bodega_kardex_v1`, `bodega_inventory_operations_v1`, `bodega_products_v1` y `bodega_sales_v1`.

**Salida:** baseline reproducible y decisión documentada de RLS.

### Fase 1 — Capa remota de lectura y whitelist

**P0 · Dependencias:** Fase 0.

- Crear `remoteAuditService`.
- Añadir lectura única, `select` mínimo, filtro por dispositivo y whitelist.
- No añadir Kardex a `MONITOR_DOC_IDS`.
- Añadir tests de autorización estática y mocks de Supabase.

**Salida:** se pueden leer documentos del par sin persistirlos ni generar egress adicional.

### Fase 2 — Backup descargable del Supervisor

**P0 · Dependencias:** Fase 1.

- Añadir acción de escritorio y menú móvil en `OwnerMonitorView`.
- Generar backup v2 desde los documentos remotos.
- Reutilizar `IDB_KEYS`/`LS_KEYS`; eliminar dependencia del exportador legacy.
- Estado de carga, backup parcial, cancelación/reintento y nombre de archivo seguro.
- Test de exclusión de secretos y de inclusión de las cuatro claves críticas.

**Salida:** archivo actual de la caja emparejada, sin escribir nada en la caja ni en el monitor.

### Fase 3 — Refactor compartido del Kardex

**P1 · Dependencias:** Fase 1.

- Extraer panel/filtros/CSV de `KardexView`.
- Corregir rango `Desde/Hasta` para semántica local inclusiva, igual que fecha exacta.
- Mantener seed solo en modo central.
- Añadir pestaña **Kardex** en Supervisor con carga bajo demanda y refresh manual.
- Mostrar metadatos de frescura y lectura parcial.

**Salida:** central y Supervisor comparten filtros, estadísticas y exportación; solo cambia la fuente.

### Fase 4 — Conciliación de ventas, inventario y Kardex

**P1 · Dependencias:** Fases 2 y 3; modelo de inventario local estable.

- Implementar `reconcileRemoteInventory` y banner de resultado.
- Relacionar ventas con movimientos mediante `referencia_id`, `operation_id` y `movementIds`.
- Cubrir ventas normales, combos, modulares, devoluciones, anulaciones y consumo diferido.
- Mostrar “incompleto” cuando no existan Kardex/operaciones publicados, no mostrar “OK”.

**Salida:** el Supervisor puede responder si stock, ventas y Kardex coinciden, con lista de diferencias accionable.

### Fase 5 — E2E determinista y hardening de egress

**P1 · Dependencias:** Fases 1–4.

- E2E con Tercio Polar y dataset sintético.
- Verificar que abrir/recargar la pestaña no repite consultas automáticamente.
- Verificar que el refresh manual hace una única consulta por acción.
- Verificar que la vista remota no dispara `queueCloudSync`, `forceSyncAllPOSData` ni escrituras locales.
- Medir bytes y requests antes/después.
- Si el Kardex completo supera límites prácticos, planificar una segunda iteración con outbox/Storage o exportación por chunks; no aumentar `MONITOR_DOC_IDS` como atajo.

**Salida:** egress controlado y suite E2E verde dos veces consecutivas.

### Fase 6 — SQL/RLS y despliegue controlado

**P0 de seguridad · Dependencias:** Fase 1 y decisión de RLS.

- Versionar una migración que permita lectura únicamente al Supervisor emparejado para el `device_id` exacto.
- Evitar `USING (true)`, comodines `monitor_web`, `monitor_device_id IS NULL` y autorización por existencia simple de `primary_device_id`.
- Si se mantiene pairing legacy, aplicar el hardening correspondiente antes de habilitar el botón.
- Si se migra a Auth estricta, exigir sesión cuyo `auth.uid()` sea la identidad autorizada y no intentar compensarlo con una anon key.
- Ejecutar SQL solo en el proyecto correcto y verificar con consultas de diagnóstico; nunca guardar credenciales en el repo.

**Salida:** lectura remota autorizada, revocable y aislada por caja.

---

## 4. Matriz mínima de pruebas

### Servicio remoto

- `REMOTE-001`: query usa `eq(device_id, pairedDeviceId)`.
- `REMOTE-002`: solo permite whitelist canónica.
- `REMOTE-003`: usa `select` mínimo y una consulta por acción.
- `REMOTE-004`: no escribe storage ni comandos.
- `REMOTE-005`: fila ausente produce `missingDocIds`, no falso éxito.
- `REMOTE-006`: error RLS/red devuelve estado estructurado.

### Backup

- `BACKUP-001`: incluye productos, ventas, Kardex y operaciones.
- `BACKUP-002`: incluye snapshots/configuración permitida.
- `BACKUP-003`: excluye sesión, PIN, `sb-*` y secretos.
- `BACKUP-004`: backup parcial no se etiqueta como completo.
- `BACKUP-005`: JSON descargado se puede parsear y es compatible con el formato v2.
- `BACKUP-006`: dos clics rápidos no generan dos requests concurrentes.

### Kardex / conciliación

- `REMOTE-KDX-001`: filtros remotos iguales a central.
- `REMOTE-KDX-002`: fecha exacta y rango usan zona local.
- `REMOTE-KDX-003`: CSV conserva referencia, motivo, usuario y metadata.
- `REMOTE-KDX-004`: `327 → 326 → 327` de Tercio Polar cuadra.
- `REMOTE-KDX-005`: venta de combo no crea salida del padre.
- `REMOTE-KDX-006`: anulación doble no duplica devolución.
- `REMOTE-KDX-007`: consumo diferido concilia solo despachos reales.
- `REMOTE-KDX-008`: operación pendiente se muestra como advertencia.
- `REMOTE-KDX-009`: stock actual distinto del último Kardex produce discrepancia.
- `REMOTE-KDX-010`: Kardex incompleto nunca produce “OK”.

### Egress / seguridad

- `EGRESS-REMOTE-001`: montar Supervisor no solicita Kardex automáticamente.
- `EGRESS-REMOTE-002`: refrescar manualmente produce una sola lectura.
- `EGRESS-REMOTE-003`: no se añade Kardex a `MONITOR_DOC_IDS`.
- `EGRESS-REMOTE-004`: payload remoto no se publica de vuelta a Supabase.
- `RLS-REMOTE-001`: otro `device_id` no es legible.
- `RLS-REMOTE-002`: monitor revocado no puede leer.
- `RLS-REMOTE-003`: no emparejado no puede leer.

---

## 5. Gates y criterios de aceptación

Antes de implementar cada fase:

```bash
bunx eslint <archivos afectados>
bun run test --run <tests relevantes>
bun run build
```

Gate de release:

- Backup remoto actual incluye las cuatro claves críticas.
- Kardex remoto muestra exactamente los movimientos publicados de la caja emparejada.
- Conciliación no confunde datos faltantes con estado correcto.
- Caso Tercio Polar pasa venta/anulación y el reporte remoto coincide.
- No hay nuevos POST/Realtime del Kardex al montar el Supervisor.
- RLS verificado en el proyecto correcto.
- No se comparten tokens, anon keys adicionales, contraseñas ni `service_role`.

## 6. Decisiones que requieren confirmación antes de codificar

1. **Formato de backup:** JSON v2 descargable (recomendado) frente a ZIP comprimido.
2. **Política ante datos faltantes:** bloquear descarga o permitir “backup parcial” con advertencia (recomendado: permitir solo si el usuario confirma y el nombre lo marca como parcial).
3. **RLS vigente:** pairing legacy endurecido o Auth estricta. No mezclar ambos modelos.
4. **Histórico grande:** lectura bajo demanda directa mientras el tamaño sea aceptable; migrar a outbox/Storage por chunks si la medición supera el límite de PostgREST/Realtime.
