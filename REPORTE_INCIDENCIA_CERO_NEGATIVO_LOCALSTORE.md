# Reporte de Incidencia: Error VTA-PROCESO-01 ("Valor transaccional no representable")

**Fecha:** 17 de Octubre de 2026  
**Sistema:** Donde Juancho POS (PWA / Web / LocalStorage + IndexedDB)  
**Severidad:** Crítica (bloqueo total de checkout y abonos en el dispositivo afectado)  
**Estado:** Diagnóstico completo, laptop curada temporalmente, solución definitiva diseñada y lista para implementación.

---

## 1. Síntomas Observados

1. **En la Interfaz (Pantalla de Ventas):**
   * Al pulsar el botón "PAGAR (LISTO)" para completar una venta, el sistema fallaba de inmediato mostrando una notificación roja flotante:
   > *"No se confirmó la venta completa. Revisa el historial antes de repetir el cobro. Código de diagnóstico: VTA-PROCESO-01"*
   * El fallo ocurría con **cualquier tipo de venta** (contado, fiado, montos pequeños, montos grandes) y en cualquier intento de cobro.

2. **En la Consola del Navegador (Google Chrome / Laptop):**
   ```text
   [SNIPER 11:17:10 a. m.] 2_PROCESS_EXCEPTION: Excepción en processSaleTransaction {
     "code": null,
     "message": "Valor transaccional no representable",
     "stack": "TypeError: Valor transaccional no representable
         at $a (NormalAppRoot-BFxhnG9N.js:2:5888)
         at $a (NormalAppRoot-BFxhnG9N.js:2:6489)
         at $a (NormalAppRoot-BFxhnG9N.js:2:6489)
         at Object.setItem (NormalAppRoot-BFxhnG9N.js:2:13756)
         at async SalesView-DEJ1TSrU.js:42:25210
         at async NormalAppRoot-BFxhnG9N.js:2:13900"
   }
   [StorageGuard] Advertencia al verificar protección de ventas: TypeError: Valor transaccional no representable
   [SupervisorCommands] Error al registrar abono de cliente: TypeError: Valor transaccional no representable
   ```

3. **Comportamiento Anómalo Reportado:**
   * En la **laptop**, ninguna venta ni abono procesaba.
   * En la **PC**, al importar el archivo de respaldo exportado desde esa misma laptop, el sistema sí permitía realizar ventas con total normalidad.

---

## 2. Causa Raíz (Root Cause Analysis)

### A. La Venta Culpable
A través de un script diagnóstico que imitó el algoritmo estricto del guardián del sistema sobre las 1,568 ventas locales de la laptop, se identificó el registro exacto:

```text
🚨 ENCONTRADO EN HISTORIAL: Cero negativo (-0) en Venta #892f1b12-d1a1-42fa-aef1-02a0f7c386f0.totalUsd
```

La venta histórica con identificador `892f1b12-d1a1-42fa-aef1-02a0f7c386f0` tenía su campo `totalUsd` establecido en `-0` (cero negativo según el estándar IEEE-754 de coma flotante).

### B. El Guardián de Integridad en `src/utils/localStore.js`
En el motor de almacenamiento local seguro, antes de escribir datos atómicos en IndexedDB o localStorage, se ejecuta la función `cloneTransactionValue`:

```javascript
// src/utils/localStore.js (línea 141-144)
function cloneTransactionValue(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
    if (typeof value !== 'object' || seen.has(value)) throw new TypeError('Valor transaccional no representable');
    ...
```

La condición:
```javascript
!Object.is(value, -0)
```
determina que si un número es `-0`, la función no lo retorna como válido. Al pasar a la siguiente línea (`typeof value !== 'object'`), al ser un tipo `'number'`, arroja **`TypeError: Valor transaccional no representable`**.

### C. El Mecanismo de Bloqueo en Cascada
En `src/utils/checkoutProcessor.js` (línea 570):
```javascript
const updatedSales = [saleForResult, ...existingSales.filter(item => item.id !== saleForResult.id)];
await storageService.setItem(SALES_KEY, updatedSales);
```
Cuando un cajero hace una venta nueva o registra un abono de cliente:
1. El sistema junta la venta nueva (`saleForResult`) con todas las ventas existentes (`existingSales`).
2. Se envía la lista completa a `setItem('bodega_sales_v1', updatedSales)`.
3. `cloneTransactionValue` recorre **cada una de las 1,568 ventas**.
4. Al llegar a la venta `#892f1b12-...` y evaluar `totalUsd: -0`, aborta inmediatamente con la excepción.
5. `useCheckoutFlow` atrapa el error nativo como un fallo imprevisto y genera el código `VTA-PROCESO-01`.

---

## 3. ¿Por qué Fallaba en la Laptop pero Funcionaba en la PC?

La diferencia radica en el mecanismo de persistencia y serialización:

| Entorno | Dónde viven los datos | Comportamiento con el Cero Negativo (`-0`) | Resultado |
| :--- | :--- | :--- | :--- |
| **Laptop** | **IndexedDB (`localforage`)** | Utiliza el algoritmo nativo **Structured Clone** de JavaScript, el cual **preserva exactamente el `-0`** en disco sin alterarlo. | El `-0` permanece intacto; cada guardado detona el guardián. |
| **PC** | **Importación de archivo `.json`** | El archivo fue exportado vía `JSON.stringify`. Por especificación ECMAScript, **`JSON.stringify(-0)` produce `"0"`** (cero positivo). Al importarse con `JSON.parse`, se convirtió en `0`. | El archivo de respaldo se auto-sanitizó al exportarse; la PC quedó limpia. |

---

## 4. Solución Temporal Aplicada

Se ejecutó en la consola del navegador de la laptop una transacción directa de corrección sobre el almacén de IndexedDB:

```javascript
indexedDB.open('BodegaApp').onsuccess = (e) => {
  const db = e.target.result;
  const tx = db.transaction('bodega_app_data', 'readwrite');
  const store = tx.objectStore('bodega_app_data');
  const req = store.get('bodega_sales_v1');
  
  req.onsuccess = () => {
    const sales = req.result || [];
    sales.forEach(sale => {
      if (Object.is(sale.totalUsd, -0)) sale.totalUsd = 0;
      for (const k of Object.keys(sale)) {
        if (Object.is(sale[k], -0)) sale[k] = 0;
      }
    });
    store.put(sales, 'bodega_sales_v1');
  };
};
```
Esta acción normalizó el valor `-0` a `0` en la base de datos local de la laptop, desbloqueando el checkout al instante.

---

## 5. Solución Definitiva Propuesta (Blindaje en Código)

Para garantizar que esta situación **nunca más vuelva a repetirse** bajo ninguna circunstancia, se propone implementar tres capas de blindaje:

### Capa 1: Auto-Normalización en el Guardián (`src/utils/localStore.js`)
En lugar de romper la aplicación cuando se encuentra con un `-0`, el guardián debe corregirlo silenciosamente en caliente:

```javascript
// ANTES:
if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
if (typeof value !== 'object' || seen.has(value)) throw new TypeError('Valor transaccional no representable');

// DESPUÉS (Solución propuesta):
if (typeof value === 'number') {
    if (Object.is(value, -0)) return 0; // Normaliza automáticamente -0 a 0 positivo
    if (Number.isFinite(value)) return value;
    throw new TypeError('Valor numérico no finito en transacción');
}
if (typeof value !== 'object' || seen.has(value)) throw new TypeError('Valor transaccional no representable');
```

> [!IMPORTANT]
> **Beneficio Clave:** Si cualquier venta histórica o nueva llega a contener un `-0` (por ejemplo, por operaciones con saldo cero, vueltos exactos o redondeos en centavos), el guardián la convierte en `0` válido en memoria y disco, evitando cualquier bloqueo del cajero.

### Capa 2: Blindaje de Salida en Aritmética Financiera (`src/utils/dinero.js`)
Asegurar que todas las primitivas financieras normalicen cero negativo:
* En `round2`, `round4`, `subR`, `sumR` y `_shiftRound`:
```javascript
const out = sign * Math.sign(rounded) * Number(`${rm}e${Number(re) - decimals}`);
return _tripwire(n, decimals, Object.is(out, -0) ? 0 : out);
```

### Capa 3: Saneamiento Preventivo en `checkoutProcessor.js`
Al preparar `finalPersistedSale` y `saleForResult`, pasar los campos numéricos de cambio y balance por un saneador:
* `totalUsd: Object.is(cartTotalUsd, -0) ? 0 : cartTotalUsd`
* `changeUsd: Object.is(changeUsd, -0) ? 0 : changeUsd`

---

## 6. Plan de Pruebas y Validación

1. **Prueba Unitaria de Guardián (`localTransaction.test.js`):**
   * Verificar que `cloneTransactionValue({ totalUsd: -0 })` retorne `{ totalUsd: 0 }` sin lanzar error.
   * Verificar que `Object.is(result.totalUsd, -0)` sea `false`.
2. **Prueba de Checkout con Vuelto Exacto:**
   * Cobro de $0.12 con $0.12 en efectivo USD.
   * Venta en $0.00 o con descuento del 100%.
3. **Validación en Dispositivo Real:**
   * Realizar venta de prueba en la laptop y confirmar persistencia limpia tanto en local como en la nube.
