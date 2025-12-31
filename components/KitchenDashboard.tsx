
import React, { useState, useMemo, useEffect } from 'react';
import { ConfirmedOrder, OrderItem } from '../types';
import { ChefHat, Clock, AlertTriangle, CheckCheck, Flame, Bell, Utensils, ClipboardList, Filter, Play, History } from 'lucide-react';

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

    // Changed filter mode to strictly 'active' vs 'completed'
    const [filterMode, setFilterMode] = useState<'active' | 'completed'>('active');

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

    const sortedTickets = useMemo(() => {
        if (filterMode === 'active') {
            // ACTIVE TAB: Show 'pending' and 'cooking'. 
            // Sort: Oldest first (FIFO) so kitchen sees what came in first.
            return orders
                .filter(order => order.status === 'pending' || order.status === 'cooking')
                .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        } else {
            // COMPLETED TAB: Show 'ready' and 'served'.
            // Sort: Newest first (LIFO) so you see what you just finished.
            return orders
                .filter(order => order.status === 'ready' || order.status === 'served')
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        }
    }, [orders, filterMode]);

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

    return (
        <div className="flex h-screen bg-[#1C1917] text-stone-200 font-sans overflow-hidden">

            {/* --- LEFT SIDEBAR: PRODUCTION SUMMARY --- */}
            <div className="w-64 bg-[#1B4332] border-r border-[#D4A574]/30 flex flex-col shrink-0">
                <div className="h-16 flex items-center px-6 border-b border-stone-800">
                    <div className="flex items-center gap-2 text-[#D4A574]">
                        <ClipboardList size={20} />
                        <span className="font-bold tracking-wider text-sm uppercase">Producción</span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {productionSummary.length === 0 ? (
                        <div className="text-stone-600 text-sm text-center mt-10 italic">
                            Todo tranquilo...
                        </div>
                    ) : (
                        productionSummary.map(([name, count]) => (
                            <div key={name} className="flex justify-between items-center bg-stone-800/50 p-3 rounded border border-stone-800">
                                <span className="text-sm font-medium text-stone-300 truncate w-32" title={name}>{name}</span>
                                <span className="bg-stone-700 text-white font-mono font-bold px-2 py-1 rounded text-sm min-w-[30px] text-center">
                                    {count}
                                </span>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 border-t border-stone-800 text-stone-500 text-xs text-center">
                    Total Items Pendientes: {productionSummary.reduce((acc, curr) => acc + curr[1], 0)}
                </div>
            </div>

            {/* --- MAIN CONTENT --- */}
            <div className="flex-1 flex flex-col min-w-0">

                {/* Header */}
                <div className="h-16 bg-[#163025] border-b border-[#D4A574]/30 flex items-center justify-between px-6 shrink-0">
                    <div className="flex items-center gap-4">
                        <button onClick={onBack} className="p-2 bg-[#1B4332] rounded hover:bg-[#2D5A45] transition-colors">
                            <ChefHat size={20} className="text-stone-400" />
                        </button>
                        <h1 className="text-xl font-bold text-white tracking-widest">KDS <span className="text-stone-600">|</span> PANTALLA DE COCINA</h1>
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="flex bg-stone-800 rounded p-1">
                            <button
                                onClick={() => setFilterMode('active')}
                                className={`px-3 py-1 rounded text-xs font-bold uppercase transition-colors ${filterMode === 'active' ? 'bg-[#BC6C4F] text-white' : 'text-stone-400 hover:text-stone-200'}`}
                            >
                                Activos
                            </button>
                            <button
                                onClick={() => setFilterMode('completed')}
                                className={`px-3 py-1 rounded text-xs font-bold uppercase transition-colors ${filterMode === 'completed' ? 'bg-emerald-700 text-white' : 'text-stone-400 hover:text-stone-200'}`}
                            >
                                Completados
                            </button>
                        </div>
                        <div className="text-right">
                            <div className="text-2xl font-mono font-bold text-white leading-none">
                                {new Date(currentTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tickets Grid */}
                <div className="flex-1 overflow-x-auto overflow-y-hidden p-6">
                    <div className="flex gap-6 h-full items-start">
                        {sortedTickets.length === 0 ? (
                            <div className="m-auto flex flex-col items-center justify-center text-stone-700 opacity-50">
                                {filterMode === 'active' ? <Utensils size={64} className="mb-4" /> : <History size={64} className="mb-4" />}
                                <h2 className="text-2xl font-bold uppercase">
                                    {filterMode === 'active' ? 'Sin Comandas Activas' : 'Sin Historial Reciente'}
                                </h2>
                                <p>{filterMode === 'active' ? 'Esperando pedidos...' : 'Los pedidos entregados aparecerán aquí.'}</p>
                            </div>
                        ) : (
                            sortedTickets.map((ticket) => {
                                const urgency = getUrgency(ticket.timestamp);

                                // CRITICAL FIX: Determine if the order is globally done (from DB status)
                                // This ensures that on page refresh, completed tickets look completed.
                                const isGlobalDone = ticket.status === 'ready' || ticket.status === 'served';

                                const borderColor = isGlobalDone
                                    ? 'border-stone-600'
                                    : urgency === 'critical' ? 'border-red-500' : urgency === 'warning' ? 'border-yellow-500' : 'border-emerald-500';

                                // Workflow State
                                const isPending = ticket.status === 'pending';
                                const isCooking = ticket.status === 'cooking';

                                // Status Badge
                                let statusBadge = null;
                                if (isCooking) statusBadge = <span className="bg-yellow-500/20 text-yellow-500 text-[10px] px-2 py-0.5 rounded border border-yellow-500/50 uppercase font-bold animate-pulse">Cocinando</span>;
                                else if (isGlobalDone) statusBadge = <span className="bg-green-500/20 text-green-500 text-[10px] px-2 py-0.5 rounded border border-green-500/50 uppercase font-bold">Entregado</span>;
                                else if (isPending) statusBadge = <span className="bg-blue-500/20 text-blue-400 text-[10px] px-2 py-0.5 rounded border border-blue-500/50 uppercase font-bold">Nuevo</span>;

                                return (
                                    <div
                                        key={ticket.id}
                                        className={`w-[320px] shrink-0 flex flex-col h-full max-h-full rounded-lg border-t-4 ${borderColor} bg-[#1c1c1c] shadow-2xl transition-all duration-300 ${isGlobalDone ? 'opacity-50 grayscale' : ''}`}
                                    >
                                        {/* Ticket Header */}
                                        <div className="p-4 bg-[#252525] border-b border-stone-800 flex justify-between items-start">
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-3xl font-black text-white">Mesa {ticket.tableNumber}</span>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <div className="text-stone-400 text-xs flex items-center gap-2">
                                                        <Clock size={12} />
                                                        {new Date(ticket.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        <span className="text-stone-600">|</span>
                                                        {ticket.clientName}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-[10px] text-stone-600 font-mono uppercase truncate">
                                                            #{ticket.id.slice(-6)}
                                                        </div>
                                                        {statusBadge}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className={`flex flex-col items-end ${urgency === 'critical' && !isGlobalDone ? 'animate-pulse' : ''}`}>
                                                <span className={`text-2xl font-mono font-bold ${isGlobalDone ? 'text-stone-500' : urgency === 'critical' ? 'text-red-500' : urgency === 'warning' ? 'text-yellow-500' : 'text-emerald-500'}`}>
                                                    {formatElapsed(ticket.timestamp)}
                                                </span>
                                                <span className="text-[9px] uppercase tracking-wider text-stone-500">Wait Time</span>
                                            </div>
                                        </div>

                                        {/* Items List */}
                                        <div className={`flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar relative ${isPending ? 'pointer-events-none' : ''}`}>

                                            {/* Blur Overlay for Pending Tickets */}
                                            {isPending && (
                                                <div className="absolute inset-0 z-20 backdrop-blur-[4px] bg-stone-900/10 flex items-center justify-center transition-all">
                                                </div>
                                            )}

                                            {ticket.items.map((item, idx) => {
                                                const localState = getItemState(ticket.id, idx);

                                                // The item is "Done" if locally checked OR if the global order is Done/Served
                                                const isItemDone = localState.completed || isGlobalDone;
                                                const isItemCooking = localState.cooking && !isGlobalDone;

                                                return (
                                                    <div
                                                        key={`${ticket.id}_${idx}`}
                                                        // Pass isGlobalDone to prevent toggling if order is finished
                                                        onClick={() => toggleItemState(ticket.id, idx, isGlobalDone)}
                                                        className={`p-3 rounded cursor-pointer border select-none transition-all relative overflow-hidden group ${isItemDone ? 'bg-stone-900 border-stone-800 text-stone-600' :
                                                                isItemCooking ? 'bg-amber-900/20 border-amber-700/50' :
                                                                    'bg-[#2a2a2a] border-[#333] hover:bg-[#333]'
                                                            }`}
                                                    >
                                                        <div className="flex gap-3 relative z-10">
                                                            <span className={`font-mono text-xl font-bold ${isItemDone ? 'text-stone-700' : 'text-[#D4A574]'}`}>
                                                                {item.quantity}
                                                            </span>
                                                            <div className="flex-1 min-w-0">
                                                                <div className={`font-bold text-sm leading-tight ${isItemDone ? 'line-through' : 'text-stone-200'}`}>
                                                                    {item.menuItem.name}
                                                                </div>

                                                                {/* Modifier / Notes */}
                                                                {item.notes && (
                                                                    <div className={`mt-1.5 flex items-start gap-1.5 px-2 py-1 rounded text-xs border ${isItemDone ? 'bg-stone-800 text-stone-600 border-stone-700' : 'bg-red-500/10 text-red-200 border-red-500/20'}`}>
                                                                        <AlertTriangle size={12} className={`shrink-0 mt-0.5 ${isItemDone ? 'text-stone-600' : 'text-red-400'}`} />
                                                                        <span className="font-bold">{item.notes}</span>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Status Icon */}
                                                            <div className="shrink-0 self-center">
                                                                {isItemDone ? (
                                                                    <CheckCheck className="text-emerald-900" size={20} />
                                                                ) : isItemCooking ? (
                                                                    <Flame className="text-[#BC6C4F] animate-pulse" size={20} />
                                                                ) : (
                                                                    <div className="w-5 h-5 rounded-full border-2 border-stone-600 group-hover:border-stone-400" />
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Footer Actions */}
                                        {!isGlobalDone && (
                                            <div className="p-3 bg-[#202020] border-t border-stone-800">
                                                {isPending ? (
                                                    <button
                                                        onClick={() => acceptTicket(ticket.id)}
                                                        className="w-full bg-blue-700 hover:bg-blue-600 text-white py-3 rounded text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-900/20 animate-pulse"
                                                    >
                                                        <Play size={16} fill="currentColor" />
                                                        Aceptar Ticket
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => completeTicket(ticket.id, ticket.items.length)}
                                                        className="w-full bg-stone-800 hover:bg-stone-700 text-stone-300 py-3 rounded text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors"
                                                    >
                                                        <CheckCheck size={16} />
                                                        Completar Ticket
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default KitchenDashboard;
