import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

const renderIcon = (Icon, defaultProps) => {
    if (!Icon) return null;
    if (React.isValidElement(Icon)) {
        return Icon;
    }
    return <Icon {...defaultProps} />;
};

export default function CustomSelect({ value, onChange, options, className = '', placeholder = 'Seleccionar...', openDirection = 'down' }) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    const selectedOption = options.find(opt => opt.value === value);
    const selectedIcon = selectedOption?.icon;

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm flex items-center justify-between text-left border border-transparent shadow-sm transition-all cursor-pointer"
            >
                <span className="flex items-center gap-2.5 truncate">
                    {renderIcon(selectedIcon, { size: 18, className: "text-slate-400 dark:text-slate-500 shrink-0" })}
                    <span>{selectedOption ? selectedOption.label : placeholder}</span>
                </span>
                <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
                <div className={`absolute left-0 right-0 max-h-60 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-[60] py-1 scrollbar-hide animate-in fade-in duration-100 ${
                    openDirection === 'up' 
                        ? 'bottom-full mb-1.5 slide-in-from-bottom-2' 
                        : 'top-full mt-1.5 slide-in-from-top-2'
                }`}>
                    {options.map((opt) => {
                        const optIcon = opt.icon;
                        const isSelected = opt.value === value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => {
                                    onChange(opt.value);
                                    setIsOpen(false);
                                }}
                                className={`w-full px-4 py-2.5 text-sm font-bold text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2.5 cursor-pointer ${
                                    isSelected 
                                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400' 
                                        : 'text-slate-700 dark:text-slate-350'
                                }`}
                            >
                                {renderIcon(optIcon, { size: 18, className: `shrink-0 ${isSelected ? 'text-emerald-650 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}` })}
                                <span className="truncate">{opt.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
