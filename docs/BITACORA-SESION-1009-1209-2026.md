# 📋 Bitácora de sesión — Auditoría 10-09 → 12-09-2026 y FASE 1 del plan maestro

> Sesión de emergencia iniciada por: cierre errado ($0.71) en la PC principal, los datos del
> cierre documentado de la Jornada 10-09 no llegaron a la nube, sincronización rota y cambios
> del supervisor sin efecto. Todo lo descrito quedó aplicado y verificado salvo lo marcado ⏳.

---

## 1. Línea de tiempo de la incidencia

| Hora (UTC) | Evento |
|---|---|
| 10-09 | Jornada 10-09 operada normalmente. PC principal registra ventas #779–#784. |
| 11-09 ~01:00 | **Cierre errado**: la PC hace un cierre ciego de **$0.71** sin los datos reales (el cierre documentado decía 15.350 Bs / 8 ventas / gaveta 8.410+$33). Ese cierre errado se subió a la nube pisando el intento correcto. |
| 11-09 16:57 | El local corrupto del PC (clientes con favor $2,022.97) **pisó el Doc 52 de la nube**. El `customerSyncGuard` lo sanitizó a 0/0. CLI-00011 "mono" quedó 0/0 en la nube. |
| 11-09 16:59 | Se **reabre caja** ("relance") con apertura 8.410 Bs / $33. Turno activo nuevo. |
| 12-09 00:56–03:06 | Cirugías de convergencia (ver §2). 14 ventas del PC rescatadas a la nube. Abono de Ramón reclasificado a Pago Móvil. Fiadas de jose gregorio insertadas. |
| 12-09 03:06 | Última operación confirmada del PC (aplicó `update_sales_record` del abono). |
| 12-09 04:25 | El PC sube `bodega_products_v1` por última vez. |
| 12-09 04:30 | Último heartbeat del PC (`device_pairings.last_seen_at`). **La caja se cerró ~00:30 local (04:30 UTC) y el PC quedó sin conexión.** |
| 12-09 04:46 | Se encola `enable_feature` (FASE 1) — 2 minutos tarde, el PC ya estaba offline. Queda `pending`. |

---

## 2. Trabajo realizado (en orden)

### 2.1 Convergencia del Doc 60 (nube)
- **Rescate del cierre canónico**: el cierre errado #41 ($0.71, id `cierre_1789145662786`) se **reescribió** con los datos del cierre documentado (15.350 Bs / 8 ventas / gaveta 8.410+$33 / declarado=esperado / diff 0), preservando timestamp y operador originales. Se registró además el **cierre forzado #40** (cierre administrativo) y la apertura de relance quedó como turno activo.
- **Historial consolidado**: Doc 60 pasó de 907 → 918 → 935 registros. Cierre #40 + cierre #41 canónico + las 8 ventas rescatadas (#785–#792, 58.390 Bs) + apertura de relance.
- **Snapshots de rollback** en `backups/` antes de CADA escritura: `snapshot-doc60-pre-rescate14.json`, `snapshot-consolidado-doc60-52-20260912.json`, y respaldo vivo del PC `backups/pc-local-backup-live.json`.

### 2.2 Clientes (Doc 52)
- **CLI-00011 "mono" → "jose gregorio"**: teléfono 04128677412, deuda final **$17.45** (14.08 autorizados + Margarina Nelly 250gr $2.50 + Malta Retornable $0.87 — precios del catálogo REAL del PC; la nube tenía un catálogo viejo con la margarina a $1.78, se reemplazó por el catálogo del PC: 154 → 189 productos).
- **Duplicado eliminado**: CLI-00019 "mono" (mismo teléfono, 0 ventas asociadas, 0/0) borrado con el comando nuevo `delete_customer` (con blindaje: rechaza borrar clientes con saldo salvo `force`).
- **Abono de Ramón (CLI-00005)**: **$21.28** (20.000 Bs efectivo ÷ tasa 940) → deuda 87.50 → **$66.22**. Registrado como movimiento `COBRO_DEUDA` #801 con historial.
- **Fiadas de jose gregorio**: #802 Margarina Nelly 250gr $2.50 (2.350,00 Bs) y #803 Malta Retornable $0.87 (817,80 Bs) — insertadas como `VENTA_FIADA` reales para que aparezcan en el historial del modal.
- Fiados por cobrar verificados: **$148.27** = suma exacta de los 8 deudores (ramón 66.22 + gabriel 21.10 + jose gregorio 17.45 + juan carlos 17 + elis 13 + alexander 7.29 + alexander2 6.20 + adrián 0.01).

### 2.3 Ventas y arqueo del turno activo
- El monitor mostraba 8 ventas/58.390 Bs pero el PC tenía **22 ventas/119.120 Bs** — 14 ventas de hoy (12-09) atrapadas en su IndexedDB por el breaker. **Rescatadas** como #804–#817 (con `_originalSaleNumber` para trazabilidad).
- **Abono de Ramón reclasificado**: el dueño lo recibió **por Pago Móvil**, no en efectivo → ya no suma a la gaveta. Corregido en nube (marcado `_corregido`) y en el PC local (comando `update_sales_record`).
- **Gaveta esperada correcta**: 8.710 Bs / $67.00 (apertura 8.410 + efectivo ventas 260+40 Bs + $5+$1 USD), no 28.670 (que inflaba el abono como efectivo).

### 2.4 Handler de comandos del supervisor (`useSupervisorCommands.js`) — acciones nuevas
| Acción | Para qué |
|---|---|
| `update_customer_balance` (envelope inventory_update) | Corregir deuda/favor por comando |
| `delete_customer` | Borrar duplicado con blindaje de saldo |
| `register_customer_payment` | Abonos (`COBRO_DEUDA`) y fiadas (`creditos`) reales con movimiento en Doc 60 |
| `update_sales_record` | Corrección quirúrgica de cualquier registro de venta |
| `enable_feature` | Activar flags por comando (FASE 1) — solo lista blanca |

Todas: idempotentes por id de comando, con `withLock('pos_write_lock')`, push a nube tras aplicar, y envelope `command_type:'inventory_update'` (único aceptado por la constraint viva de la tabla).

### 2.5 FASE 1 del plan maestro — merge-on-push (✅ código, ⏳ activación)
- `src/utils/salesPushMerge.js`: `prepareSalesPushPayload` (unión por id + veto de no-encogimiento) y `fetchCloudSalesReference` (lee Doc 60 por RPC existente `read_paired_audit_documents` — **cero DDL necesario**, token del Management API estaba vencido pero no hizo falta).
- **Invariante I5**: en empate de `updatedAt` gana LA NUBE; los `REGISTRO_CIERRE` sellados los manda la copia cloud salvo que el local sea estrictamente más nuevo. El cierre $0.71 ya corregido no puede ser resucitado por el local truncado.
- Cableado en `pushCloudSyncNow` con **triple compuerta**: flag `dj_sales_push_merge_v1` (kill-switch sin redeploy) ∧ device_id de producción (la instancia fantasma queda fuera) ∧ respeta `confirm_sales_purge_flag`. El breaker de 39 cierres queda intacto como segunda línea.
- **14/14 tests** en `tests/salesPushMerge.test.js`. Build verde. Desplegado a `dondejuanchopos.vercel.app`.
- ⏳ **Activación**: comando encolado (id `6fd51add`), pendiente de que el PC vuelva a conectar. Bucle `scripts/wait-and-activate-merge.mjs` re-intenta cada 3.5 min (~3 h) y verifica el push fusionado. Si al reconectar el PC aún corre el SW viejo, el comando fallará una vez con "Acción inválida" (inofensivo) y el bucle lo re-encolará.

### 2.6 Otros
- `read_paired_cloud_backup` RPC usado para descargar backups del PC sin acceso directo a `cloud_backups` (tabla cerrada a anon).
- Heartbeat de presencia: `device_pairings.last_seen_at` (lo escribe `touch_pos_heartbeat` cada 60 s).
- Instancia fantasma confirmada: un dataset viejo del 19-08 comparte el `device_id` del PC (subió un backup el 01:07). FASE 3A la aísla.

---

## 3. ⚠️ Situación al cierre de esta sesión (12-09 ~05:00 UTC)

### La caja se cerró a las 12:30 am, el supervisor dice que sigue abierta — ¿por qué?
1. El **cierre de las 12:30 am NO llegó a la nube**: Doc 60 congelado en `updated_at 03:06 UTC`. El push de ventas del PC sigue bloqueado por el breaker (el merge aún no se activó — el PC se apagó 2 min antes del comando).
2. El monitor calcula el "Turno Activo" desde la **apertura de relance (11-09 16:59)**, que en Doc 60 sigue sin cierre → por eso muestra "abierto". **No es un error del monitor: es la nube desactualizada.**
3. Además estaba **offline**: último heartbeat 04:30 UTC. Sin conexión no puede ni procesar comandos ni subir nada.

### ¿Se registraron más ventas después de las 22:43 (02:43 UTC)?
- **Desconocido hasta reconectar el PC.** Lo último visible en la nube son las 22 ventas rescatadas (hasta #817, rescate hecho a las 02:43 UTC).
- El PC estaba vivo hasta al menos **04:25 UTC** (subió productos) y su heartbeat llega a **04:30 UTC** (00:30 local, la hora del cierre). Es **probable** que hubiera ventas entre las 02:43 y las 00:30 local, y el registro de cierre de las 12:30 am con los totales finales.
- **Todo eso existe SOLO en el IndexedDB del navegador del PC.** Preparado para rescatarlo al reconectar:
  - `request_full_backup` ya encolado (el PC subirá su estado completo al conectar).
  - El bucle de activación de FASE 1 corre en background (`logs/wait-merge.log`); con el merge activo, el propio PC empujará su cierre y ventas nuevas fusionadas sin destruir nada.

### Plan al reconectar (orden)
1. Esperar a que el PC procese `enable_feature` (el bucle lo confirma solo).
2. Descargar el backup completo nuevo (`read_paired_cloud_backup`) y auditar: cierre de las 12:30 am, ventas nuevas post-02:43, arqueo final del turno.
3. Si el merge funciona, el Doc 60 se completa solo; si no, cirugía manual con el backup como fuente (mismo procedimiento de siempre: snapshot + insertar + verificar).
4. Cotejar gaveta física declarada por el cajero vs esperada del cierre.

---

## 4. Reglas operativas vigentes
1. **Mientras FASE 1 no esté confirmada activa**: verificar Monitor vs `request_full_backup` al cierre de cada jornada.
2. Nada se borra: siempre unión por id + snapshot de rollback en `backups/` antes de escribir.
3. Los comandos nuevos van sobre el envelope `inventory_update` (constraint viva de la tabla).
4. El Service Worker tarda ~15 min en activarse tras cada deploy: primer comando falla con "Acción inválida" → reintentar.
5. Regla de oro de los cierres: los `REGISTRO_CIERRE` sellados son inmutables; la nube manda salvo corrección estrictamente posterior.

## 5. Scripts creados (reutilizables)
| Script | Uso |
|---|---|
| `scripts/reconcile-cloud-final-11092026.mjs` | Cirugía de consolidación del Doc 60 |
| `scripts/rescue-14-sales-and-fix-abono-11092026.mjs` | Rescate de ventas + reclasificar abono |
| `scripts/dedupe-mono-cli00011.mjs` | Auditoría del duplicado de clientes |
| `scripts/rename-price-abono-11092026.mjs` | Renombrar/precio/abono por comando |
| `scripts/fiadas-jose-gregorio-11092026.mjs` | Insertar fiadas con historial |
| `scripts/mirror-fiadas-doc60-11092026.mjs` | Espejo de fiadas al Doc 60 |
| `scripts/fix-cobro-ramon-local-11092026.mjs` | Reclasificar abono en el PC local |
| `scripts/activate-sales-merge-12092026.mjs` | Encolar/verificar `enable_feature` |
| `scripts/wait-and-activate-merge.mjs` | Bucle resiliente de activación |
| `scripts/request-backup-11092026.mjs` | Pedir backup completo al PC |
| `scripts/audit-live-shift-11092026.mjs` | Auditoría read-only del turno activo |
