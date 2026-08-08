# Checkout POS — Plan Completo de Fixeo

> **Para Claude:** REQUERIDO: usar `superpowers:executing-plans` para implementar este plan tarea por tarea.

**Objetivo:** Corregir y blindar el flujo de cobro POS para que los cálculos de USD/Bs/COP, vueltos, crédito, Cashea, monedero, persistencia y experiencia de usuario tengan una única fuente de verdad y sean auditables.

**Arquitectura:** Extraer la liquidación del pago a un motor puro compartido por la UI y `checkoutProcessor`. El motor calculará el régimen de pago, saldo pendiente, vuelto y distribución de salidas; el procesador volverá a validar todos los invariantes antes de persistir. La UI quedará como una capa de captura/visualización con estados explícitos, no como autoridad financiera.

**Stack:** React 19, Vite, Tailwind, Vitest, `FinancialEngine`, `dinero.js`, IndexedDB mediante `storageService`, `withLock`, PWA/Capacitor.

---

## Reglas no negociables

1. La UI y el procesador deben llamar al mismo motor de liquidación; no se duplicará la fórmula en `index.jsx`, hooks y processor.
2. Todo importe monetario debe ser finito, no negativo y operar con `round2`, `mulR`, `divR`, `sumR` y `subR`.
3. Un pago digital nunca se clasificará como efectivo físico por su moneda. La clasificación será explícita: `isCash`, `currency`, `methodId` y, si aplica, `requiresReference`.
4. La suma de salidas de vuelto debe ser exactamente igual o menor al vuelto real: físico + monedero + donado + adeudado + voucher.
5. El procesador debe recomputar los totales desde el carrito y rechazar discrepancias en USD, Bs, COP, subtotal y descuento.
6. Un doble clic, reintento de red o re-render no puede crear dos ventas ni descontar stock dos veces.
7. Ningún fix se considera terminado sin pruebas de regresión, build y revisión visual en 375, 768, 1024 y 1440 px.

## Matriz de invariantes financieros

| ID | Invariante | Guardrail | Resultado si falla |
|---|---|---|---|
| FIN-POS-01 | Totales recomputados desde carrito | Comparar subtotal, descuento, total USD/Bs/COP con tolerancias centralizadas | Rechazar sin escribir |
| FIN-POS-02 | Régimen puro Bs consistente | Residual y vuelto se calculan contra `cartTotalBs`, no contra USD×tasa | Rechazar inconsistencia |
| FIN-POS-03 | Pago válido | `currency` en USD/BS/COP; montos finitos y no negativos; método conocido/activo | Rechazar pago inválido |
| FIN-POS-04 | Efectivo real | Solo métodos `isCash === true` participan en defecto de vuelto físico | No generar salida de gaveta falsa |
| FIN-POS-05 | Vuelto no duplicado | `given + owed + donated + voucher + wallet <= change` | Rechazar venta |
| FIN-POS-06 | Cliente requerido | Crédito, Cashea, saldo a favor y vuelto a monedero requieren cliente válido | Rechazar sin persistir |
| FIN-POS-07 | Referencias | Métodos que requieren referencia deben tener referencia normalizada y longitud mínima | Error inline y bloqueo |
| FIN-POS-08 | Idempotencia | `checkoutOperationId` único por intento lógico | Reintento devuelve la venta existente |
| FIN-POS-09 | Integridad de stock | Stock, venta, cliente y auditoría se comprometen una sola vez | Recuperación journalizada |
| FIN-POS-10 | Redondeo | No `Math.round`, `toFixed` ni `parseFloat` para lógica financiera | ESLint/test fallan |

## Fase 0 — Preparación y línea base

### Tarea 0.1: Congelar evidencia actual

**Archivos:** Crear `docs/plans/2026-08-07-checkout-pos-baseline.md` solo si se necesita registrar snapshots; no modificar lógica.

1. Ejecutar `npm.cmd test` y guardar el resultado: esperado actual, 34 archivos, 293 pruebas pasadas y 10 omitidas.
2. Ejecutar `npm.cmd run build` y registrar la advertencia JSX de `PaymentLeftColumn.jsx:361`.
3. Ejecutar `npx.cmd eslint src/components/Sales/CheckoutModalPOS src/hooks/useCheckoutFlow.js src/utils/checkoutProcessor.js` y registrar el parser error y warnings.
4. Confirmar que el worktree ya tiene cambios del usuario y no revertirlos.

### Tarea 0.2: Definir tolerancias y tipos de dominio

**Archivos:** Modificar `src/utils/securityConstants.js`; probar en `tests/securityConstants.test.js`.

1. Añadir constantes nombradas para `PAYMENT_ZERO`, `TOTAL_DRIFT_USD`, `TOTAL_DRIFT_BS`, `TOTAL_DRIFT_COP`, `CHANGE_SPLIT_TOLERANCE` e `IDEMPOTENCY_WINDOW`.
2. Evitar nuevos literales `0.009`, `0.01`, `0.5` dispersos en checkout.
3. Añadir helpers puros de validación de monto si no existe uno equivalente.
4. Ejecutar pruebas unitarias de constantes y commit: `chore: centralize checkout financial tolerances`.

## Fase 1 — Motor único de liquidación

### Tarea 1.1: Escribir pruebas del motor antes de implementarlo

**Archivos:** Crear `tests/checkoutPaymentEngine.test.js`.

Cubrir, como mínimo:

- pago exacto USD;
- USD con vuelto;
- Bs puro exacto contra precio manual;
- Bs puro parcial: falta calculada por residual Bs y equivalente de display proporcional;
- Bs puro con sobrepago: vuelto Bs real, sin vuelto USD falso;
- pago mixto USD + Bs bajo régimen USD;
- COP convertido con tasa COP válida;
- tasa inválida, `NaN`, `Infinity`, negativos y moneda desconocida;
- Cashea y saldo a favor;
- pago digital excedente que no genera efectivo físico;
- distribución física USD/Bs sin doble conteo.

Ejecutar: `npx.cmd vitest run tests/checkoutPaymentEngine.test.js`.
Esperado inicialmente: los casos nuevos fallan por ausencia del motor o por discrepancias actuales.

### Tarea 1.2: Implementar el motor puro

**Archivo:** Crear `src/core/CheckoutPaymentEngine.js`.

Implementar funciones puras:

- `validatePaymentInput(payment, activeMethods)`;
- `calculatePaymentState({ cartTotalUsd, cartTotalBs, payments, saldoFavorUsd, casheaUsd, rate, tasaCop })`;
- `calculateChangeDistribution({ change, physicalUsd, physicalBs, resolution })`;
- `assertCheckoutInvariants(state)`.

El resultado debe separar explícitamente:

```js
{
  regime: 'PURE_BS' | 'USD',
  paid: { usd, bs, cop },
  remaining: { usd, bs },
  change: { usd, bs },
  physicalCashReceived: { usd, bs, cop },
  isPaid,
  isCreditEligible,
  diagnostics: []
}
```

Para `PURE_BS`, el residual autoritativo es Bs. Para régimen USD, Bs se convierte con la tasa efectiva. El motor nunca debe inferir efectivo solo por `currency`.

### Tarea 1.3: Rehacer las pruebas hasta verde

Ejecutar `npx.cmd vitest run tests/checkoutPaymentEngine.test.js tests/checkoutBsManual.test.js tests/cashReconciliation.test.js`.
Esperado: todos los casos nuevos y existentes pasan.
Commit: `feat: add single checkout settlement engine`.

## Fase 2 — Integración del POS y corrección de vueltos

### Tarea 2.1: Sustituir cálculos duplicados del hook

**Archivos:** Modificar `src/components/Sales/CheckoutModalPOS/hooks/usePaymentCalculations.js` y `src/components/Sales/CheckoutModalPOS/index.jsx`.

1. Eliminar la fórmula local de dos regímenes.
2. Mapear entradas UI al contrato del motor.
3. Usar el mismo resultado para `faltaPorPagar`, `faltaPorPagarBS`, `cambioUSD`, `isPaid` y botones.
4. Eliminar estados/props no utilizados: `isPureBsPayment`, `montoIGTF`, `totalConIGTFBS`, `activeInputType`, `isVueltoValido` si no se vuelven necesarios.
5. Pasar el subtotal real `cartSubtotalUsd`, nunca `originalTotalUsd` como subtotal.

### Tarea 2.2: Corregir clasificación de efectivo

**Archivos:** Modificar `src/config/paymentMethods.js`, `src/components/Sales/CheckoutModalPOS/index.jsx`, `src/core/CheckoutPaymentEngine.js`.

1. Añadir `isCash: true/false` a métodos de fábrica y normalizar custom methods.
2. Marcar efectivo USD/Bs/COP como físico; marcar pago móvil, punto, transferencia, Zelle, Cashea y saldo como no físico.
3. Si hay excedente digital, no asignar vuelto físico por defecto.
4. Mostrar una resolución requerida: `Pagar por fuera`, `Voucher`, `Cliente deja el cambio` o bloqueo.
5. Añadir prueba de que un pago Zelle excedente no aumenta la salida `_vuelto_usd` de gaveta.

### Tarea 2.3: Corregir “Pagar por fuera”, voucher y donación

**Archivos:** Modificar `src/components/Sales/CheckoutModalPOS/index.jsx`, `src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx`, `src/utils/checkoutProcessor.js`.

1. Cuando la resolución sea `changeOwed`, `changeVoucher` o `wallet`, el vuelto físico por defecto debe ser cero salvo que exista distribución manual.
2. Hacer que las resoluciones sean una unión mutuamente excluyente, no varios booleanos independientes.
3. Exponer botón de Voucher si se mantiene la capacidad en el processor; si no se requiere negocio, eliminar el estado muerto y su contrato.
4. Validar método, nota y referencia del vuelto adeudado.
5. Mostrar el monto exacto pendiente y el monto físico ya entregado.
6. Añadir pruebas para vuelto completo por fuera, parcial por fuera, voucher y donación parcial.

### Tarea 2.4: Implementar o retirar el vuelto al monedero

**Archivos:** Modificar `src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx`, `src/components/Sales/CheckoutModalPOS/index.jsx`, `src/utils/checkoutProcessor.js`, `src/utils/financialLogic.js`, `src/utils/voidSaleProcessor.js`.

1. Añadir la acción visible “Abonar a cuenta” solo con cliente seleccionado.
2. Persistir `vueltoParaMonedero` con el monto real no entregado.
3. Aplicar el abono contra deuda primero y luego a favor.
4. Revertirlo al anular la venta.
5. Añadir pruebas de deuda mayor, deuda menor y cliente sin deuda.

## Fase 3 — Endurecimiento del processor y persistencia

### Tarea 3.1: Validar totales desde el carrito

**Archivo:** Modificar `src/utils/checkoutProcessor.js`.

1. Recomputa `FinancialEngine.buildCartTotals` una sola vez.
2. Comparar `subtotalUsd`, `discountAmountUsd`, `totalUsd`, `totalBs` y `totalCop` contra los argumentos recibidos.
3. Rechazar discrepancias fuera de tolerancia con mensaje auditable.
4. Validar `cartSubtotalUsd` real y evitar que el caller elija un subtotal arbitrario.
5. No normalizar monedas desconocidas a USD: rechazar antes.
6. Validar `amountUsd`, `amountBs`, `amountCop`, `amountInput`, `currency`, `methodId` y referencias.

### Tarea 3.2: Validar cliente y capacidades

1. Crédito requiere cliente y deuda calculada.
2. Cashea requiere cliente elegible, mínimo y porcentaje permitido.
3. Saldo a favor no puede exceder saldo disponible ni producir vuelto artificial; si el negocio permite excedente, debe ir a resolución explícita.
4. Vuelto a monedero requiere cliente.
5. Todas las validaciones deben ejecutarse de nuevo en el processor, no solo en React.

### Tarea 3.3: Idempotencia de checkout

**Archivos:** Modificar `src/components/Sales/CheckoutModalPOS/index.jsx`, `src/hooks/useCheckoutFlow.js`, `src/utils/checkoutProcessor.js`.

1. Crear `checkoutOperationId` al abrir/procesar una operación.
2. Deshabilitar el botón inmediatamente y mostrar `Procesando…`.
3. Mantener el bloqueo hasta respuesta exitosa o error recuperable.
4. Bajo `pos_write_lock`, buscar una venta con el mismo `checkoutOperationId` antes de escribir.
5. Si existe, devolver la venta previa sin descontar stock ni crear cliente/transacciones otra vez.
6. Probar doble clic síncrono, doble clic con delay y retry después de timeout.

### Tarea 3.4: Reparar `withLock` sin perder reentrancia legítima

**Archivos:** Modificar `src/utils/withLock.js`, `src/services/kardexService.js`, `src/services/consumptionSessionService.js`, `src/utils/checkoutProcessor.js`, `src/utils/voidSaleProcessor.js`; ampliar `tests/withLock.concurrency.test.js`.

1. Eliminar el bypass global que ejecuta la función sin lock cuando ya existe contención.
2. Separar fachadas bloqueadas de funciones `Unlocked` para llamadas internas.
3. Mantener reentrancia solo mediante una API explícita, nunca por detectar un nombre en un `Set` global.
4. Probar exclusión estricta con N=2, 10 y 50.
5. Probar que checkout + Kardex no produce deadlock.

### Tarea 3.5: Journal de escritura y recuperación

**Archivos:** Crear `src/utils/checkoutJournal.js`; modificar `src/utils/checkoutProcessor.js`, `src/hooks/useSalesData.js`.

1. Escribir una intención de checkout antes de mutar venta, stock y cliente.
2. Marcar estados `PENDING`, `COMMITTED` o `ROLLED_BACK`.
3. En arranque/recarga, detectar journals pendientes y completar o revertir de forma idempotente.
4. Añadir failure injection para fallar después de venta, después de stock y después de cliente.
5. No borrar el journal hasta confirmar todas las colecciones.

## Fase 4 — Cashea, saldo y cliente

### Tarea 4.1: Estado reactivo de política de Cashea

**Archivos:** Modificar `src/components/Sales/CheckoutModalPOS/index.jsx`, `src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx`, `src/context/ProductContext.jsx` o crear `src/hooks/useCheckoutPolicy.js`.

1. Cargar configuración mediante una fuente reactiva, no `localStorage.getItem` directo durante render.
2. Derivar elegibilidad de cliente, nivel, mínimo y porcentaje.
3. Resetear Cashea, porcentaje y pagos virtuales cuando cambia el cliente.
4. Impedir crédito simultáneo con Cashea.
5. Añadir pruebas de cambio de cliente, cliente sin nivel y monto inferior al mínimo.

### Tarea 4.2: Blindar cliente nuevo y saldo a favor

**Archivos:** Modificar `src/components/Sales/CheckoutCustomerPicker.jsx`, `src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx`.

1. Si `onCreateCustomer` devuelve `null`, no acceder a `.id`; mostrar error y conservar el formulario.
2. Asociar labels e inputs con IDs.
3. Limitar saldo usado al saldo disponible y al monto pendiente según política.
4. Mostrar saldo restante tras aplicar el abono.
5. Añadir prueba del fallo de persistencia del cliente.

## Fase 5 — Corrección JSX, accesibilidad y responsive

### Tarea 5.1: Reparar estructura y limpiar warnings

**Archivos:** Todos los archivos bajo `src/components/Sales/CheckoutModalPOS/` y `src/hooks/useCheckoutFlow.js`.

1. Eliminar el `)}` extra de `PaymentLeftColumn.jsx:361`.
2. Resolver imports, props, estados y callbacks muertos.
3. Corregir dependencias de `useEffect`, `useMemo` y `useCallback`.
4. Ejecutar ESLint solo sobre el alcance; objetivo: cero errores y cero warnings nuevos.

### Tarea 5.2: Accesibilidad operativa

1. Añadir `aria-label` a cerrar, llenar saldo, limpiar y toggles.
2. Añadir `role="tablist"`, `role="tab"`, `aria-selected` y estados visibles a Contado/Crédito.
3. Asociar todos los labels mediante `htmlFor`/`id`.
4. Añadir `aria-invalid`, `aria-describedby` y mensajes inline para referencias y montos.
5. Implementar focus trap, restauración de foco y cierre por Escape dentro del diálogo.
6. Garantizar targets táctiles mínimos de 44×44 px.

### Tarea 5.3: Responsive y jerarquía visual

1. Usar una columna en `< lg` y dos columnas en `lg+`.
2. Mantener total, estado de pago y acción principal visibles/sticky.
3. Reservar espacio para teclado virtual y safe areas de Capacitor.
4. Revisar contraste de textos `text-slate-400` y tamaños de 9–10 px.
5. Respetar `prefers-reduced-motion` en zoom, bounce y pulse.
6. Verificar manualmente 375×812, 768×1024, 1024×768 y 1440×900.

## Fase 6 — Pruebas end-to-end y cierre

### Tarea 6.1: Completar regresión financiera

**Archivos:** Ampliar `tests/checkoutBsManual.test.js`, `tests/cashReconciliation.test.js`, `tests/changeShortage.test.js`; crear `tests/checkoutProcessor.validation.test.js` y `tests/checkoutIdempotency.test.js`.

Matriz mínima:

- exacto, faltante y vuelto en USD;
- exacto, parcial y excedente en Bs manual;
- mixto USD/Bs;
- COP habilitado/deshabilitado;
- descuento fijo y porcentual;
- crédito total y con abono;
- Cashea válido, inválido y cambio de cliente;
- saldo a favor exacto, parcial y exceso;
- vuelto físico, donación, monedero, adeudado y voucher;
- referencias faltantes/insuficientes;
- montos `NaN`, `Infinity`, negativos y moneda inválida;
- doble submit y retry;
- fallo en cada etapa del journal.

### Tarea 6.2: Pruebas de UI/UX

Usar `@agent-browser` para abrir el checkout en desktop y móvil y verificar:

1. foco inicial en el primer método;
2. navegación completa por teclado;
3. lectura semántica de labels/errores;
4. cambio Contado/Crédito;
5. selección de cliente y Cashea;
6. distribución de vuelto;
7. botón bloqueado durante procesamiento;
8. ausencia de scroll horizontal;
9. resolución de “Pagar por fuera” sin rechazo falso;
10. modal usable con teclado virtual.

### Tarea 6.3: Validación final

Ejecutar en este orden:

```powershell
npx.cmd eslint src/components/Sales/CheckoutModalPOS src/hooks/useCheckoutFlow.js src/utils/checkoutProcessor.js src/core/CheckoutPaymentEngine.js
npm.cmd test
npm.cmd run build
```

Esperado:

- ESLint sin errores ni warnings nuevos en el alcance;
- suite completa verde;
- build verde sin warning JSX;
- ningún caso de la matriz financiera con duplicación o pérdida;
- reporte manual de responsive y accesibilidad adjunto al PR.

Commit final: `fix: harden POS checkout settlement and UX`.

## Orden de implementación y checkpoints

1. Fase 0: línea base y tolerancias.
2. Fase 1: motor puro y pruebas.
3. Fase 2: integración de cálculos, efectivo y resoluciones de vuelto.
4. Fase 3: processor, idempotencia, locks y journal.
5. Fase 4: Cashea, saldo y clientes.
6. Fase 5: JSX, accesibilidad y responsive.
7. Fase 6: regresión completa y QA visual.

Cada fase debe terminar con un commit independiente. Si una prueba financiera falla, no se continúa a UI. Si el contrato de datos actual no coincide con una ancla del plan, se detiene la implementación y se actualiza este plan antes de modificar persistencia.

Plan completo y guardarraíles definidos. Siguiente paso recomendado: ejecutar Fase 0 y luego Fase 1 en una rama dedicada.
