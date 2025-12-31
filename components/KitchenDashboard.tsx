import React, { useState, useMemo, useEffect } from 'react';
import { ConfirmedOrder, OrderItem } from '../types';
import { ChefHat, Clock, AlertTriangle, CheckCheck, Flame, Bell, Utensils, ClipboardList, Filter, Play, History, ArrowRight } from 'lucide-react';

interface KitchenDashboardProps {
    orders: ConfirmedOrder[];
    onUpdateStatus: (orderId: string, status: 'cooking' | 'ready') => void;
    onBack: () => void;
}

// Track individual item completion locally
interface KitchenItemState {
    completed: boolean;
    cooking: boolean;
}

const KitchenDashboard: React.FC<KitchenDashboardProps> = ({ orders, onUpdateStatus, onBack }) => {
    const [currentTime, setCurrentTime] = useState(Date.now());
    const [itemStates, setItemStates] = useState<Record<string, KitchenItemState>>({});

    // Mobile Tab State
    const [mobileTab, setMobileTab] = useState<'active' | 'completed'>('active');

    // Timer update
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 10000);
        return () => clearInterval(timer);
    }, []);

    // --- HELPERS ---

    const getItemState = (orderId: string, itemIdx: number) => {
        const key = `${orderId}_${itemIdx}`;
        return itemStates[key] || { completed: false, cooking: false };
    };

    const toggleItemState = (orderId: string, itemIdx: number, isGlobalDone: boolean) => {
        // If the order is already done globally (served/ready), prevent toggling
        if (isGlobalDone) return;

        const key = `${orderId}_${itemIdx}`;
        setItemStates(prev => {
            const current = prev[key] || { completed: false, cooking: false };
            let next: KitchenItemState;

            if (!current.cooking && !current.completed) {
                next = { cooking: true, completed: false };
            } else if (current.cooking && !current.completed) {
                next = { cooking: false, completed: true };
            } else {
                next = { cooking: false, completed: false }; // Reset
            }

            return { ...prev, [key]: next };
        });
    };

    const completeTicket = (orderId: string, itemCount: number) => {
        const updates: Record<string, KitchenItemState> = {};
        for (let i = 0; i < itemCount; i++) {
            updates[`${orderId}_${i}`] = { cooking: false, completed: true };
        }
        setItemStates(prev => ({ ...prev, ...updates }));

        // Trigger "Delivered/Ready" status
        onUpdateStatus(orderId, 'ready');
    };

    const acceptTicket = (orderId: string) => {
        // This triggers 'cooking' status which maps to 'aceptado' in the sheet API
        onUpdateStatus(orderId, 'cooking');
    };

    // --- DERIVED STATE ---

    const activeOrders = useMemo(() => {
        return orders
            .filter(order => order.status === 'pending' || order.status === 'cooking')
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }, [orders]);

    const completedOrders = useMemo(() => {
        return orders
            .filter(order => order.status === 'ready' || order.status === 'served')
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }, [orders]);

    const productionSummary = useMemo(() => {
        const summary: Record<string, number> = {};
        orders.forEach(order => {
            // Production summary only cares about what is NOT done yet
            if (order.status === 'pending' || order.status === 'cooking') {
                order.items.forEach((item, idx) => {
                    const state = getItemState(order.id, idx);
                    if (!state.completed) {
                        const name = item.menuItem.name;
                        summary[name] = (summary[name] || 0) + item.quantity;
                    }
                });
            }
        });
        return Object.entries(summary).sort((a, b) => b[1] - a[1]); // Sort by count desc
    }, [orders, itemStates]);

    const getUrgency = (timestamp: string) => {
        const elapsed = (currentTime - new Date(timestamp).getTime()) / 60000;
        if (elapsed > 25) return 'critical';
        if (elapsed > 12) return 'warning';
        return 'normal';
    };

    const formatElapsed = (timestamp: string) => {
        const mins = Math.floor((currentTime - new Date(timestamp).getTime()) / 60000);
        return `${mins}m`;
    };

    const StatusBadge = ({ isCooking, isGlobalDone, isPending }: any) => {
        if (isCooking) return <span className="bg-yellow-500/20 text-yellow-500 text-[10px] px-2 py-0.5 rounded border border-yellow-500/50 uppercase font-bold animate-pulse">Cocinando</span>;
        if (isGlobalDone) return <span className="bg-green-500/20 text-green-500 text-[10px] px-2 py-0.5 rounded border border-green-500/50 uppercase font-bold">Entregado</span>;
        if (isPending) return <span className="bg-blue-500/20 text-blue-400 text-[10px] px-2 py-0.5 rounded border border-blue-500/50 uppercase font-bold">Nuevo</span>;
        return null;
    };

    return (
        <div className="flex flex-col h-screen bg-[#1C1917] text-stone-200 font-sans overflow-hidden">

            {/* --- HEADER --- */}
            <div className="h-16 bg-[#163025] border-b border-[#D4A574]/30 flex items-center justify-between px-4 md:px-6 shrink-0 z-20">
                <div className="flex items-center gap-3 md:gap-4">
                    <button onClick={onBack} className="p-2 bg-[#1B4332] rounded hover:bg-[#2D5A45] transition-colors">
                        <ArrowRight size={20} className="text-stone-400 rotate-180" />
                    </button>
                    <h1 className="text-lg md:text-xl font-bold text-white tracking-widest flex items-center gap-2">
                        <ChefHat size={20} className="text-[#BC6C4F]" />
                        <span className="hidden md:inline">KDS | PANTALLA DE COCINA</span>
                        <span className="md:hidden">KDS</span>
                    </h1>
                </div>

                <div className="text-2xl font-mono font-bold text-white leading-none">
                    {new Date(currentTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>

            {/* --- MOBILE TABS --- */}
            <div className="md:hidden flex border-b border-stone-800 bg-[#1c1917] shrink-0">
                <button
                    onClick={() => setMobileTab('active')}
                    className={`flex-1 py-4 text-center font-bold uppercase tracking-widest text-xs transition-colors border-b-2 ${mobileTab === 'active' ? 'border-[#BC6C4F] text-[#BC6C4F] bg-[#BC6C4F]/10' : 'border-transparent text-stone-500'}`}
                >
                    Activos ({activeOrders.length})
                </button>
                <button
                    onClick={() => setMobileTab('completed')}
                    className={`flex-1 py-4 text-center font-bold uppercase tracking-widest text-xs transition-colors border-b-2 ${mobileTab === 'completed' ? 'border-emerald-500 text-emerald-500 bg-emerald-500/10' : 'border-transparent text-stone-500'}`}
                >
                    Completados
                </button>
            </div>

            {/* --- CONTENT AREA --- */}
            <div className="flex-1 flex overflow-hidden">

                {/* --- SIDEBAR: PRODUCTION (Desktop Only) --- */}
                <div className="hidden md:flex w-64 bg-[#1B4332] border-r border-[#D4A574]/30 flex-col shrink-0">
                    <div className="h-12 flex items-center px-4 border-b border-stone-800">
                        <div className="flex items-center gap-2 text-[#D4A574]">
                            <ClipboardList size={18} />
                            <span className="font-bold tracking-wider text-xs uppercase">Producción</span>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {productionSummary.map(([name, count]) => (
                            <div key={name} className="flex justify-between items-center bg-stone-800/50 p-2 rounded border border-stone-800">
                                <span className="text-xs font-medium text-stone-300 truncate w-32" title={name}>{name}</span>
                                <span className="bg-stone-700 text-white font-mono font-bold px-2 py-0.5 rounded text-xs min-w-[24px] text-center">{count}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* --- TICKETS COLUMNS --- */}
                <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 md:p-6 bg-[#161616]">
                    <div className="flex gap-6 h-full items-start">

                        {/* ACTIVE TICKETS */}
                        <div className={`flex-1 min-w-[300px] flex flex-col h-full gap-4 ${mobileTab === 'completed' ? 'hidden md:flex' : 'flex'}`}>
                            {/* Desktop Header for Column */}
                            <div className="flex justify-between items-center pb-2 border-b border-stone-800 mb-2 md:mb-0">
                                <h2 className="text-sm font-bold text-[#BC6C4F] uppercase tracking-wider">En Marcha</h2>
                                <span className="bg-[#BC6C4F] text-white text-xs font-bold px-2 py-0.5 rounded-full">{activeOrders.length}</span>
                            </div>

                            <div className="flex-1 overflow-y-auto pr-2 pb-20 space-y-4">
                                {activeOrders.length === 0 && (
                                    <div className="p-8 border-2 border-dashed border-stone-800 rounded-xl text-center text-stone-600">
                                        <p>Sin comandas pendientes</p>
                                    </div>
                                )}
                                {activeOrders.map(ticket => {
                                    const urgency = getUrgency(ticket.timestamp);
                                    const isPending = ticket.status === 'pending';
                                    const isCooking = ticket.status === 'cooking';
                                    const borderColor = urgency === 'critical' ? 'border-red-500' : urgency === 'warning' ? 'border-yellow-500' : 'border-[#BC6C4F]';
                                    const isLate = urgency === 'critical';

                                    return (
                                        <div key={ticket.id} className={`bg-[#2c2927] rounded-xl border-l-4 overflow-hidden shadow-xl transition-all ${isCooking ? 'border-amber-400' : borderColor}`}>
                                            <div className="p-4 flex justify-between items-start bg-black/20">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <h3 className="text-xl font-bold text-white">Mesa {ticket.tableNumber}</h3>
                                                        <StatusBadge isCooking={isCooking} isPending={isPending} />
                                                    </div>
                                                    <div className="text-xs text-stone-400 font-mono flex items-center gap-2">
                                                        <span>#{ticket.id.slice(-4)}</span>
                                                        <span>•</span>
                                                        <span>{ticket.clientName}</span>
                                                    </div>
                                                </div>
                                                <div className={`flex flex-col items-end ${isLate ? 'text-red-400 animate-pulse' : 'text-stone-400'}`}>
                                                    <span className="text-xl font-mono font-bold">{formatElapsed(ticket.timestamp)}</span>
                                                </div>
                                            </div>

                                            <div className={`p-4 space-y-3 relative ${isPending ? 'opacity-50' : ''}`}>
                                                {ticket.items.map((item, idx) => {
                                                    const localState = getItemState(ticket.id, idx);
                                                    const isItemDone = localState.completed;
                                                    const isItemCooking = localState.cooking;

                                                    return (
                                                        <div
                                                            key={idx}
                                                            onClick={() => !isPending && toggleItemState(ticket.id, idx, false)}
                                                            className={`flex gap-3 text-sm p-2 rounded border ${isItemDone ? 'bg-stone-900 border-stone-800 opacity-50' : 'bg-transparent border-transparent hover:bg-white/5 cursor-pointer'}`}
                                                        >
                                                            <span className={`font-bold text-lg w-6 shrink-0 ${isItemDone ? 'text-stone-600' : 'text-[#D4A574]'}`}>{item.quantity}x</span>
                                                            <div className="flex-1">
                                                                <span className={`font-medium text-base ${isItemDone ? 'text-stone-500 line-through' : 'text-stone-200'}`}>{item.menuItem.name}</span>
                                                                {item.notes && <p className="text-red-300 italic text-xs mt-0.5 bg-red-900/20 p-1 rounded inline-block">Nota: {item.notes}</p>}
                                                            </div>
                                                            <div className="shrink-0 pt-1">
                                                                {isItemDone ? <CheckCheck size={16} className="text-emerald-700" /> : isItemCooking ? <Flame size={16} className="text-amber-500" /> : <div className="w-4 h-4 rounded-full border border-stone-600"></div>}
                                                            </div>
                                                        </div>
                                                    );
                                                })}

                                                {isPending && (
                                                    <div className="absolute inset-0 flex items-center justify-center z-10">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); acceptTicket(ticket.id); }}
                                                            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-full font-bold shadow-xl flex items-center gap-2 transform hover:scale-105 transition-all"
                                                        >
                                                            <Play size={16} fill="white" /> ACEPTAR
                                                        </button>
                                                    </div>
                                                )}
                                            </div>

                                            {!isPending && (
                                                <button
                                                    onClick={() => completeTicket(ticket.id, ticket.items.length)}
                                                    className="w-full py-4 bg-[#BC6C4F] hover:bg-[#a35d44] text-white font-bold uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all border-t border-white/10"
                                                >
                                                    <CheckCheck size={20} /> COMPLETAR TICKET
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* COMPLETED TICKETS */}
                        <div className={`flex-1 min-w-[300px] flex flex-col h-full gap-4 md:border-l md:border-stone-800 md:pl-6 ${mobileTab === 'active' ? 'hidden md:flex' : 'flex'}`}>
                            {/* Desktop Header for Column */}
                            <div className="flex justify-between items-center pb-2 border-b border-stone-800 mb-2 md:mb-0">
                                <h2 className="text-sm font-bold text-emerald-600 uppercase tracking-wider">Completados</h2>
                                <span className="bg-emerald-900/30 text-emerald-500 text-xs font-bold px-2 py-0.5 rounded-full">{completedOrders.length}</span>
                            </div>

                            <div className="flex-1 overflow-y-auto pb-20 space-y-2">
                                {completedOrders.map(order => (
                                    <div key={order.id} className="bg-[#1c1917] rounded border border-stone-800 p-3 opacity-60 hover:opacity-100 transition-opacity">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="font-bold text-stone-300">Mesa {order.tableNumber}</span>
                                            <span className="text-emerald-600 text-[10px] font-bold uppercase border border-emerald-900/30 px-1.5 py-0.5 rounded">
                                                {order.status === 'served' ? 'Entregado' : 'Listo'}
                                            </span>
                                        </div>
                                        <div className="text-stone-500 text-xs flex justify-between">
                                            <span>{order.items.length} items</span>
                                            <span>{new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
};

export default KitchenDashboard;
