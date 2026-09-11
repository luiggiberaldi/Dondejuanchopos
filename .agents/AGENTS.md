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
