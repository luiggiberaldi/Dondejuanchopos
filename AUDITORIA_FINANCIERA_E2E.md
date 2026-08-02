# Auditoría Financiera E2E — Donde Juancho POS

**Fecha:** 2026-08-01
**Alcance:** flujo financiero completo — primitivas de dinero, concurrencia/persistencia, motor de desglose, cierre de caja, reportes y precios en Bs.
**Estado de la suite al auditar:** 10 fallos / 262 tests (5 archivos), 10 skipped.

> Esta auditoría **no aplica cambios**. Documenta hallazgos verificados, su radio de impacto y las mitigaciones/guardarraíles propuestos.

---

## Resumen ejecutivo

| # | Hallazgo | Severidad | Verificado |
|---|----------|-----------|------------|
| A | `withLock` pierde la exclusión mutua dentro de una misma pestaña | **CRÍTICO** | Sí — reproducido |
| B | `round2` devuelve `NaN` en dos ventanas de magnitud | **CRÍTICO** | Sí — reproducido |
| C | Contradicción apertura de caja: implementación vs. tests | **ALTO** | Sí — 3 tests |
| D | `currentFloat` calcula mal el efectivo disponible | **ALTO** | Por inspección |
| E | Reportes históricos y turno vivo usan filtros de flujo distintos | **MEDIO-ALTO** | Por inspección |
| F | Redondeo de Bs oculto, bidireccional y no conciliado | **MEDIO** | Sí — reproducido |
| G | El vuelto se captura mal y se descuenta en la moneda equivocada | **CRÍTICO** | Sí — reproducido |

**6 de los 10 fallos de la suite tienen una sola raíz: el hallazgo A.**

---

## A. CRÍTICO — `withLock` pierde la exclusión mutua intra-pestaña

**Ubicación:** `src/utils/withLock.js:86`, `src/utils/withLock.js:108-110`

```js
const _activeLocksInThread = new Set();   // ← module-level

export async function withLock(name, fn, opts = {}) {
  if (_activeLocksInThread.has(name)) {
    return await fn();                    // ← ejecuta SIN cerrojo
  }
  _activeLocksInThread.add(name);
  ...
}
```

### Mecanismo

El `Set` es de módulo, no de contexto asíncrono. JavaScript no tiene continuation-local storage en el navegador, así que este guard **no puede distinguir una llamada anidada (reentrante) de una llamada concurrente**. Ambas ven el mismo `name` en el `Set`.

Consecuencia: el **primer** llamante toma el cerrojo; **cualquier otro llamante concurrente mientras esté tomado se salta el cerrojo por completo** y ejecuta de inmediato. La exclusión mutua no se degrada — desaparece exactamente cuando hay contención, que es el único momento en que importa.

Afecta también al camino nativo `navigator.locks`, porque el guard envuelve a ambos caminos. Entre pestañas sí funciona (cada pestaña tiene su propia instancia del módulo); el fallo es **intra-pestaña**, que es el caso común: doble clic, `Promise.all`, operaciones en lote, ráfagas de auditoría.

### Radio de impacto

`pos_write_lock` protege el read-modify-write de ventas, productos y clientes en:

| Archivo | Operación |
|---|---|
| `src/utils/checkoutProcessor.js:167` | persistir venta |
| `src/utils/voidSaleProcessor.js:27` | anular venta |
| `src/utils/customerTransactionProcessor.js:48` | abonos / fiado |
| `src/services/kardexService.js:49,147,244` | movimientos de inventario |
| `src/services/consumptionSessionService.js:64` | fichas de consumo |
| `src/hooks/useGastosInternos.js:65,91,198` | gastos internos |
| `src/hooks/useCheckoutFlow.js:132` | apertura de caja |
| `src/hooks/useSupervisorCommands.js:317,384` | comandos de supervisor |
| `src/views/DashboardView.jsx:387` | mutación de ventas |

`AUDIT_LOCK` protege el log de auditoría (`src/services/auditService.js:56,206`).

### Por qué se pierde el dato (no solo el número)

`src/utils/checkoutProcessor.js:168-174`:

```js
const existingSales = await storageService.getItem(SALES_KEY, []);
const saleNumber = existingSales.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1;
const updatedSales = [finalPersistedSale, ...existingSales];
await storageService.setItem(SALES_KEY, updatedSales);
```

Es un read-modify-write sobre el array completo. Correcto **solo** bajo exclusión real. Sin ella, dos ventas concurrentes leen el mismo array, calculan el mismo `saleNumber` y el segundo `setItem` **sobreescribe** al primero: la venta no queda con número duplicado, **desaparece**.

### Evidencia reproducida

- `tests/withLock.test.js` — orden observado `start_2, start_1, end_2, end_1` (solapado) en lugar de intercalado. Falla tanto en camino nativo como en fallback.
- `FIN-007` — dos ventas concurrentes → **1 persistida**, 1 perdida.
- `FIN-006` — dos abonos concurrentes al mismo cliente → **1 persistido**.
- `HOOK-008` — 50 `logEvent` en paralelo → **1 entrada**; 49 eventos de auditoría perdidos. El límite `MAX_ENTRIES` también queda sin verificar.

### Restricción para el arreglo (importante)

**El guard es load-bearing: no se puede borrar sin más.** Hay reentrancia genuina en producción:

`src/utils/checkoutProcessor.js:296` llama a `recordKardexMovement` **dentro** del `withLock('pos_write_lock')` abierto en la línea 167, y `kardexService.js:49` vuelve a pedir el mismo cerrojo. Sin guard, eso es un **deadlock** en el mutex en memoria y una espera indefinida con `navigator.locks` en modo exclusive. Lo mismo aplica a `voidSaleProcessor.js:167` y `remoteInventoryProcessor.js:215,303`.

Introducido en `9ea8854` (módulo Kardex) — el guard fue la solución al deadlock que el propio Kardex creó; el coste colateral fue la exclusión mutua.

### Mitigación propuesta

**Opción 1 — split-lock (recomendada).** Separar cada operación en un núcleo sin cerrojo y una fachada con cerrojo:

```js
export async function recordKardexMovementUnlocked(mov) { /* núcleo */ }
export async function recordKardexMovement(mov) {
  return withLock('pos_write_lock', () => recordKardexMovementUnlocked(mov));
}
```

Los llamantes que ya están dentro del cerrojo usan la variante `Unlocked`. Con eso **desaparece toda reentrancia**, se elimina `_activeLocksInThread` por completo y `withLock` recupera su semántica. Es explícito, verificable y no depende de magia de contexto.

**Opción 2 — token de propietario.** `withLock` pasa un token a `fn`; las llamadas anidadas lo reciben vía `opts.parent` y se saltan el cerrojo solo si el token coincide. Preserva la ergonomía actual pero obliga a hilar el token por toda la cadena de llamadas.

**Guardarraíl.** Test de invariante de concurrencia: N llamadas en paralelo a `withLock` con el mismo nombre deben producir secciones críticas estrictamente no solapadas, para N = 2, 10 y 50. Los tests actuales cubren N=2 y N=3; el caso de auditoría demuestra que N alto rompe distinto.

---

## B. CRÍTICO — `round2` devuelve `NaN` en dos ventanas de magnitud

**Ubicación:** `src/utils/dinero.js:29-37`

```js
const shifted = Number(`${abs}e${decimals}`);
return sign * Number(`${Math.round(shifted)}e-${decimals}`);
```

La técnica de desplazar el punto decimal por string es correcta en el rango habitual, pero **asume que `String(number)` nunca usa notación exponencial**. Cuando lo hace, se concatenan dos exponentes (`"5e-7" + "e2"` → `"5e-7e2"`) y `Number()` devuelve `NaN`.

### Ventana baja: `[1e-12, 1e-6)`

`String(5e-7) === "5e-7"`. El guard de la línea 34 corta por debajo de `1e-12`, así que hay una ventana abierta:

```
1e-13    → 0      (salvado por el guard)
1e-12    → NaN
5e-7     → NaN
9.99e-7  → NaN
1e-6     → 0      ("0.000001", decimal)
```

El ruido típico de coma flotante (~1e-16) cae por debajo del guard y se salva. Lo que sí entra son operaciones legítimas:

```
divR(0.0001, 500)     → NaN
divR(0.05, 100000)    → NaN
mulR(0.0001, 0.001)   → NaN
```

### Ventana alta: `abs >= 1e19` (para `round2`)

No detectada en la pasada anterior. El fallo aquí es el **segundo** template: `Math.round(shifted)` devuelve un número que se estringa en exponencial a partir de `1e21`.

```
round2(1e20)   → NaN
round2(1e21)   → NaN
round2(1.23e22)→ NaN
```

Con `decimals = 2`, basta `abs >= 1e19`. Poco probable como monto real, pero alcanzable con datos corruptos, un campo mal parseado o una tasa aberrante — y el resultado es silencioso.

### Por qué importa

`NaN` no lanza: se propaga. `sumR`, `subR`, `mulR` y `divR` lo arrastran, y `calculatePaymentBreakdown` lo filtra por `roundedTotal !== 0` — que es `true` para `NaN`, así que el bucket **sí se conserva, con total `NaN`**. De ahí pasa al desglose, al arqueo y al PDF de cierre sin ninguna barrera.

### Mitigación propuesta

Reemplazar el shift por string por una implementación que no dependa de `String(number)`:

```js
function _shiftRound(n, decimals) {
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  if (abs < 1e-12) return 0;
  const [mantissa, exp = '0'] = abs.toExponential().split('e');
  const shifted = Number(`${mantissa}e${Number(exp) + decimals}`);
  const rounded = Math.round(shifted);
  const [rm, re = '0'] = Math.abs(rounded).toExponential().split('e');
  const out = sign * Math.sign(rounded) * Number(`${rm}e${Number(re) - decimals}`);
  return out + 0;   // normaliza -0 → 0
}
```

Normalizar a notación exponencial **antes** de concatenar elimina ambas ventanas, porque el exponente se suma numéricamente en vez de textualmente.

**Validado antes de proponerla:**

- Cierra ambas ventanas: `1e-12`, `5e-7`, `9.99e-7` → `0`; `1e20`, `1e21`, `1.23e22` → el valor correcto.
- **Cero regresiones** en el barrido de 1..200.000 con offset `.005` (el mismo criterio que documenta la implementación actual).
- Conserva round-half-away-from-zero: `2.005 → 2.01`, `−2.005 → −2.01`, `0.125 → 0.13`, `2.675 → 2.68`.
- Correcta en las demás precisiones: `round0(2.5) = 3`, `round3(1.0005) = 1.001`, `round4(0.00005) = 0.0001`.

El `+ 0` final no es cosmético: sin él, `_shiftRound(-5e-7, 2)` devuelve `-0`. Como `Object.is(-0, 0)` es `false`, un `expect(...).toBe(0)` fallaría, y `-0` puede llegar a formatearse como `"-0"` en el PDF de cierre.

**Guardarraíl.** Tripwire de `NaN` en las primitivas: si un resultado no es finito partiendo de entradas finitas, lanzar en `DEV` y registrar una anomalía de auditoría en producción. Un `NaN` en el núcleo financiero nunca debe ser silencioso. Añadir tests de barrido sobre las fronteras `1e-12`, `1e-7`, `1e-6`, `1e18`, `1e19`, `1e21`.

---

## C. ALTO — Contradicción sobre la apertura de caja: implementación vs. tests

**Ubicación:** `src/core/FinancialEngine.js:147-159` vs. `tests/financialEngine.test.js:65`, `tests/shiftScope.test.js:44,65`

La cabecera del motor declara:

> `FIN-002: Apertura COP entra al breakdown de efectivo_cop.`

La implementación hace lo contrario: manda `APERTURA_CAJA` a un bucket de metadatos `_apertura` y hace `return` explícito — *"Do NOT count opening float as sales revenue or payment method receipts"*.

Los tests siguen escritos contra el contrato viejo:
- `FIN-002` espera `breakdown['efectivo_usd'].total === 50` → el bucket no existe → `TypeError`.
- `CC1` espera `130` (100 apertura + 50 venta − 20 gasto) → recibe `30`.
- `CC1` autoconsumo espera `100` → el bucket no existe → `TypeError`.

El rediseño llegó en `e9e1034` ("desglose independiente de divisas en apertura de caja") sin actualizar los tests.

**El rediseño es defendible** — separar fondo de apertura de ingresos por ventas es lo correcto contablemente. El problema no es la decisión: es que **quedaron tres tests rojos como contrato obsoleto**, y con ellos rojos la suite ya no protege ese camino. Además el arreglo quedó incompleto (ver hallazgo D).

`CierreCajaWizard.jsx:59-61` sí compensa correctamente:

```js
const expectedUsd = round2((paymentBreakdown['efectivo_usd']?.total || 0) + openingUsd - (paymentBreakdown['_vuelto_usd']?.total || 0));
```

**Mitigación.** Decidir el contrato de forma explícita y re-baselinear los tres tests contra él, documentando en la cabecera del motor que `_apertura` y `_vuelto_*` son **buckets de metadatos que todo consumidor debe integrar**. Hoy esa obligación es tácita y ya hay un consumidor que la incumple.

**Guardarraíl.** Un test que enumere todos los consumidores de `calculatePaymentBreakdown` y verifique que cada uno integra `_apertura` y `_vuelto_*`, o declare explícitamente por qué no.

---

## D. ALTO — `currentFloat` calcula mal el efectivo disponible

**Ubicación:** `src/views/SalesView.jsx:321-333`

```js
const todayOpen = salesData.filter(s => {
    if (s.cajaCerrada) return false;
    const saleDay = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : todayStr;
    return saleDay === todayStr;
});
const bd = FinancialEngine.calculatePaymentBreakdown(todayOpen);
return {
    usd: bd['efectivo_usd']?.total ?? 0,
    bs:  bd['efectivo_bs']?.total  ?? 0,
};
```

Tres defectos, consecuencia directa del hallazgo C:

1. **No suma la apertura.** El fondo inicial vive en `_apertura`, que aquí se ignora. El efectivo disponible queda **subestimado** por el monto de apertura completo.
2. **No resta el vuelto ya entregado.** `_vuelto_usd` / `_vuelto_bs` no se descuentan, así que el efectivo queda **sobreestimado** por todo el vuelto que ya salió de la caja.
3. **Usa el día calendario, no el turno.** El resto del sistema usa `getOpenShiftMovements` para que un turno cruce la medianoche. Aquí el filtro es `saleDay === todayStr`, así que **a medianoche el efectivo disponible se reinicia a cero a mitad de turno**.

Este valor alimenta la advertencia anti-sobregiro de vuelto en `CheckoutModal.jsx:430`. Con estos tres sesgos la advertencia falla en ambas direcciones: alerta cuando sí hay efectivo (apertura ignorada) y calla cuando la caja ya se vació a fuerza de vueltos.

**Mitigación.** Reutilizar `getOpenShiftMovements` y aplicar la misma fórmula del wizard (`efectivo + apertura − vuelto`). Mejor aún: extraer esa fórmula a **una sola función** en `FinancialEngine` (`computeExpectedCash(breakdown)`) y usarla tanto en `CierreCajaWizard` como en `currentFloat`. Hoy la lógica está duplicada y ya divergió.

---

## E. MEDIO-ALTO — Reportes históricos y turno vivo usan filtros de flujo distintos

**Ubicación:** `src/utils/reportsProcessor.js:14-19` y `src/utils/reportsProcessor.js:~100` vs. `src/hooks/useDashboardMetrics.js:18,40`

El dashboard en vivo alimenta el desglose con `shiftScope.movements`, que **incluye** `APERTURA_CAJA` y `GASTO_INTERNO`.

Los reportes históricos filtran así:

```js
if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA'
    && s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'PAGO_PROVEEDOR') return false;
```

`GASTO_INTERNO` y `APERTURA_CAJA` quedan fuera. Pero `FinancialEngine` **sí sabe** descontar un `GASTO_INTERNO` con `afectaCaja: true` (`FinancialEngine.js:162-204`) — simplemente nunca le llegan.

**Consecuencia:** el mismo turno, visto en el reporte histórico, muestra **más efectivo recibido** que el que mostró el dashboard en vivo, por el monto exacto de los gastos internos que salieron de la caja. Los dos números son "oficiales" y no cuadran entre sí.

`groupSalesByCierreId` repite el mismo filtro, así que el desglose reconstruido por cierre arrastra el mismo sesgo.

**Mitigación.** Una única fuente de verdad para el alcance del flujo de caja: exportar un `isCashFlowMovement(sale)` desde `shiftScope` y usarlo en `reportsProcessor`, `useDashboardMetrics` y el generador de cierre. Que los tres consumidores decidan por su cuenta qué es "flujo de caja" es la causa estructural.

**Guardarraíl.** Test de conciliación: para un conjunto fijo de movimientos, el desglose del dashboard en vivo y el del reporte histórico del mismo rango deben ser idénticos.

---

## F. MEDIO — Redondeo de Bs oculto, bidireccional y no conciliado

**Ubicación:** `src/utils/productProcessor.js:189-191,246-252`, `src/utils/dinero.js:75-79`

```js
const activeStep = bsRoundingStep !== null && bsRoundingStep !== undefined
    ? bsRoundingStep
    : parseInt(localStorage.getItem('bs_rounding_step') || '10', 10);
```

Tres problemas distintos:

**1. Dependencia global oculta en un motor declarado puro.** `FinancialEngine.buildCartTotals` está documentado como *"Centralized, pure-function mathematical engine"*, pero por `calculatePricing` lee `localStorage` en cada ítem de cada llamada. El resultado depende del entorno, no de los argumentos. Esto es exactamente lo que hace fallar a `tests/checkoutBsManual.test.js:68`: el test espera `225` y obtiene `230`, porque el step por defecto es `10`.

**2. El redondeo puede ir hacia abajo.** `roundBs` usa `Math.round(n / step) * step` — al múltiplo **más cercano**, no hacia arriba:

```
45 Bs → 50   (+5, a favor del negocio)
44 Bs → 40   (−4, en contra)
```

Mientras tanto `dinero.js:85-86` documenta la política contraria: *"Política del POS para precios en Bolívares (siempre redondear Bs hacia arriba)"*. Esa política está implementada en `ceilR`, que no es lo que usa el camino `tasa_dia`. La política declarada y la implementada no coinciden.

**3. El diferencial de redondeo no se contabiliza en ninguna parte.** En el caso del test: `subtotalUsd = 5`, `subtotalBs = 230`, tasa `45`. La tasa implícita es `46` — un recargo del **+2,2%** que no aparece como ingreso, descuento ni ajuste. Sobre miles de líneas al mes, la diferencia entre `totalUsd × tasa` y `totalBs` es dinero real sin cuenta contable donde caer.

**Mitigación.**
- Pasar `bsRoundingStep` explícitamente desde la capa de UI/config; que el motor no lea `localStorage` nunca. Esto vuelve `buildCartTotals` determinista y reparable en test.
- Decidir la política (nearest vs. ceil) y alinear código y documentación. Si es ceil, usar `ceilR` en `tasa_dia`; si es nearest, corregir el comentario de `dinero.js:85`.
- Registrar el diferencial: `round2(totalBs − totalUsd × tasa)` como campo de la venta, sumable en el cierre. Convierte un sesgo invisible en una línea auditable.

**Guardarraíl.** Invariante de conciliación en el cierre: `|totalBs − totalUsd × tasa|` no debe exceder `nº de líneas × step`. Por encima de eso, anomalía registrada — atrapa tanto errores de tasa como redondeos descontrolados.

---

## G. CRÍTICO — El vuelto se captura mal y se descuenta en la moneda equivocada

> Hallazgo añadido tras revisar el *Plan de Fixes — Corrección del Cuadre de Caja*. El síntoma que describe ese plan (descuadre fantasma en el cierre) **es real y está reproducido**. La causa raíz, en cambio, **no es la que el plan atribuye**: las fórmulas de `CierreCajaWizard` ya son correctas. El defecto está aguas arriba, en la captura del vuelto. Ver "Evaluación del plan propuesto" al final de esta sección.

### Reproducción

Escenario: apertura `Bs 5.570`, venta de `Bs 398`, el cliente paga con un billete de `Bs 500`, se le devuelven `Bs 102`. Tasa `80`.
Efectivo real en gaveta al cierre: **`Bs 5.968`** (`5.570 + 500 − 102`).

Aplicando la fórmula actual de `CierreCajaWizard.jsx:59-60` sobre el desglose real del motor:

| Escenario de captura | `_vuelto_bs` | `expectedBs` | `expectedUsd` |
|---|---|---|---|
| 1. Cajero no toca los campos de vuelto | `102` | `5.968` ✅ | **`−1,27`** ❌ |
| 2. Cajero declara solo el vuelto en USD | `undefined` | **`6.070`** ❌ | **`−1,27`** ❌ |
| 3. El vuelto no se registra | `undefined` | **`6.070`** ❌ | `0` ✅ |

Los escenarios 2 y 3 inflan el esperado en Bs por **exactamente el monto del vuelto**. Ese es el descuadre fantasma reportado.

### G1 — `changeUsd` y `changeBs` son el mismo vuelto en dos monedas, y se descuentan las dos

`src/hooks/useCheckoutCalculations.js:101-102`

```js
const changeUsd = Math.max(0, subR(totalPaidWithCasheaUsd, dynamicTotalUsd));
const changeBs  = Math.max(0, subR(totalPaidBs + mulR(casheaAmountUsd, safeRate), dynamicTotalBs));
```

No son la **partición** del vuelto por moneda: son el **total** del vuelto expresado en USD y expresado en Bs. En una venta pagada íntegramente en Bs con vuelto en Bs, ambos son positivos (`102 Bs` y `1,27 $`) y describen el mismo billete.

Cuando el cajero no toca los campos (`useCheckoutCalculations.js:173-174`), el fallback persiste **ambos**. `FinancialEngine.js:353-360` crea entonces `_vuelto_bs = 102` **y** `_vuelto_usd = 1,27`, y el wizard descuenta cada uno de su moneda: el esperado en dólares baja `$1,27` que nunca salieron de la gaveta como dólares.

Efecto: **sobrante fantasma en USD en todo cierre con vuelto en Bs.** En el escenario 1 el esperado en dólares llega a ser **negativo**.

### G2 — El fallback del vuelto es todo-o-nada

`src/hooks/useCheckoutCalculations.js:173-174`

```js
const defaultUsdChange = (!changeUsdGiven && !changeBsGiven) ? changeUsd : round2(safeParse(changeUsdGiven));
const defaultBsChange  = (!changeUsdGiven && !changeBsGiven) ? changeBs  : round2(safeParse(changeBsGiven));
```

La condición evalúa **ambos** campos a la vez. Basta que el cajero escriba en uno para que el otro deje de usar el valor calculado y pase a `safeParse('') === 0`.

Es decir: **declarar el vuelto en una moneda borra silenciosamente el vuelto de la otra.** El campo vacío no significa "cero entregado", significa "no lo especifiqué" — pero el código lo interpreta como cero y lo persiste como cero.

### G3 — En el checkout POS el vuelto en Bs es cero por defecto, sin fallback

`src/components/Sales/CheckoutModalPOS/index.jsx:359-360`

```js
changeUsdGiven: distVueltoUSD ? parseFloat(distVueltoUSD) : cambioUSD,
changeBsGiven:  distVueltoBS  ? parseFloat(distVueltoBS)  : 0,
```

La rama USD cae al vuelto calculado (`cambioUSD`); la rama Bs cae a **`0` literal**. No hay fallback.

En este modal, **todo vuelto en bolívares que el cajero no teclee explícitamente se persiste como cero**. No depende de que el cajero se equivoque: es el comportamiento por defecto del camino de venta. Esta es la explicación más directa del caso `6.871` vs `6.210` — el sistema nunca supo que esos `Bs 661` salieron de la gaveta.

### G4 — El vuelto en COP no existe en ninguna parte del circuito

- `checkoutProcessor.js:149-150` persiste `changeUsd` y `changeBs`. **No existe `changeCop`**; ningún archivo lo escribe.
- `FinancialEngine.js:353-360` solo crea `_vuelto_usd` y `_vuelto_bs`. **No existe el bucket `_vuelto_cop`.**
- `CierreCajaWizard.jsx:61` calcula `expectedCop = efectivo_cop + openingCop`, **sin restar vuelto alguno**.
- `dailyCloseGenerator.js:437` lee `s.changeCop` — un campo que **siempre es `undefined`**, así que esa rama del PDF nunca se imprime.

Cualquier vuelto entregado en pesos infla el esperado en COP por su monto íntegro, y no queda rastro en el reporte. El plan propone "preservar `_vuelto_cop`": ese bucket **hay que crearlo**, no preservarlo.

### G5 — Las ventas que no son `VENTA` pierden el vuelto

`src/utils/checkoutProcessor.js:149-150`

```js
changeUsd: tipoVenta !== 'VENTA' ? 0 : round2(changeBreakdown?.changeUsdGiven || 0),
changeBs:  tipoVenta !== 'VENTA' ? 0 : round2(changeBreakdown?.changeBsGiven  || 0),
```

Una `VENTA_FIADA` o `VENTA_CASHEA` con abono inicial en efectivo y vuelto entregado registra `change* = 0`. El efectivo salió de la gaveta y el arqueo no lo sabe.

### Mitigación propuesta

El orden importa: **corregir la captura antes que el consumo**. Si se ajustan las fórmulas del cierre sin arreglar G2/G3, se estará compensando un dato que sigue llegando mal.

1. **Persistir el vuelto como partición explícita, no como doble representación.** Guardar `changeGiven: { usd, bs, cop }` donde cada componente sea *lo que físicamente se entregó en esa moneda*, con la invariante `usd·tasa + bs + cop/tasaCop ≈ vueltoTotalBs`. Elimina G1 de raíz.
2. **Fallback por campo, no global** (G2): cada moneda cae a su valor calculado de forma independiente.
3. **Eliminar el `: 0` de `CheckoutModalPOS`** (G3) y usar el vuelto calculado en Bs.
4. **Añadir `changeCop` al circuito completo** (G4): persistencia, bucket `_vuelto_cop` y resta en `expectedCop`.
5. **Registrar el vuelto en todos los `tipoVenta`** (G5).

**Guardarraíl.** Invariante de conservación del efectivo, verificable por venta y acumulada en el cierre:

```
efectivo_entrado − vuelto_entregado = efectivo_neto_en_gaveta
```

Y una comprobación de coherencia del vuelto: la suma del vuelto declarado, convertida a una moneda común, debe igualar el vuelto calculado dentro de la tolerancia de redondeo. Si no cuadra, es anomalía registrada — no un cierre silenciosamente torcido.

### Evaluación del plan propuesto

**Lo que el plan acierta:** el síntoma, su gravedad, que el punto ciego está en el tratamiento del vuelto en operaciones multimoneda, y la necesidad de una suite de regresión de cuadre de caja.

**Lo que el plan atribuye mal:**

- *"`CierreCajaWizard` no descuenta correctamente los vueltos"* — sí los descuenta. `CierreCajaWizard.jsx:59-60` ya aplica `efectivo + apertura − vuelto`, que es la fórmula que el plan propone implementar. Reescribirla no cambia nada: el dato que recibe es el que viene mal.
- *"El sistema exigía `5.570 + 1.301 = 6.871`"* — correcto como observación, pero eso ocurre porque `_vuelto_bs` **no existe en el desglose** (G2/G3), no porque la resta esté mal escrita.
- *"Actualizar `OwnerMonitorView.jsx` para usar la misma fórmula"* — `OwnerMonitorView` **no calcula** el esperado. Lee `reconData.expectedBs` ya persistido por el wizard al cerrar (`OwnerMonitorView.jsx:503-504, 2291, 2400`). Cambiar una fórmula ahí es un no-op. Lo que sí tiene es un fallback dudoso en la línea 2291 (`?? activeC.totalUsd`, ventas brutas como esperado cuando falta `reconData`) y, más importante, **los cierres ya guardados conservarán su `expectedBs` erróneo**: ninguna corrección de código los recalcula.

**Riesgo de regresión en el Componente 1 (importante).** El plan propone que `calculatePaymentBreakdown` devuelva los buckets de efectivo **ya netos**. Eso rompe a un consumidor existente: `DashboardPaymentBreakdown.jsx:24-25` hace

```js
const netoBs  = subtotalBs  - totalVueltoBs;
const netoUsd = subtotalUsd - totalVueltoUsd;
```

Con buckets netos, **restaría el vuelto por segunda vez**. Además, la vista "Medios de Pago" necesita el bruto por método: un bucket neto mezcla dos conceptos distintos (cobrado por método vs. efectivo en gaveta) en un mismo número.

**Alternativa recomendada:** mantener los buckets en bruto y exponer **una sola función** en `FinancialEngine` — `computeExpectedCash(breakdown)` — que devuelva `{ bs, usd, cop }` aplicando `efectivo + apertura − vuelto`. Que la consuman `CierreCajaWizard`, `currentFloat` (hallazgo D) y el generador de cierre. Se resuelve la duplicación de la fórmula sin cambiar la semántica de los buckets ni romper a los consumidores actuales.

---

## Estado de los 10 fallos

| Test | Hallazgo | Naturaleza |
|---|---|---|
| `withLock` — exclusión nativa | A | Bug real |
| `withLock` — exclusión fallback | A | Bug real |
| `FIN-007` ventas concurrentes | A | Bug real — pérdida de venta |
| `FIN-006` abonos concurrentes | A | Bug real — pérdida de abono |
| `HOOK-008` 50 logEvent paralelos | A | Bug real — pérdida de auditoría |
| `HOOK-008` límite MAX_ENTRIES | A | Enmascarado por A |
| `FIN-002` apertura COP | C | Contrato obsoleto |
| `CC1` gasto afectaCaja: true | C | Contrato obsoleto |
| `CC1` autoconsumo | C | Contrato obsoleto |
| `checkoutBsManual` fallback por tasa | F | Contrato obsoleto + dependencia global |

---

## Orden de ataque recomendado

1. **A** — es pérdida de datos activa en el camino de venta. Todo lo demás es secundario.
2. **G2 + G3** — dos líneas, y son las que producen el descuadre fantasma en cada cierre. Arreglar la **captura** antes que cualquier fórmula de consumo.
3. **B** — la corrección es acotada y elimina una clase entera de fallo silencioso.
4. **G1 + G4 + G5** — partición explícita del vuelto, circuito COP completo y vuelto en ventas fiadas.
5. **C** — definir el contrato de `_apertura` y re-baselinear los tres tests contra él.
6. **D** — depende de **C**; se resuelve junto con `computeExpectedCash` (ver G).
7. **E** — unificar el alcance de flujo de caja.
8. **F** — sacar `localStorage` del motor y conciliar el diferencial de redondeo.

**A**, **G2** y **G3** son los tres que están costando dinero hoy: el primero pierde ventas, los otros dos hacen que el cajero responda por efectivo que ya entregó.

## Nota sobre el árbol de trabajo

`src/utils/dailyCloseGenerator.js` tiene cambios sin confirmar. Son de presentación del PDF (renderizado del vuelto en sección propia con color ámbar y cálculo de alto de fila). **Sin impacto financiero** — no tocan importes ni agregaciones.
