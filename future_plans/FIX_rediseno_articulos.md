# Plan de FIXEO — Rediseño de Artículos (post-implementación)

> **Contexto:** el LLM ejecutor implementó el plan `rediseno_articulos_licoreria.md` en **un solo commit** (`847fdc0`, sobre `main`). La auditoría encontró **1 bug que rompe la app**, **lógica financiera incorrecta**, **asimetría de stock**, **fases enteras sin hacer** y **deuda técnica de lint**. Este documento corrige todo.
> **Mismas reglas** que el plan original (§0): localiza por búsqueda, no adivines, un commit por fix, harness verde (`npm run lint && npm run test && npm run build`) antes de cerrar cada fix.
> **Convención de modo confirmada del código actual:** el string de ½ caja es **`'halfBox'`** (camelCase) en TODO el código ya escrito (SearchBar, SalesView, checkoutProcessor). **Mantén `'halfBox'`** — NO lo cambies a `'halfbox'`. Los modos válidos son: `'unit'`, `'box'`, `'halfBox'`.

---

## Estado por fase (qué quedó bien / mal / falta)

| Fase | Estado | Detalle |
|---|---|---|
| 1 Placeholder | ✅ OK | Cambiado. |
| 2 "Bulto"→"Caja" | ⚠️ Verificar | Revisar que no queden textos "Bulto" visibles. |
| 3 Auto-foto | ✅ OK | Eliminada. |
| 4 Granel toggle | ❌ NO HECHO | `dj_granel_enabled` no existe; `backupKeys.js` y `SettingsTabSistema.jsx` sin tocar. |
| 5 Ocultar COP | 🟡 Parcial | Se removió `priceCop` de los forms (ok), verificar checkout y que no queden refs muertas. |
| 6 Modelo datos | ✅ OK | `buildProductPayload` y `useProductForm` con campos nuevos. **Sin test.** |
| 7 Toggles formato | 🔴 ROTO | Forms Quick/Wizard/Modal OK, pero **`ProductsView.jsx` NO declara los 11 `useState`** → 33 `no-undef` → **crashea al guardar/editar**. |
| 8 Recibos Bs manual | ❌ NO HECHO | `ticketHtmlTemplate.js`, `ReceiptModal.jsx`, `ReceiptShareHelper.js` sin tocar. |
| 9 Unicidad barcode | ❌ NO HECHO | No hay validación de barcode duplicado. Resolución multi-formato SÍ está en SalesView. |
| 10 Ventas formato | 🟡 Parcial | `addToCart`, modos box/halfBox y popup 3 botones OK. Usa `parseFloat` (prohibido). |
| 11 Stock | 🔴 ROTO | Venta box/halfBox OK, pero **`voidSaleProcessor.js` NO actualizado** → anular repone mal. Falta display "≈ cajas". |
| 12 Checkout/pago Bs | 🔴 INCORRECTO | Ver **FIX-2**. Bloquea ventas 100% USD; usa IDs inexistentes; ambos modales y `useCheckoutCalculations` sin tocar. |
| Tests | ❌ NO HECHO | Ninguna prueba nueva. |
| Proceso | ⚠️ | Un solo commit en `main`, sin `PROGRESO_...md`. |

---

## FIX-0 — Rama y línea base
1. Trabaja en una rama: `git checkout -b fix/rediseno-articulos` (si no existe ya).
2. Corre el harness y anota el estado (hay fallos preexistentes, ver nota).
> **Nota — fallos PREEXISTENTES (no los causó el rediseño, NO los "arregles" aquí salvo que se indique):**
> - `tests/hooks.test.js` espera `PROTECTED_KEYS` con `pda_demo_flag_v1` pero el código tiene `dj_demo_flag_v1` (residuo de rebrand). Déjalo salvo que el humano pida arreglarlo.
> - `hasSecondaryPrice is not defined` en `SettingsTabNegocio.jsx` (archivo no tocado por el rediseño).
> - Errores `no-undef` de `process/Buffer/require/__dirname` en `scripts/`, `worker.js`, etc. (config de entorno, ajenos).
**Commit:** no aplica (solo preparación).

---

## FIX-1 🔴 BLOQUEANTE — Declarar los estados faltantes en `ProductsView.jsx`
**Problema:** `ProductsView.jsx` usa `priceBsManual, sellByBox, boxUnits, boxBarcode, boxPriceUsd, boxPriceBs, sellByHalfBox, halfBoxUnits, halfBoxBarcode, halfBoxPriceUsd, halfBoxPriceBs` (en `handleSave` ~línea 425 y al pasar props al Modal) pero **nunca los declara con `useState`** → 33 errores `no-undef` → **ReferenceError al renderizar/guardar**.
**Archivo:** `src/views/ProductsView.jsx`.
**Pasos:**
1. Junto a los `useState` de producto existentes (busca `const [priceUsd, setPriceUsd]` o similar), añade los 11 estados nuevos con defaults:
   ```js
   const [priceBsManual, setPriceBsManual] = useState('');
   const [sellByBox, setSellByBox] = useState(false);
   const [boxUnits, setBoxUnits] = useState('');
   const [boxBarcode, setBoxBarcode] = useState('');
   const [boxPriceUsd, setBoxPriceUsd] = useState('');
   const [boxPriceBs, setBoxPriceBs] = useState('');
   const [sellByHalfBox, setSellByHalfBox] = useState(false);
   const [halfBoxUnits, setHalfBoxUnits] = useState('');
   const [halfBoxBarcode, setHalfBoxBarcode] = useState('');
   const [halfBoxPriceUsd, setHalfBoxPriceUsd] = useState('');
   const [halfBoxPriceBs, setHalfBoxPriceBs] = useState('');
   ```
2. En **`handleEdit`** (busca `handleEdit`): puebla cada estado desde el producto con fallback (`setSellByBox(product.sellByBox || false)`, `setBoxUnits(product.boxUnits?.toString() || '')`, etc.).
3. En el **reset del formulario** (al crear nuevo / cerrar modal — busca donde se hace `setPriceUsd('')` o `resetForm`): resetea también los 11 a su default.
4. Verifica que ya se pasan como props al `<ProductFormModal .../>` (deberían; si falta alguno, añádelo).
**Guardarraíl:** `npx eslint --no-cache src/views/ProductsView.jsx` → **0 errores `no-undef`**.
**DoD:** crear y editar un producto NO lanza error; los campos de Caja/½Caja persisten y se recargan al editar.
**Commit:** `fix(products): declarar estados de Caja/½Caja/precioBs en ProductsView (corrige crash al guardar)`.

---

## FIX-2 🔴 BLOQUEANTE — Precio Bs manual sin romper ventas USD ni la consistencia (D1/D7)
**Problema actual (verificado en el código):**
- `FinancialEngine.buildCartTotals` usa `priceBsManual` **incondicionalmente** para el total Bs. Resultado: con Polar $1.50 / 55 Bs y tasa 38, `cartTotalBs=55` pero `cartTotalUsd=1.50`. En pago **100% USD**, el guard compara `55` vs `1.50×38=57` → drift 2 → **la venta en dólares se BLOQUEA**. 🔴
- `checkoutProcessor` "resuelve" esto **desactivando el guard** para pagos Bs y (por error) también para mixtos/COP, usando IDs **inexistentes** (`zelle`, `binance`). Esto rompe la protección FIN-022 y deja totales USD/Bs **inconsistentes** en la venta guardada.

**Diseño correcto (D1 + D7) — impлеméntalo así:**
> Los totales deben ser SIEMPRE internamente consistentes (`cartTotalBs == cartTotalUsd × tasa`). El guard FIN-022 NO se desactiva nunca. Lo que cambia según el pago es **cuál es la base**.

**FIX-2a — `buildCartTotals` gateado por bandera (no incondicional):**
`src/core/FinancialEngine.js` → `buildCartTotals(cartItems, discountData, bcvRate, copRate = 0, useManualBs = false)`:
- Añade parámetro `useManualBs = false` (default preserva comportamiento actual).
- La línea Bs:
  ```js
  const lineItemsBs = cartItems.map(item => {
      if (useManualBs && item.priceBsManual != null && item.priceBsManual > 0) {
          return mulR(item.priceBsManual, item.qty);   // Bs manual (solo en pago 100% Bs)
      }
      if (item.exactBs != null) return mulR(item.exactBs, item.qty); // Venta Libre (existente)
      return mulR(mulR(item.priceUsd, item.qty), bcvRate);           // derivado por tasa (default)
  });
  ```
- **Quita** el bloque incondicional `if (item.priceBsManual != null ...)` que el ejecutor añadió arriba de `exactBs`.
- Cuando `useManualBs` sea true, deriva el USD del total Bs para mantener consistencia: expón/recalcula `subtotalUsd = divR(subtotalBs, bcvRate)` en esa rama (documenta con `// D1:`).

**FIX-2b — Detección de pago 100% Bs por CURRENCY (no por IDs hardcodeados):**
En `src/hooks/useCheckoutCalculations.js` (y donde se arma el total del checkout): determina `isPureBsPayment` = hay pagos y **todos** tienen `currency === 'BS'` según el catálogo de `config/paymentMethods.js` (NO listes IDs a mano; busca el método y lee su `currency`). Cuando `isPureBsPayment`, reconstruye los totales con `buildCartTotals(..., useManualBs = true)` y pásalos consistentes al checkout.

**FIX-2c — Restaurar el guard íntegro en `checkoutProcessor.js`:**
Revierte el bloque del ejecutor a la versión original SIEMPRE activa:
```js
const expectedBs = mulR(cartTotalUsd, effectiveRate);
const bsDrift = Math.abs(subR(cartTotalBs, expectedBs));
if (bsDrift > FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_BS) {
    return { success: false, error: `Inconsistencia USD/Bs: drift de ${round2(bsDrift)} Bs (tasa ${effectiveRate}).` };
}
```
Como los totales llegan ya consistentes (2a/2b), el guard pasa en TODOS los casos y sigue protegiendo. Elimina toda referencia a `zelle`/`binance`.

**FIX-2d — Ambos modales (D5):** aplica 2b en `CheckoutModal.jsx` **y** `CheckoutModalPOS/` (index + `components/PaymentInputs.jsx`), de modo que el total mostrado al cajero use Bs manual en pago 100% Bs y USD-base en USD/mixto.

**Guardarraíl (OBLIGATORIO):** crea `tests/checkoutBsManual.test.js` (estilo `financialEngine.test.js`) con:
1. Polar $1.50 / 55 Bs, tasa 38, pago 100% `pago_movil` → total 55 Bs, `cartTotalUsd≈1.447`, guard pasa, venta OK.
2. Mismo, pago 100% `efectivo_usd` → total base $1.50, Bs derivado 57, guard pasa, venta OK (**NO bloqueada**).
3. Mismo, mixto $1 + resto Bs → base USD, resto = (1.50−1)×38, guard pasa.
4. Sin `priceBsManual`, pago Bs → fallback `priceUsd×tasa` (D2).
**DoD:** los 4 tests verdes; cobrar en USD ya NO se bloquea; cobrar 100% Bs cobra el manual.
**Commit:** `fix(checkout): precio Bs manual consistente con FIN-022 en 100% Bs, sin bloquear USD/mixto`.

---

## FIX-3 🔴 Asimetría de stock — actualizar `voidSaleProcessor.js`
**Problema:** vender Caja descuenta `boxUnits` unidades, pero al **anular** la venta `voidSaleProcessor.js` conserva la lógica vieja → repone cantidad incorrecta.
**Archivo:** `src/utils/voidSaleProcessor.js`.
**Pasos:** replica EXACTO el cálculo de `physicalQty` por `_mode` de `checkoutProcessor.js` (`unit`→qty, `box`→qty×boxUnits, `halfBox`→qty×halfBoxUnits, peso→qty), pero **sumando** stock (inverso). Usa los mismos campos del item (`item.boxUnits`, `item.halfBoxUnits`) vía el spread `...product` que ya existe en el cart item.
**Guardarraíl:** añade a `tests/` un caso: vender 1 caja (36u) baja 36; anular repone 36 exactas.
**DoD:** vender y anular Unidad/Caja/½Caja deja el stock idéntico al inicial.
**Commit:** `fix(sales): anulacion repone stock por formato (simetria con la venta)`.

---

## FIX-4 🟠 Eliminar `parseFloat` prohibido (regla `no-restricted-syntax`)
**Problema:** el ejecutor usó `parseFloat` en cálculos de dinero (SalesView, forms, ProductsView). El proyecto lo **prohíbe** (usa dinero.js). Genera errores de lint y riesgo de drift IEEE-754.
**Pasos:** en los archivos tocados, reemplaza `parseFloat(x)` por el helper del proyecto para dinero (busca cómo se hace hoy: `CurrencyService.safeParse`, `round2`, o el import de `dinero`/`financialLogic`). Para conteos enteros de unidades, `parseInt(x, 10)` es aceptable si no lo marca el linter — verifica.
**Guardarraíl:** `npx eslint --no-cache <archivos tocados>` → **0 errores `no-restricted-syntax`**.
**DoD:** lint de los archivos del rediseño sin errores; tests financieros verdes.
**Commit:** `refactor(products): usar helpers de dinero en vez de parseFloat (regla financiera)`.

---

## FIX-5 🟠 Fase 4 faltante — Toggle Granel + backup
**Archivos:** `src/components/Settings/tabs/SettingsTabSistema.jsx`, `src/config/backupKeys.js`, forms Quick/Wizard.
**Pasos:** implementa la Fase 4 del plan original: toggle "Permitir venta a Granel (Kg/Litro)" con clave `dj_granel_enabled` (default `false`), añade `'dj_granel_enabled'` a `LS_KEYS` en `backupKeys.js`, y oculta Granel en los forms tras el flag.
**Guardarraíl:** `grep -rn "dj_granel_enabled" src/` muestra el toggle, el gate en forms y la clave en backup.
**DoD:** con flag off no aparece Granel; on lo muestra; la clave entra al backup.
**Commit:** `feat(settings): toggle de venta a granel (oculto por defecto) + backup`.

---

## FIX-6 🟠 Fase 8 faltante — Bs manual en recibos/tickets
**Archivos:** `src/utils/ticketHtmlTemplate.js`, `src/components/.../ReceiptModal.jsx`, `ReceiptShareHelper.js`.
**Pasos:** donde el Bs de línea se calcula como `priceUsd × rate`, usa el Bs manual del item si viene (`item.priceBsManual`/`exactBs`), con fallback a `priceUsd × rate` (D2). Solo lectura/formato; no cambies el motor.
**Guardarraíl:** un producto sin Bs manual imprime igual que antes (test/manual).
**DoD:** el recibo de una venta 100% Bs muestra el Bs cobrado real.
**Commit:** `feat(receipts): mostrar precio Bs manual en tickets y recibos`.

---

## FIX-7 🟡 Fase 9 faltante — Validación de unicidad de barcode
**Archivo:** `src/components/Products/ProductFormModal.jsx` (validación antes de guardar).
**Pasos:** implementa la Fase 9: los 3 barcodes del producto (`barcode`, `boxBarcode`, `halfBoxBarcode`) no se repiten entre sí; ninguno coincide con los de OTRO producto. Barcodes vacíos/`null` se ignoran. Error claro indicando el choque.
**Guardarraíl:** test o prueba manual: intentar guardar con `boxBarcode` igual al `barcode` de otro producto → se rechaza.
**DoD:** no se puede crear/editar con barcode duplicado.
**Commit:** `feat(products): validacion de unicidad de los 3 codigos de barras`.

---

## FIX-8 🟡 Fase 11 (display) faltante — Equivalente en cajas (0,5)
**Archivos:** `ProductCard.jsx` y donde se muestre stock.
**Pasos:** crea helper único `boxEquivalent(product)` y muéstralo junto al stock:
- `sellByBox` → `stock / boxUnits`.
- solo `sellByHalfBox` → `stock / (halfBoxUnits × 2)` (la ½ caja = **0,5 cajas**).
- sin caja → omitir.
Formato: `240 unidades (≈ 6,6 cajas)`. Solo informativo.
**Guardarraíl:** producto con solo ½ caja de 18u y stock 18 muestra `≈ 0,5 cajas`.
**DoD:** el equivalente aparece correcto en los 3 casos.
**Commit:** `feat(products): mostrar equivalente en cajas (½ caja = 0,5) junto al stock`.

---

## FIX-9 🟡 Tests faltantes (Fases 6/9/10/11)
Añade pruebas mínimas que no se crearon:
- `buildProductPayload` con Caja/½Caja (Fase 6).
- `resolveByBarcode`/selección de formato por barcode (Fase 10).
- (Los de checkout y void ya se pidieron en FIX-2/FIX-3.)
**Guardarraíl/DoD:** `npm run test` verde con los nuevos casos.
**Commit:** `test(products): cobertura de payload, resolucion de barcode y formatos`.

---

## FIX-10 — Cierre y verificación global
1. `npm run lint` → sin errores **nuevos** en archivos del rediseño (los preexistentes de FIX-0 pueden quedar).
2. `npm run test` → verde (salvo el preexistente `pda_demo_flag_v1`, si el humano decide no tocarlo).
3. `npm run build` → compila.
4. `grep -rn "Bulto" src/` → solo identificadores internos.
5. `grep -rn "zelle\|binance" src/utils/checkoutProcessor.js` → vacío.
6. Crea `future_plans/PROGRESO_rediseno_articulos.md` con la checklist FIX-1…FIX-9 marcada.
7. Corre las 6 pruebas manuales del plan original (crear producto, precios duales, activar caja, escanear caja, pago 100% Bs = 55 Bs, pago mixto).
**Commit:** `docs(products): progreso y verificacion final del rediseno`.

---

## Orden recomendado
**Primero lo que rompe la app:** FIX-1 → FIX-2 → FIX-3 (bloqueantes). Luego FIX-4 (lint/deuda). Después las fases faltantes FIX-5…FIX-8. Cierra con FIX-9 (tests) y FIX-10 (verificación).
Ante cualquier discrepancia con el código: **DETENTE y reporta**, no adivines.
