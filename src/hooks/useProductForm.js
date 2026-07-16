import { useReducer, useCallback } from 'react';

const INITIAL_STATE = {
    editingId: null,
    name: '',
    barcode: '',
    priceUsd: '',
    priceBsManual: '', // Precio unidad en Bs (Manual)
    costUsd: '',
    costBs: '',
    stock: '',
    category: 'otros',
    lowStockAlert: '5',
    image: undefined,
    isFormShaking: false,

    // Caja
    sellByBox: false,
    boxUnits: '',
    boxBarcode: '',
    boxPriceUsd: '',
    boxPriceBs: '',

    // Media Caja
    sellByHalfBox: false,
    halfBoxUnits: '',
    halfBoxBarcode: '',
    halfBoxPriceUsd: '',
    halfBoxPriceBs: '',

    // Costo de compra por caja (Calculadora auxiliar)
    purchaseByBoxCost: '',
    purchaseBoxUnits: '',
    purchaseBoxBcv: false,
};

function reducer(state, action) {
    if (action.type === 'SET') {
        return { ...state, [action.field]: action.value };
    }
    if (action.type === 'RESET') {
        return { ...INITIAL_STATE };
    }
    if (action.type === 'PATCH') {
        return { ...state, ...action.patch };
    }
    return state;
}

export function useProductForm() {
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

    const setEditingId = useCallback((v) => dispatch({ type: 'SET', field: 'editingId', value: v }), []);
    const setName = useCallback((v) => dispatch({ type: 'SET', field: 'name', value: v }), []);
    const setBarcode = useCallback((v) => dispatch({ type: 'SET', field: 'barcode', value: v }), []);
    const setPriceUsd = useCallback((v) => dispatch({ type: 'SET', field: 'priceUsd', value: v }), []);
    const setPriceBsManual = useCallback((v) => dispatch({ type: 'SET', field: 'priceBsManual', value: v }), []);
    const setCostUsd = useCallback((v) => dispatch({ type: 'SET', field: 'costUsd', value: v }), []);
    const setCostBs = useCallback((v) => dispatch({ type: 'SET', field: 'costBs', value: v }), []);
    const setStock = useCallback((v) => dispatch({ type: 'SET', field: 'stock', value: v }), []);
    const setCategory = useCallback((v) => dispatch({ type: 'SET', field: 'category', value: v }), []);
    const setLowStockAlert = useCallback((v) => dispatch({ type: 'SET', field: 'lowStockAlert', value: v }), []);
    const setImage = useCallback((v) => dispatch({ type: 'SET', field: 'image', value: v }), []);
    const setIsFormShaking = useCallback((v) => dispatch({ type: 'SET', field: 'isFormShaking', value: v }), []);

    // Setters Caja
    const setSellByBox = useCallback((v) => dispatch({ type: 'SET', field: 'sellByBox', value: v }), []);
    const setBoxUnits = useCallback((v) => dispatch({ type: 'SET', field: 'boxUnits', value: v }), []);
    const setBoxBarcode = useCallback((v) => dispatch({ type: 'SET', field: 'boxBarcode', value: v }), []);
    const setBoxPriceUsd = useCallback((v) => dispatch({ type: 'SET', field: 'boxPriceUsd', value: v }), []);
    const setBoxPriceBs = useCallback((v) => dispatch({ type: 'SET', field: 'boxPriceBs', value: v }), []);

    // Setters Media Caja
    const setSellByHalfBox = useCallback((v) => dispatch({ type: 'SET', field: 'sellByHalfBox', value: v }), []);
    const setHalfBoxUnits = useCallback((v) => dispatch({ type: 'SET', field: 'halfBoxUnits', value: v }), []);
    const setHalfBoxBarcode = useCallback((v) => dispatch({ type: 'SET', field: 'halfBoxBarcode', value: v }), []);
    const setHalfBoxPriceUsd = useCallback((v) => dispatch({ type: 'SET', field: 'halfBoxPriceUsd', value: v }), []);
    const setHalfBoxPriceBs = useCallback((v) => dispatch({ type: 'SET', field: 'halfBoxPriceBs', value: v }), []);

    // Setters Costo de compra por caja
    const setPurchaseByBoxCost = useCallback((v) => dispatch({ type: 'SET', field: 'purchaseByBoxCost', value: v }), []);
    const setPurchaseBoxUnits = useCallback((v) => dispatch({ type: 'SET', field: 'purchaseBoxUnits', value: v }), []);
    const setPurchaseBoxBcv = useCallback((v) => dispatch({ type: 'SET', field: 'purchaseBoxBcv', value: v }), []);

    const resetForm = useCallback(() => {
        dispatch({ type: 'RESET' });
    }, []);

    const populateForm = useCallback((product, effectiveRate) => {
        const currentPriceUsd = product.priceUsd || product.priceUsdt || 0;
        const currentCostUsd = product.costUsd || (product.costBs ? product.costBs / effectiveRate : 0);
        const currentCostBs = product.costBs || (product.costUsd ? product.costUsd * effectiveRate : 0);

        const isAlreadyUnitCost = product.purchaseByBoxCost && product.purchaseBoxUnits;
        const costMultiplier = (product.sellByBox && product.boxUnits && !isAlreadyUnitCost) ? (parseInt(product.boxUnits, 10) || 1) : 1;
        const formCostUsd = currentCostUsd * costMultiplier;
        const formCostBs = currentCostBs * costMultiplier;

        const patch = {
            editingId: product.id,
            name: product.name,
            barcode: product.barcode || '',
            priceUsd: currentPriceUsd > 0 ? currentPriceUsd.toString() : '',
            priceBsManual: product.priceBsManual ? product.priceBsManual.toString() : (product.priceBs ? product.priceBs.toString() : ''),
            costUsd: formCostUsd > 0 ? formCostUsd.toFixed(2) : '',
            costBs: formCostBs > 0 ? formCostBs.toFixed(2) : '',
            stock: product.stock ?? '',
            category: product.category || 'otros',
            lowStockAlert: product.lowStockAlert ?? 5,
            image: product.image,

            // Caja
            sellByBox: !!product.sellByBox,
            boxUnits: product.boxUnits ? product.boxUnits.toString() : '',
            boxBarcode: product.boxBarcode || '',
            boxPriceUsd: product.boxPriceUsd ? product.boxPriceUsd.toString() : '',
            boxPriceBs: product.boxPriceBs ? product.boxPriceBs.toString() : '',

            // Media Caja
            sellByHalfBox: !!product.sellByHalfBox,
            halfBoxUnits: product.halfBoxUnits ? product.halfBoxUnits.toString() : '',
            halfBoxBarcode: product.halfBoxBarcode || '',
            halfBoxPriceUsd: product.halfBoxPriceUsd ? product.halfBoxPriceUsd.toString() : '',
            halfBoxPriceBs: product.halfBoxPriceBs ? product.halfBoxPriceBs.toString() : '',

            // Costo de compra por caja
            purchaseByBoxCost: product.purchaseByBoxCost ? product.purchaseByBoxCost.toString() : '',
            purchaseBoxUnits: product.purchaseBoxUnits ? product.purchaseBoxUnits.toString() : '',
            purchaseBoxBcv: !!product.purchaseBoxBcv,
        };

        dispatch({ type: 'PATCH', patch });
    }, []);

    return {
        editingId: state.editingId, setEditingId,
        name: state.name, setName,
        barcode: state.barcode, setBarcode,
        priceUsd: state.priceUsd, setPriceUsd,
        priceBsManual: state.priceBsManual, setPriceBsManual,
        costUsd: state.costUsd, setCostUsd,
        costBs: state.costBs, setCostBs,
        stock: state.stock, setStock,
        category: state.category, setCategory,
        lowStockAlert: state.lowStockAlert, setLowStockAlert,
        image: state.image, setImage,
        isFormShaking: state.isFormShaking, setIsFormShaking,

        // Caja
        sellByBox: state.sellByBox, setSellByBox,
        boxUnits: state.boxUnits, setBoxUnits,
        boxBarcode: state.boxBarcode, setBoxBarcode,
        boxPriceUsd: state.boxPriceUsd, setBoxPriceUsd,
        boxPriceBs: state.boxPriceBs, setBoxPriceBs,

        // Media Caja
        sellByHalfBox: state.sellByHalfBox, setSellByHalfBox,
        halfBoxUnits: state.halfBoxUnits, setHalfBoxUnits,
        halfBoxBarcode: state.halfBoxBarcode, setHalfBoxBarcode,
        halfBoxPriceUsd: state.halfBoxPriceUsd, setHalfBoxPriceUsd,
        halfBoxPriceBs: state.halfBoxPriceBs, setHalfBoxPriceBs,

        // Costo de compra por caja
        purchaseByBoxCost: state.purchaseByBoxCost, setPurchaseByBoxCost,
        purchaseBoxUnits: state.purchaseBoxUnits, setPurchaseBoxUnits,
        purchaseBoxBcv: state.purchaseBoxBcv, setPurchaseBoxBcv,

        resetForm,
        populateForm,
    };
}
