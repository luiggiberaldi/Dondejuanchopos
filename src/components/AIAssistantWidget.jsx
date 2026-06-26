import React, { useState, useEffect, useRef } from 'react';
import { Bot, Send, Trash2, X, Sparkles, User, AlertCircle } from 'lucide-react';
import { useProductContext } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

const BODEGA_CHAT_SYSTEM = `Eres un asistente inteligente y experto integrado en "Precios al Día", el sistema de punto de venta (POS) y gestión de inventario offline-first para bodegas, abastos y comercios en Venezuela.

## CONTEXTO OPERATIVO DE VENEZUELA:
- Tasas de cambio: Se manejan múltiples monedas. Principalmente Dólares (USD) como moneda de valor de referencia, y Bolívares (Bs) y Pesos Colombianos (COP) para pagos.
- La tasa de cambio oficial es fijada por el Banco Central de Venezuela (BCV). Los comercios actualizan esta tasa diariamente en Configuración -> Tasas.
- La tasa de Pesos Colombianos (COP) puede calcularse automáticamente usando la TRM diaria y brechas cambiarias o definirse de forma manual.
- El vuelto en efectivo es un problema común. El sistema ayuda a calcular vuelto mixto (ej. pagar con USD y dar cambio en Bs por pago móvil o efectivo).

## CARACTERÍSTICAS DEL POS (Precios al Día):
1. Offline-First: Funciona sin internet mediante IndexedDB. Las ventas se sincronizan automáticamente con Supabase (en la nube) cuando hay señal.
2. Seguridad de Acceso: Cada usuario entra con su PIN (6 dígitos para Admin, 4 para Cajero). Por razones de seguridad (SEC-002), los hashes de los PINs se almacenan estrictamente de forma local en IndexedDB y jamás se sincronizan a internet.
3. Gestión de Usuarios: Los administradores tienen acceso total (reportes, configuraciones, usuarios). Los cajeros tienen acceso restringido (solo ventas, clientes e inventario en modo de lectura).
4. Inventario: Permite registrar precios de venta y compra. Los precios se recalculan automáticamente según la tasa cambiaria del día. Los cajeros no pueden ver costos ni márgenes de ganancia.
5. Cierre de Caja: Al final del día, el sistema compara de forma matemática y exacta el dinero esperado con el real contado.
6. Auditoría Financiera e IA integrada: El módulo Dev Panel (Tester) realiza una auditoría 100% matemática y determinista sobre las transacciones del local. La IA evalúa este diagnóstico final y genera un informe narrativo detallando recomendaciones útiles para el negocio.
7. Módulo de Financiamiento Cashea (Registrar compras en cuotas):
   - Se puede activar o desactivar en "Configuración -> Ventas" (sección Financiamiento Cashea). Se puede configurar un monto mínimo en dólares para permitir su uso.
   - ¡IMPORTANTE!: Para que la opción de cobro con Cashea se active e ilustre en la pantalla de cobro (checkout), se debe seleccionar un cliente primero en la zona de cobro. El sistema activará el financiamiento si el cliente seleccionado tiene un Nivel de Cashea (del 1 al 6) y la venta cumple con el monto mínimo.
   - Al seleccionar Cashea en el checkout, el cliente paga una inicial (ej. 60% o 40%) en caja y la porción restante es financiada por Cashea.
   - Es obligatorio seleccionar un Cliente para cobros con Cashea, ya que el monto financiado se registra automáticamente como una deuda por cobrar (deuda de Cashea) en su perfil.
   - En el Dashboard y Cierre de Caja, el dinero financiado se registra bajo la categoría VENTA_CASHEA como cobro pendiente para no descuadrar el efectivo.

## REGLAS DE RESPUESTA:
- Sé amable, práctico, directo y habla en español de Venezuela ("tú", términos de comercio local como "bodega", "vuelto", "pago móvil", "fiado", "abasto").
- Si el usuario te envía un "CONTEXTO DE LA APLICACIÓN" o "CONTEXTO EN TIEMPO REAL DEL POS" en la consulta, utilízalo para responder de forma precisa a su negocio. No inventes datos que contradigan ese contexto.
- Usa formato Markdown simple (negritas, listas, saltos de línea).
`;

export default function AIAssistantWidget() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([
        {
            role: 'assistant',
            content: '¡Hola! Soy tu **Asistente de Precios al Día**. Pregúntame sobre ventas, inventario, deudas del negocio o cálculo de vuelto cambiario en bolívares y dólares.'
        }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isKeyboardActive, setIsKeyboardActive] = useState(false);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    // Conexiones de contexto del POS
    const { effectiveRate, tasaCop, products } = useProductContext();
    const { cart } = useCart();
    const { usuarioActivo } = useAuthStore();
    const { isOnline } = useOfflineQueue();

    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    // Scroll al final al recibir nuevos mensajes
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isTyping]);

    // Ocultar widget si el teclado móvil está activo
    useEffect(() => {
        if (!window.visualViewport) return;
        const handleResize = () => {
            const isKeyboard = window.visualViewport.height < window.innerHeight - 150;
            setIsKeyboardActive(isKeyboard);
        };
        window.visualViewport.addEventListener('resize', handleResize);
        return () => window.visualViewport?.removeEventListener('resize', handleResize);
    }, []);

    // Compilar estado actual del POS en un texto descriptivo
    const compilePosContext = () => {
        const rateBcv = effectiveRate || 0;
        const rateCop = tasaCop || 0;
        const username = usuarioActivo?.nombre || "Cajero general";
        const role = usuarioActivo?.rol || "CAJERO";
        const lowStockCount = products ? products.filter(p => p.stock <= (p.minStock || 5)).length : 0;
        const connection = isOnline ? "Online (Sincronizado)" : "Offline (Modo sin conexión)";
        const cartLen = cart?.length || 0;

        let salesCount = 0;
        let totalSalesUsd = 0;
        let totalSalesBs = 0;

        try {
            const sales = JSON.parse(localStorage.getItem('bodega_sales_v1') || '[]');
            const todayStr = new Date().toISOString().split('T')[0];
            const todaySales = sales.filter(s => {
                const sDate = s.timestamp ? s.timestamp.split('T')[0] : '';
                return sDate === todayStr;
            });
            salesCount = todaySales.length;
            totalSalesUsd = todaySales.reduce((acc, curr) => acc + (curr.totalUsd || 0), 0);
            totalSalesBs = todaySales.reduce((acc, curr) => acc + (curr.totalBs || 0), 0);
        } catch (e) {
            console.error("Error al leer métricas para IA:", e);
        }

        return `[CONTEXTO EN TIEMPO REAL DEL POS]
- Conexión: ${connection}
- Usuario activo: ${username} (Rol: ${role})
- Tasa BCV Oficial: Bs. ${rateBcv.toFixed(2)}
- Tasa COP: ${rateCop}
- Carrito actual: ${cartLen} productos
- Items bajo stock: ${lowStockCount}
- Ventas hoy: ${salesCount} transacciones (Total hoy: $${totalSalesUsd.toFixed(2)} USD / Bs. ${totalSalesBs.toFixed(2)} Bs.)
`;
    };

    const handleSend = async (textToSend) => {
        const messageText = textToSend || input;
        if (!messageText.trim() || isTyping) return;

        setInput('');
        if (inputRef.current) inputRef.current.style.height = 'auto';

        // Agregar mensaje del usuario a la UI
        const newMessages = [...messages, { role: 'user', content: messageText }];
        setMessages(newMessages);
        setIsTyping(true);

        try {
            // Construir payload con contexto dinámico
            const contextText = compilePosContext();
            
            // Enviamos el historial completo a la API
            const apiMessages = [
                { role: 'system', content: `${BODEGA_CHAT_SYSTEM}\n\n${contextText}` },
                ...newMessages.map(m => ({ role: m.role, content: m.content }))
            ];

            const isLocal = window.location.protocol === "file:" || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
            const apiEndpoint = isLocal ? 'http://localhost:3000/api/chat' : '/api/chat';

            const response = await fetch(apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: apiMessages })
            });

            if (!response.ok) {
                throw new Error(`Error de servidor (${response.status})`);
            }

            // Iniciar lectura de stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let aiResponse = "";

            // Añadir burbuja de respuesta vacía para actualizar en tiempo real
            setMessages(prev => [...prev, { role: 'assistant', content: "" }]);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    const cleanLine = line.trim();
                    if (!cleanLine || !cleanLine.startsWith('data: ')) continue;
                    
                    const dataStr = cleanLine.slice(6);
                    if (dataStr === '[DONE]') break;
                    
                    try {
                        const parsed = JSON.parse(dataStr);
                        const content = parsed.choices?.[0]?.delta?.content;
                        if (content) {
                            aiResponse += content;
                            setMessages(prev => {
                                const updated = [...prev];
                                updated[updated.length - 1].content = aiResponse;
                                return updated;
                            });
                        }
                    } catch (e) {
                        // Ignorar errores parciales de JSON
                    }
                }
            }
        } catch (error) {
            console.error("Error en chat asistente:", error);
            setMessages(prev => [...prev, { 
                role: 'assistant', 
                content: `⚠️ Lo siento, no pude comunicarme con el servidor. Verifica tu conexión de red.\n*Detalle:* \`${error.message}\`` 
            }]);
        } finally {
            setIsTyping(false);
        }
    };

    // Parser de inline: bold (**texto**) y código (`código`) dentro de una línea
    const parseInline = (text) => {
        if (!text) return null;
        // Regex seguro: [^*\n]+ evita cruzar asteriscos de viñetas
        const parts = text.split(/(\*\*[^*\n]+?\*\*|`[^`\n]+?`)/g);
        return parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
                return <strong key={i} className="font-bold text-slate-800 dark:text-white">{part.slice(2, -2)}</strong>;
            }
            if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
                return <code key={i} className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-mono text-rose-500 dark:text-rose-400">{part.slice(1, -1)}</code>;
            }
            return part || null;
        });
    };

    // Renderizado de markdown: procesa línea por línea para manejar viñetas correctamente
    const parseMarkdown = (text) => {
        if (!text) return null;

        const lines = text.split('\n');
        const result = [];

        lines.forEach((line, lineIndex) => {
            const isLast = lineIndex === lines.length - 1;

            // Detectar encabezados (### o ##)
            const headingMatch = line.match(/^#{1,3}\s+(.+)/);
            if (headingMatch) {
                result.push(
                    <span key={lineIndex} className="block font-bold text-slate-800 dark:text-white text-xs mt-1">
                        {parseInline(headingMatch[1])}
                    </span>
                );
                if (!isLast) result.push(<br key={`br-${lineIndex}`} />);
                return;
            }

            // Detectar viñetas (* texto, - texto, • texto)
            const bulletMatch = line.match(/^[\s]*[-*•]\s+(.+)/);
            if (bulletMatch) {
                result.push(
                    <span key={lineIndex} className="flex gap-1.5 items-start mt-0.5">
                        <span className="text-emerald-500 dark:text-emerald-400 shrink-0 mt-px">•</span>
                        <span>{parseInline(bulletMatch[1])}</span>
                    </span>
                );
                return;
            }

            // Línea vacía → separador
            if (line.trim() === '') {
                if (!isLast) result.push(<br key={lineIndex} />);
                return;
            }

            // Línea normal
            result.push(<span key={lineIndex}>{parseInline(line)}</span>);
            if (!isLast) result.push(<br key={`br-${lineIndex}`} />);
        });

        return result;
    };

    const handleClear = () => {
        setIsConfirmOpen(true);
    };

    const confirmClear = () => {
        setMessages([
            {
                role: 'assistant',
                content: 'Conversación reiniciada. ¿En qué puedo ayudarte con el sistema **Precios al Día**?'
            }
        ]);
        setIsConfirmOpen(false);
    };

    // Sugerencias rápidas
    const suggestions = [
        { label: "Calcular Vuelto", prompt: "¿Cómo me ayuda el POS a calcular el vuelto o cambio?" },
        { label: "Cashea", prompt: "¿Cómo funciona el módulo de financiamiento Cashea en el POS?" },
        { label: "Sincronización", prompt: "¿Qué pasa si pierdo el internet? ¿Cómo se sincronizan los datos?" },
        { label: "Bajo Stock", prompt: "¿Cuáles son los productos con bajo stock en mi inventario?" },
        { label: "Cierre de Caja", prompt: "¿Cómo hago un cierre de caja correcto al finalizar el turno?" }
    ];

    if (isKeyboardActive && !isOpen) return null;

    return (
        <div className="fixed bottom-24 right-4 z-[90] flex flex-col items-end">
            {/* Panel de Chat */}
            {isOpen && (
                <div className="mb-4 w-[90vw] sm:w-[380px] h-[50vh] sm:h-[480px] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800/80 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-250 select-text">
                    {/* Header */}
                    <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-2xl bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-700 overflow-hidden shrink-0 flex items-center justify-center p-0.5">
                                <img src="/bot-avatar.png" alt="Bot Avatar" className="w-full h-full object-contain rounded-xl" />
                            </div>
                            <div>
                                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">Asistente Virtual</h3>
                                <div className="flex items-center gap-1 mt-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                    <span className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">En línea</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <button 
                                onClick={handleClear} 
                                className="p-2 text-slate-400 hover:text-rose-500 dark:text-slate-500 dark:hover:text-rose-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                                title="Limpiar chat"
                            >
                                <Trash2 size={15} />
                            </button>
                            <button 
                                onClick={() => setIsOpen(false)} 
                                className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                            >
                                <X size={15} />
                            </button>
                        </div>
                    </div>

                    {/* Mensajes */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin">
                        {messages.map((m, i) => (
                            <div key={i} className={`flex items-start gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold overflow-hidden ${
                                    m.role === 'user' 
                                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300' 
                                        : 'bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-700 p-0.5'
                                }`}>
                                    {m.role === 'user' ? <User size={13} /> : <img src="/bot-avatar.png" alt="Bot" className="w-full h-full object-contain rounded-lg" />}
                                </div>
                                <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                                    m.role === 'user'
                                        ? 'bg-emerald-500 text-white rounded-tr-none'
                                        : 'bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 rounded-tl-none border border-slate-100 dark:border-slate-800'
                                }`}>
                                    {parseMarkdown(m.content)}
                                </div>
                            </div>
                        ))}
                        {isTyping && messages[messages.length - 1].content === "" && (
                            <div className="flex items-start gap-2.5">
                                <div className="w-7 h-7 rounded-xl bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-700 p-0.5 flex items-center justify-center shrink-0 overflow-hidden">
                                    <img src="/bot-avatar.png" alt="Bot" className="w-full h-full object-contain rounded-lg" />
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl rounded-tl-none px-3.5 py-2.5 flex gap-1 items-center border border-slate-100 dark:border-slate-800">
                                    <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                    <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                    <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Sugerencias Rápidas */}
                    {messages.length === 1 && (
                        <div className="px-4 py-2 flex flex-wrap gap-1.5 bg-slate-50/50 dark:bg-slate-900/50 shrink-0 border-t border-slate-100 dark:border-slate-850">
                            {suggestions.map((s, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => handleSend(s.prompt)}
                                    className="px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 rounded-lg text-[9px] font-bold text-slate-500 dark:text-slate-400 transition-colors"
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Input */}
                    <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-150 dark:border-slate-800 shrink-0">
                        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/60 rounded-2xl px-3 py-1.5 border border-slate-100 dark:border-slate-800">
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={(e) => {
                                    setInput(e.target.value);
                                    e.target.style.height = 'auto';
                                    e.target.style.height = `${Math.min(e.target.scrollHeight, 70)}px`;
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                placeholder="Haz tu pregunta..."
                                rows={1}
                                className="flex-1 bg-transparent border-none text-xs focus:ring-0 outline-none text-slate-700 dark:text-slate-200 placeholder-slate-400 resize-none min-h-[20px] max-h-[70px] font-medium py-1"
                            />
                            <button
                                onClick={() => handleSend()}
                                disabled={!input.trim() || isTyping}
                                className={`p-1.5 rounded-xl transition-all ${
                                    input.trim() && !isTyping 
                                        ? 'bg-emerald-500 text-white shadow-md active:scale-95' 
                                        : 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                                }`}
                            >
                                <Send size={13} />
                            </button>
                        </div>
                    </div>
                    {/* Confirm Modal */}
                    {isConfirmOpen && (
                        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 w-full max-w-[280px] shadow-2xl text-center select-none animate-in fade-in zoom-in-95 duration-150">
                                <h4 className="text-xs font-bold text-slate-800 dark:text-white mb-2">Reiniciar Conversación</h4>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
                                    ¿Está seguro de que desea restablecer el chat? Se borrará el historial de la conversación actual.
                                </p>
                                <div className="flex gap-2 justify-center">
                                    <button 
                                        onClick={() => setIsConfirmOpen(false)}
                                        className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl text-[10px] font-bold text-slate-600 dark:text-slate-350 transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button 
                                        onClick={confirmClear}
                                        className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 rounded-xl text-[10px] font-bold text-white shadow-md active:scale-95 transition-all"
                                    >
                                        Reiniciar
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Botón FAB */}
            <button
                onClick={() => {
                    setIsOpen(!isOpen);
                }}
                className={`w-12 h-12 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 active:scale-90 hover:scale-105 pointer-events-auto overflow-hidden ${
                    isOpen 
                        ? 'bg-slate-800 dark:bg-slate-700 text-white rotate-90' 
                        : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                }`}
                title="Asistente de Inteligencia Artificial"
            >
                {isOpen ? <X size={20} /> : (
                    <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center p-1">
                        <img src="/bot-avatar.png" alt="Bot" className="w-full h-full object-contain rounded-full" />
                    </div>
                )}
            </button>
        </div>
    );
}
