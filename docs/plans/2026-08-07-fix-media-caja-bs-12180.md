# Media Caja Bs — Plan de Fixeo, Tests y Guardarraíles

> **Para Claude:** REQUERIDO: usar `superpowers:executing-plans` para implementar este plan tarea por tarea.

**Objetivo:** Garantizar que una media caja con precio Bs fijo —incluida la Solera de `$14 / Bs 12.180`— conserve el precio desde configuración hasta carrito, checkout, persistencia, arqueo y reportes, sin aceptar silenciosamente un total Bs igual a cero.

**Arquitectura:** Unificar los nombres de precio por formato en un contrato canónico (`halfBoxPriceBs` y `boxPriceBs`) con compatibilidad temporal para los alias históricos (`halfBoxPriceBsManual` y `boxPriceBsManual`). La normalización será centralizada y compartida por catálogo, carrito, `FinancialEngine`, sincronización remota y checkout. El checkout tendrá un guardarraíl de integridad que rechazará una venta cuando un formato configurado como `bs_fijo` no pueda resolver un precio Bs positivo.

**Tech Stack:** React 19, Vite, Vitest, `FinancialEngine`, `productProcessor`, `dinero.js`, `storageService`, sincronización remota y Tailwind.

---

## Evidencia auditada

La captura muestra una media caja configurada con `Bs 12.180`, pero en checkout aparece `Total Bs 0,00`. Al introducir `Bs 12.180`, el POS lo interpreta como un sobrepago y muestra `Vuelto $14 / Bs 12.180`.

La causa más probable es una deriva de contrato:

| Etapa | Campo que usa |
|---|---|
| `BsCongeladoWizardModal` | `halfBoxPriceBsManual` |
| `SalesView.addToCart` | `halfBoxPriceBs` |
| `normalizeProduct` | `halfBoxPriceBs` |
| `calculatePricing` | `halfBoxPriceBs` |
| `FinancialEngine.buildCartTotals` | resultado de `calculatePricing` |

La misma divergencia existe entre `boxPriceBsManual` y `boxPriceBs`.

Archivos principales:

- `src/components/Products/BsCongeladoWizardModal.jsx:360-373`
- `src/utils/productProcessor.js:137-179, 220-296`
- `src/views/SalesView.jsx:337-368, 507-594`
- `src/core/FinancialEngine.js:508-582`
- `src/utils/remoteInventoryProcessor.js:66-118`
- `src/utils/frozenPrices.js:20-39`
- `src/components/Sales/CheckoutModalPOS/components/TransactionSummary.jsx:8-24`

## Contrato canónico

### Campos de precio

```js
{
  priceBsManual: number | null,       // unidad
  boxPriceBs: number | null,          // caja
  halfBoxPriceBs: number | null,      // media caja
  priceBsUsdRef: number | null,
  boxPriceBsUsdRef: number | null,
  halfBoxPriceBsUsdRef: number | null
}
```

### Alias legacy aceptados solo en la frontera

```js
boxPriceBsManual
halfBoxPriceBsManual
boxPriceUsdt
halfBoxPriceUsdt
```

Regla de precedencia:

1. El campo canónico válido tiene prioridad.
2. Si falta el canónico, se toma el alias legacy válido.
3. Si ambos existen y difieren, gana el canónico y se registra una anomalía de migración.
4. Nunca se transforma un valor inválido o negativo en cero silenciosamente.

## Guardarraíles y arneses no negociables

| ID | Guardarraíl | Verificación | Acción ante fallo |
|---|---|---|---|
| HBOX-01 | Contrato único | Todos los lectores pasan por `normalizeProduct`/helper central | Fallar test estático o unitario |
| HBOX-02 | Compatibilidad legacy | `halfBoxPriceBsManual: 12180` resuelve `halfBoxPriceBs: 12180` | Migrar o rechazar con error explícito |
| HBOX-03 | Precedencia | Canónico válido vence a alias diferente | Registrar warning de migración |
| HBOX-04 | Precio positivo | `bs_fijo` requiere precio Bs finito y mayor que cero | No agregar al carrito |
| HBOX-05 | Precio por formato | Media caja no hereda accidentalmente precio de unidad/caja | Rechazar cálculo incorrecto |
| HBOX-06 | Total de carrito | Solera media caja produce `totalBs = 12180` | Test de regresión obligatorio |
| HBOX-07 | Sin vuelto falso | Pago Bs 12180 sobre total Bs 12180 produce vuelto Bs 0 | Test de checkout |
| HBOX-08 | No mutación | Normalizar no modifica el objeto original | Test de inmutabilidad |
| HBOX-09 | Migración idempotente | Normalizar dos veces no cambia el resultado | Test idempotente |
| HBOX-10 | Persistencia | Guardado local/remoto mantiene campo canónico | Test de storage/remote |
| HBOX-11 | Checkout defensivo | Un formato fijo sin precio no puede venderse como Bs 0 | Rechazar antes de escribir venta |
| HBOX-12 | UI honesta | Selector y checkout no muestran Bs 0 como precio válido | Mostrar “Precio Bs no configurado” |
| HBOX-13 | Reconciliación | No se registra `12180` como vuelto si el total esperado es `12180` | Invariante financiero |
| HBOX-14 | Cobertura de formatos | Unidad, caja y media caja usan la misma política | Matriz parametrizada |

## Arneses de prueba

1. **Arnés de contrato:** fixtures con campos canónicos, aliases legacy, ambos, nulos, strings numéricos, negativos y `NaN`.
2. **Arnés de formato:** la misma tarifa y producto evaluados como `unit`, `box` y `halfBox`.
3. **Arnés financiero:** carrito → `FinancialEngine.buildCartTotals` → `calculatePaymentState` → `processSaleTransaction`.
4. **Arnés de persistencia:** objeto legacy guardado, rehidratado y vuelto a guardar sin pérdida.
5. **Arnés de sincronización:** payload remoto con alias y payload remoto canónico.
6. **Arnés de regresión visual/manual:** selector de formatos, cesta, resumen de checkout y pago Bs exacto.

---

## Fase 0 — Línea base y reproducción controlada

### Tarea 0.1: Congelar el caso Solera

**Archivos:** Crear `tests/halfBoxBsPriceRegression.test.js`.

**Paso 1: Escribir el fixture fallido**

```js
const soleraHalfBoxLegacy = {
  id: 'solera-half-regression',
  name: 'Cerveza Solera',
  priceUsd: 14,
  pricingMode: 'bcv',
  sellByBox: true,
  sellByHalfBox: true,
  halfBoxUnits: 18,
  halfBoxPriceUsd: 14,
  halfBoxPricingMode: 'bs_fijo',
  halfBoxPriceBsManual: 12180,
  _mode: 'halfBox'
};
```

Añadir expectativas de que el precio de media caja debe ser `$14` y `Bs 12180`.

**Paso 2: Ejecutar para confirmar la regresión**

Run: `npx.cmd vitest run tests/halfBoxBsPriceRegression.test.js`

Expected before fix: FAIL porque el lector canónico ignora `halfBoxPriceBsManual` y devuelve `unitPriceBs = 0`.

**Paso 3: Registrar la evidencia**

Documentar en el test y en el commit que el fallo observado produce `cartTotalBs = 0` y convierte un pago Bs 12180 en vuelto.

### Tarea 0.2: Capturar la línea base del repositorio

**Archivos:** Ninguno.

Run:

```powershell
npm.cmd test -- --run
npm.cmd run build
npx.cmd eslint src/utils/productProcessor.js src/core/FinancialEngine.js src/views/SalesView.jsx src/utils/remoteInventoryProcessor.js
```

Expected: conservar los resultados actuales y no revertir cambios ajenos del worktree.

---

## Fase 1 — Normalizador único de precios por formato

### Tarea 1.1: Escribir tests de precedencia y compatibilidad

**Archivos:** Test: `tests/halfBoxBsPriceRegression.test.js`.

Cubrir:

- canónico `halfBoxPriceBs: 12180`;
- legacy `halfBoxPriceBsManual: 12180`;
- ambos con el mismo valor;
- ambos con valores distintos: gana canónico;
- `null`, `''`, `NaN`, `Infinity` y negativos;
- caja completa con `boxPriceBsManual`;
- normalización repetida sin cambios adicionales;
- objeto original sin mutar.

Run: `npx.cmd vitest run tests/halfBoxBsPriceRegression.test.js`

Expected before implementation: FAIL en los casos legacy y de precedencia.

### Tarea 1.2: Implementar helper de lectura canónica

**Archivos:** Modificar `src/utils/productProcessor.js`.

Crear un helper puro próximo a `normalizeProduct`, por ejemplo:

```js
const readPositiveMoney = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
};

const resolveFormatBsPrice = (raw, canonicalKey, legacyKey) => {
  const canonical = readPositiveMoney(raw?.[canonicalKey]);
  if (canonical !== null) return canonical;
  return readPositiveMoney(raw?.[legacyKey]);
};
```

Usarlo para producir siempre:

```js
halfBoxPriceBs: resolveFormatBsPrice(raw, 'halfBoxPriceBs', 'halfBoxPriceBsManual'),
boxPriceBs: resolveFormatBsPrice(raw, 'boxPriceBs', 'boxPriceBsManual'),
```

No borrar los aliases en esta fase; la compatibilidad de lectura debe existir durante la migración.

### Tarea 1.3: Ejecutar el arnés unitario

Run: `npx.cmd vitest run tests/halfBoxBsPriceRegression.test.js tests/pricingMode.test.js tests/frozenPrices.test.js`

Expected: PASS; ningún precio fijo válido debe convertirse en cero.

### Tarea 1.4: Commit de normalización

```powershell
git add src/utils/productProcessor.js tests/halfBoxBsPriceRegression.test.js
git commit -m "fix: normalize legacy box Bs prices"
```

---

## Fase 2 — Corregir escritores y sincronización

### Tarea 2.1: Escribir test de persistencia del asistente Bs congelado

**Archivos:** Test: `tests/halfBoxBsPriceRegression.test.js` o `tests/remoteInventoryD4.test.js` según el mock disponible.

Verificar que al guardar una media caja desde el flujo Bs congelado, el objeto final contenga:

```js
halfBoxPriceBs: 12180,
halfBoxPriceBsManual: 12180
```

El alias se conserva temporalmente para dispositivos/versiones antiguas, pero el campo canónico debe ser obligatorio para nuevas escrituras.

### Tarea 2.2: Corregir el escritor local

**Archivos:** Modificar `src/components/Products/BsCongeladoWizardModal.jsx:350-373`.

Cambiar las asignaciones de caja y media caja para escribir primero el campo canónico:

```js
origProd.boxPriceBs = newPriceBs;
origProd.boxPriceBsManual = newPriceBs; // compatibilidad temporal

origProd.halfBoxPriceBs = newPriceBs;
origProd.halfBoxPriceBsManual = newPriceBs; // compatibilidad temporal
```

Para USD, hacer lo mismo con `boxPriceUsd`/`halfBoxPriceUsd` cuando aplique y evitar que `boxPriceUsdt` o `halfBoxPriceUsdt` sean la única fuente.

### Tarea 2.3: Corregir la normalización remota

**Archivos:** Modificar `src/utils/remoteInventoryProcessor.js:80-118`.

Después de leer aliases, materializar también los canónicos:

```js
normalized.boxPriceBs = readPositiveMoney(data.boxPriceBs, data.boxPriceBsManual);
normalized.halfBoxPriceBs = readPositiveMoney(data.halfBoxPriceBs, data.halfBoxPriceBsManual);
```

Mantener los aliases durante la migración y respetar la regla: canónico válido gana sobre legacy.

### Tarea 2.4: Ejecutar tests de storage y remoto

Run:

```powershell
npx.cmd vitest run tests/halfBoxBsPriceRegression.test.js tests/remoteInventory.test.js tests/remoteInventoryD4.test.js
```

Expected: PASS; los payloads legacy quedan utilizables por el checkout.

### Tarea 2.5: Commit de escritores

```powershell
git add src/components/Products/BsCongeladoWizardModal.jsx src/utils/remoteInventoryProcessor.js tests/halfBoxBsPriceRegression.test.js
git commit -m "fix: persist canonical box Bs prices"
```

---

## Fase 3 — Blindar catálogo, carrito y motor financiero

### Tarea 3.1: Escribir tests de cálculo de media caja

**Archivos:** Test: `tests/halfBoxBsPriceRegression.test.js`.

Casos parametrizados:

| Caso | Precio USD | Precio Bs | Resultado esperado |
|---|---:|---:|---:|
| Canónico | 14 | 12180 | `unitPriceBs = 12180` |
| Legacy | 14 | 12180 | `unitPriceBs = 12180` |
| Caja | 28 | 24360 | `unitPriceBs = 24360` |
| Unidad heredada | 0.86 | 750 | no usar 750 para media caja cuando existe precio propio |
| Fijo incompleto | 14 | ausente | error explícito, nunca 0 silencioso |

Añadir una prueba de `FinancialEngine.buildCartTotals` con un item `_mode: 'halfBox'` y esperar:

```js
expect(totals.totalUsd).toBe(14);
expect(totals.totalBs).toBe(12180);
```

### Tarea 3.2: Blindar `calculatePricing`

**Archivos:** Modificar `src/utils/productProcessor.js:220-296`.

Antes de devolver un precio para `bs_fijo`:

- Resolver el precio específico del formato.
- No caer silenciosamente a precio de unidad si el formato tiene regla propia `bs_fijo`.
- Devolver un metadato o error estructurado, por ejemplo:

```js
pricingError: mode === 'bs_fijo' && unitPriceBs <= 0
  ? 'PRECIO_BS_FORMATO_AUSENTE'
  : null
```

El error debe conservarse como dato de cálculo, sin lanzar excepciones desde componentes visuales.

### Tarea 3.3: Propagar el guardarraíl al total del carrito

**Archivos:** Modificar `src/core/FinancialEngine.js:508-582`.

Agregar `pricingErrors` al resultado de `buildCartTotals`. Si cualquier item fijo tiene precio Bs ausente o inválido:

```js
return {
  ...totals,
  pricingErrors: [{ itemId, itemName, mode, code: 'PRECIO_BS_FORMATO_AUSENTE' }]
};
```

No alterar el cálculo de productos válidos. El resultado debe seguir siendo puro y determinista.

### Tarea 3.4: Evitar agregar formatos inválidos al carrito

**Archivos:** Modificar `src/views/SalesView.jsx:507-594` y `src/components/Sales/SearchBar.jsx:206-223`.

En `addToCart` y en el selector de media caja:

- usar `calculatePricing(product, effectiveRate, bcvRate, 'halfBox')` como fuente única;
- si `pricingError` existe, no agregar el producto;
- mostrar: `Media caja sin precio Bs fijo válido. Revisa la configuración del producto.`;
- no mostrar `Bs 0` como si fuera un precio válido.

El fallback legacy debe estar resuelto por `normalizeProduct`, no duplicado en estos componentes.

### Tarea 3.5: Test de carrito y cálculo

Run:

```powershell
npx.cmd vitest run tests/halfBoxBsPriceRegression.test.js tests/checkoutBsManual.test.js tests/saleItemsBsCalculator.test.js
```

Expected: PASS; ningún caso válido produce total Bs cero.

### Tarea 3.6: Commit de motor y carrito

```powershell
git add src/utils/productProcessor.js src/core/FinancialEngine.js src/views/SalesView.jsx src/components/Sales/SearchBar.jsx tests/halfBoxBsPriceRegression.test.js
git commit -m "fix: protect half-box Bs pricing in cart totals"
```

---

## Fase 4 — Guardarraíles de checkout y persistencia financiera

### Tarea 4.1: Escribir test de checkout exacto

**Archivos:** Test: `tests/halfBoxBsPriceRegression.test.js`.

Usar un carrito de media caja Solera y pago:

```js
payments: [{
  methodId: 'punto_venta',
  currency: 'BS',
  amountInput: 12180,
  amountBs: 12180,
  amountUsd: 14
}]
```

Esperar:

```js
result.success === true;
result.sale.totalBs === 12180;
result.sale.changeBs === 0;
result.sale.changeUsd === 0;
```

También probar el caso defectuoso: carrito `bs_fijo` sin precio de formato. Debe devolver error y no escribir en `bodega_sales_v1` ni descontar stock.

### Tarea 4.2: Rechazar totales con error de precio

**Archivos:** Modificar `src/utils/checkoutProcessor.js`.

Después de `FinancialEngine.buildCartTotals` y antes de persistir:

```js
if (totals.pricingErrors?.length) {
  return {
    success: false,
    error: 'No se puede cobrar: hay un formato sin precio Bs válido.'
  };
}
```

El rechazo debe ocurrir antes de escribir venta, espejo, stock, Kardex o cliente.

### Tarea 4.3: Verificar el contrato del total mostrado

**Archivos:** Revisar `src/components/Sales/CheckoutModalPOS/components/TransactionSummary.jsx` y `src/components/Sales/CheckoutModalPOS/hooks/usePaymentCalculations.js`.

Reglas:

- `totalBS` debe venir de `FinancialEngine.buildCartTotals`.
- Si existe error de pricing, mostrar estado bloqueado y mensaje accionable.
- Nunca calcular un total Bs alternativo desde `$ × tasa` cuando existe precio fijo por formato.

### Tarea 4.4: Regresión financiera completa

Run:

```powershell
npx.cmd vitest run tests/halfBoxBsPriceRegression.test.js tests/checkoutBsManual.test.js tests/changeShortage.test.js tests/financialEngine.test.js
```

Expected: PASS; el pago exacto en Bs no genera vuelto artificial.

### Tarea 4.5: Commit de checkout

```powershell
git add src/utils/checkoutProcessor.js src/components/Sales/CheckoutModalPOS src/core/FinancialEngine.js tests/halfBoxBsPriceRegression.test.js
git commit -m "fix: block zero Bs totals for fixed half-box prices"
```

---

## Fase 5 — Migración de datos existentes

### Tarea 5.1: Escribir test de migración idempotente

**Archivos:** Test: `tests/halfBoxBsPriceRegression.test.js`.

Cubrir:

- producto legacy se convierte a canónico;
- producto canónico no cambia;
- canónico y legacy distintos conserva canónico y registra conflicto;
- migrar dos veces devuelve el mismo objeto lógico;
- no se eliminan campos no relacionados.

### Tarea 5.2: Crear migrador de productos

**Archivos:** Modificar `src/utils/productProcessor.js` o crear `src/utils/productPriceMigration.js` si el helper crece demasiado.

Implementar una función pura:

```js
export function migrateFormatPriceAliases(product) {
  const next = { ...product };
  next.boxPriceBs = readPositiveMoney(product.boxPriceBs, product.boxPriceBsManual);
  next.halfBoxPriceBs = readPositiveMoney(product.halfBoxPriceBs, product.halfBoxPriceBsManual);
  return next;
}
```

La función debe devolver también conflictos opcionales para auditoría, sin lanzar por datos legacy válidos.

### Tarea 5.3: Ejecutar migración al cargar y guardar

**Archivos:** Revisar `src/context/ProductContext.jsx`, `src/hooks/useSalesData.js` y `src/utils/remoteInventoryProcessor.js`.

Aplicar la migración:

- al cargar productos desde storage;
- al recibir productos remotos;
- antes de persistir una edición;
- antes de construir el carrito.

Usar `storageService`, no `localStorage` directo, para persistencia de productos.

### Tarea 5.4: Registrar conflictos de datos

Si `halfBoxPriceBs` y `halfBoxPriceBsManual` existen con valores diferentes:

- usar el canónico;
- registrar evento de auditoría `PRODUCT_PRICE_ALIAS_CONFLICT`;
- incluir producto, formato, valor canónico y valor legacy;
- no cambiar automáticamente el precio canónico.

### Tarea 5.5: Test de migración y sincronización

Run:

```powershell
npx.cmd vitest run tests/halfBoxBsPriceRegression.test.js tests/remoteInventory.test.js tests/remoteInventoryD4.test.js tests/security.test.js
```

Expected: PASS y ningún alias legacy válido queda inutilizable.

### Tarea 5.6: Commit de migración

```powershell
git add src/utils/productProcessor.js src/utils/productPriceMigration.js src/context/ProductContext.jsx src/hooks/useSalesData.js src/utils/remoteInventoryProcessor.js tests/halfBoxBsPriceRegression.test.js
git commit -m "fix: migrate legacy box price aliases"
```

---

## Fase 6 — UI/UX y validación operativa

### Tarea 6.1: Test de estado de precio faltante

**Archivos:** Si no existe infraestructura de React Testing Library, mantener este caso en el arnés de `calculatePricing` y documentar QA manual.

Comportamiento requerido:

- selector de media caja muestra precio Bs real cuando existe;
- muestra `Precio Bs no configurado` cuando `bs_fijo` no tiene precio;
- el botón no agrega el formato inválido;
- checkout no muestra `Total Bs 0` como estado cobrable.

### Tarea 6.2: QA visual manual

Validar en 375, 768, 1024 y 1440 px:

1. Abrir producto Solera.
2. Confirmar `½ Caja`, `$14`, `Bs 12.180`.
3. Agregar media caja.
4. Verificar cesta: `$14 / Bs 12.180`.
5. Abrir POS: resumen `$14 / Bs 12.180`.
6. Introducir pago exacto `Bs 12.180`.
7. Verificar `Vuelto Bs 0` y botón de cobro habilitado.
8. Repetir con precio legacy y confirmar que se normaliza.
9. Probar producto fijo sin precio y confirmar bloqueo accionable.

### Tarea 6.3: Accesibilidad y prevención de errores

**Archivos:** `src/components/Sales/SearchBar.jsx`, `src/components/Sales/CheckoutModalPOS/components/TransactionSummary.jsx`.

- Mensaje de error asociado al formato seleccionado.
- Foco visible en el selector.
- `aria-invalid` cuando el precio está ausente.
- No usar color como única señal.
- Mantener objetivos táctiles de mínimo 44 px.

### Tarea 6.4: Commit de UX

```powershell
git add src/components/Sales/SearchBar.jsx src/components/Sales/CheckoutModalPOS/components/TransactionSummary.jsx
git commit -m "fix: explain missing fixed Bs format prices"
```

---

## Fase 7 — Regresión final y checklist de salida

### Tarea 7.1: Ejecutar suite focalizada

Run:

```powershell
npx.cmd vitest run tests/halfBoxBsPriceRegression.test.js tests/pricingMode.test.js tests/frozenPrices.test.js tests/checkoutBsManual.test.js tests/remoteInventoryD4.test.js
```

Expected: todos los tests PASS.

### Tarea 7.2: Ejecutar suite completa

Run: `npm.cmd test -- --run`

Expected: cero regresiones respecto a la línea base y ningún test nuevo omitido sin justificación.

### Tarea 7.3: Validar build y lint de scope

Run:

```powershell
npm.cmd run build
npx.cmd eslint src/utils/productProcessor.js src/core/FinancialEngine.js src/views/SalesView.jsx src/components/Sales/SearchBar.jsx src/utils/remoteInventoryProcessor.js src/utils/checkoutProcessor.js
```

Expected: build correcto y cero errores ESLint en archivos modificados del alcance.

### Tarea 7.4: Revisión de diff y datos

Run:

```powershell
git diff --check
git status --short
```

Confirmar:

- no se borraron cambios preexistentes;
- no hay escrituras destructivas;
- no quedan fórmulas duplicadas de precio media caja;
- no se acepta total Bs cero en formato fijo;
- no se generan ventas con vuelto artificial;
- los aliases legacy siguen legibles durante la migración.

### Tarea 7.5: Commit final

```powershell
git add src tests docs/plans/2026-08-07-fix-media-caja-bs-12180.md
git commit -m "fix: harden half-box Bs pricing end to end"
```

## Criterios de aceptación

- Una media caja Solera configurada como `$14 / Bs 12.180` muestra `Bs 12.180` en selector, carrito, resumen y recibo.
- El pago exacto de `Bs 12.180` no produce vuelto.
- Un producto guardado históricamente con `halfBoxPriceBsManual` funciona sin edición manual.
- Una media caja sin precio Bs fijo no entra al carrito ni puede llegar a persistencia como `totalBs = 0`.
- Caja y media caja tienen la misma compatibilidad de aliases.
- Los conflictos entre campos canónicos y legacy quedan auditados.
- La suite focalizada y la suite completa quedan en verde.
- El build de producción es correcto.

## Riesgos y decisiones

| Riesgo | Mitigación |
|---|---|
| Productos existentes solo tienen alias legacy | Fallback de lectura + migración idempotente |
| Canónico y legacy tienen valores distintos | Gana canónico; se audita el conflicto |
| Dispositivos antiguos esperan aliases | Escribir ambos durante periodo de compatibilidad |
| Precio fijo ausente | Bloquear y mostrar error accionable, nunca convertir a cero |
| Cesta abierta durante edición de producto | Revalidar ítems al cambiar `products` y antes de checkout |
| Diferencia entre precio de unidad y formato | Resolver siempre con `targetFormat` explícito |
| Cambio de tasa afecta precio fijo | `bs_fijo` permanece fijo; solo USD equivalente puede variar en display |

