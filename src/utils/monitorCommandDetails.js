/**
 * src/utils/monitorCommandDetails.js
 *
 * Detalles descriptivos de comandos de supervisor (cola local y comandos en la
 * nube). Extraído y unificado desde OwnerMonitorView.jsx (refactor 2026-08-21):
 * las ramas local/cloud repetían la misma lógica de detalle de inventario.
 */
const formatUsdAmount = value => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
}).format(Number(value) || 0);

export function isDuplicateProductIdFailure(command) {
    const reason = String(command?.error_reason || '');
    return /DUPLICATE_PRODUCT_ID_CONFLICT|Ya existe un producto con ese ID/i.test(reason);
}

function buildInventoryActionDetails(action, data) {
    const details = [];
    let actionLabel = 'Modificación de Inventario';
    let actionColor = 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300';

    if (action === 'adjust_stock') {
        const delta = data.delta || 0;
        actionLabel = `Ajuste de Stock (${delta > 0 ? '+' : ''}${delta})`;
        actionColor = delta > 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300';
        details.push(`📦 Stock: ${delta > 0 ? '+' : ''}${delta} unidades`);
    } else if (action === 'edit' || action === 'add') {
        actionLabel = action === 'add' ? 'Nuevo Producto / Combo' : 'Edición de Producto / Combo';
        actionColor = action === 'add' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300';

        if (data.priceUsd !== undefined && data.priceUsd !== null && data.priceUsd !== '') details.push(`💵 $${formatUsdAmount(data.priceUsd)}`);
        if (data.pricingMode === 'bcv' || data.forceBcv) details.push('🏛️ Siempre BCV');
        else if (data.pricingMode === 'bs_fijo') details.push(`🔒 Bs Fijo (${data.priceBsManual || data.priceBs || '0'} Bs)`);
        else if (data.pricingMode === 'tasa_dia') details.push('⚡ Tasa del Día');
        if (data.stock !== undefined && data.stock !== null && data.stock !== '') details.push(`📦 Stock: ${data.stock} u`);
        if (data.category && data.category !== 'varios') details.push(`🏷️ ${data.category}`);
        if (data.barcode) details.push(`📊 Cód: ${data.barcode}`);
        if (data.sellByBox && data.boxUnits) details.push(`📦 Caja: ${data.boxUnits}u ($${data.boxPriceUsd || 0})`);
        if (data.sellByHalfBox && data.halfBoxUnits) details.push(`📦 ½ Caja: ${data.halfBoxUnits}u ($${data.halfBoxPriceUsd || 0})`);
    } else if (action === 'delete') {
        actionLabel = 'Eliminación de Producto';
        actionColor = 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300';
        details.push('🗑️ Eliminado del catálogo');
    }

    return { actionLabel, actionColor, details };
}

function getCommandAuthor(payload, cmd) {
    return payload.supervisorNombre || payload.supervisorName || payload.actor?.nombre || cmd.monitor_device_id || 'Supervisor';
}

export function getSupervisorCommandDetails(item, products = []) {
    if (!item) return { title: 'Modificación', actionLabel: 'Inventario', actionColor: 'bg-slate-100 text-slate-700', details: [], author: 'Supervisor' };

    if (item.isLocal) {
        const change = item.data || {};
        const data = change.data || {};
        const targetProd = Array.isArray(products) ? products.find(p => p.id === change.productId) : null;
        const action = change.action || change.command_type;

        if (action === 'void_employee_consumption') {
            const details = [];
            if (data.totalUsd || change.totalUsd) details.push(`💵 $${formatUsdAmount(data.totalUsd || change.totalUsd || 0)} USD`);
            details.push('↺ Devolución a Stock');
            return {
                title: `Consumo: ${data.employeeNombre || change.employeeNombre || 'Personal'}`,
                actionLabel: 'Anulación de Consumo',
                actionColor: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
                details,
                author: 'Tú (Monitor)',
            };
        }

        if (action === 'save_employee') {
            const emp = data.employee || data;
            const details = [];
            if (emp.cargo) details.push(`💼 ${emp.cargo}`);
            if (emp.salarioSemanalUsd !== undefined) details.push(`💵 $${formatUsdAmount(emp.salarioSemanalUsd)}/sem`);
            if (emp.limiteConsumoPorc !== undefined) details.push(`📊 Límite: ${emp.limiteConsumoPorc}%`);
            const isEdit = Boolean(emp.id && !emp._isNew);
            return {
                title: `Empleado: "${emp.nombre || 'Personal'}"`,
                actionLabel: isEdit ? 'Edición de Empleado' : 'Alta de Empleado',
                actionColor: isEdit ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
                details,
                author: 'Tú (Monitor)',
            };
        }

        if (action === 'delete_employee') {
            const empName = data.employeeNombre || data.nombre || 'Personal';
            return {
                title: `Empleado: "${empName}"`,
                actionLabel: 'Eliminación de Empleado',
                actionColor: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
                details: ['🗑️ Eliminado del registro de personal'],
                author: 'Tú (Monitor)',
            };
        }

        const title = data.name || targetProd?.name || 'Artículo / Configuración';
        return { title, ...buildInventoryActionDetails(action, data), author: 'Tú (Monitor)' };
    }

    const cmd = item.data || item;
    const payload = cmd.payload || {};
    const action = payload.action || cmd.command_type;
    const data = payload.data || {};
    const prodId = payload.productId || data.id;
    const targetProd = Array.isArray(products) ? products.find(p => p.id === prodId) : null;

    if (action === 'void_employee_consumption' || cmd.command_type === 'void_employee_consumption') {
        const details = [];
        if (payload.totalUsd) details.push(`💵 $${formatUsdAmount(payload.totalUsd)} USD`);
        if (payload.employeeNombre) details.push(`👤 ${payload.employeeNombre}`);
        details.push('↺ Devolución a Stock');
        return {
            title: `Consumo: ${payload.employeeNombre || 'Personal'}`,
            actionLabel: 'Anulación de Consumo',
            actionColor: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
            details,
            author: getCommandAuthor(payload, cmd),
        };
    }

    if (action === 'save_employee' || cmd.command_type === 'save_employee') {
        const emp = payload.employee || payload.data || payload;
        const details = [];
        if (emp.cargo) details.push(`💼 ${emp.cargo}`);
        if (emp.salarioSemanalUsd !== undefined) details.push(`💵 $${formatUsdAmount(emp.salarioSemanalUsd)}/sem`);
        if (emp.limiteConsumoPorc !== undefined) details.push(`📊 Límite: ${emp.limiteConsumoPorc}%`);
        const isEdit = Boolean(emp.id && !emp._isNew);
        return {
            title: `Empleado: "${emp.nombre || 'Personal'}"`,
            actionLabel: isEdit ? 'Edición de Empleado' : 'Alta de Empleado',
            actionColor: isEdit ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
            details,
            author: getCommandAuthor(payload, cmd),
        };
    }

    if (action === 'delete_employee' || cmd.command_type === 'delete_employee') {
        const empName = payload.employeeNombre || payload.nombre || (payload.employeeId ? `#${payload.employeeId}` : 'Personal');
        return {
            title: `Empleado: "${empName}"`,
            actionLabel: 'Eliminación de Empleado',
            actionColor: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
            details: ['🗑️ Eliminado del registro de personal'],
            author: getCommandAuthor(payload, cmd),
        };
    }

    if (cmd.command_type === 'user_update') {
        const details = [];
        if (payload.nombre) details.push(`👤 Nombre: ${payload.nombre}`);
        if (payload.userId) details.push(`ID: #${payload.userId}`);
        if (payload.bypassPin !== undefined) details.push(payload.bypassPin ? '🔓 Acceso Libre (Sin PIN)' : '🔒 Requiere PIN');
        if (payload.action === 'change_pin') details.push('🔑 Clave/PIN Actualizado');
        return {
            title: payload.nombre ? `Cajero: "${payload.nombre}"` : `Usuario #${payload.userId || ''}`,
            actionLabel: payload.action === 'change_pin' ? 'Cambio de PIN' : 'Datos de Usuario',
            actionColor: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
            details,
            author: getCommandAuthor(payload, cmd),
        };
    }

    if (cmd.command_type === 'rate_change') {
        const details = [];
        if (payload.rate || payload.tasa) details.push(`💵 Tasa: ${payload.rate || payload.tasa} Bs`);
        if (payload.bcvRate) details.push(`🏛️ BCV: ${payload.bcvRate} Bs`);
        return {
            title: 'Tasa de Cambio',
            actionLabel: 'Ajuste de Tasa',
            actionColor: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
            details,
            author: getCommandAuthor(payload, cmd),
        };
    }

    if (cmd.command_type === 'void_sale') {
        const details = [];
        if (payload.totalUsd || payload.totalBs) details.push(`💵 $${payload.totalUsd || 0} / ${payload.totalBs || 0} Bs`);
        if (payload.reason) details.push(`Motivo: ${payload.reason}`);
        return {
            title: `Anulación de Venta #${payload.saleNumber || String(payload.saleId || '').slice(-6)}`,
            actionLabel: 'Anulación de Venta',
            actionColor: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
            details,
            author: getCommandAuthor(payload, cmd),
        };
    }

    // inventory_update
    const title = data.name || payload.name || payload.productName || targetProd?.name || 'Artículo / Configuración';
    return { title, ...buildInventoryActionDetails(action, data), author: getCommandAuthor(payload, cmd) };
}
