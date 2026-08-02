# Plan de Fixes — Auditoría Financiera E2E

Origen: [AUDITORIA_FINANCIERA_E2E.md](AUDITORIA_FINANCIERA_E2E.md), hallazgos **A**–**G**.
Cubre pérdida de ventas por concurrencia, `NaN` en la primitiva de dinero y el descuadre fantasma del cierre de caja.

---

## 0. Estado verificado del árbol (medido, no asumido)

| Comprobación | Resultado |
|---|---|
| `npx eslint --no-cache src tests` | **88 errores**, 1783 warnings |
| Perfil por regla | 79 `no-restricted-syntax`, 4 `no-undef`, 4 `react-hooks/preserve-manual-memoization`, 1 `no-extra-boolean-cast` |
| `npx vitest run` | **10 fallos** / 242 pasan / 10 skipped (262), 5 archivos rojos |
| Árbol sucio al planificar | `src/utils/dailyCloseGenerator.js` (cambios de presentación del PDF, **sin impacto financiero**) |

Los 88 errores de ESLint son **preexistentes** y no son objetivo de este plan. Cualquier número distinto de 88 al cerrar una fase es una regresión.

### Los 10 fallos preexistentes, por raíz

| Test | Raíz | Fase que lo cierra |
|---|---|---|
| `withLock` — exclusión nativa | A | F1 |
| `withLock` — exclusión fallback | A | F1 |
| `financialEngine` — FIN-007 ventas concurrentes | A | F1 |
| `financialEngine` — FIN-006 abonos concurrentes | A | F1 |
| `hooks` — HOOK-008 50 logEvent paralelos | A | F1 |
| `hooks` — HOOK-008 límite MAX_ENTRIES | A | F1 |
| `financialEngine` — FIN-002 apertura COP | C | F5 |
| `shiftScope` — CC1 gasto `afectaCaja: true` | C | F5 |
| `shiftScope` — CC1 autoconsumo | C | F5 |
| `checkoutBsManual` — fallback por tasa | F | F7 |

### Trayectoria esperada del baseline

Es parte del arnés: si una fase no deja el número exacto, **detente**.

| Tras | Fallos vitest | ESLint |
|---|---|---|
| F1 | **4** | 88 |
| F2 | 4 | 88 |
| F3 | 4 | 88 |
| F4 | 4 | 88 |
| F5 | **1** | 88 |
| F6 | 1 | 88 |
| F7 | **0** | 88 |

---

## 1. Hallazgos

| # | Sev | Qué |
|---|---|---|
| A | 🔴 | `withLock` pierde la exclusión mutua intra-pestaña; dos ventas concurrentes → una se pierde |
| G3 | 🔴 | `CheckoutModalPOS` persiste el vuelto en Bs como `0` por defecto |
| G2 | 🔴 | El fallback del vuelto es todo-o-nada: declarar una moneda borra la otra |
| B | 🔴 | `round2` devuelve `NaN` en `[1e-12, 1e-6)` y en `abs >= 1e19` |
| G1 | 🟠 | `changeUsd` y `changeBs` son el mismo vuelto en dos monedas; se descuentan ambos |
| G4 | 🟢 | El vuelto en COP no existe en ningún punto del circuito — **fuera de alcance por D-3**, degradado a guardarraíl |
| G5 | 🟡 | Las ventas que no son `VENTA` persisten el vuelto como `0` |
| C | 🟠 | Contrato de `_apertura`: implementación y tests se contradicen |
| D | 🟠 | `currentFloat` ignora apertura y vuelto, y usa día calendario en vez de turno |
| E | 🟡 | Reportes históricos excluyen `GASTO_INTERNO` del flujo; el dashboard lo incluye |
| F | 🟡 | `localStorage` dentro del motor "puro", comentario que contradice la política real y diferencial de redondeo sin contabilizar |
| **H** | 🔴 | **Deadlock ABBA latente**, hoy enmascarado por A — ver §2.1 |

### 1.1 Decisiones de negocio registradas

Ambas estaban bloqueando fases. Confirmadas por el dueño el **2026-08-01**; quedan aquí para no reconstruirlas desde el historial de conversación.

| # | Pregunta | Decisión | Efecto |
|---|---|---|---|
| D-1 | ¿En qué moneda se entrega el vuelto? | **Tiende a la moneda del pago** (`$5` por una compra de `$1` → `$4` en dólares; pago en Bs → vuelto en Bs), pero **se reparte entre las dos monedas con normalidad**, p. ej. cuando no hay suficientes dólares en caja | Desbloquea **F2**. El reparto es operación corriente, así que el modelo de datos debe ser una **partición de dos componentes**; el defecto por moneda del pago sólo cubre el caso en que el cajero no reparte |
| D-2 | ¿El redondeo de Bs va al múltiplo más cercano o siempre hacia arriba? | **Al múltiplo más cercano** — el código actual es correcto | Desbloquea **F7** y lo reduce: `roundBs` no se toca, se corrige el comentario. `checkoutBsManual` se re-baselinea a `230` |
| D-3 | ¿Se usa COP en este sistema? | **No.** El peso colombiano no se utiliza | Reduce **F4**: no se construye el circuito de `changeCop`. G4 baja a 🟢 y se sustituye por un guardarraíl |

D-2 invierte el diagnóstico original: el defecto no estaba en `roundBs` sino en la documentación que lo describe. `44 → 40` pierde 4 Bs y **eso es intencional**; lo que faltaba era contabilizar el diferencial acumulado, que sigue siendo parte de F7.

**D-3 — evidencia medida antes de decidir el alcance:**

| Comprobación | Resultado |
|---|---|
| `cop_enabled` en `localStorage` | Opt-in (`=== 'true'`): **ausente → desactivado** |
| Pagos COP en los respaldos (`efectivo_cop`, `transferencia_cop`, `amountCop`) | **0 ocurrencias** |
| `tasaCop` / `totalCop` en respaldos | Sólo claves de configuración, sin pagos asociados |

Es decir: COP **nunca se ha usado en producción**. Construir el circuito completo de vuelto en COP sería trabajo para una ruta que no se ejecuta.

**El código COP no se borra.** Lo prohíbe el protocolo del repo (los métodos de fábrica `efectivo_cop` y `transferencia_cop` sólo se ocultan con `copEnabled=false`), y dejarlo inerte es menos arriesgado que extirparlo de siete archivos. Si el negocio reactiva COP algún día, el trabajo pendiente es exactamente el que describe G4 en la auditoría.

---

## 2. Protocolo

Vinculante, igual que en los planes anteriores de este repo:

1. Localizar el código por **anclas de texto**, nunca por número de línea.
2. **Una fase a la vez, un commit por fase.** No adelantar fases.
3. Arnés por fase: `npx eslint --no-cache <archivos tocados>` → `npx vitest run <tests de la fase>` → `npx vitest run` completo → al cerrar el plan, `npm run build`.
4. Comparar contra la **trayectoria esperada** de §0. Un número distinto es una regresión, aunque los tests nuevos pasen.
5. **DETENTE** si el código no coincide con lo que este documento describe: reportar, no improvisar.
6. **Nada de código de migración de datos.** Los cierres ya persistidos conservan su `expectedBs` erróneo; corregirlos retroactivamente es una decisión de negocio, no de este plan (§6.3).

Restricciones vigentes del repo: no tocar la guarda FIN-022; no borrar los métodos de pago COP de fábrica (`efectivo_cop`, `transferencia_cop`), sólo ocultarlos con `copEnabled=false`; SEC-002, SEC-009, SEC-010; `parseFloat` prohibido en código financiero.

### 2.1 Aviso crítico antes de tocar `withLock`

**Arreglar A destapa un deadlock que hoy está enmascarado.** El guard roto convierte toda adquisición anidada en un no-op, así que el sistema nunca ha ejercitado su propio grafo de cerrojos.

Mapa real de adquisiciones (verificado):

| Camino | Orden de cerrojos |
|---|---|
| Anular venta — [voidSaleProcessor.js:27](src/utils/voidSaleProcessor.js#L27) → [:198](src/utils/voidSaleProcessor.js#L198) `cancelSessionBySaleId` → [consumptionSessionService.js:306](src/services/consumptionSessionService.js#L306) | `pos_write_lock` → `consumption_dispatch_lock` |
| Despacho parcial — [DeferredConsumptionModal.jsx:142](src/components/Sales/DeferredConsumptionModal.jsx#L142) → [consumptionSessionService.js:162](src/services/consumptionSessionService.js#L162) → [:234](src/services/consumptionSessionService.js#L234) `recordKardexMovement` → [kardexService.js:49](src/services/kardexService.js#L49) | `consumption_dispatch_lock` → `pos_write_lock` |

Los dos órdenes son **opuestos**. En cuanto la exclusión mutua sea real, una anulación concurrente con un despacho parcial **cuelga las dos operaciones para siempre** — el mutex en memoria no tiene timeout y `navigator.locks` en modo `exclusive` tampoco.

Por eso F1 no se limita a arreglar `withLock`: **colapsa `consumption_dispatch_lock` dentro de `pos_write_lock`** y elimina toda adquisición anidada. Con un único cerrojo de escritura y variantes `Unlocked` para los llamantes internos, el ABBA desaparece por construcción, no por disciplina.

---

## 3. Fases

### F1 🔴 — Un solo cerrojo de escritura, sin adquisiciones anidadas

**Hallazgos:** A, H.

#### Dónde

- [withLock.js:86](src/utils/withLock.js#L86), ancla `const _activeLocksInThread = new Set();`
- [withLock.js:108](src/utils/withLock.js#L108), ancla `if (_activeLocksInThread.has(name)) {`
- [kardexService.js:18](src/services/kardexService.js#L18) `recordKardexMovement`
- [consumptionSessionService.js:15](src/services/consumptionSessionService.js#L15) `createSessionFromSale`, [:150](src/services/consumptionSessionService.js#L150) `registerPartialDispatch`, [:303](src/services/consumptionSessionService.js#L303) `cancelSessionBySaleId`, [:392](src/services/consumptionSessionService.js#L392) `revertDispatchRound`

#### Qué pasa

El `Set` es de módulo, no de contexto asíncrono. No puede distinguir una llamada anidada de una concurrente, así que **el primer llamante toma el cerrojo y cualquier otro concurrente se lo salta entero**. Como [checkoutProcessor.js:168-174](src/utils/checkoutProcessor.js#L168-L174) es un read-modify-write sobre el array completo de ventas, dos ventas simultáneas leen lo mismo y la segunda sobreescribe a la primera: la venta **desaparece**.

El guard es load-bearing: hay reentrancia genuina (`checkoutProcessor` → `recordKardexMovement`, ambos sobre `pos_write_lock`). Borrarlo sin más es deadlock inmediato.

#### Cambio

**Paso 1 — núcleos sin cerrojo.** Para cada función que hoy abre `withLock`, extraer el cuerpo a una variante `…Unlocked` y dejar la pública como fachada:

```js
// kardexService.js
export async function recordKardexMovementUnlocked(params) {
    /* cuerpo actual, sin withLock */
}
export async function recordKardexMovement(params) {
    return withLock('pos_write_lock', () => recordKardexMovementUnlocked(params));
}
```

Mismo patrón en `createSessionFromSale`, `registerPartialDispatch`, `cancelSessionBySaleId`, `revertDispatchRound`, `seedInitialKardexIfEmpty` y `createInventorySnapshot`.

**Paso 2 — los llamantes internos usan la variante `Unlocked`.** Sustituciones exactas:

| Archivo | Llamada actual | Pasa a |
|---|---|---|
| [checkoutProcessor.js:296](src/utils/checkoutProcessor.js#L296) | `recordKardexMovement` | `recordKardexMovementUnlocked` |
| [checkoutProcessor.js:202](src/utils/checkoutProcessor.js#L202) | `createSessionFromSale` | `createSessionFromSaleUnlocked` |
| [voidSaleProcessor.js:167](src/utils/voidSaleProcessor.js#L167) | `recordKardexMovement` | `recordKardexMovementUnlocked` |
| [voidSaleProcessor.js:198](src/utils/voidSaleProcessor.js#L198) | `cancelSessionBySaleId` | `cancelSessionBySaleIdUnlocked` |
| [remoteInventoryProcessor.js:215,303](src/utils/remoteInventoryProcessor.js#L215) | `recordKardexMovement` | `recordKardexMovementUnlocked` |
| [consumptionSessionService.js:81,234,343,436](src/services/consumptionSessionService.js#L81) | `recordKardexMovement` | `recordKardexMovementUnlocked` |

**Paso 3 — colapsar el cerrojo de despacho.** Cambiar `'consumption_dispatch_lock'` por `'pos_write_lock'` en las tres fachadas de `consumptionSessionService`. Justificación: mutan el mismo dominio de almacenamiento que las ventas y el kardex. El coste de rendimiento es irrelevante en un POS de un terminal; el beneficio es que **desaparece el grafo de cerrojos** y con él el ABBA.

**Paso 4 — eliminar el guard.** Borrar `_activeLocksInThread` y el bloque de reentrancia de [withLock.js:107-112](src/utils/withLock.js#L107-L112), y el `finally { _activeLocksInThread.delete(name) }`. `withLock` recupera su semántica original.

> `audit_log_lock` **no** se colapsa: `logEvent` no se llama a sí mismo y no participa en ningún ciclo. Se queda como está, y con el guard eliminado vuelve a serializar de verdad (eso es lo que cierra HOOK-008).

#### Arnés

```bash
npx eslint --no-cache src/utils/withLock.js src/services/kardexService.js src/services/consumptionSessionService.js src/utils/checkoutProcessor.js src/utils/voidSaleProcessor.js src/utils/remoteInventoryProcessor.js
npx vitest run tests/withLock.test.js tests/financialEngine.test.js tests/hooks.test.js
npx vitest run          # debe quedar en 4 fallos
```

**Test nuevo obligatorio** — `tests/withLock.concurrency.test.js`:

- N secciones críticas concurrentes con el mismo nombre no se solapan, para **N = 2, 10 y 50**. Los tests actuales sólo cubren N=2 y N=3; HOOK-008 demuestra que N alto rompe distinto.
- Reentrancia eliminada: `withLock('x', () => withLock('x', fn))` debe **fallar por timeout** en un test con `vi.useFakeTimers`, confirmando que ya no existe un camino anidado en el código de producción.
- **Anti-ABBA:** anular una venta con ficha de consumo mientras corre un despacho parcial, en paralelo, debe completar ambas. Este test es el que protege contra la regresión de §2.1 — sin él, F1 puede colgar producción sin que la suite se entere.

#### Guardarraíl

Regla ESLint (o test de invariante que recorra `src/`) que prohíba llamar a una fachada con cerrojo desde dentro de otro `withLock`. La lista de funciones-fachada se declara explícita; añadir una nueva sin su variante `Unlocked` debe romper el arnés.

#### Riesgo y mitigación

| Riesgo | Mitigación |
|---|---|
| Deadlock por una anidación no detectada | El test de reentrancia por timeout la caza; ejecutar con `--testTimeout=5000` para que falle rápido en vez de colgar CI |
| Una fachada queda sin usar su `Unlocked` y serializa de más | No es corrupción, sólo lentitud; el guardarraíl de ESLint lo detecta |
| `navigator.locks` no disponible → fallback en memoria sin exclusión entre pestañas | Preexistente y documentado en el módulo; fuera de alcance |

---

### F2 🔴 — El vuelto en Bs deja de perderse en la captura

**Hallazgos:** G2, G3. **Dos líneas, y son las que producen el descuadre fantasma.**

#### Dónde

- [CheckoutModalPOS/index.jsx:359-360](src/components/Sales/CheckoutModalPOS/index.jsx#L359-L360), ancla `changeUsdGiven: distVueltoUSD ? parseFloat(distVueltoUSD) : cambioUSD,`
- [useCheckoutCalculations.js:173-174](src/hooks/useCheckoutCalculations.js#L173-L174), ancla `const defaultUsdChange = (!changeUsdGiven && !changeBsGiven)`

#### Qué pasa

En el modal POS la rama USD cae al vuelto calculado y **la rama Bs cae a `0` literal**. Todo vuelto en bolívares que el cajero no teclee se persiste como cero, y el arqueo exige efectivo que ya salió de la gaveta.

En el hook, el fallback evalúa **ambos** campos a la vez: basta escribir en uno para que el otro pase a `safeParse('') === 0`. Un campo vacío significa "no lo especifiqué", no "cero entregado".

Reproducido en la auditoría: apertura `Bs 5.570` + venta de `Bs 398` pagada con billete de `Bs 500` → esperado `6.070` en vez de `5.968`.

#### Cambio

⚠️ **La corrección obvia es incorrecta.** El impulso natural es hacer que la rama Bs caiga a un `cambioBS`, simétrico de `cambioUSD`. No se puede, por dos razones verificadas:

1. **`cambioBS` no existe.** En `CheckoutModalPOS` sólo hay `cambioUSD` ([:156](src/components/Sales/CheckoutModalPOS/index.jsx#L156)) y `tasaSegura`. El equivalente en Bs se obtendría como `mulR(cambioUSD, tasaSegura)` — ver [:193](src/components/Sales/CheckoutModalPOS/index.jsx#L193).
2. **Rellenar ambas con el total sería G1.** `cambioUSD` y su equivalente en Bs son **el mismo vuelto expresado dos veces**. Persistir las dos hace que el wizard descuente en ambas monedas: se cambiaría un descuadre visible por uno silencioso en la otra moneda. Es exactamente el error que ya comete [useCheckoutCalculations.js:173-174](src/hooks/useCheckoutCalculations.js#L173-L174) cuando ambos campos están vacíos.

El valor por defecto tiene que ser una **partición**: el vuelto entero en **una** moneda y `0` en la otra. Cuál sea esa moneda es una decisión con contenido de negocio.

**Regla del negocio (confirmada por el dueño, 2026-08-01):**

> El vuelto **tiende** a entregarse en la misma moneda en que el cliente pagó: si paga con `$5` una compra de `$1`, se le devuelven `$4` en efectivo en dólares; si paga en Bs, el vuelto es en Bs.
> Pero **el vuelto se reparte entre las dos monedas con normalidad** — por ejemplo cuando no hay suficientes dólares en la caja, parte se devuelve en `$` y el resto en Bs.

Esto es determinante para el diseño: **el reparto entre monedas es operación corriente, no un caso excepcional.** Por tanto:

- El modelo de datos **tiene que ser una partición de dos componentes**, no una moneda con un valor y la otra en cero. Esto es exactamente lo que G1 rompe hoy al persistir el vuelto completo en ambas monedas a la vez.
- Los campos de reparto (`distVueltoUSD` / `distVueltoBS`) son el **camino normal**, no una intervención rara. Siguen mandando sobre el valor por defecto.
- El valor por defecto sólo cubre el caso en que el cajero no reparte nada, y ahí lo sensato es la moneda del pago.

La invariante que gobierna todo lo demás:

```
vueltoUsd · tasa + vueltoBs  ≈  vueltoTotalEnBs     (dentro de la tolerancia de redondeo)
```

Ni `vueltoUsd` ni `vueltoBs` pueden contener por sí solos el vuelto completo salvo que el otro sea cero. **El sistema no puede saber cuántos billetes físicos hay en la gaveta**, así que la decisión de repartir es siempre del cajero; lo que el sistema debe garantizar es que lo repartido sume exactamente el vuelto.

```js
// CheckoutModalPOS/index.jsx — partición según la moneda del efectivo recibido
const vueltoEnBs = /* el efectivo recibido es predominantemente en Bs */;
changeUsdGiven: distVueltoUSD ? parseFloat(distVueltoUSD) : (vueltoEnBs ? 0 : cambioUSD),
changeBsGiven:  distVueltoBS  ? parseFloat(distVueltoBS)  : (vueltoEnBs ? round2(mulR(cambioUSD, tasaSegura)) : 0),
```

```js
// useCheckoutCalculations.js — fallback por campo, y sólo la moneda que corresponde
const defaultUsdChange = changeUsdGiven ? round2(CurrencyService.safeParse(changeUsdGiven))
                                        : (isPureBsPayment ? 0 : changeUsd);
const defaultBsChange  = changeBsGiven  ? round2(CurrencyService.safeParse(changeBsGiven))
                                        : (isPureBsPayment ? changeBs : 0);
```

**Pago mixto en efectivo** (parte en `$`, parte en Bs): el defecto va a la moneda del **mayor componente en efectivo**, convertido a una base común para comparar. En caso de empate, Bs. El cajero puede repartir a mano igual que en cualquier otro caso.

Con esta forma, F2 corrige G2 y G3 **sin activar G1**. F4 formaliza después el modelo `changeGiven` y cubre COP y los tipos de venta restantes.

> **Dependencia operativa con F5.** La excepción "no hay dólares en la caja" se apoya en que el cajero **vea** que no los hay. Ese aviso es la advertencia anti-sobregiro de [CheckoutModal.jsx:430](src/components/Sales/CheckoutModal.jsx#L430), que hoy está rota por el hallazgo D: `currentFloat` ignora la apertura y no resta el vuelto ya entregado, así que avisa cuando sí hay efectivo y calla cuando la caja ya se vació. Hasta que F5 la arregle, la excepción depende sólo del criterio del cajero.

#### Arnés

```bash
npx eslint --no-cache src/components/Sales/CheckoutModalPOS/index.jsx src/hooks/useCheckoutCalculations.js
npx vitest run tests/cashReconciliation.test.js
npx vitest run          # sigue en 4
```

**Test nuevo obligatorio** — `tests/cashReconciliation.test.js`, con el caso real de la auditoría:

1. Apertura `Bs 5.570`, venta `Bs 398`, pago con `Bs 500`, vuelto `Bs 102` → `expectedBs === 5968`, diferencia `0` al declarar `5968`.
2. Cajero declara el vuelto **sólo** en USD → el vuelto en Bs no se pierde (antes: `0`).
3. Pago en Bs sin tocar ningún campo → `changeBs = 102`, `changeUsd = 0`.
4. **Pago en `$` sin tocar ningún campo:** compra de `$1` pagada con `$5` → `changeUsd = 4`, `changeBs = 0`. El vuelto no puede saltar de moneda por su cuenta.
5. **Vuelto repartido entre las dos monedas** (caso corriente, no excepción): del mismo vuelto de `$4`, el cajero entrega `$2` en efectivo y el resto en Bs → `changeUsd = 2`, `changeBs = 2 × tasa`. `expectedUsd` baja `2`, `expectedBs` baja `2 × tasa`, y **la suma equivale a un solo vuelto de `$4`**.
6. **Sin dólares en caja:** todo el vuelto en Bs → `changeUsd = 0`, `changeBs = 4 × tasa`, y `expectedUsd` **no baja**.
7. **Pago mixto en efectivo** → el defecto cae en la moneda del mayor componente.
8. **Anti-G1 (el test que sostiene la fase):** en ningún caso la suma de los componentes convertida a una base común puede exceder el vuelto calculado. Hoy, con ambos campos vacíos, lo **duplica**.

#### Guardarraíl

Dos invariantes por venta, verificables en test:

- **No-pérdida:** ningún camino de checkout persiste `changeBs === 0` cuando el vuelto calculado en Bs supera la tolerancia de redondeo.
- **Partición:** el vuelto persistido, convertido a una moneda común, equivale a **un solo** vuelto — nunca a dos representaciones del mismo.

---

### F3 🔴 — `round2` deja de devolver `NaN`

**Hallazgo:** B.

#### Dónde

[dinero.js:29-37](src/utils/dinero.js#L29-L37), ancla `const shifted = Number(\`${abs}e${decimals}\`);`

#### Qué pasa

El desplazamiento por string asume que `String(number)` nunca usa notación exponencial. Cuando la usa, se concatenan dos exponentes (`"5e-7" + "e2"`) y `Number()` da `NaN`. Dos ventanas:

- **Baja `[1e-12, 1e-6)`** — el guard corta por debajo de `1e-12`, dejando la ventana abierta. `divR(0.05, 100000)` → `NaN`.
- **Alta `abs >= 1e19`** — falla el **segundo** template, porque `Math.round(shifted)` se estringa en exponencial a partir de `1e21`.

`NaN` no lanza: se propaga. `calculatePaymentBreakdown` filtra por `roundedTotal !== 0`, que es `true` para `NaN`, así que el bucket **sobrevive con total `NaN`** hasta el PDF de cierre.

#### Cambio

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

Normalizar a exponencial **antes** de concatenar hace que el exponente se sume numéricamente en vez de textualmente.

**Validado durante la auditoría:** cierra ambas ventanas; **cero regresiones** en el barrido `1..200.000` con offset `.005`; conserva round-half-away-from-zero (`2.005 → 2.01`, `−2.005 → −2.01`, `2.675 → 2.68`); `round0(2.5) = 3`, `round3(1.0005) = 1.001`, `round4(0.00005) = 0.0001`.

El `+ 0` no es cosmético: sin él `_shiftRound(-5e-7, 2)` devuelve `-0`, y como `Object.is(-0, 0)` es `false`, un `toBe(0)` falla y el PDF puede imprimir `"-0"`.

#### Arnés

```bash
npx eslint --no-cache src/utils/dinero.js
npx vitest run tests/dinero.test.js
npx vitest run          # sigue en 4
```

**Tests nuevos** en `tests/dinero.test.js`: fronteras `1e-13`, `1e-12`, `1e-7`, `1e-6`, `1e18`, `1e19`, `1e21`, `1e22`; signo negativo en la ventana baja; barrido de no-regresión `1..200.000` con offset `.005`.

#### Guardarraíl

**Tripwire de `NaN` en las primitivas.** Si el resultado no es finito partiendo de entradas finitas: `throw` en DEV, y en producción registrar anomalía de auditoría y devolver `0`. Un `NaN` en el núcleo financiero no puede volver a ser silencioso.

---

### F4 🟠 — Partición explícita del vuelto

**Hallazgos:** G1, G5. (G4/COP queda fuera de alcance por **D-3**; se sustituye por un guardarraíl.)

#### Dónde

- [useCheckoutCalculations.js:101-102](src/hooks/useCheckoutCalculations.js#L101-L102), ancla `const changeUsd = Math.max(0, subR(`
- [checkoutProcessor.js:149-150](src/utils/checkoutProcessor.js#L149-L150), ancla `changeUsd: tipoVenta !== 'VENTA' ? 0 :`
- [FinancialEngine.js:353-360](src/core/FinancialEngine.js#L353-L360), ancla `if (safeChangeUsd > 0) {`

#### Qué pasa

**G1.** `changeUsd` y `changeBs` no son la partición del vuelto por moneda: son el **total** del vuelto expresado en USD y en Bs. En una venta pagada en Bs con vuelto en Bs, ambos son positivos y describen el mismo billete. Al persistirse los dos, el wizard descuenta cada uno de su bucket: el esperado en dólares baja por dólares que nunca salieron. Con el escenario de la auditoría, `expectedUsd` llega a **`−1,27`**.

**G5.** `tipoVenta !== 'VENTA'` fuerza el vuelto a `0`: una `VENTA_FIADA` con abono en efectivo y vuelto entregado no lo registra.

**G4 (fuera de alcance).** `changeCop` no lo escribe nadie, no existe el bucket `_vuelto_cop`, `expectedCop` no resta vuelto alguno y [dailyCloseGenerator.js:437](src/utils/dailyCloseGenerator.js#L437) lee un campo siempre `undefined`. Por **D-3** no se construye el circuito: COP no se usa y nunca se usó. El riesgo no es que esté roto, sino que **se active sin que nadie lo note**; eso lo cubre el guardarraíl de más abajo.

#### Cambio

**Modelo de datos.** Persistir el vuelto como partición, no como doble representación:

```js
changeGiven: { usd: <entregado en $>, bs: <entregado en Bs> }
```

con la invariante `usd·tasa + bs ≈ vueltoTotalBs` dentro de la tolerancia de redondeo. La clave `cop` **se reserva en el esquema pero no se puebla**: dejarla prevista evita un cambio de forma si D-3 se revierte algún día.

Mantener `changeUsd` / `changeBs` como campos derivados **sólo de lectura** para las ventas históricas; el motor pasa a leer `changeGiven` cuando existe y a caer a los campos viejos cuando no.

- `checkoutProcessor`: eliminar la condición `tipoVenta !== 'VENTA'`; el vuelto se registra en todos los tipos.
- **Guardarraíl COP en lugar del circuito:** si aparece un pago o un vuelto en COP mientras `cop_enabled` es `false`, registrar anomalía de auditoría. Convierte una funcionalidad no construida en una **detectada**, en vez de un cierre torcido en silencio el día que alguien active el flag.

#### Arnés

```bash
npx eslint --no-cache src/hooks/useCheckoutCalculations.js src/utils/checkoutProcessor.js src/core/FinancialEngine.js
npx vitest run tests/cashReconciliation.test.js tests/financialEngine.test.js
npx vitest run          # sigue en 4
```

**Tests nuevos** en `tests/cashReconciliation.test.js`:

1. Pago en Bs con vuelto en Bs → `expectedUsd` **no se mueve** (cierra G1).
2. Pago en USD con vuelto repartido entre `$` y Bs → cada moneda descuenta lo suyo, y la suma equivale a un solo vuelto.
3. `VENTA_FIADA` con abono en efectivo y vuelto → queda registrado (cierra G5).
4. **Compatibilidad hacia atrás:** una venta histórica sin `changeGiven` sigue produciendo el mismo desglose que hoy.
5. **Guardarraíl COP:** un pago en COP con `cop_enabled = false` genera anomalía y no altera el cuadre.

#### Guardarraíl

Invariante de conservación del efectivo, por venta y acumulada en el cierre:

```
efectivo_entrado − vuelto_entregado = efectivo_neto_en_gaveta
```

Y coherencia del vuelto: la suma de `changeGiven` convertida a una moneda común debe igualar el vuelto calculado dentro de la tolerancia. Si no cuadra → anomalía registrada, no un cierre torcido en silencio.

---

### F5 🟠 — Una sola fórmula del efectivo esperado

**Hallazgos:** C, D. Cierra los 3 fallos de contrato (`FIN-002`, `CC1` ×2).

#### Dónde

- [FinancialEngine.js:147-159](src/core/FinancialEngine.js#L147-L159), ancla `if (sale.tipo === 'APERTURA_CAJA') {`
- [CierreCajaWizard.jsx:59-61](src/components/Dashboard/CierreCajaWizard.jsx#L59-L61), ancla `const expectedUsd = round2(`
- [SalesView.jsx:321-333](src/views/SalesView.jsx#L321-L333), ancla `const currentFloat = useMemo(`

#### Qué pasa

La cabecera del motor declara *"FIN-002: Apertura COP entra al breakdown de efectivo_cop"*, pero la implementación manda `APERTURA_CAJA` al bucket `_apertura` y hace `return`. El rediseño (`e9e1034`) es **defendible** — separar fondo de apertura de ingresos por ventas es correcto contablemente — pero dejó tres tests rojos como contrato obsoleto, y con ellos rojos la suite ya no protege ese camino.

Peor: el rediseño quedó **incompleto**. `CierreCajaWizard` compensa correctamente; `currentFloat` no. Éste ignora la apertura, no resta el vuelto ya entregado y filtra por día calendario en vez de por turno, así que **a medianoche el efectivo disponible se reinicia a cero a mitad de turno**. Alimenta la advertencia anti-sobregiro de [CheckoutModal.jsx:430](src/components/Sales/CheckoutModal.jsx#L430), que por eso falla en ambas direcciones.

#### Cambio

**Decisión de contrato (explícita):** `_apertura` y `_vuelto_*` son **buckets de metadatos que todo consumidor debe integrar**. Los buckets de método siguen en **bruto**.

Añadir a `FinancialEngine` una única función:

```js
static computeExpectedCash(breakdown) {
    // { bs, usd, cop } = efectivo + apertura − vuelto, por moneda
}
```

Consumidores que pasan a usarla: `CierreCajaWizard` (sustituye sus tres líneas), `currentFloat` en `SalesView` y el generador de cierre. `currentFloat` además pasa a alimentarse de `getOpenShiftMovements`, no de un filtro por día.

Documentar la obligación en la cabecera del motor, junto a `FIN-002`. Re-baselinear `FIN-002` y los dos `CC1` contra este contrato.

> **No** adoptar la variante de "buckets ya netos". `DashboardPaymentBreakdown.jsx:24-25` hace `netoBs = subtotalBs − totalVueltoBs`: con buckets netos **restaría el vuelto por segunda vez**, y la vista "Medios de Pago" necesita el bruto por método.

#### Arnés

```bash
npx eslint --no-cache src/core/FinancialEngine.js src/components/Dashboard/CierreCajaWizard.jsx src/views/SalesView.jsx
npx vitest run tests/financialEngine.test.js tests/shiftScope.test.js tests/cashReconciliation.test.js
npx vitest run          # debe bajar a 1
```

**Tests nuevos:** turno que cruza medianoche → `currentFloat` no se reinicia; `computeExpectedCash` da el mismo número que la fórmula del wizard para un juego fijo de movimientos; `DashboardPaymentBreakdown` sigue mostrando el neto correcto (anti-doble-resta).

#### Guardarraíl

Test que enumere los consumidores de `calculatePaymentBreakdown` y verifique que **cada uno** integra `_apertura` y `_vuelto_*`, o declare por qué no. Hoy esa obligación es tácita y ya hay un consumidor que la incumple.

---

### F6 🟡 — Un solo predicado de flujo de caja

**Hallazgo:** E.

#### Dónde

- [reportsProcessor.js:14-19](src/utils/reportsProcessor.js#L14-L19), ancla `// Flujo de Dinero (para Desglose de Pagos, incluye pagos de deudas)`
- `groupSalesByCierreId`, ancla `const salesForCashFlow = c.sales.filter(`
- [useDashboardMetrics.js:18](src/hooks/useDashboardMetrics.js#L18), ancla `const shiftCashFlow = shiftScope.movements;`

#### Qué pasa

El dashboard en vivo usa `shiftScope.movements`, que **incluye** `APERTURA_CAJA` y `GASTO_INTERNO`. Los reportes históricos los excluyen del filtro. `FinancialEngine` **sí sabe** descontar un `GASTO_INTERNO` con `afectaCaja: true` — simplemente nunca le llegan.

Resultado: el mismo turno, visto en el reporte histórico, muestra **más efectivo recibido** que el que mostró el dashboard, por el monto exacto de los gastos internos. Dos números oficiales que no cuadran entre sí.

#### Cambio

Exportar `isCashFlowMovement(sale)` desde `shiftScope` y usarlo en `reportsProcessor` (ambos sitios) y en `useDashboardMetrics`. Que tres consumidores decidan por su cuenta qué es "flujo de caja" es la causa estructural.

#### Arnés

```bash
npx eslint --no-cache src/utils/reportsProcessor.js src/hooks/useDashboardMetrics.js src/utils/shiftScope.js
npx vitest run tests/shiftScope.test.js tests/cashReconciliation.test.js
npx vitest run          # sigue en 1
```

**Test nuevo:** para un juego fijo de movimientos, el desglose del dashboard en vivo y el del reporte histórico del mismo rango son **idénticos**.

---

### F7 🟡 — Redondeo de Bs explícito y conciliado

**Hallazgo:** F. Cierra el último fallo (`checkoutBsManual`).

#### Dónde

- [productProcessor.js:189-191](src/utils/productProcessor.js#L189-L191), ancla `const activeStep = bsRoundingStep !== null`
- [productProcessor.js:246-252](src/utils/productProcessor.js#L246-L252), ancla `case 'tasa_dia':`
- [dinero.js:75-79](src/utils/dinero.js#L75-L79), ancla `export const roundBs =`
- [dinero.js:83](src/utils/dinero.js#L83), ancla `Política del POS para precios en Bolívares` (JSDoc de `ceilR`)

#### Qué pasa

Tres cosas distintas:

1. **Dependencia global oculta.** `FinancialEngine.buildCartTotals` está documentado como motor puro, pero vía `calculatePricing` lee `localStorage` en cada ítem de cada llamada. El resultado depende del entorno, no de los argumentos: por eso el test espera `225` y obtiene `230`.
2. **La documentación contradice al código.** `roundBs` usa `Math.round(n/step)*step` — al múltiplo **más cercano**: `45 → 50` (+5) pero `44 → 40` (−4). La frase que documenta la política contraria está en el **JSDoc de `ceilR`**, [dinero.js:83](src/utils/dinero.js#L83): *"Política del POS para precios en Bolívares (siempre redondear Bs hacia arriba)"*. Pero `tasa_dia` no usa `ceilR`, usa `roundBs`.

   **Decisión del dueño (2026-08-01): la política correcta es el múltiplo más cercano, tal como está el código.** El defecto, por tanto, **no es el redondeo: es el comentario**. Se corrige la documentación y `roundBs` no se toca. Esto reduce el alcance de F7 y elimina cualquier riesgo de alterar precios en producción.
3. **El diferencial no se contabiliza.** `subtotalUsd 5` / `subtotalBs 230` a tasa `45` implica una tasa efectiva de `46`: **+2,2%** que no aparece como ingreso, descuento ni ajuste.

#### Cambio

- `bsRoundingStep` se pasa **explícitamente** desde la capa de UI/config. El motor no lee `localStorage` nunca. Esto vuelve `buildCartTotals` determinista y reparable en test.
- **Corregir el JSDoc de `ceilR`**, ancla `Política del POS para precios en Bolívares` ([dinero.js:83](src/utils/dinero.js#L83)): esa frase describe una política que el sistema no aplica. La política real (múltiplo más cercano) vive en `roundBs`, y ahí es donde debe documentarse. **`roundBs`, `ceilR` y `calculatePricing` no cambian de comportamiento** — sólo el texto.
- Registrar el diferencial `round2(totalBs − totalUsd × tasa)` como campo de la venta, sumable en el cierre. Con redondeo al más cercano el diferencial es de signo variable, así que **el acumulado del turno es la cifra que importa**, no el de cada línea.
- **Re-baselinear `checkoutBsManual`.** El test espera `225` (conversión cruda) y obtiene `230` porque el step por defecto es `10`. Con la política confirmada, `230` es el resultado **correcto**. El test pasa a inyectar `bsRoundingStep` de forma explícita: con `step = 0` debe dar `225`, con `step = 10` debe dar `230`. Deja de depender del `localStorage` del entorno.

#### Arnés

```bash
npx eslint --no-cache src/utils/productProcessor.js src/utils/dinero.js src/core/FinancialEngine.js
npx vitest run tests/checkoutBsManual.test.js tests/dinero.test.js
npx vitest run          # debe llegar a 0
npm run build
```

#### Guardarraíl

Invariante de conciliación en el cierre: `|totalBs − totalUsd × tasa|` no puede exceder `nº de líneas × step`. Por encima → anomalía registrada. Atrapa tanto errores de tasa como redondeos descontrolados.

---

## 4. Guardarraíles permanentes

Sobreviven al plan. Cada uno nace en una fase pero se queda como red del sistema.

| # | Guardarraíl | Nace en |
|---|---|---|
| GR-1 | Exclusión mutua verificada a N = 2, 10 y 50 | F1 |
| GR-2 | Test anti-ABBA: anulación + despacho concurrentes completan | F1 |
| GR-3 | Prohibido llamar a una fachada con cerrojo dentro de otro `withLock` | F1 |
| GR-4 | Ningún checkout persiste `changeBs === 0` con vuelto real en Bs | F2 |
| GR-5 | Tripwire de `NaN`: throw en DEV, anomalía en producción | F3 |
| GR-6 | Conservación del efectivo: `entrado − vuelto = neto en gaveta` | F4 |
| GR-7 | Coherencia del vuelto declarado vs. calculado: los componentes suman **un solo** vuelto | F4 |
| GR-7b | Pago o vuelto en COP con `cop_enabled = false` → anomalía registrada | F4 |
| GR-8 | Todo consumidor del desglose integra `_apertura` y `_vuelto_*` | F5 |
| GR-9 | Dashboard vivo y reporte histórico dan el mismo desglose | F6 |
| GR-10 | Conciliación `totalBs` vs `totalUsd × tasa` | F7 |

---

## 5. Mitigación de errores

### 5.1 Qué hacer si una fase se tuerce

| Síntoma | Causa probable | Acción |
|---|---|---|
| La app se cuelga al anular una venta | ABBA de §2.1: quedó una adquisición anidada | Revertir F1 completa. **No parchear con timeouts.** Volver con el mapa de cerrojos en la mano |
| Una operación tarda mucho más | Una fachada no usa su variante `Unlocked` y serializa de más | No es corrupción. Localizar con GR-3 y corregir |
| El cuadre queda corto en USD tras F2 | Se implementó el fallback rellenando **ambas** monedas: es G1 | Volver a §F2. El defecto es una partición, no dos representaciones. **No "compensar" a mano** |
| Aparecen fallos nuevos fuera de la fase | Regresión | Revertir el commit de la fase. La trayectoria de §0 es el criterio, no la intuición |
| `NaN` en un reporte tras F3 | El tripwire está haciendo su trabajo | Leer la anomalía registrada: apunta a la entrada real, no a `dinero.js` |

### 5.2 Reversibilidad

Un commit por fase, en el orden de §3, hace que cada fase sea revertible con un único `git revert` sin arrastrar a las demás. **Excepción:** F4 depende de F2 y F5 depende de F4. Revertir F2 obliga a revertir F4 y F5.

Ninguna fase escribe migraciones ni altera datos ya persistidos, así que **revertir código restaura el comportamiento anterior por completo**. Las ventas creadas mientras F2/F4 estaban activas conservan su `changeGiven`, que el motor sabe leer o ignorar según la versión.

### 5.3 Lo que este plan deliberadamente NO arregla

- **Los cierres históricos ya persistidos conservan su `expectedBs` erróneo.** Ninguna fase los recalcula. Corregirlos retroactivamente cambia cifras de arqueo ya firmadas por un cajero: **es decisión de negocio**, y exigiría el código de migración que el protocolo prohíbe.

  Afecta a **dos** consumidores, no sólo al monitor:

  | Consumidor | Cómo lee el esperado |
  |---|---|
  | `OwnerMonitorView` | `reconData.expectedBs` persistido ([:503-504](src/views/OwnerMonitorView.jsx#L503-L504), [:2400](src/views/OwnerMonitorView.jsx#L2400)) |
  | **PDF de cierre** | `reconData.expectedBs ?? reconData.expectedCashBs ?? todayTotalBs` ([dailyCloseGenerator.js:250-251](src/utils/dailyCloseGenerator.js#L250-L251)) |

  Consecuencia práctica: **reimprimir el PDF de un cierre antiguo seguirá mostrando la cifra vieja** (`Bs 6.871`, no `Bs 6.210`). Sólo los cierres generados **después** de desplegar F2+F5 saldrán correctos. Conviene avisar al dueño antes del despliegue, porque durante un tiempo convivirán PDFs con dos criterios distintos.

  El PDF arrastra además el mismo fallback dudoso que el monitor: si falta `reconData.expectedBs`, cae a `todayTotalBs` — ventas brutas como efectivo esperado. Queda documentado, sin tocar.
- **El fallback de [OwnerMonitorView.jsx:2291](src/views/OwnerMonitorView.jsx#L2291)** (`?? activeC.totalUsd`, ventas brutas como esperado cuando falta `reconData`) queda documentado pero sin tocar: es una vista de monitoreo, no una fuente de verdad contable.
- **El circuito de vuelto en COP** (G4), por **D-3**. El código COP existente queda inerte, no se borra: lo prohíbe el protocolo del repo y su reactivación futura debe seguir siendo barata. Lo que sí se añade es el guardarraíl GR-7b, para que activar `cop_enabled` sin construir el circuito se detecte en vez de torcer un cierre.
- **Los 88 errores de ESLint** preexistentes.
- **La exclusión mutua entre pestañas** cuando `navigator.locks` no está disponible: el fallback en memoria es por definición intra-pestaña.

---

## 6. Riesgos

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | F1 destapa el ABBA y cuelga el POS | **Media** | **Crítico** | Paso 3 de F1 colapsa los cerrojos; GR-2 lo prueba antes de mergear |
| R2 | F2 mal implementada convierte el descuadre en Bs en uno silencioso en USD | **Alta** | Alto | §F2 explica por qué la corrección obvia falla; el test anti-G1 lo bloquea |
| R3 | Adoptar "buckets netos" rompe el dashboard | Baja | Alto | §F5 lo prohíbe explícitamente y explica por qué |
| R4 | ~~La política de redondeo de F7 se elige sin el dueño~~ | — | — | **Resuelto:** múltiplo más cercano, confirmado el 2026-08-01. F7 sólo corrige el comentario |
| R5 | Un cierre en curso durante el despliegue | Baja | Alto | Desplegar con la caja cerrada |
| R6 | `changeGiven` en ventas nuevas leído por una versión vieja | Baja | Bajo | Los campos `changeUsd`/`changeBs` se mantienen derivados |

---

## 7. Si algo no encaja

Si al abrir un archivo el código no coincide con lo que este documento describe — anclas ausentes, funciones renombradas, una fase ya aplicada a medias — **detente y reporta**. No improvisar sobre un árbol distinto del que se auditó.

En particular, **detente** si:

- No existe una forma fiable de determinar la moneda predominante del efectivo recibido en `CheckoutModalPOS` (F2). Sin eso, el valor por defecto sería una suposición sobre dinero físico.
- Aparece un cuarto cerrojo, o un `withLock` con un nombre no listado en §2.1 (F1).
- Los 10 fallos de partida no son exactamente los de §0 — significa que el árbol se movió y la trayectoria esperada ya no aplica.

---

## 8. Revisión externa (2026-08-01) — qué se aceptó y qué no

Este plan fue revisado por otra herramienta. Se comprobó cada objeción contra el código; el resultado se registra aquí para que no haya que re-litigarlo.

### Aceptadas

| # | Objeción | Verificación | Acción |
|---|---|---|---|
| C4 | El comentario de política de redondeo no está en `dinero.js:85-86` | ✅ Cierta. La frase está en la **línea 83**, dentro del JSDoc de `ceilR`; 85-86 son `@param`/`@returns` | Ancla corregida en **F7** |
| C5 | El plan cita `OwnerMonitorView` pero omite el generador de PDF | ✅ Cierta. [dailyCloseGenerator.js:250-251](src/utils/dailyCloseGenerator.js#L250-L251) también lee `reconData.expectedBs` persistido | Añadido a **§5.3** con la tabla de ambos consumidores |
| — | "Usar sólo anclas de texto, nunca el número de línea" | ✅ De acuerdo | Ya es la regla 1 del **§2**. Los números son orientativos |

### Rechazadas, con evidencia

**C1 — «`consumptionSessionService.js:15` es incorrecta; la función empieza en la 64».** Falso.

```
15:export async function createSessionFromSale(sale, cartItem) {
64:    return await withLock('pos_write_lock', async () => {
```

La línea 15 **es** la declaración de la función. La 64 es el `withLock` que abre *dentro* de ella. El ancla original es correcta.

**Mecanismo del fallo de `withLock`** — la revisión afirma que *"la primera corrutina vacía el `Set` en su `finally` antes de que llegue la segunda, así que ambas lo encuentran vacío"*. Es incorrecto, y además se contradice: si ambas lo encontraran vacío, **ambas tomarían el cerrojo y se serializarían bien** — no habría bug.

El `finally` corre cuando la primera llamada **termina**, no antes de que llegue la segunda. `_activeLocksInThread.add(name)` es síncrono y ocurre antes del primer `await`, así que toda llamada concurrente posterior encuentra el nombre **presente**. Replicando el guard exacto con 3 llamadas concurrentes:

```
llamada ve el Set vacio -> toma el cerrojo
llamada ve el Set CON el nombre -> SE SALTA EL CERROJO
llamada ve el Set CON el nombre -> SE SALTA EL CERROJO

Orden resultante: start_2, start_3, start_1, end_2, end_3, end_1   ← solapado
```

Coincide con el fallo real de `tests/withLock.test.js`. **El mecanismo importa porque determina el arreglo:** el problema no es una carrera sobre el `Set`, es que el guard no puede distinguir reentrancia de concurrencia. Por eso la solución es eliminar la anidación (F1), no sincronizar mejor el `Set`.

**«F3: el bug de la ventana baja ya tiene guard → reducir alcance».** Falso, y es la objeción más peligrosa. El guard es `abs < 1e-12`, y la ventana de `NaN` es `[1e-12, 1e-6)` — **por encima** del guard, no dentro. Medido:

```
1e-13   → 0     (el guard lo salva)
1e-12   → NaN
5e-7    → NaN
9.99e-7 → NaN
1e-6    → 0
divR(0.05, 100000) → NaN
```

La revisión tampoco menciona la **ventana alta** (`abs >= 1e19`), que falla por el segundo template y también está reproducida. **F3 mantiene su alcance completo.**

---

## 9. Auditoría de la implementación y reparación (2026-08-01)

El plan se implementó desde otro IDE. Auditado fase por fase: **5 de 7 correctas**, con dos fallos graves y tres guardarraíles ausentes. Todo lo de abajo ya está reparado y verificado.

### Estado final medido

| Comprobación | Antes de reparar | Después |
|---|---|---|
| `npx vitest run` | 29 archivos, 266 pasan, 0 fallos | **30 archivos, 270 pasan, 0 fallos** |
| `npx eslint --no-cache src tests` | 81 errores | **81 errores** (sin regresión) |
| `npm run build` | — | **✓ 31,76 s, PWA generada** |

> El baseline bajó de 88 a 81 errores durante la implementación. Comprobado que **no** hay `eslint-disable` nuevos ni cambios en `eslint.config.js`: es mejora real (`no-restricted-syntax` 79→72), no silenciamiento.

### 🔴 Reparado — dos auto-deadlocks que F1 dejó vivos

`src/hooks/useGastosInternos.js` nunca se tocó durante la implementación. Seguía llamando a la fachada **con** cerrojo desde dentro de `withLock('pos_write_lock')`:

| Función | Abre cerrojo | Llamaba a |
|---|---|---|
| `registrarAutoconsumo` | línea 91 | `recordKardexMovement` (línea 151) |
| `anularGasto` | línea 198 | `recordKardexMovement` (línea 214) |

Con el guard de reentrancia eliminado, esto es un **auto-deadlock permanente**. Probado replicando el mutex real:

```
[outer] cerrojo tomado, entrando a Kardex...
Resultado: TIMEOUT-DEADLOCK        ← el inner nunca ejecuta
```

Registrar un autoconsumo o anular un gasto colgaba el POS para siempre. **Ambas llamadas migradas a `recordKardexMovementUnlocked`.** Barrido posterior sobre todo `src/`: no queda ninguna otra anidación.

### 🔴 Implementado — GR-3, el guardarraíl que debió atraparlo

`tests/lockNesting.guard.test.js`. Recorre `src/` y falla si un archivo que abre `withLock` llama a una fachada con cerrojo. **Verificado con un fichero señuelo** — un guardarraíl que no puede fallar no sirve:

```
src/utils/__gr3_probe.js: usa la fachada con cerrojo "recordKardexMovement"
                          — usar "recordKardexMovementUnlocked"
```

Incluye además dos invariantes para que la lista no se pudra: toda fachada registrada debe seguir existiendo, y toda variante `Unlocked` debe corresponder a una fachada registrada.

**Desviación deliberada del plan:** no se crearon `seedInitialKardexIfEmptyUnlocked` ni `createInventorySnapshotUnlocked`. Ninguna de las dos se invoca desde un contexto con cerrojo (`KardexView` no abre `withLock`; `createInventorySnapshot` no tiene llamantes), así que serían código muerto. Las variantes `Unlocked` se crean **bajo demanda**, y GR-3 obliga a crearlas en cuanto alguien las necesite.

### 🟠 Implementado — GR-5, tripwire de `NaN`

`src/utils/dinero.js`. Si una entrada finita produce una salida no finita: `throw` en DEV, y en producción `console.error` + anomalía de auditoría (con tope de 5 por sesión para no inundar el log). El import de `auditService` es **diferido**: `dinero.js` es una hoja y un import estático crearía un ciclo.

### ⚠️ F7 — completado en parte, con un descubrimiento de alcance

**Hecho:**

- `resolveBsRoundingStep()` — punto único donde se resuelve el paso, con **validación de tipo**. Un objeto pasaba antes la guarda `!== null`, coercía a `NaN` en `activeStep > 0` y **desactivaba el redondeo en silencio**. Ahora lanza en DEV.
- El test de `checkoutBsManual` era un **verde falso**: pasaba `{ bsRoundingStep: 1 }` y daba 225 por esa coerción, no por el paso. Reescrito para inyectar números reales y comprobar los dos comportamientos: paso 1 → `225`, paso 10 → `230`. Más un caso que verifica que un valor no numérico se rechaza.
- JSDoc de `ceilR` corregido (C4) y política real documentada en `roundBs`.
- `bsVsUsdDiffBs` expuesto en `buildCartTotals` y persistido en la venta.

**Desviación de nombre, a propósito:** el plan lo llamaba "diferencial de redondeo". El campo incluye también los precios manuales en Bs (`bs_fijo`), que divergen de la tasa **a propósito**. Llamarlo "redondeo" sería engañoso — exactamente el tipo de nombre incorrecto que causó el problema de `ceilR`. Se llama por lo que contiene: la divergencia Bs-vs-USD.

**Pendiente, y NO debe hacerse a ciegas:**

> `calculatePricing` tiene **21 llamantes** y sólo **uno** (`FinancialEngine:445`) inyecta el paso. Los otros 20 dependen del valor guardado en configuración.
>
> Si se elimina esa resolución sin plomar los 21, cualquier usuario con un paso distinto de 10 vería **el precio mostrado divergir del precio cobrado**. La lectura de configuración quedó aislada en `resolveBsRoundingStep()` (testeable e inyectable), que era el objetivo real de F7; **plomar los 21 llamantes es una fase propia**, toca componentes de UI y necesita su propio arnés.

### Desviación de protocolo, sin reparar

La implementación se hizo con **cero commits**: los 22 archivos están en el working tree. El plan exigía un commit por fase justamente para la reversibilidad de §5.2. Revertir F7 sin arrastrar F1–F6 es ahora manual. No se corrige desde aquí porque agrupar el trabajo ya hecho en commits retroactivos es una decisión del dueño del repo.
