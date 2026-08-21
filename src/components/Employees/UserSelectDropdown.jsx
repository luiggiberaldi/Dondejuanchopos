import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, User, Crown, ShoppingCart } from 'lucide-react';

export default function UserSelectDropdown({
    value,
    onChange,
    usuarios = [],
    className = '',
    placeholder = 'Sin usuario asociado (Personal)'
}) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    const selectedUser = usuarios.find(u => String(u.id) === String(value));

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (user) => {
        onChange(user);
        setIsOpen(false);
    };

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full min-h-[48px] px-3.5 py-2 rounded-2xl border transition-all duration-200 flex items-center justify-between gap-2.5 text-left cursor-pointer outline-none ${
                    isOpen 
                        ? 'border-brand ring-2 ring-brand/20 bg-brand-light/30 dark:bg-slate-800' 
                        : 'border-slate-200/90 dark:border-slate-700/80 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600 shadow-sm'
                }`}
            >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {selectedUser ? (
                        <>
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-white font-black text-xs shadow-xs ${
                                selectedUser.rol === 'ADMIN' 
                                    ? 'bg-gradient-to-br from-brand to-brand-dark' 
                                    : 'bg-gradient-to-br from-emerald-500 to-teal-500'
                            }`}>
                                {(selectedUser.nombre || 'U')[0].toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-black text-slate-800 dark:text-white truncate">
                                    {selectedUser.nombre}
                                </p>
                                <div className="flex items-center gap-1 mt-0.5">
                                    {selectedUser.rol === 'ADMIN' ? (
                                        <Crown size={11} className="text-amber-500 shrink-0" />
                                    ) : (
                                        <ShoppingCart size={11} className="text-emerald-500 shrink-0" />
                                    )}
                                    <span className={`text-[10px] font-bold uppercase tracking-wider truncate block ${
                                        selectedUser.rol === 'ADMIN' ? 'text-brand' : 'text-emerald-600 dark:text-emerald-400'
                                    }`}>
                                        {selectedUser.rol === 'ADMIN' ? 'Administrador' : 'Cajero'}
                                    </span>
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
                                <User size={15} />
                            </div>
                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate flex-1 min-w-0">
                                {placeholder}
                            </span>
                        </>
                    )}
                </div>

                <div className={`w-7 h-7 rounded-xl flex items-center justify-center transition-all duration-200 text-slate-400 shrink-0 ${
                    isOpen ? 'rotate-180 bg-brand/10 text-brand' : 'bg-slate-50 dark:bg-slate-800/80'
                }`}>
                    <ChevronDown size={15} />
                </div>
            </button>

            {/* Menú Desplegable Redondeado */}
            {isOpen && (
                <div className="absolute left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl z-[150] p-1.5 max-h-56 overflow-y-auto space-y-1 animate-in fade-in zoom-in-95 duration-150 custom-scrollbar">
                    {/* Opción 1: Sin usuario asociado */}
                    <button
                        type="button"
                        onClick={() => handleSelect(null)}
                        className={`w-full p-2.5 rounded-xl text-left text-xs font-semibold flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                            !value 
                                ? 'bg-brand-light/60 dark:bg-brand/10 text-brand font-bold' 
                                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
                                <User size={14} />
                            </div>
                            <span className="truncate">Sin usuario asociado (Personal)</span>
                        </div>
                        {!value && <Check size={15} className="text-brand shrink-0" />}
                    </button>

                    {/* Usuarios Disponibles */}
                    {usuarios.map(u => {
                        const isSelected = String(u.id) === String(value);
                        const isAdmin = u.rol === 'ADMIN';
                        return (
                            <button
                                key={u.id}
                                type="button"
                                onClick={() => handleSelect(u)}
                                className={`w-full p-2 rounded-xl text-left text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                                    isSelected 
                                        ? 'bg-brand-light/60 dark:bg-brand/10 text-brand' 
                                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200'
                                }`}
                            >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-white font-black text-xs ${
                                        isAdmin ? 'bg-gradient-to-br from-brand to-brand-dark' : 'bg-gradient-to-br from-emerald-500 to-teal-500'
                                    }`}>
                                        {(u.nombre || 'U')[0].toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold truncate">{u.nombre}</p>
                                        <div className="flex items-center gap-1">
                                            {isAdmin ? (
                                                <Crown size={10} className="text-amber-500 shrink-0" />
                                            ) : (
                                                <ShoppingCart size={10} className="text-emerald-500 shrink-0" />
                                            )}
                                            <span className={`text-[9px] font-bold uppercase tracking-wider truncate block ${
                                                isAdmin ? 'text-brand' : 'text-emerald-600 dark:text-emerald-400'
                                            }`}>
                                                {isAdmin ? 'Administrador' : 'Cajero'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                {isSelected && <Check size={15} className="text-brand shrink-0" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
