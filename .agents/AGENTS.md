# Memoria y Reglas de Desarrollo — Donde Juancho POS (Precios al Día)

Este archivo define las directivas operativas mandatorias, contexto del negocio, infraestructura y el dispositivo central para cualquier sesión de IA y pair programming.

---

## 📱 DISPOSITIVO CENTRAL Y AUDITORÍAS (REGLA MANDATORIA)
> [!IMPORTANT]
> **DISPOSITIVO CENTRAL Y AUTORITATIVO DE PRODUCCIÓN:**
> * **`device_id`:** `PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F`
> * **Tipo / Modelo:** Terminal portátil táctil Sunmi V2 / PDA de Caja Principal con impresora térmica integrada.
> * **Operador habitual:** Chailin (Rol: `CAJERO`).
> 
> **DIRECTIVA ABSOLUTA PARA TODA INVESTIGACIÓN O AUDITORÍA:**
> Siempre que el usuario solicite investigar, auditar, contrastar, revisar o corregir datos de ventas, inventario, Kardex, cierres de caja, arqueos o clientes, **ES OBLIGATORIO Y POR DEFECTO HACERLO PARA ESTE DISPOSITIVO (`PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F`)**, consultando sus documentos en Supabase (`sync_documents?device_id=eq.PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F`) o sus comandos encolados (`supervisor_commands?primary_device_id=eq.PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F`), a menos que el usuario indique explícitamente otro ID de dispositivo.

---

## ⚙️ Principios Clave de Arquitectura e Infraestructura
1. **Offline-First:** IndexedDB/localforage (`storageService`) es la fuente de verdad local. Sincronización en la nube bidireccional vía Supabase (`sync_documents`).
2. **Cero Cálculos de Punto Flotante con Dinero:** Todos los cálculos monetarios deben usar estrictamente `dinero.js` (`round2`, `mulR`, `subR`, `sumR`, `divR`). Nunca usar `Math.round` o `toFixed` para finanzas.
3. **Cerrojos de Concurrencia:** Todo read-modify-write en ventas, clientes, caja o inventario debe ejecutarse bajo `withLock('pos_write_lock')`.
4. **Regla de Oro en Clientes:** El saldo neto de clientes se normaliza estrictamente como `saldoNeto = favor - deuda`. Un cliente nunca puede tener deuda y saldo a favor simultáneamente.
5. **Reversibilidad de Transacciones:** Todo movimiento en la ficha del cliente (abonos, créditos, ventas) es reversible mediante `processVoidSale` con previsualización del nuevo saldo en `VoidMovementModal`.
6. **Preservación Inmutable de Cierres y Turnos:**
   - La tabla de ventas `bodega_sales_v1` del PDA principal (`Doc ID 60`) debe mantener siempre los registros de cierre (`tipo === 'REGISTRO_CIERRE'`). Si alguna vez se truncan en Doc 60, se rescatan de `Doc ID 18483` (que almacena todos los 40 cierres históricos #1 al #39).
   - **Guarda-rail de Re-Apertura:** Si ya existe una apertura activa en la jornada, ninguna re-apertura accidental (ej. con 0 Bs / 0 USD) puede mover hacia adelante el timestamp del turno ni fragmentar ventas anteriores.
   - **Script de Recuperación:** Si se desincroniza la jornada del 10-09-2026, ejecutar:
     `node scripts/reconcile-shift-10092026.mjs`
   - **Conciliación Oficial del 10-09-2026:**
     - Apertura: 9.980,00 Bs y $33,00 USD
     - Ventas: 15.350,00 Bs (8 ventas: #785 a #792) -> PM: 5.550 Bs, PTO: 9.670 Bs, Efectivo: 130 Bs
     - Gasto Teipe: -1.700,00 Bs en efectivo
     - Gaveta final: 8.410,00 Bs y $33,00 USD
7. **Consistencia de Clientes y Prevención de Reversión de Saldos (Caso Jose Gregorio / Mono - CLI-00011):**
   - **Incidencia:** El cliente `CLI-00011` (anteriormente "mono", ID: `733d1603-5672-4dec-8f40-79aa572f5d5a`) presentó una anomalía de saldo a favor de `+$2,022.97`.
   - **Causa Raíz:** Se originó por una confusión de moneda al ingresar una transacción en Bolívares con el selector en `USD` en `TransactionModal`.
   - **Por qué Revertía:** La caja física Sunmi V2 (`PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F`) conservaba el registro en su IndexedDB local. Al estar la sincronización basada en sobreescritura de array completo (`pushCloudSync('bodega_customers_v1')`), cada vez que la caja física reconectaba o vendía, pisaba la nube con su saldo local corrupto, anulando los reseteos del Monitor (que fallaban silenciosamente por RLS al intentar UPDATE directo en `sync_documents`).
   - **Estado Autorizado y Consolidado (11-09-2026):**
     - **ID:** `733d1603-5672-4dec-8f40-79aa572f5d5a` | **Código:** `CLI-00011`
     - **Nombre:** `jose gregorio` (anteriormente `mono`)
     - **Teléfono:** `04128677412`
     - **Deuda Total Legítima:** **$14.08 USD** (Venta #438: $9.58 + Venta #492: $1.13 + Venta fiada #793: $3.37 [1x Margarina Nelly 250gr $2.50 + 1x Malta Retornable $0.87]).
     - **Saldo a Favor:** **$0.00**.
     - **Depuración:** Se eliminó el duplicado temporal vacío `CLI-00019`.
   - **Comando Supervisor Asociado:** Comando `d0a94c27-bd0f-445a-885c-4b984370768f` (`inventory_update` con `update_customer_balance`) encolado en `supervisor_commands` para actualizar la base de datos IndexedDB local de la caja Sunmi en su próxima sincronización.
   - **Script de Rescate Rápido:** Si por alguna contingencia la caja física volviera a sobreescribir el saldo, ejecutar:
     `python scripts/fix_jose_gregorio_balance.py`
8. **Blindaje de Ventas Vinculadas a Cierres Históricos y Anti-Sobreescritura Cloud:**
   - **Incidencia:** En la pestaña "Historial de Cierres" del Monitor, cierres históricos (ej. Cierre #37) mostraban el desglose de métodos de pago y la lista de ventas del turno completamente vacíos (`[]`).
   - **Causa Raíz:** En `bodega_sales_v1` de Doc 60 coexistían los 40 resúmenes `REGISTRO_CIERRE`, pero las ventas históricas no tenían `cierreId` asignado (estaban en Doc 18483 con `cierreId`), por lo que el filtro `s.cierreId === cierre.cierreId` de `useMonitorShiftMetrics.js` no encontraba movimientos asociados.
   - **Triple Blindaje Implementado:**
     1. **`salesMerge.js` (`mergeSingleSale`):** Si una venta tiene `cierreId` o `cajaCerrada: true` en cualquiera de sus versiones (local o entrante), se preserva sellada incondicionalmente. Ninguna sincronización o actualización posterior puede borrar o poner en `undefined` el `cierreId`. Para los `REGISTRO_CIERRE`, preserva el `summary` y numeración intactos.
     2. **`useCloudSync.js` (`pushCloudSyncNow`):** Circuit breaker que bloquea cualquier subida a la nube de `bodega_sales_v1` si el array entrante contiene menos cierres que el mínimo histórico (39 cierres) o menos que el máximo conocido (`bodega_sales_max_cierres`). Si la PC/PDA principal enciende sin conexión o con una base de datos local vieja/incompleta, **nunca sobreescribe Doc 60 en Supabase**.
     3. **`storageService.js`:** Auto-fusión inmediata ante intentos de encogimiento de ventas o reducción en el conteo de `REGISTRO_CIERRE` (`isCierresCountShrinking`), con auto-recuperación desde `bodega_sales_shadow_backup_v1`.
   - **Estado Consolidado Doc 60:**
     - 906 registros (40 cierres históricos + 805 ventas vinculadas con `cierreId` + turno activo con 8 ventas y 1 gasto).
     - Cierre #37: 6 movimientos vinculados ($22.22 USD / 18.222,66 Bs), breakdown exacto.
9. **INCIDENCIA RECURRENTE — Ventas del PC que no llegan a la nube (12-09-2026, aún SIN solución definitiva):**
   - **Síntoma:** El Monitor del Supervisor muestra cifras de turno desactualizadas (ventas totales, gaveta esperada). Las ventas existen SOLO en el IndexedDB del PC principal.
   - **Causa Raíz estructural (confirmada por auditoría del 12-09):** El POS primario es **push-only** (`_applyFromCloud` solo lo usa el monitor; la caja JAMÁS hace pull de `bodega_sales_v1`). El circuit breaker de `pushCloudSyncNow` exige ≥39 cierres para autorizar el push — pero el PC quedó con un historial local truncado (apenas 2 cierres tras el incidente del cierre errado del 11-09). Resultado: el push de ventas del PC está bloqueado INDEFINIDAMENTE y cada venta nueva solo vive en su IndexedDB. Los cambios de clientes/productos SÍ sincronizan (otro flujo), por eso el problema pasa desapercibido hasta el arqueo.
   - **Agravantes descubiertos:** (a) Existen al menos DOS dispositivos operando bajo el MISMO `device_id` `PDA-V2-...39F` (el PC y una instancia con dataset viejo del 19-08 que también consume comandos y sube backups) — cualquier fix debe asumir escritores múltiples. (b) Las correcciones por comando (`register_customer_payment`, fiadas) insertan ventas con numeración que colisiona con las ventas propias del PC (el PC numeraba #795–#808; los comandos usaron #801–#803). (c) La PWA activa el Service Worker nuevo con retraso (hasta ~15 min), por lo que comandos con acciones nuevas fallan una vez con "Acción inválida" y requieren re-encolado.
   - **Parche temporal del 12-09 (NO es solución definitiva):** Rescate manual de 14 ventas al Doc 60 (renumeradas #804–#817 vía `scripts/rescue-14-sales-and-fix-abono-11092026.mjs`) y reclasificación del abono de Ramón a `pago_movil` (el dueño lo recibió; no cuenta como efectivo de gaveta). El PC quedó con numeración propia divergente que habrá que reconciliar.
   - **Plan de fixeo definitivo (PENDIENTE DE IMPLEMENTAR):**
     1. Reemplazar el breaker binario por un **merge-on-push** para ventas: el push del PC nunca debe ser todo-o-nada; debe fusionar por `id` (union de registros, sellados preservados vía `salesMerge`) y solo bloquear si detecta BORRADO de registros existentes. Así un historial local pequeño nunca vuelve a bloquear ventas nuevas.
     2. **Reconstruir el historial del PC**: restaurar en su IndexedDB el Doc 60 consolidado (una vez, controlado) para que su push vuelva a ser legítimo y la numeración se alinee.
     3. **Identidad de dispositivo**: separar el `device_id` de la instancia vieja/fantasma o purgar su acceso, para que haya UN solo escritor por `device_id`.
     4. **Numeración de ventas autoritativa en nube**: obtener `saleNumber` de un contador central (secuencia en Supabase o max de Doc 60) al momento de facturar, en vez de `max(local)+1`.
     5. **Alerta de divergencia**: chequeo programático (o en el Monitor) que compare `count(ventas hoy en Doc 60)` vs `max(saleNumber)` y avise cuando la nube se quede atrás del PC.
   - **Lección operativa:** mientras el push siga bloqueado, después de cada jornada con ventas hay que verificar el Monitor contra un `request_full_backup` del PC y rescatar a mano.
   - **ACTUALIZACIÓN 13-09 (II): FASE 3B CORREGIDA EN PRODUCCIÓN (RLS) + FASE 4 DESPLEGADA** —
     (a) La primera venta con allocator (#842, 22:47) reveló vía `saleNumberNote` que el
     INSERT del reclamo violaba RLS: la política de hardening exige `status='pending'`
     y el diseño insertaba 'applied' directo (los scripts de boot lo enmascaraban con
     service key). Arreglo: insert pending + self-confirm UPDATE a 'applied' + relectura
     AGNÓSTICA de status (`.in('status', ['pending','applied'])`); claims excluidos del
     routing del hook. Verificado en vivo: ventas de 23:55/00:10/00:24 reclamaron
     #844/#845/#846 desde la nube con la instancia real del PC. (b) FASE 4 completa:
     banner de divergencia PC↔nube en Monitor (divergenceAlert.js puro 12 tests +
     usePcDivergenceCheck con auto-chequeo por sesión TTL 15 min + botón manual) y
     `scripts/daily-sync-audit.mjs` (solo lectura, exit 1 en advertencias): su primera
     corrida guió la limpieza de 5 pares duplicados (#830–#834→#847–#851) y quedó
     vigilando la divergencia estructural (PC 78 vs nube 967) que FASE 2 cierra al
     cierre de caja.
   - **ACTUALIZACIÓN 13-09: FASE 3B IMPLEMENTADA Y DESPLEGADA — tobogán de duplicados cerrado** —
     `src/utils/saleNumberAllocator.js`: el `saleNumber` ya no nace de `max(local)+1`
     (causa raíz de todos los incidentes de duplicados) sino de la NUBE al facturar:
     línea base = máx del Doc 60 leído fresco (RPC existente, sin DDL), reclamo atómico
     en `supervisor_commands` (fila `applied`, `action='sale_number_claim'` — patrón de
     anuncio de 3A) + compactación secuencial determinista (`resolveClaims`) para
     ráfagas; fallback offline = `max(local)+1` marcado `saleNumberProvisional` con
     guardia monótona. Migrados `checkoutProcessor` (facturación) y
     `customerTransactionProcessor` (abonos/créditos). Bugs reales atrapados por tests:
     claimKey colapsable en misma ms, COBRO_DEUDA invisible para el máximo local (los
     abonos SÍ consumen numeración). 27 tests nuevos + suites de checkout/clientes en
     verde (118 corridas). Bootstrap end-to-end en vivo: asignación cloud #842 con el
     par canónico + fallback verificado; reclamo de evidencia eliminado tras la prueba.
     3 pares duplicados del vespertino (#825–#827) renumerados a #839–#841 con el
     script idempotente; Doc 60 con 0 duplicados y máx #841 al cierre de la fase. El
     par FASE 2 (`replace_sales_history`) sigue armado en pending para el cierre de
     hoy — tras aplicarse, el máximo local del PC se alinea y las colisiones cesan.
   - **ACTUALIZACIÓN 12-09 (noche, IV): FASE 2 re-armada con AUTO-DIFERIMIENTO** —
     El orquestador nocturno murió con la sesión que lo lanzó (21:01 UTC) y FASE 2 nunca ejecutó. Sustituido por defer integrado: prepare/apply encolados una vez quedan `pending` con turno abierto (Gate 2 hace return silencioso), se re-evalúan en cada ciclo de polling y se ejecutan solos al cierre de caja (prepare auto-encola su backup, sella confirmToken en su fila; apply espera el prepare aplicado). Tres pares quemados por SW viejo antes de que el defer estuviera activo (incluido un bug propio: defer DESPUÉS del Gate 2 — corregido moviéndolo AL Gate 2). Cuarto par armado y VERIFICADO en defer (pending tras polling del PC real, 21:44 UTC). La verificación de la reconstrucción (historial PC == Doc 60, max #838+) es para la mañana del 13-09.
   - **ACTUALIZACIÓN 12-09 (noche, III): FASE 3A IMPLEMENTADA Y GATE REGISTRADO** —
     (a) **Código**: `src/utils/instanceFingerprint.js` — `dj_instance_id` persistente por navegador (aparece como `instanceId` en cada backup v2.1), puerta de comandos con concesión central y cache TTL 60s; fail-open si el gate no está registrado (despliegue seguro). Gate cableado al inicio de `processCommand` en `useSupervisorCommands.js`: instancia no-primaria → `return` SIN `updateCommandStatus` (el comando queda pending para la caja real).
     (b) **Canal del gate** (decisión de diseño): `read_paired_audit_documents` tiene lista blanca de doc_ids (agregar uno exige DDL; token Management API muerto) → el gate vive como ANUNCIO en `supervisor_commands` (`{action:'instance_gate', primaryInstanceId}`, `command_type='inventory_update'`, insertada DIRECTAMENTE en status 'applied' — jamás se procesa como comando). Elegido el más reciente por `created_at` (la tabla viva no tiene `updated_at`). 22 tests; verificado el upsert/lectura con el MISMO camino que usa el POS.
     (c) **Registro**: `scripts/register-primary-instance-12092026.mjs` — encola backup fresco, verifica identidad (`instanceId` + Service Worker + dataset reciente/número cercano; la fantasma del 19-08 queda descartada por datos viejos, NO por historial truncado que es normal) y registra `6630e805…` como instancia primaria. Desplegado a producción; efectivo en cuanto la fantasma recargue su SW.
     (d) **Segunda pasada de renumeración**: la facturación vespertina del cajero (#816–#824) creó 9 colisiones nuevas con los números de la primera cirugía; re-aplicado el script (idempotente) → #830–#838, 0 duplicados, totales intactos. Ventana de colisión residual queda limitada a ventas nuevas hasta FASE 2 (esta noche) y desaparece con FASE 3B.
   - **ACTUALIZACIÓN 12-09 (noche, II): FASE 1 ACTIVADA Y VERIFICADA + FASE 2 IMPLEMENTADA** —
     (a) El 12-09 a las 19:41 UTC la PC real aplicó `enable_feature` (los 2 intentos previos los quemó la instancia fantasma mientras la PC estaba apagada) y su primer push FUSIONADO entregó a la nube el cierre de las 12:30 am y 7 ventas nocturnas: Doc 60 de 935→945 registros, 42→43 cierres, 14→21 ventas de hoy, sin pérdidas ni duplicados por id. Conciliación PC↔nube por id: 0 faltantes en ambas direcciones; summary del cierre byte-idéntico; clientes 18/18 idénticos.
     (b) **FASE 2 implementada y desplegada**: comando `replace_sales_history` (envelope `inventory_update`) en dos fases prepare→apply con token de confirmación `cierreCount:maxSaleNumber:recordCount`, gates de device+turno cerrado+lectura cloud fresca+backup <30 min verificado, única escritura `bodega_sales_v1` bajo `pos_write_lock` (detalle en el plan maestro). Helpers puros en `src/utils/salesHistoryRestore.js`; 23 tests nuevos, suite en verde.
     (c) **Orquestador nocturno armado**: `scripts/fase2-overnight-12092026.mjs` (log `logs/fase2-overnight.log`) espera el cierre de caja y ejecuta backup→prepare→apply→backup final solo, con reintentos ante SW viejo y abort limpio si se abre un turno.
     (d) **Pendiente descubierto**: 12 `saleNumber` duplicados en el Doc 60 (#759–#763 y #809–#815, ventas distintas con mismo número) — la numeración local `max(local)+1` del PC colisiona con la nube; la FASE 2 alinea el máximo local (#817) y la FASE 3B lo elimina estructuralmente.
     (e) **RENUMERACIÓN APLICADA (12-09 20:28 UTC)**: `scripts/renumber-duplicates-doc60-12092026.mjs` renumeró el lado más reciente de los 12 pares a #818–#829 (regla: conserva el número la venta más antigua; trazabilidad `_renumberedFrom`/`_nota`/`updatedAt`). Verificado: 0 duplicados, mismas ventas por id, totales Bs/$ idénticos, summaries de cierres intactos, 945 registros. **No-revert probado** ejecutando el `prepareSalesPushPayload` de producción contra el store local real del PC (backup 65 registros): union-merge sin veto, 12 renumerados intactos, max #829, 0 duplicados. Snapshot pre-cirugía: `backups/snapshot-doc60-pre-renumber-*.json`. Nota: la primera escritura tenía un bug del script (marcaba trazabilidad sin asignar `saleNumber`) — la verificación post-escritura del propio script lo detectó; corregido y re-aplicado. Pendiente residual: si el PC factura antes de la FASE 2 nocturna, su venta puede duplicar #816/#817; con FASE 2 aplicada el máximo local pasa a #829 (y luego 3B elimina la clase entera).
   - **ACTUALIZACIÓN 12-09 (noche): FASE 1 IMPLEMENTADA Y DESPLEGADA** — ver `docs/PLAN-MAESTRO-FIX-SYNC-VENTAS.md` (decisiones) y `docs/BITACORA-SESION-1009-1209-2026.md` (bitácora completa). Código en `src/utils/salesPushMerge.js` + cableado en `pushCloudSyncNow` (triple compuerta: flag `dj_sales_push_merge_v1` ∧ device de producción ∧ respeto a purga deliberada; invariante I5: en empate de updatedAt gana LA NUBE y los cierres sellados son intocables salvo corrección estrictamente posterior). 14/14 tests. Comando `enable_feature` encolado; **activación pendiente de que el PC reconecte** (offline desde 04:30 UTC, cierre de caja ~00:30 local NO sincronizado; `request_full_backup` ya encolado para rescatar el cierre y las ventas post-02:43 UTC al reconectar).
