# Control de Impacto en Caja para Abonos y Deudas (afectaCaja) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir que los usuarios elijan explícitamente al registrar un abono o una deuda si el movimiento debe sumar o descontar de la gaveta de efectivo físico (`afectaCaja`), evitando descuadres en los cierres cuando los pagos o préstamos se realizan por fuera de la caja.

**Architecture:** Extender el patrón arquitectónico existente `afectaCaja` (usado actualmente en `GASTO_INTERNO` y consumos de empleados). En `customerTransactionProcessor.js`, asignar `afectaCaja` a los registros `COBRO_DEUDA` y `VENTA_FIADA`. En `FinancialEngine.js`, cuando un cobro de deuda tiene `afectaCaja: false`, se descuenta la deuda del cliente (`fiado`) pero se registra en un bucket no monetario/externo (`cobro_externo` con `isCash: false`), de modo que `computeExpectedCash` no incremente el efectivo esperado de la gaveta. En `TransactionModal.jsx`, agregar un switch accesible e intuitivo con previsualización del impacto.

**Tech Stack:** React 18, Tailwind CSS, Lucide Icons, Vitest, JavaScript (ES6+).

---

### Task 1: Soporte de `afectaCaja` en `FinancialEngine.js` y Test Unitario

**Files:**
- Modify: `src/core/FinancialEngine.js:315-375`
- Test: `tests/financialEngine.test.js`

**Step 1: Write the failing test**
Añadir una prueba en `tests/financialEngine.test.js` que verifique que:
1. Un `COBRO_DEUDA` con `afectaCaja: true` (o por defecto) suma al efectivo esperado en gaveta.
2. Un `COBRO_DEUDA` con `afectaCaja: false` reduce el `fiado` pero NO suma al efectivo esperado en gaveta (`expectedCash.bs === 0` o `expectedCash.usd === 0`), agrupándolo en `cobro_externo`.

```javascript
describe('afectaCaja en COBRO_DEUDA', () => {
    it('COBRO_DEUDA con afectaCaja: false reduce fiado pero no suma al efectivo esperado en gaveta', () => {
        const sales = [
            {
                id: 'cobro-externo-1',
                tipo: 'COBRO_DEUDA',
                afectaCaja: false,
                totalBs: 7546,
                totalUsd: 100,
                rate: 75.46,
                payments: [{
                    methodId: 'efectivo_bs',
                    amount: 7546,
                    currency: 'BS',
                    amountBs: 7546,
                    amountUsd: 100,
                    isCash: false,
                    afectaCaja: false
                }]
            }
        ];

        const breakdown = FinancialEngine.calculatePaymentBreakdown(sales);
        const expectedCash = FinancialEngine.computeExpectedCash(breakdown);

        expect(breakdown['fiado']?.total).toBe(-100); // Se redujo la deuda fiada
        expect(expectedCash.bs).toBe(0); // La gaveta NO espera efectivo
    });
});
```

**Step 2: Run test to verify it fails**
Run: `npx vitest run tests/financialEngine.test.js`
Expected: FAIL porque actualmente `calculatePaymentBreakdown` suma `efectivo_bs` a la gaveta sin verificar `sale.afectaCaja`.

**Step 3: Write minimal implementation**
En `src/core/FinancialEngine.js`:
En `calculatePaymentBreakdown`, cuando `sale.tipo === 'COBRO_DEUDA'`:
- Si `sale.afectaCaja === false`:
  - Se procesa la reducción de `breakdown['fiado']`.
  - En lugar de sumar a `breakdown[methodId]` de efectivo físico, se acumula en `breakdown['cobro_externo'] = { total: round2(sale.totalUsd || 0), currency: 'USD', label: 'Cobro Externo (Sin Afectar Gaveta)', isCash: false }`.
  - No se agregan pagos en efectivo físico a la gaveta.

**Step 4: Run test to verify it passes**
Run: `npx vitest run tests/financialEngine.test.js`
Expected: PASS

**Step 5: Commit**
```bash
git add src/core/FinancialEngine.js tests/financialEngine.test.js
git commit -m "feat(financial): soporte de afectaCaja: false en COBRO_DEUDA para FinancialEngine"
```

---

### Task 2: Propagación de `afectaCaja` en `customerTransactionProcessor.js`

**Files:**
- Modify: `src/utils/customerTransactionProcessor.js:18-240`
- Test: `tests/customerIntegrity.test.js`

**Step 1: Write the failing test**
Añadir una prueba en `tests/customerIntegrity.test.js` que llame a `processCustomerTransaction` con `afectaCaja: false` y valide que el registro de venta generado (`sale`) contenga `afectaCaja: false` tanto en el objeto raíz como en sus pagos.

```javascript
it('processCustomerTransaction guarda afectaCaja: false cuando se especifica', async () => {
    const res = await processCustomerTransaction({
        transactionAmount: '50',
        currencyMode: 'USD',
        type: 'ABONO',
        customer: { id: 'cust-1', name: 'Test', deuda: 100, favor: 0 },
        paymentMethod: 'efectivo_usd',
        bcvRate: 40,
        afectaCaja: false,
        operationId: 'op-afecta-false-1'
    });

    expect(res.error).toBeUndefined();
    const sales = await storageService.getItem('bodega_sales_v1', []);
    const savedSale = sales.find(s => s.customerTransactionId === 'op-afecta-false-1');
    expect(savedSale.afectaCaja).toBe(false);
});
```

**Step 2: Run test to verify it fails**
Run: `npx vitest run tests/customerIntegrity.test.js`
Expected: FAIL porque `processCustomerTransaction` aún no recibe ni persiste `afectaCaja`.

**Step 3: Write minimal implementation**
En `src/utils/customerTransactionProcessor.js`:
- Recibir `afectaCaja = true` en los parámetros de `processCustomerTransaction`.
- En `cobroRecord` (`type === 'ABONO'`):
  - `afectaCaja: afectaCaja !== false`
  - Si `afectaCaja === false`:
    - `notes: 'Cobro externo / No ingresa a gaveta'`
    - En `payments[0]`: `afectaCaja: false`, `isCash: false`.
- En `fiadoRecord` (`type === 'CREDITO'`):
  - `afectaCaja: afectaCaja === true` (por defecto `false` para mercancía; `true` si es préstamo en efectivo).

**Step 4: Run test to verify it passes**
Run: `npx vitest run tests/customerIntegrity.test.js`
Expected: PASS

**Step 5: Commit**
```bash
git add src/utils/customerTransactionProcessor.js tests/customerIntegrity.test.js
git commit -m "feat(customers): persistir afectaCaja en cobros y creditos de clientes"
```

---

### Task 3: Interfaz de Usuario en `TransactionModal.jsx` y `CustomersView.jsx`

**Files:**
- Modify: `src/components/Customers/TransactionModal.jsx:8-515`
- Modify: `src/views/CustomersView.jsx:255-316`

**Step 1: Write unit / component test or verify UI state**
Verificar que el modal inicialice `afectaCaja`:
- Para `ABONO`: `true` por defecto.
- Para `CREDITO`: `false` por defecto.
Y que el cambio de switch actualice el estado y se pase al handler `handleTransaction`.

**Step 2: Implement UI controls in `TransactionModal.jsx`**
1. Estado `const [afectaCaja, setAfectaCaja] = useState(true);`
2. Resetear en `useEffect` según el tipo:
   - Si `transactionModal.type === 'ABONO'`: `setAfectaCaja(true)`.
   - Si `transactionModal.type === 'CREDITO'`: `setAfectaCaja(false)`.
3. Renderizar tarjeta interactiva con switch:
   - **En pestaña ABONO**:
     - Switch: **"Ingresar dinero a la gaveta de caja"**
     - Si está activo: Icono verde de caja `[✓] Entra a la gaveta física (se sumará al arqueo del cierre)`.
     - Si está inactivo: Icono ámbar `[✕] Cobro externo / Fuera de caja (la deuda baja, pero NO se exigirá efectivo en el arqueo)`.
   - **En pestaña CREDITO**:
     - Switch: **"Descontar de la gaveta (Préstamo en efectivo)"**
     - Si está inactivo (por defecto): `[✓] Crédito en cuenta / Mercancía fiada (no toca el dinero de la caja)`.
     - Si está activo: Icono rojo `[!] Préstamo en efectivo (el dinero sale de la gaveta y reduce el esperado de caja)`.
4. Mostrar el estado en la pantalla de confirmación (`showConfirmation`).
5. Enviar `afectaCaja` a `handleTransaction(isFullPayment, isExplicitHighAmount, afectaCaja)`.

**Step 3: Update `CustomersView.jsx`**
En `handleTransaction`:
- Recibir `afectaCaja`.
- Añadir `afectaCaja` a la firma única de `transactionRequestRef`.
- Pasarlo a `processCustomerTransaction({ ..., afectaCaja })`.

**Step 4: Test in browser / simulator**
Verificar que al abrir el modal de Abono, el interruptor aparezca claro, responsivo en móvil y escritorio, y respete el modo oscuro/claro.

**Step 5: Commit**
```bash
git add src/components/Customers/TransactionModal.jsx src/views/CustomersView.jsx
git commit -m "feat(ui): selector de afectaCaja en modal de abonos y deudas"
```

---

### Task 4: Soporte en Monitor Supervisor y Etiquetas de Historial

**Files:**
- Modify: `src/components/Monitor/SupervisorCustomerTransactionModal.jsx`
- Modify: `src/utils/supervisorCustomerTransaction.js`
- Modify: `src/views/CustomersView.jsx:780-820` (Historial de movimientos)

**Step 1: Implement `afectaCaja` in Supervisor Modal**
Permitir que el supervisor también elija si un abono o deuda registrado desde el Monitor afecta o no la caja.
- En `SupervisorCustomerTransactionModal.jsx`: agregar switch `afectaCaja`.
- En `buildSupervisorCustomerTransaction.js`: incluir `afectaCaja` en el comando/payload.

**Step 2: Visual badges en historial de transacciones**
En la lista de movimientos del cliente:
- Si `sale.afectaCaja === false && sale.tipo === 'COBRO_DEUDA'`:
  Mostrar badge distintivo: `Cobro Externo` (color púrpura/índigo suave) para distinguirlo inmediatamente de un cobro en caja física.

**Step 3: Test and run lint/tests**
Run: `npx vitest run`
Expected: Todos los tests pasan sin regresiones.

**Step 4: Commit**
```bash
git add src/components/Monitor/SupervisorCustomerTransactionModal.jsx src/utils/supervisorCustomerTransaction.js src/views/CustomersView.jsx
git commit -m "feat(monitor): soporte de afectaCaja en transacciones del supervisor y distintivo visual en historial"
```

---

### Task 5: Validación Integral y Verificación en Cierre de Caja

**Files:**
- Test: `tests/financialEngine.test.js`
- Run: `npm run build`

**Step 1: Simulación completa de arqueo con abono externo**
Crear test de integración que simule un turno con:
1. Apertura de caja: 6.560 Bs.
2. Venta en efectivo: 4.380 Bs.
3. Abono de deuda en efectivo de 7.546 Bs con `afectaCaja: false`.
4. Validar que:
   - El saldo del cliente baja 7.546 Bs.
   - El efectivo esperado en gaveta es exactamente `6.560 + 4.380 = 10.940 Bs` (¡cero descuadre!).
   - El reporte de cierre muestra el abono bajo cobranzas externas.

**Step 2: Ejecutar suite de pruebas completa**
Run: `npx vitest run`
Expected: 100% de tests pasando.

**Step 3: Ejecutar build de producción**
Run: `npm run build`
Expected: Compilación limpia sin errores TypeScript/JSX.

**Step 4: Commit final**
```bash
git add .
git commit -m "test(cierre): validacion completa de arqueo con abonos externos y control de caja"
```
