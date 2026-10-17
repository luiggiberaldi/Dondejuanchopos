# Plan de Implementación Auditado: Corrección de Causa Raíz en Gastos Internos (Fix Cero Negativo -0)

**Fecha:** 17 de Octubre de 2026  
**Sistema:** Donde Juancho POS (PWA / Web / LocalStorage + IndexedDB)  
**Estado:** Auditado, validado contra el código real y listo para ejecución inmediata.

---

## 1. Diagnóstico Forense y Estado Actual del Código

### A. La Causa Raíz Real No Parcheada
El registro que detonó el bloqueo en la laptop no fue una venta, sino un **Gasto Interno de Insumos** registrado por Luis Medina el 16/10 a las 10:11 p.m. (`#892f1b12-d1a1-42fa-aef1-02a0f7c386f0`) por 350 Bs de agua potable.
En `src/hooks/useGastosInternos.js` (línea 69):
```javascript
const totalEnUsd = isUsd ? (amountUsd || 0) : 0;
// Cuando el gasto es en Bolívares (isUsd es false), totalEnUsd vale 0.
// En JavaScript: -(0) produce estrictamente -0:
totalUsd: -totalEnUsd, // -> -0
```
Además, en `items` del gasto:
```javascript
priceUsd: isUsd ? -totalEnUsd : 0, // si no es USD, produce 0 (limpio), pero si totalEnUsd es 0 produce -0
costBs:   isBs  ? -totalEnBs  : 0
```
Y en la sección de **Autoconsumo** (línea 153):
```javascript
totalUsd: -Math.abs(totalUsd), // si totalUsd es 0 -> -Math.abs(0) produce -0
totalBs:  -Math.abs(totalBs),  // si totalBs es 0  -> -Math.abs(0) produce -0
```

### B. Hallazgos Clave de la Auditoría Técnica
1. **`localStore.js` (Líneas 143–148):**  
   Ya cuenta con la auto-normalización en su versión actual:
   ```javascript
   if (typeof value === 'number') {
       if (Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
       throw new TypeError(`Valor transaccional no representable en ${path}: número no finito`);
   }
   ```
   *No requiere modificaciones.*
2. **`dinero.js` (Línea 67):**  
   Ya implementa el operador `out + 0` en `_shiftRound`, lo cual garantiza que `round2(0)`, `round2(-0)` y `subR(0.12, 0.12)` retornen `0` normal.  
   *No requiere modificaciones.*
3. **`checkoutProcessor.js`:**  
   Sus totales provienen de `buildCartTotals` / `dinero.js`, que ya normalizan a `0`.  
   *No requiere cambios redundantes.*

---

## 2. Plan de Tareas Quirúrgico y Definitivo

### Tarea 1: Corrección Integral en `src/hooks/useGastosInternos.js`

**Archivos involucrados:**
- `src/hooks/useGastosInternos.js:68-87` (Gasto normal)
- `src/hooks/useGastosInternos.js:153-163` (Autoconsumo)

#### Paso 1.1: Saneamiento de signos en `registrarGasto`
Garantizar que nunca se aplique el operador unario `-` a un valor igual a `0`:
```javascript
totalBs:  totalEnBs === 0 ? 0 : -totalEnBs,
totalUsd: totalEnUsd === 0 ? 0 : -totalEnUsd,
rate: bcvRate,
...(tasaCop > 0 && { tasaCop }),
...(copEnabled && { totalCop: totalEnCop === 0 ? 0 : -totalEnCop }),
paymentMethod: methodId,
payments: [{
    methodId:  methodId,
    amountUsd: (isUsd && totalEnUsd !== 0) ? -totalEnUsd : 0,
    amountBs:  (isBs  && totalEnBs  !== 0) ? -totalEnBs  : 0,
    ...(copEnabled && { amountCop: (isCop && totalEnCop !== 0) ? -totalEnCop : 0 }),
    currency:    currency,
    methodLabel: 'Gasto Interno'
}],
items: [{
    name:     `Gasto: ${description.trim()}`,
    qty:      1,
    priceUsd: (isUsd && totalEnUsd !== 0) ? -totalEnUsd : 0,
    costBs:   (isBs  && totalEnBs  !== 0) ? -totalEnBs  : 0
}]
```

#### Paso 1.2: Saneamiento de signos en `registrarAutoconsumo`
Evitar `-Math.abs(0)`:
```javascript
const safeNegative = (num) => {
    const val = Math.abs(num || 0);
    return val === 0 ? 0 : -val;
};

totalUsd: safeNegative(totalUsd),
totalBs:  safeNegative(totalBs),
...(copEnabled && { totalCop: safeNegative(totalUsd * (tasaCop || 0)) }),
paymentMethod: 'autoconsumo',
payments: [{
    methodId:    'autoconsumo',
    amountUsd:   safeNegative(totalUsd),
    amountBs:    safeNegative(totalBs),
    currency:    'USD',
    methodLabel: 'Autoconsumo de Inventario'
}],
```

---

### Tarea 2: Prueba Unitaria Específica (TDD)

**Archivos involucrados:**
- Crear: `tests/gastosInternosNegativeZero.test.js`

**Contenido del Test:**
1. Simular el registro de un gasto de `350 Bs` (moneda `BS`).
2. Validar que:
   - `totalBs` sea `-350`.
   - `totalUsd` sea `0` y `Object.is(totalUsd, -0)` sea `false`.
   - `items[0].priceUsd` sea `0` y `Object.is(priceUsd, -0)` sea `false`.
3. Validar que al pasar el objeto por `localStore.transaction`, se persista sin arrojar `TypeError: Valor transaccional no representable`.

---

### Tarea 3: Limpieza de Archivos Scratch y Diagnóstico

Eliminar archivos de prueba temporales que no deben formar parte del repositorio ni del build de producción:
* `tests/scratchRepro.test.js`
* `tests/scratchCloudRef.test.js`
* `tests/scratchSupabase.test.js`
* `vercel_NormalAppRoot.js`
* `vercel_SalesView.js`

---

### Tarea 4: Verificación Integral y Despliegue

1. Ejecutar las pruebas unitarias:
   ```bash
   npx vitest run tests/gastosInternosNegativeZero.test.js tests/localTransaction.test.js
   ```
2. Ejecutar build de producción:
   ```bash
   npm run build
   ```
3. Commit ordenado y push a `main`:
   ```bash
   git add src/hooks/useGastosInternos.js tests/gastosInternosNegativeZero.test.js PLAN_FIXES_NORMALIZACION_VALORES_TRANSACCIONALES_2026-10-17.md AGENT.md
   git commit -m "fix(gastos): normalizar ceros negativos en registro de gastos y autoconsumo"
   git push origin main
   ```
