# Plan mejorado — Empleados, Consumos y Nómina Semanal

**Fecha:** 2026-08-19  
**Estado:** aprobado e implementado progresivamente  
**Alcance:** POS local, inventario/Kardex, nómina semanal, cierres de caja, backup y Monitor del Supervisor.

## 1. Objetivo

Implementar un módulo de empleados que permita administrar empleados y salarios semanales, registrar consumos de mercancía a precio de venta, descontar inventario inmediatamente, deducir los consumos de la nómina semanal y mostrar una proyección resumida en el Monitor del Supervisor.

El consumo de empleado no es una venta: no genera revenue ni entrada de efectivo. La liquidación sí puede generar un egreso financiero y, si se paga en efectivo, debe afectar la gaveta y el cierre de caja.

## 2. Decisiones de negocio

| Tema | Regla |
|---|---|
| Valoración | Precio de venta congelado al confirmar el consumo |
| Costo | Costo referencial congelado al confirmar el consumo |
| Período | Lunes 00:00 a domingo 23:59:59 en `America/Caracas` |
| Intervalo | `[periodoInicio, periodoFin)` |
| Salario | USD semanal congelado en el período |
| Límite | Bloqueo automático; ADMIN puede autorizar una excepción auditada |
| Stock | Descuento inmediato, sin stock negativo ni clamp silencioso |
| Caja al consumir | No afecta caja ni ventas |
| Liquidación inicial | Solo ADMIN local |
| Supervisor remoto | Consulta; no liquida en el MVP |
| Monitor | Proyección resumida en realtime; detalle bajo demanda |
| Correcciones | Anulación reversible; no borrar historial |

## 3. Alcance del MVP

### Incluido

- Catálogo de empleados activos/inactivos.
- Salario semanal y límite de consumo.
- Consumo desde POS por empleado.
- Búsqueda y lector de código de barras reutilizando el POS.
- Stock + Kardex + consumo con idempotencia y recovery.
- Resumen semanal.
- Liquidación local con métodos de pago existentes.
- Movimiento financiero de pago de nómina.
- Recibo imprimible.
- Proyección en Monitor.
- Backup, restore y sincronización de nuevas claves.

### Fuera del MVP

- Liquidación remota desde el Supervisor.
- Bonificaciones, horas extras, anticipos y préstamos.
- Firma digital o PIN individual del empleado.
- Tablas Supabase normalizadas para nómina.
- Reapertura remota de períodos.

## 4. Arquitectura existente a reutilizar

No se crea un segundo mecanismo de inventario ni de sincronización.

### Inventario

Usar `applyInventoryOperationUnlocked` dentro de `withLock('pos_write_lock')` con una operación equivalente a:

```js
{
  operationId,
  referenceId: consumptionId,
  referenceType: 'CONSUMO_EMPLEADO',
  source: 'CONSUMO_EMPLEADO',
  tipo: 'AUTOCONSUMO',
  subtipo: 'CONSUMO_EMPLEADO',
  allowNegative: false,
  deductions: [{
    productoId,
    cantidad: -qty,
    origen: 'CONSUMO_EMPLEADO'
  }]
}
```

### Dinero

Toda operación monetaria usa `src/utils/dinero.js`: `round2`, `mulR`, `divR`, `sumR` y `subR`. La UI no es autoridad para precio, costo, stock, total ni balance.

### Caja

El consumo permanece en `bodega_employee_consumptions_v1`. La liquidación genera, cuando corresponde, un movimiento financiero espejo explícito `GASTO_INTERNO` con `isPayrollSettlement`, `settlementId`, `category: 'nomina'`, `afectaCaja` y `payments`.

## 5. Claves de almacenamiento

```text
bodega_employees_v1
bodega_employee_consumptions_v1
bodega_payroll_periods_v1
bodega_payroll_settlements_v1
bodega_employee_payroll_projection_v1
```

- `employees`: catálogo.
- `employee_consumptions`: historial detallado.
- `payroll_periods`: períodos y estado.
- `payroll_settlements`: liquidaciones.
- `employee_payroll_projection`: documento pequeño para el Monitor.

Los historiales se incluyen en backups y se consultan bajo demanda; no se retransmiten continuamente al Monitor.

## 6. Contratos de datos

### Employee

```js
{
  id,
  nombre,
  cedula,
  cargo,
  salarioSemanalUsd,
  limiteConsumoPorc,
  activo,
  fechaIngreso,
  createdAt,
  updatedAt,
  deactivatedAt,
  deactivatedBy
}
```

Los empleados con historial no se borran: se desactivan.

### EmployeeConsumption

```js
{
  id,
  employeeId,
  employeeNombre,
  periodoId,
  timestamp,
  status: 'PENDING' | 'APPLIED' | 'VOIDED' | 'FAILED_RETRYABLE',
  items: [{ productId, sku, name, qty, unit, priceUsd, costUsd }],
  totalUsd,
  totalBs,
  tasaBsPorUsd,
  tasaFuente,
  tasaCapturadaAt,
  valoracion: 'venta',
  inventoryOperationId,
  settlementId,
  nota,
  actor,
  deviceId,
  createdAt,
  updatedAt,
  voidedAt,
  voidedBy,
  voidReason
}
```

El servicio lee precio, costo, nombre, SKU y stock del catálogo fresco dentro del lock.

### PayrollPeriod

```js
{
  id,
  periodoInicio,
  periodoFin,
  zonaHoraria: 'America/Caracas',
  status: 'OPEN' | 'SETTLED' | 'CLOSED_WITH_PENDING_ITEMS',
  createdAt,
  closedAt,
  closedBy
}
```

### PayrollSettlement

```js
{
  id,
  employeeId,
  employeeNombre,
  periodoId,
  periodoInicio,
  periodoFin,
  salarioSemanalUsd,
  totalConsumosUsd,
  netoAPagarUsd,
  netoAPagarBs,
  tasaBcv,
  tasaCapturadaAt,
  payments: [{ methodId, currency, amountUsd, amountBs, isCash, reference }],
  status: 'PENDING' | 'PAID' | 'VOIDED' | 'FAILED_RETRYABLE',
  paidAt,
  consumptionIds,
  cashMovementId,
  idempotencyKey,
  nota,
  actor
}
```

La liquidación es inmutable; una corrección se realiza mediante anulación y nueva liquidación.

## 7. Reglas financieras

### Consumo

- No crea venta, ingreso, pago ni movimiento de caja.
- Sí descuenta inventario y crea Kardex.
- Sí incrementa la deducción de nómina.
- No permite stock negativo ni consumos parcialmente aplicados.

### Liquidación

```text
netoAPagarUsd = salarioSemanalUsd - consumosAplicadosDelPeriodo
```

- El neto no puede ser negativo en el flujo normal.
- Una excepción requiere ADMIN y auditoría.
- `netoAPagarBs` usa la tasa BCV capturada al pagar.
- Pago en efectivo requiere turno abierto en el MVP.
- Pago digital no descuenta la gaveta, pero queda registrado como egreso financiero.
- El movimiento espejo referencia `settlementId` y es idempotente.

## 8. Servicios

Crear:

```text
src/utils/employeePayrollModel.js
src/services/employeeService.js
```

### Modelo puro

- `getPayrollPeriodForDate`.
- `getCurrentPayrollPeriod`.
- `calculateConsumptionTotal`.
- `calculatePayrollSummary`.
- `validateConsumptionLimit`.
- `calculateSettlementAmounts`.
- Normalizadores de empleado, consumo y liquidación.

### Servicio

- `getEmployees`.
- `saveEmployee`.
- `deactivateEmployee`.
- `getPayrollPeriod`.
- `getEmployeePayrollSummary`.
- `registerEmployeeConsumption`.
- `voidEmployeeConsumption`.
- `settleEmployeePayroll`.
- `getPayrollProjection`.
- `recoverPendingEmployeeOperations`.

Todas las fachadas críticas tendrán variantes `Unlocked` y usarán `pos_write_lock`.

## 9. Flujo de consumo

1. Validar actor ADMIN/CAJERO.
2. Validar empleado activo.
3. Determinar período.
4. Leer productos frescos bajo lock.
5. Validar stock suficiente.
6. Leer precio y costo actuales.
7. Crear snapshots y total.
8. Validar límite.
9. Crear consumo `PENDING`.
10. Aplicar inventario/Kardex con `operationId` estable.
11. Confirmar consumo `APPLIED`.
12. Actualizar la proyección.
13. Emitir eventos y sincronización.

Los errores intermedios dejan un estado recuperable y nunca deben duplicar el descuento.

## 10. Flujo de liquidación

1. Validar ADMIN.
2. Leer datos frescos dentro del lock.
3. Incluir solo consumos `APPLIED` del período solicitado.
4. Verificar que no exista liquidación válida para empleado/período.
5. Calcular salario, consumos y neto.
6. Validar método y turno si es efectivo.
7. Crear settlement `PENDING`.
8. Crear movimiento financiero espejo.
9. Asociar consumos con `settlementId`.
10. Confirmar settlement `PAID`.
11. Actualizar período y proyección.
12. Generar recibo.

El mismo `idempotencyKey` devuelve la liquidación existente ante un reintento.

## 11. Interfaz

### POS

Agregar `Consumo Personal` separado de `Fichas` de consumo diferido. El modal mostrará empleados activos, productos, stock, salario, consumo, nuevo consumo, saldo y alertas de límite. Debe bloquear doble envío y no confiar en totales calculados solo por React.

### Ajustes

Agregar pestaña `Empleados`, únicamente para ADMIN. Permitirá crear, editar salario/límite, desactivar y consultar historial.

### Monitor

Agregar `Nómina & Consumos` usando la proyección resumida. Mostrará nómina bruta, consumos, neto, porcentaje, estado y detalle bajo demanda. No incluirá liquidación remota en el MVP.

## 12. Sincronización y SQL

Actualizar:

- `src/config/backupKeys.js`.
- `src/services/remoteAuditService.js`.
- `src/hooks/useMonitorSync.js`.
- `supabase_remote_audit_setup.sql`.
- Tests de allowlist y backup.

Solo `bodega_employee_payroll_projection_v1` entra en las allowlists realtime del Monitor. El RPC de detalle debe validar pairing, empleado y período. Las allowlists de JavaScript y SQL deben mantenerse alineadas.

## 13. Pruebas

Crear:

```text
tests/employeeConsumption.test.js
tests/employeePayroll.test.js
```

Cubrir creación, desactivación, precio/costo congelados, stock, Kardex, no venta/no caja, stock insuficiente, límite, excepción ADMIN, concurrencia, idempotencia, recovery, anulaciones, períodos, cambios de salario, liquidación duplicada, cierre de caja, backup y proyección.

## 14. Fases

1. Modelo puro y contratos.
2. Servicio, lock, inventario, Kardex, idempotencia y recovery.
3. Movimiento financiero de liquidación y cierre de caja.
4. POS y Ajustes.
5. Proyección y Monitor.
6. Backup, SQL, sincronización, tests, lint y build.

## 15. Aceptación

- Un consumo reduce exactamente el stock solicitado.
- Kardex conserva snapshots coherentes.
- Precio y costo quedan congelados.
- No aparece como venta ni ingreso de caja.
- Doble clic/reintento no duplica datos.
- Recovery funciona tras fallos intermedios.
- `$60 - $15.50 = $44.50`.
- Los períodos no se mezclan.
- La liquidación es idempotente.
- Efectivo concilia con el cierre.
- Digital no altera la gaveta.
- CAJERO no configura ni liquida.
- Supervisor remoto solo consulta.
- Backup/restore conserva las cinco claves.
- El Monitor recibe la proyección sin arrays históricos completos.
- Tests, lint y build terminan correctamente.
