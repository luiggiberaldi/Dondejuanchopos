import React from 'react';
import { CheckCircle, LogOut } from 'lucide-react';

export default function MonitorOverlays({ AlertTriangle, BsCongeladoAlertBanner, BsCongeladoWizardModal, Clock, ComboFormModal, Lock, RefreshCw, RemoteEmployeeModal, RemoteProductFormModal, SaleDetailModal, StockAdjustModal, SupervisorPairingModal, SupervisorRateModal, Trash2, UploadCloud, Users, UsersManager, X, activeShiftMetrics, bcvRate, bsCongeladoAlert, bsRoundingStep, cancelAllCloudCmds, cancelSingleCloudCmd, cancellingCmdId, categories, closeBsCongeladoWizard, closingRemote, cloudPendingCmds, confirmVoidConsumptionTarget, copEnabled, deleteEmployeeTarget, discardPendingChanges, editingCombo, editingEmployee, effectiveRate, executeDeleteRemoteEmployee, executeVoidConsumptionSupervisor, getSupervisorCommandDetails, handleDisconnect, handleRemoteForceDailyClose, handleSaveRemoteEmployee, hasInventoryChanges, inFlightChanges, isBsWizardOpen, isConnected, isPosOnline, openBsCongeladoWizard, pairedDeviceId, payrollDetail, pendingChanges, pendingVoidSaleIds, previousRate, products, projectedProducts, queueInventoryChange, rates, remoteDeleteTarget, remoteEditingProduct, selectedSaleDetail, setConfirmVoidConsumptionTarget, setDeleteEmployeeTarget, setEditingCombo, setEditingEmployee, setPendingVoidCommands, setPendingVoidSaleIds, setRemoteDeleteTarget, setRemoteEditingProduct, setSelectedSaleDetail, setShowCloudPendingModal, setShowComboModal, setShowCreateEmployeeModal, setShowDiscardQueueModal, setShowDisconnectConfirm, setShowPairingModal, setShowRateModal, setShowRemoteCloseModal, setShowRemoteForm, setShowUsersModal, setStockAdjustProduct, showCloudPendingModal, showComboModal, showCreateEmployeeModal, showDiscardQueueModal, showDisconnectConfirm, showPairingModal, showRateModal, showRemoteCloseModal, showRemoteForm, showToast, showUsersModal, stockAdjustProduct, supervisorUser, tasaCop, triggerHaptic, uploadPendingChanges, uploading, usuarios, viewTab, voidingConsumption }) {
    return (
<>
            {showDisconnectConfirm && (
                <div className="fixed inset-0 z-[999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full shadow-2xl space-y-5 animate-scale-in">
                        <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/20 rounded-2xl flex items-center justify-center text-rose-500 mx-auto">
                            <LogOut size={22} />
                        </div>
                        <div className="space-y-1.5 text-center">
                            <h4 className="text-base font-black text-slate-800 dark:text-white">Desvincular Supervisor</h4>
                            <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                                ¿Estás seguro de que deseas desvincular este dispositivo? Se perderá el acceso en tiempo real a las transacciones de esta caja.
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => { triggerHaptic?.(); setShowDisconnectConfirm(false); }}
                                className="flex-1 py-3 px-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-350 font-black text-xs rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => { 
                                    setShowDisconnectConfirm(false);
                                    handleDisconnect();
                                }}
                                className="flex-1 py-3 px-4 bg-rose-500 hover:bg-rose-600 text-white font-black text-xs rounded-2xl shadow-lg shadow-rose-500/20 transition-colors"
                            >
                                Desvincular
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Confirmación para Cancelar Cola Local */}
            {showDiscardQueueModal && (
                <div className="fixed inset-0 z-[999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full shadow-2xl space-y-5 animate-scale-in">
                        <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/20 rounded-2xl flex items-center justify-center text-rose-500 mx-auto">
                            <Trash2 size={22} />
                        </div>
                        <div className="space-y-1.5 text-center">
                            <h4 className="text-base font-black text-slate-800 dark:text-white">¿Cancelar Cola de Cambios?</h4>
                            <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                                Se descartarán los <strong>{pendingChanges.length} cambio(s)</strong> pendientes en este navegador sin ser enviados a la caja principal.
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => { triggerHaptic?.(); setShowDiscardQueueModal(false); }}
                                className="flex-1 py-3 px-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-350 font-black text-xs rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors"
                            >
                                Volver
                            </button>
                            <button
                                onClick={() => { 
                                    triggerHaptic?.();
                                    discardPendingChanges();
                                    setShowDiscardQueueModal(false);
                                }}
                                className="flex-1 py-3 px-4 bg-rose-500 hover:bg-rose-600 text-white font-black text-xs rounded-2xl shadow-lg shadow-rose-500/20 transition-colors"
                            >
                                Sí, Cancelar Todo
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Modal de Cambio de Tasa */}
            <SupervisorRateModal
                isOpen={showRateModal}
                onClose={() => setShowRateModal(false)}
                rates={rates}
                primaryDeviceId={pairedDeviceId}
                triggerHaptic={triggerHaptic}
                onOpenBsWizard={openBsCongeladoWizard}
            />

            {/* Formulario remoto de producto (encola add/edit) */}
            <RemoteProductFormModal
                isOpen={showRemoteForm}
                onClose={() => { setShowRemoteForm(false); setRemoteEditingProduct(null); }}
                editingProduct={remoteEditingProduct}
                onSubmit={(action, productId, data) => queueInventoryChange(action, productId, data)}
                effectiveRate={effectiveRate}
                bcvRate={bcvRate}
            />

            {/* Modal de Crear / Editar Empleado Remoto (Supervisor) */}
            <RemoteEmployeeModal
                isOpen={showCreateEmployeeModal}
                onClose={() => {
                    setShowCreateEmployeeModal(false);
                    setEditingEmployee(null);
                }}
                onSubmit={handleSaveRemoteEmployee}
                usuarios={usuarios}
                editingEmployee={editingEmployee}
            />

            {/* Confirmación inline de eliminación definitiva de empleado (Regla #15: sin window.confirm) */}
            {deleteEmployeeTarget && (
                <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-rose-50 dark:bg-rose-950/30 rounded-2xl flex items-center justify-center shrink-0">
                                <Trash2 size={18} className="text-rose-500" />
                            </div>
                            <div>
                                <h3 className="font-black text-slate-800 dark:text-white text-sm">¿Eliminar empleado definitivamente?</h3>
                                <p className="text-[10px] text-slate-400 font-bold">Confirmación final · Acción irreversible</p>
                            </div>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                            «<span className="font-black text-slate-700 dark:text-slate-200">{deleteEmployeeTarget.employeeNombre || deleteEmployeeTarget.nombre || 'Este empleado'}</span>»
                            será eliminado del sistema y el comando se enviará a la caja principal.
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setDeleteEmployeeTarget(null)}
                                className="flex-1 py-2.5 rounded-2xl font-black text-xs uppercase text-slate-500 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => executeDeleteRemoteEmployee()}
                                className="flex-1 py-2.5 rounded-2xl font-black text-xs uppercase text-white bg-rose-500 hover:bg-rose-600 shadow-lg shadow-rose-500/25 transition-colors"
                            >
                                Eliminar definitivamente
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Formulario/Wizard remoto de combos */}
            <ComboFormModal
                isOpen={showComboModal}
                onClose={() => { setShowComboModal(false); setEditingCombo(null); }}
                products={projectedProducts}
                categories={categories}
                effectiveRate={effectiveRate}
                bcvRate={bcvRate}
                copEnabled={copEnabled}
                tasaCop={tasaCop}
                onSave={(comboData) => {
                    const finalData = editingCombo ? { ...comboData, baseUpdatedAt: editingCombo.updatedAt } : comboData;
                    queueInventoryChange(editingCombo ? 'edit' : 'add', comboData.id, finalData);
                    setShowComboModal(false);
                    setEditingCombo(null);
                    showToast(editingCombo ? 'Cambio de combo encolado' : 'Combo encolado para enviar a la caja', 'success');
                }}
                editingCombo={editingCombo}
            />

            {/* Confirmación de eliminación remota */}
            {remoteDeleteTarget && (
                <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-rose-50 dark:bg-rose-950/30 rounded-2xl flex items-center justify-center shrink-0">
                                <Trash2 size={18} className="text-rose-500" />
                            </div>
                            <div>
                                <h3 className="font-black text-slate-800 dark:text-white text-sm">¿Eliminar producto?</h3>
                                <p className="text-[10px] text-slate-400 font-bold">Se encolará para enviar a la caja</p>
                            </div>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                            «<span className="font-black text-slate-700 dark:text-slate-200">{remoteDeleteTarget.name}</span>» será eliminado del inventario de la caja al subir los cambios.
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setRemoteDeleteTarget(null)}
                                className="flex-1 py-2.5 rounded-2xl font-black text-xs uppercase text-slate-500 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => { triggerHaptic?.(); queueInventoryChange('delete', remoteDeleteTarget.id, null); setRemoteDeleteTarget(null); }}
                                className="flex-1 py-2.5 rounded-2xl font-black text-xs uppercase text-white bg-rose-500 hover:bg-rose-600 shadow-lg shadow-rose-500/25 transition-colors"
                            >
                                Encolar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Gestión / Anulación de Comandos Pendientes en la Nube */}
            {showCloudPendingModal && (
                <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowCloudPendingModal(false)}>
                    <div className="bg-white dark:bg-slate-900 w-full sm:max-w-lg rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 font-black shrink-0">
                                    <Clock size={20} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-slate-800 dark:text-white">Comandos en Espera ({cloudPendingCmds.length})</h3>
                                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">Subidos a la nube · Pendientes por aplicar en la caja</p>
                                </div>
                            </div>
                            <button onClick={() => setShowCloudPendingModal(false)} className="p-2 rounded-2xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-4 space-y-3 overflow-y-auto flex-1 custom-scrollbar">
                            {cloudPendingCmds.length === 0 ? (
                                <div className="py-8 text-center text-slate-400">
                                    <CheckCircle size={32} className="mx-auto mb-2 text-emerald-500 opacity-60" />
                                    <p className="text-xs font-bold">No hay cambios pendientes en la nube</p>
                                </div>
                            ) : (
                                cloudPendingCmds.map(cmd => {
                                    const info = getSupervisorCommandDetails(cmd, products);
                                    const payload = cmd.payload || {};
                                    const formattedTime = new Date(cmd.created_at || payload.issuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                                    return (
                                        <div key={cmd.id} className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-3">
                                            <div className="min-w-0 space-y-1 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`text-[9.5px] font-black uppercase px-2 py-0.5 rounded-md ${info.actionColor}`}>
                                                        {info.actionLabel}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 font-bold">{formattedTime}</span>
                                                    {info.author && (
                                                        <span className="text-[10px] text-slate-400 font-medium ml-auto">Por: {info.author}</span>
                                                    )}
                                                </div>
                                                <p className="text-xs font-black text-slate-800 dark:text-white truncate">
                                                    {info.title}
                                                </p>
                                                {info.details.length > 0 && (
                                                    <div className="flex items-center gap-1 flex-wrap pt-0.5">
                                                        {info.details.map((det, dIdx) => (
                                                            <span key={dIdx} className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                                {det}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            <button
                                                onClick={() => cancelSingleCloudCmd(cmd.id)}
                                                disabled={cancellingCmdId === cmd.id}
                                                className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 text-[10.5px] font-black uppercase transition-colors shrink-0 disabled:opacity-40"
                                            >
                                                {cancellingCmdId === cmd.id ? 'Anulando...' : 'Anular 🚫'}
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {cloudPendingCmds.length > 0 && (
                            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 flex gap-2">
                                <button onClick={() => setShowCloudPendingModal(false)} className="flex-1 py-2.5 rounded-2xl font-black text-xs uppercase text-slate-500 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                                    Cerrar
                                </button>
                                <button onClick={cancelAllCloudCmds} className="flex-1 py-2.5 rounded-2xl font-black text-xs uppercase text-white bg-rose-500 hover:bg-rose-600 shadow-md shadow-rose-500/20 transition-colors">
                                    Anular Todos ({cloudPendingCmds.length})
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Barra flotante «Subir al sistema» — ultra compacta y de 1 sola fila */}
            {hasInventoryChanges && viewTab === 'inventario' && (
                <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[250] w-[94%] sm:w-full max-w-lg px-2 sm:px-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className="bg-[#193275] dark:bg-slate-900 border border-white/20 text-white rounded-2xl p-2.5 sm:p-3 shadow-2xl backdrop-blur-md flex items-center justify-between gap-2">
                        {/* Texto descriptivo */}
                        <div className="flex items-center gap-2 min-w-0 pl-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping shrink-0" />
                            <div className="min-w-0">
                                <p className="text-xs font-black leading-tight truncate">
                                    {pendingChanges.length > 0
                                        ? `${pendingChanges.length} cambio${pendingChanges.length !== 1 ? 's' : ''} en cola`
                                        : `${inFlightChanges.length} cambio${inFlightChanges.length !== 1 ? 's' : ''} en confirmación`}
                                </p>
                                <p className="text-[9.5px] text-slate-300 font-medium leading-none mt-0.5 hidden sm:block truncate">
                                    {pendingChanges.length > 0 ? 'Aún no se han enviado a la caja' : 'Esperando confirmación de la caja'}
                                </p>
                            </div>
                        </div>

                        {/* Botones de Acción */}
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button
                                onClick={() => { triggerHaptic?.(); discardPendingChanges(); }}
                                disabled={uploading}
                                title="Descartar cambios"
                                className="px-2.5 py-1.5 rounded-xl text-[10px] font-black uppercase text-slate-300 hover:text-white bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-40 cursor-pointer"
                            >
                                Descartar
                            </button>
                            {pendingChanges.length > 0 && (
                                <button
                                    onClick={() => { triggerHaptic?.(); uploadPendingChanges(); }}
                                    disabled={uploading || !isConnected}
                                    className="flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-[11px] font-black uppercase tracking-wider shadow-md shadow-emerald-500/30 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                >
                                    {uploading ? <RefreshCw size={13} className="animate-spin" /> : <UploadCloud size={13} />}
                                    <span>{uploading ? 'Subiendo...' : 'Subir al sistema'}</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Modal de Ajuste Rápido de Stock (+40, -10, Entrada/Salida) */}
            {stockAdjustProduct && (
                <StockAdjustModal
                    product={stockAdjustProduct}
                    onClose={() => setStockAdjustProduct(null)}
                    onConfirm={(productId, delta, extra) => queueInventoryChange('adjust_stock', productId, { delta, ...extra })}
                    triggerHaptic={triggerHaptic}
                />
            )}

            {/* Modal de Detalle Completo de Venta */}
            {selectedSaleDetail && (
                <SaleDetailModal
                    sale={selectedSaleDetail}
                    onClose={() => setSelectedSaleDetail(null)}
                    bcvRate={bcvRate}
                    effectiveRate={effectiveRate}
                    products={products}
                    pairedDeviceId={pairedDeviceId}
                    actor={supervisorUser}
                    pendingVoid={selectedSaleDetail?.id ? pendingVoidSaleIds.has(selectedSaleDetail.id) : false}
                    onVoidSaleSuccess={(saleId, commandId) => {
                        setPendingVoidSaleIds(previous => new Set(previous).add(saleId));
                        if (commandId) {
                            setPendingVoidCommands(previous => ({ ...previous, [saleId]: commandId }));
                        }
                    }}
                />
            )}

            {/* Modal de Vinculación de Dispositivos */}
            {showPairingModal && (
                <SupervisorPairingModal
                    onClose={() => setShowPairingModal(false)}
                    pairedDeviceId={pairedDeviceId}
                    triggerHaptic={triggerHaptic}
                />
            )}

            {/* Modal de Confirmación de Cierre Remoto de Caja */}
            {showRemoteCloseModal && (
                <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fade-in" onClick={() => !closingRemote && setShowRemoteCloseModal(false)}>
                    <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-amber-50/50 dark:bg-amber-950/20">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center font-black shrink-0 shadow-md shadow-amber-500/20">
                                    <Lock size={20} />
                                </div>
                                <div>
                                    <h3 className="text-base font-black text-slate-800 dark:text-white">Ejecutar Cierre Remoto</h3>
                                    <p className="text-xs text-slate-400 font-medium mt-0.5">Caja ID: {pairedDeviceId?.slice(0, 16)}...</p>
                                </div>
                            </div>
                            <button onClick={() => !closingRemote && setShowRemoteCloseModal(false)} className="p-2 rounded-2xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                                <X size={18} />
                            </button>
                        </div>
                        
                        <div className="p-5 sm:p-6 space-y-4">
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 space-y-2">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-slate-500 dark:text-slate-400 font-medium">Total Ventas (Turno Abierto):</span>
                                    <span className="font-black text-emerald-600 dark:text-emerald-400 text-sm">${activeShiftMetrics.totalUsd.toFixed(2)} USD</span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-slate-500 dark:text-slate-400 font-medium">Equivalente en Bolívares:</span>
                                    <span className="font-bold text-slate-700 dark:text-slate-200">Bs {activeShiftMetrics.totalBs.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-slate-500 dark:text-slate-400 font-medium">Ventas Acumuladas:</span>
                                    <span className="font-bold text-slate-700 dark:text-slate-200">{activeShiftMetrics.count} transacciones</span>
                                </div>
                            </div>

                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                                Al confirmar, se consolidarán todas las ventas abiertas (incluyendo las realizadas ayer y hoy) en un documento oficial de <strong>Cierre de Caja</strong>. La caja remota actualizará su estado automáticamente.
                            </p>

                            <div className="grid grid-cols-2 gap-3 pt-2">
                                <button
                                    onClick={() => setShowRemoteCloseModal(false)}
                                    disabled={closingRemote}
                                    className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 rounded-2xl font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleRemoteForceDailyClose}
                                    disabled={closingRemote}
                                    className="py-3 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-black text-xs transition-all shadow-md hover:shadow-amber-500/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                                >
                                    {closingRemote ? 'Procesando Cierre...' : '🔒 Confirmar Cierre'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Gestión de Usuarios y PINs */}
            {showUsersModal && (
                <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fade-in" onClick={() => setShowUsersModal(false)}>
                    <div className="bg-white dark:bg-slate-900 w-full sm:max-w-2xl rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/60 flex items-center justify-center text-blue-600 dark:text-blue-400 font-black shrink-0">
                                    <Users size={20} />
                                </div>
                                <div>
                                    <h3 className="text-base font-black text-slate-800 dark:text-white">Usuarios, Roles y PINs</h3>
                                    <p className="text-xs text-slate-400 font-medium mt-0.5">Consulta y gestiona los PINs de acceso de tu equipo</p>
                                </div>
                            </div>
                            <button onClick={() => setShowUsersModal(false)} className="p-2 rounded-2xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-4 sm:p-6 overflow-y-auto flex-1 custom-scrollbar space-y-4">
                            {!isPosOnline && (
                                <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/40 rounded-2xl flex items-center gap-3 text-amber-800 dark:text-amber-300 text-xs font-semibold shadow-xs">
                                    <AlertTriangle size={20} className="shrink-0 text-amber-600 dark:text-amber-400" />
                                    <div>
                                        <p className="font-black text-amber-900 dark:text-amber-200 leading-tight">Caja Principal Desconectada</p>
                                        <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium mt-0.5">Mostrando catálogo de usuarios de la última sincronización. Los cambios se enviarán y aplicarán en la caja automáticamente apenas vuelva a estar en línea.</p>
                                    </div>
                                </div>
                            )}
                            <UsersManager triggerHaptic={triggerHaptic} onQueueChange={queueInventoryChange} />
                        </div>

                        {/* Footer con botón "Subir al Sistema" si hay cambios pendientes */}
                        {pendingChanges.length > 0 && (
                            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-900 text-white flex items-center justify-between gap-3 animate-in slide-in-from-bottom-2 duration-200">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-black text-xs shrink-0 border border-amber-500/30">
                                        {pendingChanges.length}
                                    </div>
                                    <p className="text-xs font-black truncate">
                                        {pendingChanges.length} cambio{pendingChanges.length !== 1 ? 's' : ''} pendiente{pendingChanges.length !== 1 ? 's' : ''} por subir
                                    </p>
                                </div>
                                <button
                                    onClick={() => { triggerHaptic?.(); uploadPendingChanges(); }}
                                    disabled={uploading || !isConnected}
                                    className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-[11px] font-black uppercase tracking-wider shadow-md shadow-emerald-500/30 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
                                >
                                    {uploading ? <RefreshCw size={13} className="animate-spin" /> : <UploadCloud size={13} />}
                                    <span>{uploading ? 'Subiendo...' : 'Subir al sistema'}</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
            {/* Banner y Wizard para productos en Bs Congelado en Modo Supervisor */}
            <BsCongeladoAlertBanner />
            <BsCongeladoWizardModal
                isOpen={isBsWizardOpen}
                onClose={closeBsCongeladoWizard}
                prevRate={bsCongeladoAlert?.prevRate || previousRate || 0}
                newRate={effectiveRate}
                products={products}
                onSaveProducts={async (updatedList) => {
                    if (!updatedList || updatedList.length === 0) return;

                    const batchItems = updatedList.map(p => {
                        const changes = {
                            name: p.name,
                            priceUsd: p.priceUsd,
                            pricingMode: p.pricingMode || 'bs_fijo',
                            forceBcv: false,
                        };
                        if (p.priceBsManual !== undefined) changes.priceBsManual = p.priceBsManual;
                        if (p.boxPriceBsManual !== undefined) {
                            changes.boxPriceBsManual = p.boxPriceBsManual;
                            changes.boxPricingMode = p.boxPricingMode || 'bs_fijo';
                        }
                        if (p.halfBoxPriceBsManual !== undefined) {
                            changes.halfBoxPriceBsManual = p.halfBoxPriceBsManual;
                            changes.halfBoxPricingMode = p.halfBoxPricingMode || 'bs_fijo';
                        }

                        return {
                            productId: p.id,
                            data: changes
                        };
                    });

                    const batchCommand = {
                        action: 'batch_edit',
                        productId: 'batch_update',
                        data: { items: batchItems },
                        queuedAt: new Date().toISOString()
                    };

                    await uploadPendingChanges([batchCommand]);
                }}
                triggerHaptic={triggerHaptic}
                bsRoundingStep={bsRoundingStep}
            />

            {/* Modal Profesional de Confirmación para Anular Consumo de Empleado */}
            {confirmVoidConsumptionTarget && (
                <div
                    className="fixed inset-0 z-[120] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
                    onClick={() => !voidingConsumption && setConfirmVoidConsumptionTarget(null)}
                >
                    <div
                        className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 max-w-sm w-full space-y-4 animate-zoom-in"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center mx-auto">
                            <Trash2 size={26} />
                        </div>
                        <div className="text-center">
                            <h4 className="text-base font-black text-slate-800 dark:text-white">
                                ¿Anular consumo de empleado?
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                                Se anulará el consumo de <strong className="text-slate-700 dark:text-slate-200">${Number(confirmVoidConsumptionTarget.totalUsd || 0).toFixed(2)}</strong> de <strong className="text-slate-700 dark:text-slate-200">{payrollDetail?.employee?.employeeNombre || 'este empleado'}</strong>.
                            </p>
                            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold mt-2 bg-emerald-50 dark:bg-emerald-950/30 py-1.5 px-3 rounded-xl">
                                ↺ Las unidades serán devueltas al inventario de la caja principal
                            </p>
                        </div>
                        <div className="flex gap-2 pt-2">
                            <button
                                type="button"
                                disabled={voidingConsumption}
                                onClick={() => setConfirmVoidConsumptionTarget(null)}
                                className="flex-1 py-3 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                disabled={voidingConsumption}
                                onClick={() => executeVoidConsumptionSupervisor(confirmVoidConsumptionTarget)}
                                className="flex-1 py-3 px-4 rounded-xl bg-rose-500 hover:bg-rose-600 active:scale-95 text-white text-xs font-black transition-all shadow-md shadow-rose-500/20 disabled:opacity-50"
                            >
                                {voidingConsumption ? 'Enviando...' : 'Sí, Anular'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
</>
    );
}
