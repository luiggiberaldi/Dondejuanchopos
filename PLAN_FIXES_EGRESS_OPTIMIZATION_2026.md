# Plan de optimización de egress y compactación segura de payloads

> **Proyecto:** Donde Juancho POS & Supervisor  
> **Fecha de revisión:** 1 de octubre de 2026  
> **Estado:** Optimización outbound y pruebas locales implementadas; el archivado de detalle de ventas está desactivado de forma preventiva. Rollout y medición cloud pendientes.  
> **Alcance:** optimizar payloads `sync_documents` sin podar el historial de IndexedDB ni operar remotamente sobre dispositivos/base de datos.

---

## 1. Diagnóstico: observado vs. por confirmar

### 1.1 Datos reportados, no reproducidos desde este checkout

El reporte original indica 5,29 GB/5 GB de egress, ventas de 3,24 MB, Kardex de 1,40 MB, y 1.251 ventas/59 cierres. Estos valores proceden del panel o de una extracción operativa que no está incluida aquí; deben cotejarse con métricas del proyecto Supabase antes de atribuir cuota o sobreconsumo a una sola causa.

### 1.2 Hechos comprobados en el código

- `compactSalesPayload` se llama al construir el push de `bodega_sales_v1`, pero por defecto mantiene intacto el array. El helper opt-in calcula bytes UTF-8 y no está habilitado en la ruta de producción; las transformaciones aplicables de ventas quedan bloqueadas hasta completar la certificación de restore e informes.
- El merge de ventas es intencionalmente no destructivo: `prepareSalesPushPayload` une por ID contra una referencia cloud y protege el historial. En el hook activo, el merge requiere opt-in y una referencia no vacía; los errores y arrays vacíos detienen el push en lugar de tratarse como passthrough autorizado.
- En arranque, `forceSyncAllPOSData(deviceId, true)` ignoraba hashes. Ahora usa `false`; los flujos explícitos de restauración/importación conservan sus pushes incondicionales.
- El monitor tiene un cursor incremental (`updatedAfter`). El health-check revisaba presencia cada 30 s, pero el pull de recuperación se hacía cada tres ticks de 10 s únicamente si el canal no estaba sano. No se comprobó que hubiera una descarga completa de 22 documentos cada 30 s.
- `bodega_sales_mirror_v1` forma parte de backups y permanece local; no es evidencia por sí sola de un backup cloud restaurable.
- El Kardex local es historial de auditoría, lo usa el reporte y se vuelve a sembrar si está vacío. No debe podarse localmente para reducir egress.

### 1.3 Hipótesis que requieren evidencia externa

Las filas de `device_monitors`, por sí solas, no prueban clientes Realtime activos. Tampoco se ha atribuido tráfico por endpoint, documento o monitor ni se ha certificado que los tamaños reportados sean bytes JSON efectivos. No ejecutar limpieza/revocación de pairing con IDs preseleccionados sin verificar presencia y autorización en el panel.

---

## 2. Cambios implementados

### Fase A — Ventas: compactación solo outbound, fusión verificable

1. El historial y el espejo local permanecen sin cambios. Hoy `compactSalesPayload` devuelve el payload de ventas intacto por defecto; el helper de archivado outbound y sus metadatos de configuración se conservan para validación aislada, pero no quitan `items` ni los campos del registro en la ruta activa.
2. Se implementa el cálculo UTF-8 y el umbral configurable de 400 KiB dentro del helper opt-in. La retención de 15 días solo aplica al archivado explícitamente habilitado y no está activa en producción.
3. El helper de archivado permite archivar solo ventas de tipos conocidos, cerradas, vinculadas a cierre y con fecha verificable, preservando cabecera, totales, pagos, cierre, `itemCount` y marcador `archiveVersion: 1`.
4. La fusión del push valida cabecera, detalle y cantidad contra la referencia cloud al habilitar un marcador. Sin baseline o ante discrepancias conserva/restaura el detalle. Esta ruta requiere pruebas de ciclo completo en entorno aislado antes de habilitarla.
5. La fusión ordinaria y la protección local `storageService` siguen no destructivas. No se añadió bypass general al circuito de reducción de arrays.
6. El merge on-push está detrás de un opt-in explícito: solo se activa con `dj_sales_push_merge_v1 === 'true'`, sin purga deliberada y en el device_id de producción configurado. Si la referencia RPC falla o devuelve un array vacío, el push se pospone para no sobrescribir historial no verificado; el breaker clásico sigue activo.
7. El archivado de detalle está desactivado en el punto de integración (`SALES_ARCHIVE_ENABLED = false`). Se mantienen el utilitario y sus tests, pero no se retiran `items` de ventas en pushes de producción hasta certificar en entorno aislado el ciclo de lectura, persistencia del marcador, pulls, informes y restauración desde backup.

### Fase B — Kardex: helper de snapshot, integración apagada

1. `compactKardexPayload` es un helper puro que puede representar movimientos anteriores a una ventana móvil de 30 días mediante el último `stock_despues` verificable por producto, en un registro `APERTURA_PERIODO` determinista.
2. Movimientos dentro de la ventana y registros con fecha/producto/saldo incompletos se conservan.
3. La integración outbound está desactivada (`KARDEX_EGRESS_COMPACTION_ENABLED = false`) hasta probar los consumidores remotos: IndexedDB, backup y servicio de Kardex no se modifican.
4. Si se habilita en el futuro, esos snapshots serán una frontera de estado de la historia remota; no sustituyen el ledger completo del POS ni deben usarse para probar auditoría histórica anterior al corte.

### Fase C — Reducir publicaciones redundantes

- El arranque del POS pasa a respetar el hash ya existente. Se conserva el modo incondicional donde es intencional (restore/import).
- Los hooks registran el hash versionado de la fuente de ventas/Kardex luego de un push exitoso; como ambas transformaciones están apagadas, el hash de la fuente y el hash outbound coinciden en el flujo actual. La invalidación de hashes fuente no borra hashes outbound válidos de otras claves.
- El guard de salida de todos los documentos mide bytes UTF-8 cuando `TextEncoder` está disponible (fallback conservador para WebViews antiguos).

### Fase D — Monitor: catch-up incremental menos frecuente con canal sano

- Presencia sigue comprobándose cada 30 s; el catch-up por RPC corre cada 3 minutos cuando el WebSocket está sano.
- Si el canal cae, se conserva el intento de recuperación del siguiente tick de health-check; el evento `online`, volver a una pestaña visible y la recuperación manual siguen disparando sincronización inmediata.
- Realtime permanece activo para actualizaciones en vivo. El cambio no promete latencia fija de <500 ms ni reduce pulls completos solicitados expresamente.

---

## 3. Riesgos y guardarraíles

| Riesgo | Mitigación en la implementación | Límite / verificación pendiente |
|---|---|---|
| Cierres reducidos | No se archivan objetos `REGISTRO_CIERRE`; breaker de cantidad sigue activo | Probar con el Doc 60 real y todos sus 59 cierres antes de rollout |
| Merge cloud restaura items podados | Marcador versionado, comparación del baseline/detalle y validación de conteo | Confirmar formato histórico, metadatos variables y casos de ventas anuladas en una copia de backup |
| Venta antigua sin detalle en gráficos/reportes | La transformación de ventas está desactivada en el punto de integración; ningún push normal retira `items` ni metadatos | El helper de archivado requiere verificación de punta a punta y restore aislado antes de habilitarse |
| Pérdida del ledger | Integración del snapshot outbound desactivada (`KARDEX_EGRESS_COMPACTION_ENABLED = false`); historial local intacto | Antes de habilitar, revisar auditoría histórica remota y verificar que los consumidores soporten apertura de período |
| Lectura cloud fallida o vacía | Con el opt-in de merge, se pospone el push; nunca se trata un error como array vacío válido | Confirmar RPC/pairing en caja real y disponer de mecanismo explícito para recuperar/reintentar pushes pospuestos |
| Bytes o cuota no reproducibles | El límite outbound calcula JSON en UTF-8; el umbral de 400 KiB existe solo dentro del helper opt-in de ventas | El tamaño del objeto en panel no equivale necesariamente al egress agregado de Realtime/HTTP; no comprometer metas mensuales hasta observarlo |
| Rollback | Transformación de ventas desactivada (`SALES_ARCHIVE_ENABLED = false`); el payload sale sin compactación por `compactSalesPayload` | `SALES_COMPACTION_ENABLED` desactiva el helper opt-in. Si en el futuro se habilita archivado y ya se publicó, el kill switch no recompone el detalle cloud; requiere restore probado o republicación autorizada |
| Realtime/monitores abandonados | No se revocan dispositivos desde este cambio | Inventariar heartbeat/canales y obtener aprobación explícita antes de `revoke_monitor` |

---

## 4. Pruebas automatizadas implementadas

- `tests/salesCompactor.test.js`: passthrough por defecto, no mutación local, cierres intactos, bytes UTF-8, utilitario de archivo opt-in y marcador idempotente. Estos tests prueban el helper, no habilitan archivado en el hook de producción.
- `tests/salesPushMerge.test.js`: merge no destructivo, empate a favor de la nube, passthrough del helper ante referencia ausente y veto ante referencia vacía; pruebas del marcador permanecen unitarias mientras el archivado en producción está apagado.
- `tests/kardexEgressCompaction.test.js` y `tests/kardexScope.test.js`: helper de snapshots por SKU, frontera de stock y casos incompletos. La integración outbound sigue apagada en el hook.
- `tests/monitorSyncRecovery.test.js`: tres minutos con canal sano, recuperación con canal no sano y protección de cursor.
- `tests/egressHashOwnership.test.js`: arranque que respeta hashes y dueño del hash de egress.

Comandos de verificación ejecutados (usar Bun, configurado por el proyecto):

```bash
bunx vitest run tests/salesCompactor.test.js tests/salesPushMerge.test.js tests/salesMerge.test.js tests/kardexEgressCompaction.test.js tests/kardexScope.test.js tests/monitorSyncRecovery.test.js tests/egressHashOwnership.test.js tests/cloudSyncPresence.test.jsx tests/cloudStorageReaders.test.jsx tests/customerBalanceQuarantine.test.js
bun run build
git diff --check
```

Última ejecución de la suite combinada: **10 archivos / 122 pruebas pasaron**. `bun run build` también terminó correctamente; Vite emitió advertencias existentes de imports dinámicos/estáticos mezclados y tamaño de chunk. `git diff --check` pasó (solo avisos de conversión LF/CRLF del checkout).

El script `typecheck` del package actualmente termina con `|| true`; su salida no certifica un typecheck satisfactorio y puede invocar TypeScript sin un `tsconfig.json` utilizable. Interpretar ese comando con cautela.

### Medidor local de egress: recolección sin interfaz

- El medidor (`src/utils/egressMeter.js`) sigue instrumentado en los clientes Supabase y guarda solo agregados en `localStorage` bajo `dj_egress_meter_v1`. **No tiene componente ni entrada en Ajustes**: `EgressMeterPanel` fue retirado y un test (`tests/egressMeter.test.js`) falla si vuelve a aparecer en `SettingsTabSistema.jsx`.
- Para que un desarrollador recoja los datos sin UI, el módulo expone `window.__djEgress` (solo consola, sin red): `report(days)`, `export(days)`, `copy(days)`, `pause()`, `resume()`, `clear()`, `status()`.
- Procedimiento: en DevTools → Consola, ejecutar `copy(__djEgress.export(30))` y pegar el JSON en la conversación. Alternativa: `__djEgress.report(30)` para inspección directa.
- Ningún dato sale del navegador salvo copia manual del operador. El total facturado sigue siendo el de Supabase → Usage → Egress.

---

## 5. Rollout y validación operativa pendientes

1. Verificar que el backup frío existe, abre/descomprime, contiene ventas/Kardex completos y tiene timestamp/checksum identificables. El archivo indicado en el plan inicial existe en el checkout como `RESPALDO_INVENTARIO_NUBE_2026_09_27.json`, pero su restaurabilidad debe probarse sin sobreescribir producción.
2. Probar con una copia de los datos reales: número/IDs de cierres, ventas cerradas/abiertas/anuladas, pagos mixtos, cantidades de items, cabeceras y reports históricos antes/después.
3. Revisar que la cuenta de Supabase tenga el pairing requerido para `read_paired_audit_documents`; el flujo de archive se deja bloqueado hasta poder leer una baseline válida.
4. Registrar durante 24–72 h egress antes/después, requests de `write_paired_sync_document`, bytes JSON por documento, número de clientes Realtime y fallos de recuperación. Comparar ventanas equivalentes; no usar las metas originales de 12–20 MB/día o <0,6 GB/mes como promesas.
5. Consultar en la UI cuáles monitores tienen heartbeat reciente. Solo el responsable de la cuenta debe decidir revocaciones; ninguna revocación está incluida en este cambio.
6. Si hay regresión: desactivar `SALES_COMPACTION_ENABLED` en código/build para detener toda sanitización outbound de ventas y restaurar/republicar una copia completa conocida solo mediante flujo autorizado. No ejecutar purgas, SQL, RPC de revocación ni restauraciones productivas automáticamente.

---

## 6. Criterios de aceptación

- Venta: sanitización outbound no muta el historial local, ninguna venta/cierre desaparece; el archivado queda desactivado hasta aprobar pruebas aisladas de baseline, persistencia, consumo y restauración. El beneficio medido aún está pendiente.
- Kardex: local idéntico byte/registro a antes del push. El helper de snapshot tiene pruebas de frontera/saldo, pero la integración remota permanece apagada hasta certificar consumidores y restore.
- Monitor: canal sano hace catch-up cada 3 minutos; reconexión y recuperación manual permanecen inmediatas.
- Egress real: reducción observada en métricas Supabase tras un periodo de muestra comparable, desglosada por Realtime/HTTP si el panel lo permite.
- Rollback: restore desde backup probado en ambiente aislado antes de aprobar poda outbound en producción.
