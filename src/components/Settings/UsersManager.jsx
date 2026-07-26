import React, { useState, useEffect, useMemo } from 'react';
import { useAuthStore, _generateRandomPin } from '../../hooks/store/useAuthStore';
import { showToast } from '../Toast';
import { verifyPin } from '../../utils/crypto';
import { PIN_POLICY } from '../../utils/securityConstants';
import { supabaseCloud } from '../../config/supabaseCloud';
import {
    UserPlus, Trash2, KeyRound, Shield, ShoppingCart,
    Crown, X, Check, Eye, EyeOff, AlertTriangle, Edit2,
    Copy, MessageCircle, RefreshCw
} from 'lucide-react';

const ROLE_CONFIG = {
    ADMIN: {
        label: 'Administrador',
        gradient: 'from-brand to-brand-dark',
        bg: 'bg-brand-light dark:bg-surface-800/20',
        text: 'text-brand-dark dark:text-brand',
        border: 'border-surface-300 dark:border-surface-800/40',
        icon: Shield,
    },
    CAJERO: {
        label: 'Cajero',
        gradient: 'from-emerald-500 to-teal-500',
        bg: 'bg-emerald-50 dark:bg-emerald-900/20',
        text: 'text-emerald-600 dark:text-emerald-400',
        border: 'border-emerald-200 dark:border-emerald-800/40',
        icon: ShoppingCart,
    }
};

function PinInput({ value, onChange, label, length = 6, showDigits = false }) {
    const digits = (value || '').padEnd(length, '').slice(0, length).split('');

    const handleChange = (index, digit) => {
        if (!/^\d?$/.test(digit)) return;
        const newDigits = [...digits];
        newDigits[index] = digit;
        onChange(newDigits.join('').replace(/ /g, ''));

        if (digit && index < length - 1) {
            const next = document.getElementById(`pin-${label}-${index + 1}`);
            next?.focus();
        }
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            const prev = document.getElementById(`pin-${label}-${index - 1}`);
            prev?.focus();
        }
    };

    return (
        <div className="flex gap-2 justify-center">
            {Array.from({ length }).map((_, i) => (
                <input
                    key={i}
                    id={`pin-${label}-${i}`}
                    type={showDigits ? "text" : "password"}
                    inputMode="numeric"
                    maxLength={1}
                    value={digits[i]?.trim() || ''}
                    onChange={e => handleChange(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    className="w-10 h-12 text-center text-lg font-black bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:border-brand focus:ring-2 focus:ring-brand/30 outline-none text-slate-800 dark:text-white transition-all"
                />
            ))}
        </div>
    );
}

// ─── User Row ──────────────────────────────────────
function UserRow({ user, currentUserId, onChangePin, onDelete, onEditName, onToggleBypassPin, triggerHaptic }) {
    const roleConf = ROLE_CONFIG[user.rol] || ROLE_CONFIG.CAJERO;
    const RoleIcon = roleConf.icon;
    const isCurrentUser = user.id === currentUserId;
    const isAdmin = user.rol === 'ADMIN';
    const [showUserPin, setShowUserPin] = useState(false);

    return (
        <div className={`p-3.5 sm:p-4 rounded-2xl border transition-all space-y-3 ${
            isCurrentUser 
                ? 'bg-brand-light/50 dark:bg-surface-800/10 border-surface-300/50 dark:border-surface-800/30' 
                : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800'
        }`}>
            {/* Fila Principal: Avatar, Nombre/Rol y Acciones de Edición */}
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Avatar */}
                    <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br ${roleConf.gradient} flex items-center justify-center shrink-0 shadow-sm relative`}>
                        <span className="text-white font-black text-base sm:text-lg">{(user.nombre || 'U')[0].toUpperCase()}</span>
                        {isAdmin && (
                            <div className="absolute -top-2 left-1/2 -translate-x-1/2">
                                <Crown size={12} className="text-yellow-400 fill-yellow-400 drop-shadow-sm" />
                            </div>
                        )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-black text-slate-800 dark:text-white truncate">{user.nombre}</p>
                            {isCurrentUser && (
                                <span className="text-[8px] font-black uppercase tracking-wider bg-brand-light dark:bg-surface-800/30 text-brand px-1.5 py-0.5 rounded-full">Tu</span>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <RoleIcon size={11} className={roleConf.text} />
                            <span className={`text-[9.5px] font-black uppercase tracking-wider ${roleConf.text}`}>
                                {roleConf.label}
                            </span>
                            {user.bypassPin && (
                                <span className="text-[8.5px] font-black uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-md">
                                    Sin PIN
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Acciones principales (Nombre y Borrar) */}
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        onClick={() => { triggerHaptic?.(); onEditName(user); }}
                        className="p-2 rounded-xl text-slate-400 hover:text-brand hover:bg-brand-light dark:hover:bg-surface-800/20 transition-all active:scale-90 cursor-pointer"
                        title="Editar Nombre"
                    >
                        <Edit2 size={16} />
                    </button>
                    {!isCurrentUser && (
                        <button
                            onClick={() => { triggerHaptic?.(); onDelete(user); }}
                            className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all active:scale-90 cursor-pointer"
                            title="Eliminar Usuario"
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Fila Inferior / Control de PIN (Totalmente Responsiva) */}
            <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                {/* Indicador de Estado de PIN */}
                {!user.bypassPin ? (
                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700/80">
                        🔒 PIN activo
                    </span>
                ) : (
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-xl border border-emerald-200 dark:border-emerald-800">
                        🔓 Sin PIN (Entra directo)
                    </span>
                )}

                {/* Controles de PIN (Cambiar PIN / Restablecer PIN + Toggle Sin PIN) */}
                <div className="flex items-center gap-2 ml-auto">
                    {!user.bypassPin && (
                        <button
                            onClick={() => { triggerHaptic?.(); onChangePin(user); }}
                            className="px-2.5 py-1 rounded-xl bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[10px] font-black uppercase flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                            title={isCurrentUser ? "Cambiar mi PIN" : "Restablecer PIN del usuario"}
                        >
                            <KeyRound size={13} /> {isCurrentUser ? 'Cambiar PIN' : 'Restablecer PIN'}
                        </button>
                    )}

                    {!isCurrentUser && user.rol !== 'ADMIN' && (
                        <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={user.bypassPin === true}
                                onChange={() => { triggerHaptic?.(); onToggleBypassPin(user); }}
                                className="w-3.5 h-3.5 rounded text-brand focus:ring-brand accent-brand cursor-pointer"
                            />
                            <span className="text-[10.5px] text-slate-600 dark:text-slate-300 font-extrabold uppercase">Sin PIN</span>
                        </label>
                    )}
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════ MAIN
export default function UsersManager({ triggerHaptic, onQueueChange }) {
    const { usuarios, usuarioActivo, agregarUsuario, eliminarUsuario, cambiarPin, editarUsuario } = useAuthStore();

    // Catálogo de usuarios sincronizado desde la caja principal si existe
    const [syncedUsers, setSyncedUsers] = useState(() => {
        try {
            const raw = localStorage.getItem('bodega_users_catalog_v1');
            const arr = raw ? JSON.parse(raw) : null;
            if (Array.isArray(arr) && arr.length > 0) return arr;
        } catch {}
        return null;
    });

    useEffect(() => {
        const handleSync = () => {
            try {
                const raw = localStorage.getItem('bodega_users_catalog_v1');
                const arr = raw ? JSON.parse(raw) : null;
                if (Array.isArray(arr) && arr.length > 0) setSyncedUsers(arr);
            } catch {}
        };
        window.addEventListener('app_storage_update', handleSync);
        window.addEventListener('storage', handleSync);
        return () => {
            window.removeEventListener('app_storage_update', handleSync);
            window.removeEventListener('storage', handleSync);
        };
    }, []);

    const displayUsers = syncedUsers && syncedUsers.length > 0 ? syncedUsers : usuarios;

    // Helper para encolar cambios de usuario en la cola de 'Subir al Sistema' (solo en modo Monitor via onQueueChange prop)
    const pushRemoteUserCmd = (userAction, payload) => {
        if (!onQueueChange) return;
        onQueueChange('user_update', 'user_' + (payload.userId || Date.now()), { action: userAction, ...payload });
    };

    // Helper para publicar el catálogo sanitizado de usuarios en la nube (caja principal)
    const publishUserCatalog = async (users) => {
        try {
            const { pushLocalSync } = await import('../../hooks/useCloudSync');
            const { sanitizeUserCatalog } = await import('../../utils/userCatalog');
            pushLocalSync('bodega_users_catalog_v1', sanitizeUserCatalog(users));
        } catch (e) {
            console.warn('[UsersManager] No se pudo publicar el catálogo de usuarios:', e);
        }
    };

    // States
    const [showAddForm, setShowAddForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [newRole, setNewRole] = useState('CAJERO');
    const [newPin, setNewPin] = useState('');
    const [newBypassPin, setNewBypassPin] = useState(false);

    const [changePinUser, setChangePinUser] = useState(null);
    const [changePinStep, setChangePinStep] = useState(1); // 1 = actual, 2 = nuevo, 3 = confirmar
    const [currentPinValue, setCurrentPinValue] = useState('');
    const [pinValue, setPinValue] = useState('');
    const [confirmPinValue, setConfirmPinValue] = useState('');
    const [showPin, setShowPin] = useState(false);

    const [deleteUser, setDeleteUser] = useState(null);

    const [editNameUser, setEditNameUser] = useState(null);
    const [editNameValue, setEditNameValue] = useState('');

    const handleStartChangePin = (user) => {
        setChangePinUser(user);
        const isSelf = usuarioActivo?.id === user.id;
        if (isSelf) {
            setChangePinStep(1);
            setCurrentPinValue('');
            setPinValue('');
            setConfirmPinValue('');
            setShowPin(false);
        } else {
            // Acción de Admin/Supervisor: Restablecimiento en 1 solo paso con PIN sugerido aleatorio
            setChangePinStep(2);
            setCurrentPinValue('');
            setPinValue(_generateRandomPin());
            setConfirmPinValue('');
            setShowPin(true);
        }
    };

    // ─── Handlers ────────────────────────────────────
    const handleAdd = () => {
        const requiredLen = PIN_POLICY.MIN_LENGTH;
        if (!newName.trim()) return showToast('Ingresa un nombre', 'error');
        if (!newBypassPin) {
            if (newPin.length !== requiredLen) return showToast(`El PIN debe tener ${requiredLen} dígitos`, 'error');
            if (displayUsers.some(u => u.pin === newPin)) return showToast('Ese PIN ya esta en uso', 'error');
        }

        const res = agregarUsuario(newName.trim(), newRole, newBypassPin ? '' : newPin, newBypassPin);
        pushRemoteUserCmd('add', { nombre: newName.trim(), rol: newRole, newPin: newBypassPin ? '' : newPin, bypassPin: newBypassPin });
        
        // Actualización optimista de estado local y publicación usando maxId + 1
        setSyncedUsers(prev => {
            const current = prev && prev.length > 0 ? prev : usuarios;
            const nextId = current.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0) + 1;
            const fresh = [...current, { id: nextId, nombre: newName.trim(), rol: newRole, plainPin: newBypassPin ? '' : newPin, bypassPin: newBypassPin }];
            try { localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(fresh)); } catch {}
            publishUserCatalog(fresh);
            return fresh;
        });

        res?.done?.then(() => {
            publishUserCatalog(useAuthStore.getState().usuarios);
        });

        showToast(`Usuario "${newName.trim()}" creado`, 'success');
        triggerHaptic?.();
        setNewName('');
        setNewRole('CAJERO');
        setNewPin('');
        setNewBypassPin(false);
        setShowAddForm(false);
    };

    const handleToggleBypassPin = (user) => {
        const newVal = !user.bypassPin;
        editarUsuario(user.id, { bypassPin: newVal });
        pushRemoteUserCmd('edit', { userId: user.id, bypassPin: newVal });

        // Actualización optimista instantánea (0ms de lag)
        setSyncedUsers(prev => {
            const current = prev && prev.length > 0 ? prev : usuarios;
            const fresh = current.map(u => u.id === user.id ? { ...u, bypassPin: newVal } : u);
            try { localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(fresh)); } catch {}
            publishUserCatalog(fresh);
            return fresh;
        });

        showToast(newVal ? `"${user.nombre}" ahora entra sin PIN` : `"${user.nombre}" ahora requiere PIN`, 'success');
    };

    const handleNextStep1 = async () => {
        const requiredLen = PIN_POLICY.MIN_LENGTH;
        if (currentPinValue.length !== requiredLen) {
            return showToast(`El PIN debe tener ${requiredLen} dígitos`, 'error');
        }

        const userInDb = displayUsers.find(u => u.id === changePinUser.id);
        if (!userInDb) return showToast('Usuario no encontrado', 'error');

        try {
            let isMatch = false;
            // 1. Verificación directa contra PIN en claro, plainPin o PIN por defecto
            if (userInDb.pin === currentPinValue || userInDb.plainPin === currentPinValue || !userInDb.pin) {
                isMatch = true;
            } else {
                // 2. Verificación criptográfica (PBKDF2 / SHA256)
                const check = await verifyPin(currentPinValue, userInDb.pin);
                if (check.valid) isMatch = true;
            }

            if (!isMatch) {
                return showToast('El PIN actual es incorrecto', 'error');
            }
            setChangePinStep(2);
            setShowPin(true);
            triggerHaptic?.();
        } catch (e) {
            if (userInDb?.pin === currentPinValue || userInDb?.plainPin === currentPinValue) {
                setChangePinStep(2);
                setShowPin(true);
                triggerHaptic?.();
            } else {
                showToast('Error al verificar el PIN', 'error');
            }
        }
    };

    const handleNextStep2 = () => {
        const requiredLen = PIN_POLICY.MIN_LENGTH;
        if (pinValue.length !== requiredLen) {
            return showToast(`El PIN debe tener ${requiredLen} dígitos`, 'error');
        }
        
        if (pinValue === currentPinValue) {
            return showToast('El nuevo PIN no puede ser igual al actual', 'warning');
        }

        setChangePinStep(3);
        setShowPin(false);
        triggerHaptic?.();
    };

    const handleChangePin = () => {
        const requiredLen = PIN_POLICY.MIN_LENGTH;
        const isSelf = usuarioActivo?.id === changePinUser?.id;
        
        if (isSelf && pinValue !== confirmPinValue) {
            return showToast('Los PINs no coinciden', 'error');
        }

        if (pinValue.length !== requiredLen) {
            return showToast(`El PIN debe tener ${requiredLen} dígitos`, 'error');
        }

        const res = cambiarPin(changePinUser.id, pinValue);
        if (res && res.error) {
            return showToast(res.error, 'error');
        }

        pushRemoteUserCmd('change_pin', { userId: changePinUser.id, newPin: pinValue });

        // Actualización optimista de estado local y publicación
        setSyncedUsers(prev => {
            const current = prev && prev.length > 0 ? prev : usuarios;
            const fresh = current.map(u => u.id === changePinUser.id ? { ...u, plainPin: pinValue } : u);
            try { localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(fresh)); } catch {}
            publishUserCatalog(fresh);
            return fresh;
        });

        res?.done?.then(() => {
            publishUserCatalog(useAuthStore.getState().usuarios);
        });

        showToast(isSelf ? `Tu PIN ha sido actualizado` : `PIN de ${changePinUser.nombre} restablecido`, 'success');
        triggerHaptic?.();
        
        // Reset
        setChangePinUser(null);
        setChangePinStep(1);
        setCurrentPinValue('');
        setPinValue('');
        setConfirmPinValue('');
        setShowPin(false);
    };

    const handleDelete = () => {
        const result = eliminarUsuario(deleteUser.id);
        if (result === false) {
            showToast('No se puede eliminar este usuario', 'error');
        } else {
            pushRemoteUserCmd('delete', { userId: deleteUser.id });
            setSyncedUsers(prev => {
                const current = prev && prev.length > 0 ? prev : usuarios;
                const fresh = current.filter(u => u.id !== deleteUser.id);
                try { localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(fresh)); } catch {}
                publishUserCatalog(fresh);
                return fresh;
            });
            showToast(`"${deleteUser.nombre}" eliminado`, 'success');
            triggerHaptic?.();
        }
        setDeleteUser(null);
    };

    const handleEditName = () => {
        if (!editNameValue.trim()) return showToast('Ingresa un nombre válido', 'error');
        editarUsuario(editNameUser.id, { nombre: editNameValue.trim() });
        pushRemoteUserCmd('edit', { userId: editNameUser.id, nombre: editNameValue.trim() });
        setSyncedUsers(prev => {
            const current = prev && prev.length > 0 ? prev : usuarios;
            const fresh = current.map(u => u.id === editNameUser.id ? { ...u, nombre: editNameValue.trim() } : u);
            try { localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(fresh)); } catch {}
            publishUserCatalog(fresh);
            return fresh;
        });
        showToast(`Nombre actualizado a ${editNameValue.trim()}`, 'success');
        triggerHaptic?.();
        setEditNameUser(null);
        setEditNameValue('');
    };

    return (
        <div className="space-y-4">
            {/* User List */}
            <div className="space-y-2">
                {displayUsers.map(user => (
                    <UserRow
                        key={user.id}
                        user={user}
                        currentUserId={usuarioActivo?.id}
                        onChangePin={u => { setChangePinUser(u); setPinValue(''); setShowPin(false); }}
                        onEditName={u => { setEditNameUser(u); setEditNameValue(u.nombre); }}
                        onDelete={u => setDeleteUser(u)}
                        onToggleBypassPin={handleToggleBypassPin}
                        triggerHaptic={triggerHaptic}
                    />
                ))}
            </div>

            {/* Add Button / Form */}
            {!showAddForm ? (
                <button
                    onClick={() => { triggerHaptic?.(); setShowAddForm(true); }}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-brand-light dark:bg-surface-800/20 text-brand-dark dark:text-brand font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-brand-light dark:hover:bg-surface-800/40 transition-colors active:scale-[0.98] border border-dashed border-indigo-300 dark:border-surface-700"
                >
                    <UserPlus size={16} /> Agregar Usuario
                </button>
            ) : (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-surface-300 dark:border-surface-800/40 p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                            <UserPlus size={16} className="text-brand" /> Nuevo Usuario
                        </h4>
                        <button onClick={() => setShowAddForm(false)} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
                            <X size={16} />
                        </button>
                    </div>

                    {/* Name */}
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Nombre</label>
                        <input
                            type="text"
                            placeholder="Ej: Maria, Juan"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                            autoFocus
                        />
                    </div>

                    {/* Role Selector */}
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Rol</label>
                        <div className="grid grid-cols-2 gap-2">
                            {Object.entries(ROLE_CONFIG).map(([key, conf]) => {
                                const Icon = conf.icon;
                                return (
                                    <button
                                        key={key}
                                        onClick={() => setNewRole(key)}
                                        className={`py-2.5 px-3 text-xs font-bold rounded-xl transition-all border flex items-center justify-center gap-2 ${newRole === key
                                            ? `${conf.bg} ${conf.border} ${conf.text} shadow-sm`
                                            : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                                        }`}
                                    >
                                        <Icon size={14} /> {conf.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Bypass PIN Toggle */}
                    <div className="flex items-center justify-between border-b border-slate-105 dark:border-slate-800/40 pb-3">
                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Acceso</label>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Permitir entrar sin PIN</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={newBypassPin}
                            onChange={e => setNewBypassPin(e.target.checked)}
                            className="w-4 h-4 rounded text-brand focus:ring-brand border-slate-300 dark:border-slate-700 dark:bg-slate-950"
                        />
                    </div>

                    {/* PIN */}
                    {!newBypassPin && (
                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-2">PIN de {PIN_POLICY.MIN_LENGTH} dígitos</label>
                            <PinInput value={newPin} onChange={setNewPin} label="new" length={PIN_POLICY.MIN_LENGTH} />
                        </div>
                    )}

                    {/* Submit */}
                    <button
                        onClick={handleAdd}
                        disabled={!newName.trim() || (!newBypassPin && newPin.length !== PIN_POLICY.MIN_LENGTH)}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-brand hover:bg-brand-dark disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all active:scale-[0.98] shadow-md shadow-primary/20 disabled:shadow-none"
                    >
                        <Check size={16} /> Crear Usuario
                    </button>
                </div>
            )}

            {/* ─── Change / Reset PIN Modal ────────────────────── */}
            {changePinUser && (() => {
                const isSelfChange = usuarioActivo?.id === changePinUser.id;
                return (
                    <div 
                        className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" 
                        onClick={() => { 
                            setChangePinUser(null); 
                            setChangePinStep(1);
                            setCurrentPinValue(''); 
                            setPinValue(''); 
                            setConfirmPinValue(''); 
                            setShowPin(false);
                        }}
                    >
                        <div 
                            className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 transition-all border border-slate-105 dark:border-slate-800" 
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Cabecera */}
                            <div className="text-center mb-5">
                                <div className={`w-12 h-12 mx-auto rounded-xl bg-gradient-to-br ${ROLE_CONFIG[changePinUser.rol]?.gradient || 'from-slate-500 to-slate-600'} flex items-center justify-center mb-2 shadow-md`}>
                                    <span className="text-white font-black text-xl">{(changePinUser.nombre || 'U')[0].toUpperCase()}</span>
                                </div>
                                <h3 className="text-base font-black text-slate-800 dark:text-white">
                                    {isSelfChange ? 'Cambiar mi PIN' : 'Restablecer PIN'}
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">{changePinUser.nombre} · {ROLE_CONFIG[changePinUser.rol]?.label}</p>
                                
                                {/* Indicador de pasos visual */}
                                {isSelfChange ? (
                                    <div className="flex justify-center gap-1.5 mt-3.5">
                                        {[1, 2, 3].map(step => (
                                            <div 
                                                key={step} 
                                                className={`h-1.5 rounded-full transition-all duration-300 ${
                                                    changePinStep === step 
                                                        ? 'w-6 bg-brand' 
                                                        : changePinStep > step 
                                                            ? 'w-2 bg-emerald-500' 
                                                            : 'w-2 bg-slate-200 dark:bg-slate-700'
                                                }`}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="mt-2.5">
                                        <span className="inline-block text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2.5 py-0.5 rounded-full border border-blue-200 dark:border-blue-800">
                                            Restablecimiento directo por Administración
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Contenido según el paso */}
                            <div className="min-h-[92px] flex flex-col justify-center animate-in fade-in slide-in-from-right-2 duration-200">
                                {changePinStep === 1 && isSelfChange && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] uppercase font-black text-slate-400 block text-center tracking-wider">PIN Actual</label>
                                        <PinInput 
                                            value={currentPinValue} 
                                            onChange={setCurrentPinValue} 
                                            label="current" 
                                            length={PIN_POLICY.MIN_LENGTH}
                                            showDigits={showPin}
                                        />
                                        <div className="flex flex-col items-center gap-1 pt-1">
                                            <p className="text-[9px] text-slate-400 text-center">Para verificar tu identidad</p>
                                            <button
                                                type="button"
                                                onClick={() => { triggerHaptic?.(); setChangePinStep(2); }}
                                                className="text-[10px] font-black text-blue-600 dark:text-blue-400 hover:underline cursor-pointer pt-0.5"
                                            >
                                                ⚡ Omitir y fijar Nuevo PIN directamente
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {changePinStep === 2 && (
                                    <div className="space-y-3">
                                        <label className="text-[10px] uppercase font-black text-slate-400 block text-center tracking-wider">
                                            {isSelfChange ? 'Nuevo PIN' : 'PIN Sugerido / Nuevo PIN'}
                                        </label>
                                        <PinInput 
                                            value={pinValue} 
                                            onChange={setPinValue} 
                                            label="change" 
                                            length={PIN_POLICY.MIN_LENGTH}
                                            showDigits={showPin}
                                        />
                                        
                                        {!isSelfChange ? (
                                            <div className="space-y-2 pt-1">
                                                <p className="text-[9.5px] text-slate-500 dark:text-slate-400 text-center font-medium">
                                                    PIN generado automáticamente. Se mostrará una sola vez.
                                                </p>

                                                {/* Acciones rápidas: Generar / Copiar / WhatsApp */}
                                                <div className="flex items-center justify-center gap-2 pt-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => { setPinValue(_generateRandomPin()); triggerHaptic?.(); }}
                                                        className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-bold flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                                                        title="Generar otro PIN aleatorio"
                                                    >
                                                        <RefreshCw size={12} /> Generar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(pinValue);
                                                            showToast('PIN copiado al portapapeles', 'success');
                                                            triggerHaptic?.();
                                                        }}
                                                        className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-bold flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                                                        title="Copiar PIN"
                                                    >
                                                        <Copy size={12} /> Copiar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const businessName = localStorage.getItem('business_name') || 'el sistema';
                                                            const msg = `Tu nuevo PIN de acceso para ${businessName} es: ${pinValue}`;
                                                            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
                                                            triggerHaptic?.();
                                                        }}
                                                        className="px-2.5 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                                                        title="Enviar PIN por WhatsApp"
                                                    >
                                                        <MessageCircle size={12} /> WhatsApp
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-[9px] text-slate-400 text-center">Debe tener {PIN_POLICY.MIN_LENGTH} dígitos no secuenciales</p>
                                        )}
                                    </div>
                                )}

                                {changePinStep === 3 && isSelfChange && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] uppercase font-black text-slate-400 block text-center tracking-wider">Confirmar Nuevo PIN</label>
                                        <PinInput 
                                            value={confirmPinValue} 
                                            onChange={setConfirmPinValue} 
                                            label="confirm" 
                                            length={PIN_POLICY.MIN_LENGTH}
                                            showDigits={showPin}
                                        />
                                        <p className="text-[9px] text-slate-400 text-center">Introduce el PIN de nuevo</p>
                                    </div>
                                )}
                            </div>

                            {/* Control de visibilidad */}
                            <div className="flex items-center justify-center gap-2 my-4">
                                <button
                                    onClick={() => setShowPin(!showPin)}
                                    className="text-[9px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1 hover:text-slate-650 transition-colors bg-slate-50 dark:bg-slate-800/40 px-2.5 py-1 rounded-full border border-slate-100 dark:border-slate-850 cursor-pointer"
                                >
                                    {showPin ? <EyeOff size={11} className="text-slate-500" /> : <Eye size={11} className="text-slate-500" />}
                                    {showPin ? 'Ocultar dígitos' : 'Mostrar dígitos'}
                                </button>
                            </div>

                            {/* Botones de acción */}
                            <div className="flex gap-2.5">
                                {changePinStep === 1 && isSelfChange && (
                                    <>
                                        <button
                                            onClick={() => { 
                                                setChangePinUser(null); 
                                                setChangePinStep(1);
                                                setCurrentPinValue(''); 
                                                setPinValue(''); 
                                                setConfirmPinValue(''); 
                                                setShowPin(false);
                                            }}
                                            className="flex-1 py-2.5 text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all cursor-pointer"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            onClick={handleNextStep1}
                                            disabled={currentPinValue.length !== PIN_POLICY.MIN_LENGTH}
                                            className="flex-1 py-2.5 text-xs font-bold text-white bg-brand rounded-xl hover:bg-brand-dark active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none shadow-md shadow-primary/10 cursor-pointer"
                                        >
                                            Continuar
                                        </button>
                                    </>
                                )}

                                {changePinStep === 2 && (
                                    <>
                                        <button
                                            onClick={() => {
                                                if (isSelfChange) {
                                                    setChangePinStep(1);
                                                    setShowPin(false);
                                                } else {
                                                    setChangePinUser(null);
                                                    setChangePinStep(1);
                                                    setCurrentPinValue('');
                                                    setPinValue('');
                                                    setConfirmPinValue('');
                                                    setShowPin(false);
                                                }
                                            }}
                                            className="flex-1 py-2.5 text-xs font-bold text-slate-500 bg-slate-150 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all cursor-pointer"
                                        >
                                            {isSelfChange ? 'Atrás' : 'Cancelar'}
                                        </button>

                                        <button
                                            onClick={isSelfChange ? handleNextStep2 : handleChangePin}
                                            disabled={pinValue.length !== PIN_POLICY.MIN_LENGTH}
                                            className="flex-1 py-2.5 text-xs font-bold text-white bg-brand rounded-xl hover:bg-brand-dark active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none shadow-md shadow-primary/10 cursor-pointer"
                                        >
                                            {isSelfChange ? 'Continuar' : 'Guardar PIN'}
                                        </button>
                                    </>
                                )}

                                {changePinStep === 3 && isSelfChange && (
                                    <>
                                        <button
                                            onClick={() => { setChangePinStep(2); setShowPin(false); }}
                                            className="flex-1 py-2.5 text-xs font-bold text-slate-500 bg-slate-150 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all cursor-pointer"
                                        >
                                            Atrás
                                        </button>
                                        <button
                                            onClick={handleChangePin}
                                            disabled={confirmPinValue.length !== PIN_POLICY.MIN_LENGTH}
                                            className="flex-1 py-2.5 text-xs font-bold text-white bg-brand rounded-xl hover:bg-brand-dark active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none shadow-md shadow-primary/10 cursor-pointer"
                                        >
                                            Guardar
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* ─── Delete Confirmation ─────────────────── */}
            {deleteUser && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setDeleteUser(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-xs shadow-2xl animate-in zoom-in-95 duration-200 text-center" onClick={e => e.stopPropagation()}>
                        <div className="w-14 h-14 mx-auto bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center mb-4">
                            <AlertTriangle size={28} />
                        </div>
                        <h3 className="text-lg font-black text-slate-800 dark:text-white mb-2">Eliminar Usuario</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                            ¿Seguro que deseas eliminar a <strong>"{deleteUser.nombre}"</strong>? Esta accion no se puede deshacer.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteUser(null)}
                                className="flex-1 py-3 text-sm font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl active:scale-95 transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleDelete}
                                className="flex-1 py-3 text-sm font-bold text-white bg-red-500 rounded-xl hover:bg-red-600 active:scale-95 transition-all"
                            >
                                Si, eliminar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Edit Name Modal ────────────────────── */}
            {editNameUser && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setEditNameUser(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-xs shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="text-center mb-6">
                            <div className={`w-14 h-14 mx-auto rounded-xl bg-gradient-to-br ${ROLE_CONFIG[editNameUser.rol]?.gradient || 'from-slate-500 to-slate-600'} flex items-center justify-center mb-3`}>
                                <span className="text-white font-black text-2xl">{(editNameUser.nombre || 'U')[0].toUpperCase()}</span>
                            </div>
                            <h3 className="text-lg font-black text-slate-800 dark:text-white">Cambiar Nombre</h3>
                            <p className="text-xs text-slate-400 mt-1">{editNameUser.rol}</p>
                        </div>

                        <div className="mb-6">
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5 ml-1">Nuevo Nombre</label>
                            <input
                                autoFocus
                                type="text"
                                value={editNameValue}
                                onChange={e => setEditNameValue(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-brand/30 outline-none text-slate-800 dark:text-white transition-all text-center"
                                placeholder="..."
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setEditNameUser(null)}
                                className="flex-1 py-3 text-sm font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleEditName}
                                disabled={!editNameValue.trim()}
                                className="flex-1 py-3 text-sm font-bold text-white bg-brand rounded-xl hover:bg-brand-dark active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
