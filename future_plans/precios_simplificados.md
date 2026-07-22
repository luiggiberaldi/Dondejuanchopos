# Plan de Ejecución — Selector Único de Precios (4 modos) + fix forceBcv

> **Objetivo:** simplificar la UX de precios en creación/edición de artículos: un solo
> selector plano de 4 modos con lenguaje claro y vista previa del cobro, herencia de
> modo a Caja/½Caja, campo canónico `pricingMode`, y arreglo del hallazgo de auditoría
> (forceBcv congela un `priceBsManual` basura al editar).
> **Audiencia:** un LLM ejecutor. Sigue este documento **al pie de la letra**.
> **Regla de oro:** verificado contra el código el 2026-07-21. Si algo no coincide,
> **DETENTE y reporta** — NO improvises.

---

## 0. Protocolo obligatorio

1. **Localiza por búsqueda de texto (`ANCLA:`), NUNCA por número de línea.** Ancla ausente o ambigua → DETENTE y reporta.
2. Una fase a la vez. No toques nada fuera del alcance listado.
3. Harness por fase: `npx eslint --no-cache <archivos tocados>` (0 errores) + `npx vitest run tests/checkoutBsManual.test.js tests/financialEngine.test.js tests/hooks.test.js tests/remoteInventory.test.js tests/pricingMode.test.js` + `npm run build`.
4. Un commit por fase. Rama nueva desde la rama de trabajo actual. NO hagas push salvo que el humano lo pida.
5. NUNCA inventes nombres de campos. Usa solo los del Diccionario (§1).
6. **PROHIBIDO tocar `src/core/FinancialEngine.js` y `src/utils/checkoutProcessor.js`** — el motor de venta ya resuelve los 4 modos correctamente; este plan es solo de formularios y payload. Tampoco toques el guard FIN-022.
7. Actualiza `future_plans/PROGRESO_precios_simplificados.md` al cerrar cada fase.

## 1. Diccionario (verificado en código)

### Los 4 modos y su implementación actual
| Modo (nuevo nombre UI) | Persistencia actual | Resolución en venta (`FinancialEngine.js` ANCLA: `if (item.priceBsManual != null && item.priceBsManual > 0 && !item.forceBcv)`) |
|---|---|---|
| ⚡ **Tasa del día** | solo `priceUsd` | Bs = $ × tasa efectiva |
| 🏛️ **Siempre BCV** | `forceBcv: true` | Bs = $ × tasa BCV real; ignora priceBsManual/priceBsUsdRef |
| 💵 **Dos precios en $** | `priceUsd` + `priceBsUsdRef` | Bs = priceBsUsdRef × tasa (se recalcula solo) |
| 🔒 **Bs congelado** | `priceUsd` + `priceBsManual` | Bs = monto fijo escrito |

Por formato existen los espejos: `boxPriceUsd`/`boxPriceBs`/`boxPriceBsUsdRef` y `halfBoxPriceUsd`/`halfBoxPriceBs`/`halfBoxPriceBsUsdRef` (todos en `src/hooks/useProductForm.js`).

### Estado actual del formulario (lo que se va a reemplazar)
- `forceBcv` (boolean) vive en `useProductForm` (ANCLA: `forceBcv: false,`) y se persiste vía `buildProductPayload` en `src/utils/productProcessor.js` (ANCLA: `forceBcv: forceBcv ? true : false,`).
- `priceMode` / `boxPriceMode` / `halfBoxPriceMode` son **useState locales DUPLICADOS** en `ProductFormQuick.jsx` (ANCLA: `const [priceMode, setPriceMode] = useState(() => {`) y `ProductFormWizard.jsx` (misma ancla) — se derivan de cuál campo tiene valor. NO se persisten.
- UI actual en Quick: selector de 2 niveles (ANCLA: `Regla de Tasa de Cambio` y ANCLA: `Sub-selector de Estrategia para Tasa del Día`), banner regulado (ANCLA: `Producto Regulado (Víveres)`), input auxiliar (ANCLA: `INGRESAR EN BS (CALCULA USD)`).
- **HALLAZGO A CORREGIR:** en `ProductFormModal.jsx`, el efecto ANCLA: `// Re-calcular precios en bolívares cuando cambia forceBcv o las tasas de cambio` escribe `setPriceBsManual(usd × bcvRate)` (+ box/halfBox) cuando `forceBcv` se activa. El motor IGNORA esos valores en venta (guard `!item.forceBcv`), así que queda un `priceBsManual` basura persistido que confunde a la UI y al monitor remoto.
- Handlers Auto-Tasa compartidos viven en `ProductFormModal.jsx` (ANCLA: `handleUnitPriceUsdChange`) y se pasan por props a Quick y Wizard.
- Utilidades: `CurrencyService.safeParse`, `round2/mulR/divR` de `src/utils/dinero`. `parseFloat` prohibido en código financiero.
- Monitor remoto: `src/components/Monitor/RemoteProductFormModal.jsx` (formulario ligero con priceUsd/priceBsManual — se adapta en F5).

## 2. Decisiones de diseño BLOQUEADAS

- **D1 — Campo canónico `pricingMode`** con valores `'tasa_dia' | 'bcv' | 'dual_usd' | 'bs_fijo'`, por formato: `pricingMode` (unidad), `boxPricingMode`, `halfBoxPricingMode`. Vive en `useProductForm` (reemplaza los useState duplicados de Quick/Wizard) y se persiste en el payload.
- **D2 — Compatibilidad hacia atrás, SIN migración de datos.** Al cargar un producto sin `pricingMode`, derivarlo: `forceBcv → 'bcv'`; `priceBsUsdRef > 0 → 'dual_usd'`; `priceBsManual > 0 → 'bs_fijo'`; si no → `'tasa_dia'` (misma lógica que hoy usa el useState de Quick). Nunca escribas código de migración masiva.
- **D3 — `forceBcv` se SIGUE persistiendo** (derivado: `pricingMode === 'bcv'`) porque `FinancialEngine` y `CartContext` lo leen y están prohibidos de tocar. `pricingMode` manda en el formulario; `forceBcv` es un derivado de salida en el payload.
- **D4 — Normalización exclusiva en el payload (fix del hallazgo).** `buildProductPayload` fuerza coherencia según el modo de cada formato: `'tasa_dia'` y `'bcv'` → `priceBsManual: null` y `priceBsUsdRef: null`; `'dual_usd'` → `priceBsManual: null`; `'bs_fijo'` → `priceBsUsdRef: null`. Aplica igual a box/halfBox. Con esto el `priceBsManual` basura de forceBcv desaparece al guardar, sin tocar el motor.
- **D5 — Se ELIMINA el efecto que congela Bs en forceBcv** (`ProductFormModal.jsx`, ancla del hallazgo). La conversión a BCV pasa a ser solo VISUAL (vista previa), nunca escrita en los campos.
- **D6 — Herencia de modo:** Caja y ½ Caja usan `pricingMode` de la Unidad por defecto (`boxPricingMode: 'inherit'` como valor inicial). Un link "Usar otra regla para este formato" muestra el selector propio. Al guardar, `'inherit'` se resuelve al modo de la unidad en el payload (persistir el valor resuelto, no `'inherit'`).
- **D7 — Vista previa de cobro siempre visible** bajo los campos de precio de cada formato: "Cobrarás: $X en divisas · Y Bs en bolívares (…)" con el texto según modo (§3 F2). Usa `mulR/round2`, formato `toLocaleString('es-VE')`.
- **D8 — El input auxiliar "INGRESAR EN BS (CALCULA USD)"** se conserva solo en modo `'tasa_dia'`, colapsado tras un botón/icono de calculadora (no como input siempre visible).
- **D9 — No tocar:** FinancialEngine, checkoutProcessor, CartContext, SalesView (la resolución de venta ya funciona). El monitor solo se ajusta en F5 para no romper D4.

## 3. Fases

### FASE 0 — Rama y línea base
1. `git checkout -b feat/precios-simplificados` (desde la rama de trabajo actual).
2. Harness completo verde (los tests de §0.3 menos `pricingMode.test.js` que aún no existe).
3. Crea `future_plans/PROGRESO_precios_simplificados.md` con checklist F0–F5.
**Commit:** `chore(precios): rama y linea base selector unico`.

### FASE 1 — `pricingMode` canónico + payload normalizado (fix del hallazgo)
**Archivos:** `src/hooks/useProductForm.js`, `src/utils/productProcessor.js`, NUEVO `tests/pricingMode.test.js`.
1. En `useProductForm`: añade al estado inicial `pricingMode: 'tasa_dia'`, `boxPricingMode: 'inherit'`, `halfBoxPricingMode: 'inherit'` + setters memoizados (mismo patrón que ANCLA: `const setForceBcv = useCallback`).
2. En la carga de producto existente (ANCLA: `forceBcv: !!product.forceBcv,`): deriva los 3 modos con una función exportada `derivePricingMode(product, format)` que implementa D2 (para box/halfBox: si sus campos Bs/UsdRef están vacíos y no hay forceBcv → `'inherit'`; si tienen valor propio → modo propio).
3. En `buildProductPayload` (`productProcessor.js`): recibe los 3 modos; resuelve `'inherit'` al modo de unidad; aplica la normalización D4 a los 3 formatos; persiste `pricingMode`, `boxPricingMode`, `halfBoxPricingMode` (resueltos) y `forceBcv = pricingMode === 'bcv'` (D3). Mantén el resto del payload EXACTAMENTE igual (priceUsdt espejo, etc.).
4. **Tests** (`tests/pricingMode.test.js`): (a) derivación D2 de los 4 modos + inherit; (b) payload en modo `'bcv'` con `priceBsManual` sucio entra → sale `null` (el fix del hallazgo); (c) `'dual_usd'` limpia `priceBsManual` y conserva `priceBsUsdRef`; (d) `'bs_fijo'` al revés; (e) `'inherit'` en box resuelve al modo de unidad; (f) `forceBcv` true solo cuando modo `'bcv'`.
**Commit:** `feat(precios): campo canonico pricingMode con payload normalizado (fix priceBsManual basura en forceBcv)`.

### FASE 2 — Selector único de 4 tarjetas + vista previa (Unidad, en Quick)
**Archivos:** `src/components/Products/ProductFormQuick.jsx`, `src/components/Products/ProductFormModal.jsx`, NUEVO `src/components/Products/PricingModeSelector.jsx`, NUEVO `src/components/Products/PricePreviewLine.jsx`.
1. **`PricingModeSelector.jsx`** (reutilizable): grid 2×2 de tarjetas con props `{ value, onChange, effectiveRate, bcvRate, compact }`. Tarjetas EXACTAS:
   - ⚡ `tasa_dia` — "TASA DEL DÍA" / "Un precio en $, los Bs salen a la tasa activa ({effectiveRate} Bs)"
   - 🏛️ `bcv` — "SIEMPRE BCV" / "Regulados/víveres: los Bs siempre a tasa BCV ({bcvRate} Bs)"
   - 💵 `dual_usd` — "DOS PRECIOS EN $" / "Ej: $1 si paga en divisa, $2 (en Bs) si paga en bolívares — se ajusta solo con la tasa"
   - 🔒 `bs_fijo` — "BS CONGELADO" / "En Bs un monto fijo que NO se mueve con la tasa"
   Iconos lucide ya usados: `Zap`, `Landmark`, `Banknote`, `Lock`. Colores: purple / blue / emerald / amber (coherentes con los actuales).
2. **`PricePreviewLine.jsx`**: props `{ mode, usd, bsManual, bsUsdRef, effectiveRate, bcvRate }` → una línea. Textos exactos:
   - `tasa_dia`: `Cobrarás: $U · B Bs (tasa R)` con B = round(U×R)
   - `bcv`: `Cobrarás: $U · B Bs (BCV Rb)` con B = round(U×Rb)
   - `dual_usd`: `Cobrarás: $U en divisas · B Bs en bolívares (= $V × tasa R)`
   - `bs_fijo`: `Cobrarás: $U · B Bs (fijo, no cambia con la tasa)`
   Sin datos suficientes → no renderiza. Cálculos con `mulR`/`Math.round`, formato `es-VE`.
3. En **Quick**: elimina los useState locales `priceMode` + sus efectos derivadores (ANCLA: `const [priceMode, setPriceMode] = useState(() => {`) — ahora vienen de `useProductForm` por props vía commonProps del Modal. Reemplaza el bloque de 2 niveles (desde ANCLA: `Regla de Tasa de Cambio` hasta el cierre del sub-selector) por `<PricingModeSelector>`. Los inputs por modo quedan: `tasa_dia` → $ (+ calculadora Bs→USD colapsable, D8); `bcv` → solo $; `dual_usd` → "$ EN DIVISA" y "$ SI PAGA EN BS" (renombra la etiqueta ANCLA: `PRECIO REF. BS ($)`); `bs_fijo` → $ y "PRECIO BS (FIJO)". Debajo siempre `<PricePreviewLine>`. El cambio de modo LIMPIA los campos que no aplican (un solo lugar: handler `handlePricingModeChange` en el Modal).
4. En **Modal**: elimina el efecto del hallazgo (ANCLA: `// Re-calcular precios en bolívares cuando cambia forceBcv o las tasas de cambio`) según D5. Crea `handlePricingModeChange(format, mode)` que setea el modo y limpia campos no aplicables; pásalo por commonProps. `setForceBcv` ya no se llama desde la UI (solo lo deriva el payload).
**Guardarraíl manual:** crear producto en cada modo, guardar, reabrir → el modo se restaura y los campos ajenos están vacíos.
**Commit:** `feat(precios): selector unico de 4 modos con vista previa en formulario rapido`.

### FASE 3 — Herencia de modo en Caja y ½ Caja (Quick)
**Archivo:** `src/components/Products/ProductFormQuick.jsx`.
1. Elimina los useState `boxPriceMode`/`halfBoxPriceMode` y sus selectores propios (ANCLA: `Estrategia de Precios para Caja`). Por defecto (`'inherit'`): muestra solo los inputs de montos que el modo de la unidad exige + `<PricePreviewLine>` del formato + chip "Sigue la regla de la Unidad (⚡/🏛️/💵/🔒)".
2. Link discreto "Usar otra regla para este formato" → muestra `<PricingModeSelector compact>` para ese formato (`boxPricingMode`/`halfBoxPricingMode`); "Volver a heredar" restaura `'inherit'` y limpia campos ajenos.
**Commit:** `feat(precios): caja y media caja heredan la regla de precio de la unidad`.

### FASE 4 — Paridad en Wizard
**Archivo:** `src/components/Products/ProductFormWizard.jsx`.
1. Elimina sus useState duplicados de modos (misma ancla que Quick) y replica F2+F3 en el paso de precios del wizard usando los MISMOS componentes (`PricingModeSelector`, `PricePreviewLine`) y los mismos props del Modal. Cero lógica nueva: solo layout del wizard.
**Guardarraíl manual:** crear producto por wizard en modo `dual_usd` → venderlo → el ticket cobra Bs = ref$ × tasa.
**Commit:** `feat(precios): paridad del selector unico en el wizard`.

### FASE 5 — Monitor remoto + cierre
**Archivos:** `src/components/Monitor/RemoteProductFormModal.jsx`, `src/utils/remoteInventoryProcessor.js`, `tests/remoteInventory.test.js`, `future_plans/PROGRESO_precios_simplificados.md`.
1. **Monitor:** añade `<PricingModeSelector compact>` + campos por modo + preview al formulario remoto (hoy solo tiene USD/Bs manual). El payload del comando lleva `pricingMode` y campos coherentes con D4.
2. **`remoteInventoryProcessor.js`:** en `normalizeProduct` (ANCLA: `/** Normalización mínima de consistencia`), aplica la misma normalización D4 por modo (si el payload trae `pricingMode`) y deriva `forceBcv = pricingMode === 'bcv'`. Sin `pricingMode` en el payload (comandos viejos) → comportamiento actual intacto.
3. Test nuevo en `tests/remoteInventory.test.js`: edit remoto con `pricingMode: 'bcv'` y `priceBsManual` sucio → guarda `priceBsManual: null` y `forceBcv: true`.
4. Harness completo + checklist final en el PROGRESO (incluye los guardarraíles manuales de F2/F4 como pendientes de hardware).
**Commit:** `feat(precios): pricingMode en edicion remota y cierre del plan`.

## 4. Si algo no encaja
Discrepancia de anclas, props que no existen, o un consumo de `forceBcv`/`priceBsManual` no listado en §1 → DETENTE y reporta qué esperabas vs qué encontraste. En especial: si encuentras OTRO lugar que escriba `priceBsManual` automáticamente (además del efecto del hallazgo), repórtalo antes de continuar.
