import {
    ShoppingBasket, Droplets, Sparkles, Beef, Wheat,
    Milk, Drumstick, Leaf, Croissant, ShoppingBag,
    Package, LayoutGrid, Beer, Coffee, IceCream,
    Cookie, Apple, Flame, Utensils, Wine
} from 'lucide-react';

// Categorías predefinidas para el Inventario
export const BODEGA_CATEGORIES = [
    { id: 'todos', label: 'Todos', icon: '◉', color: 'slate' },
    { id: 'general', label: 'General', icon: '◆', color: 'blue' },
];

// Lucide icon map for factory categories
export const CATEGORY_ICONS = {
    todos: LayoutGrid,
    bebidas: Droplets,
    limpieza: Sparkles,
    charcuteria: Beef,
    snacks: ShoppingBasket,
    granos: Wheat,
    lacteos: Milk,
    carnes: Drumstick,
    verduras: Leaf,
    panaderia: Croissant,
    viveres: ShoppingBag,
    otros: Package,
};

export const getCategoryIcon = (id, label = '') => {
    const cleanId = (id || '').toLowerCase();
    const cleanLabel = (label || '').toLowerCase();
    
    // Mapeo exacto
    if (CATEGORY_ICONS[cleanId]) return CATEGORY_ICONS[cleanId];
    
    // Mapeo por palabras clave
    if (cleanId.includes('beer') || cleanId.includes('cerveza') || cleanId.includes('licor') || cleanId.includes('alcohol') || cleanId.includes('alcoholicas') || cleanLabel.includes('cerveza') || cleanLabel.includes('licor') || cleanLabel.includes('alcohol') || cleanLabel.includes('alcoholicas') || cleanLabel.includes('bebida alco')) {
        return Beer;
    }
    if (cleanId.includes('vino') || cleanId.includes('wine') || cleanLabel.includes('vino') || cleanLabel.includes('wine') || cleanLabel.includes('ron') || cleanLabel.includes('rum') || cleanLabel.includes('whisky')) {
        return Wine;
    }
    if (cleanId.includes('cafe') || cleanLabel.includes('café') || cleanLabel.includes('cafe')) {
        return Coffee;
    }
    if (cleanId.includes('helado') || cleanLabel.includes('helado') || cleanLabel.includes('postre') || cleanLabel.includes('torta')) {
        return IceCream;
    }
    if (cleanId.includes('galleta') || cleanId.includes('cookie') || cleanLabel.includes('galleta') || cleanLabel.includes('cookie')) {
        return Cookie;
    }
    if (cleanId.includes('fruta') || cleanLabel.includes('fruta') || cleanLabel.includes('manzana') || cleanLabel.includes('cambur') || cleanLabel.includes('platano')) {
        return Apple;
    }
    if (cleanId.includes('tabaco') || cleanId.includes('cigarro') || cleanId.includes('chimoche') || cleanLabel.includes('tabaco') || cleanLabel.includes('cigarro') || cleanLabel.includes('cigarrillo')) {
        return Flame;
    }
    if (cleanId.includes('refresco') || cleanId.includes('jugo') || cleanId.includes('malta') || cleanLabel.includes('refresco') || cleanLabel.includes('jugo') || cleanLabel.includes('malta') || cleanLabel.includes('gaseosa')) {
        return Droplets;
    }
    if (cleanId.includes('pan') || cleanLabel.includes('pan') || cleanLabel.includes('harina')) {
        return Croissant;
    }
    if (cleanId.includes('leche') || cleanLabel.includes('leche') || cleanLabel.includes('queso') || cleanLabel.includes('yogur') || cleanLabel.includes('lacteo')) {
        return Milk;
    }
    if (cleanId.includes('carne') || cleanLabel.includes('carne') || cleanLabel.includes('pollo') || cleanLabel.includes('cochino') || cleanLabel.includes('res') || cleanLabel.includes('ternera')) {
        return Drumstick;
    }
    if (cleanId.includes('verdura') || cleanId.includes('hortaliza') || cleanLabel.includes('verdura') || cleanLabel.includes('hortaliza')) {
        return Leaf;
    }
    if (cleanId.includes('comida') || cleanLabel.includes('comida') || cleanLabel.includes('desayuno') || cleanLabel.includes('cena')) {
        return Utensils;
    }
    if (cleanId.includes('viveres') || cleanLabel.includes('viveres') || cleanLabel.includes('compra')) {
        return ShoppingBag;
    }
    
    return CATEGORY_ICONS.otros || Package;
};

export const UNITS = [
    { id: 'unidad', label: 'Unidad', short: 'uni' },
    { id: 'paquete', label: 'Caja/Bulto', short: 'cja' },
    { id: 'kg', label: 'Kilogramo', short: 'kg' },
    { id: 'litro', label: 'Litro', short: 'lt' },
];

// Colores de Tailwind para las pastillas de categoría
export const CATEGORY_COLORS = {
    blue: 'bg-brand-light text-brand-dark dark:bg-surface-800 dark:text-brand',
    cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700/30 dark:text-slate-400',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400',
};
