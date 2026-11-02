# Plan de Implementación: Visualización de Métodos de Pago en Abonos de Clientes (Modo Supervisor)

> **Objetivo:** Mostrar con claridad el método de pago (Efectivo Bs, Pago Móvil, Punto de Venta, Efectivo USD, Transferencia, etc.) con el que los clientes realizaron sus abonos en el Modo Supervisor: en el acordeón de deudas, en el modal de historial y en el modal de anulación.

**Arquitectura:**
1. Agregar `getCustomerMovementPaymentInfo(sale)` como función pura exportada en `src/utils/monitorSaleFormat.js`. Resuelve método, etiqueta, ícono, badge y línea de resumen para `COBRO_DEUDA`; devuelve nulos para `VENTA_FIADA` (que no tiene pago aún).
2. Tests unitarios TDD en `tests/customerMovementPayment.test.js` cubriendo todos los métodos de fábrica, el custom `transferencia`, y casos borde reales de producción.
3. Actualizar la renderización de movimientos en `src/components/Monitor/MonitorDeudasTab.jsx` en **tres zonas**: acordeón móvil, modal de historial (tarjetas), y tabla desktop.
4. Integrar en `src/components/Customers/VoidMovementModal.jsx` (import directo, sin prop extra).

**Tech Stack:** React, Tailwind CSS, Lucide Icons, Vitest.

> IMPORTANTE — Auditoría pre-ejecución completada. Este plan incorpora 2 bugs críticos y 3 gaps encontrados contra los 23 cobros reales del Doc 60 de producción.
> - BUG-1: 'punto_venta' sin ícono en PAYMENT_METHOD_ICONS de monitorSaleFormat.js (afecta #1293, #747, #585, #521, #497)
> - BUG-3: Para pagos en USD, payments[0].amount ≠ Bs (currency-aware requerido)
> - GAP-2: operatorName null en cobros antiguos (#224, #95)
> - GAP-3: Zona C (tabla desktop líneas 961-1054) no estaba en el plan original
> - GAP-5: VENTA_FIADA no debe mostrar badge de método (aún sin pago)

---

### Task 1: Corrección de alias en PAYMENT_METHOD_ICONS + helper puro

**Archivos:**
- Modificar: `src/utils/monitorSaleFormat.js`
- Test: `tests/customerMovementPayment.test.js` (nuevo)

#### Paso 1.1 — Escribir el test (8 casos, todos deben fallar inicialmente)

Ver código completo del test en el artefacto del plan.

#### Paso 1.2 — Ejecutar el test para confirmar que falla

```bash
npx vitest run tests/customerMovementPayment.test.js
```
Resultado esperado: FAIL — "getCustomerMovementPaymentInfo is not a function".

#### Paso 1.3 — Corrección BUG-1 + Implementación del helper

En PAYMENT_METHOD_ICONS: añadir `punto_venta: CreditCard` junto a `punto_de_venta`.
Implementar `getCustomerMovementPaymentInfo(sale)` con:
- Retorno nulo completo para VENTA_FIADA (GAP-5)
- Currency-aware para la paymentSummaryLine: USD→amountUsd, BS→amount (BUG-3)
- operatorName: `sale.usuarioNombre || sale.actor?.nombre || null` (GAP-2)
- Fallback de ícono para `transferencia*` → Banknote

#### Paso 1.4 — Ejecutar el test hasta PASS

```bash
npx vitest run tests/customerMovementPayment.test.js
```
Resultado esperado: 8/8 PASS.

#### Paso 1.5 — Commit

```bash
git add src/utils/monitorSaleFormat.js tests/customerMovementPayment.test.js
git commit -m "feat(monitor): helper getCustomerMovementPaymentInfo + alias punto_venta fix"
```

---

### Task 2: Integración en MonitorDeudasTab.jsx — TRES zonas

**Archivos:**
- Modificar: `src/components/Monitor/MonitorDeudasTab.jsx`

**Zonas:**
| Zona | Líneas | Descripción |
|------|--------|-------------|
| A — Acordeón móvil | 898–940 | Tarjetas dentro de expandedCustomerId |
| B — Modal historial | 1187–1241 | Tarjetas dentro de selectedCustomerForHistory |
| C — Tabla desktop | 961–1054 | tbody de paginatedCustomers en vista ≥768px |

#### Paso 2.1 — Importar el helper en MonitorDeudasTab.jsx

```js
import { getCustomerMovementPaymentInfo } from '../../utils/monitorSaleFormat';
```

#### Paso 2.2 — Zona A (Acordeón): calcular payInfo y renderizar chip + detalle

En el `.map(s => { ... })`: añadir `const payInfo = getCustomerMovementPaymentInfo(s);`
- Cabecera: chip de método junto al badge ABONO RECIBIDO (solo isCobro)
- Cuerpo: para COBRO_DEUDA → paymentSummaryLine + operatorName; para VENTA_FIADA → items productos

#### Paso 2.3 — Zona B (Modal historial): misma lógica, tamaños ligeramente mayores

#### Paso 2.4 — Zona C (Tabla desktop): badge compacto del último cobro no anulado en celda de acciones

#### Paso 2.5 — Commit

```bash
git add src/components/Monitor/MonitorDeudasTab.jsx
git commit -m "feat(monitor-deudas): mostrar método de pago en tarjetas de abonos (3 zonas)"
```

---

### Task 3: Integración en VoidMovementModal.jsx

**Archivo:**
- Modificar: `src/components/Customers/VoidMovementModal.jsx:151-185`

#### Paso 3.1 — Import directo (sin prop extra, auditado en GAP-4)

```js
import { getCustomerMovementPaymentInfo } from '../../utils/monitorSaleFormat';
```

#### Paso 3.2 — Mostrar método de pago en la tarjeta del movimiento a revertir

Solo para isCobro: badge con ícono + methodLabel + paymentSummaryLine, separados del monto por un divisor.
Permite al supervisor saber qué transacción bancaria o efectivo se está revirtiendo.

#### Paso 3.3 — Commit

```bash
git add src/components/Customers/VoidMovementModal.jsx
git commit -m "feat(void-modal): mostrar método de pago al previsualizar anulación de abono"
```

---

### Task 4: Verificación Integral

#### Paso 4.1 — Suite completa

```bash
npm test -- --run
```

Tests críticos: financialEngine (35), supervisorCustomerTransaction (6), supervisorCustomerMovementVoid (4), customerMovementPayment (8 nuevos).

#### Paso 4.2 — Verificación visual en producción

| # | Cliente | Método | Badge |
|---|---------|--------|-------|
| #1590 | Gabriel Morales | Efectivo (Bs) | 🟢 esmeralda |
| #1293 | Alexander | Punto de Venta | 🔵 índigo |
| #801 | Ramón | Pago Móvil | 🟣 púrpura |
| #919 | Jose Gregorio | Efectivo ($) | 🩵 teal |
| S/# | Ramón | Transferencia | 🟡 ámbar |
