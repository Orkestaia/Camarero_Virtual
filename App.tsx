
import React, { useState, useEffect, useRef } from 'react';
import { useLiveSession } from './hooks/useLiveSession';
import { MenuItem, OrderItem, ConfirmedOrder } from './types';
import Visualizer from './components/Visualizer';
import OrderSummary from './components/OrderSummary';
import MenuExplorer from './components/MenuExplorer';
import KitchenDashboard from './components/KitchenDashboard';
import OrderStatus from './components/OrderStatus';
import { fetchMenuFromWebhook, sendOrderToWebhook, fetchOrdersFromWebhook, updateOrderInWebhook } from './utils/api';
import { Mic, MicOff, ChefHat, AlertCircle, User, LayoutGrid, Sparkles } from 'lucide-react';

function App() {
  // Global State
  const [appMode, setAppMode] = useState<'selection' | 'dining' | 'kitchen'>('selection');
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [confirmedOrders, setConfirmedOrders] = useState<ConfirmedOrder[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);

  // Dining State
  const [tableNumber, setTableNumber] = useState("1");
  const [activeTab, setActiveTab] = useState<'chat' | 'menu'>('chat');
  const [cartItems, setCartItems] = useState<OrderItem[]>([]);
  const [dinersCount, setDinersCount] = useState<number>(1);
  const [clientName, setClientName] = useState<string>("Cliente");
  const [isSending, setIsSending] = useState(false);

  // Refs for reliable access inside callbacks
  const cartItemsRef = useRef<OrderItem[]>([]);

  useEffect(() => {
    cartItemsRef.current = cartItems;
  }, [cartItems]);

  // 1. Fetch Menu on Mount
  useEffect(() => {
    const loadMenu = async () => {
      setMenuLoading(true);
      const items = await fetchMenuFromWebhook();
      setMenu(items);
      setMenuLoading(false);
    };
    loadMenu();
  }, []);

  // 2. Poll for Orders (Real-time sync)
  useEffect(() => {
    const loadOrders = async () => {
      const orders = await fetchOrdersFromWebhook();
      setConfirmedOrders(orders);
    };

    loadOrders();
    const intervalId = setInterval(loadOrders, 5000); // 5s poll for Sheets (avoid rate limits)
    return () => clearInterval(intervalId);
  }, []);

  // 3. Handle URL Params for Table
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mesa = params.get('mesa');
    if (mesa) {
      setTableNumber(mesa);
      setAppMode('dining');
    }
  }, []);

  // --- HANDLERS ---

  const handleAddToCart = (item: MenuItem, quantity: number, notes?: string) => {
    setCartItems(prev => {
      const newNotes = (notes || '').trim().toLowerCase();
      const existingIndex = prev.findIndex(i =>
        i.menuItem.id === item.id &&
        (i.notes || '').trim().toLowerCase() === newNotes
      );

      if (existingIndex >= 0) {
        const updatedItems = [...prev];
        updatedItems[existingIndex] = {
          ...updatedItems[existingIndex],
          quantity: updatedItems[existingIndex].quantity + quantity
        };
        return updatedItems;
      } else {
        const newItem: OrderItem = {
          id: Math.random().toString(36).substr(2, 9),
          menuItem: item,
          quantity,
          notes,
          timestamp: new Date().toISOString()
        };
        return [...prev, newItem];
      }
    });
  };

  const handleRemoveItem = (itemId: string) => {
    setCartItems(prev => prev.filter(item => item.id !== itemId));
  };

  const handleRemoveFromOrder = (itemName: string) => {
    setCartItems(prev => {
      const target = prev.find(i => i.menuItem.name.toLowerCase().includes(itemName.toLowerCase()));
      if (target) {
        return prev.filter(i => i.id !== target.id);
      }
      return prev;
    });
  };

  const handleUpdateQuantity = (itemId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      handleRemoveItem(itemId);
      return;
    }
    setCartItems(prev => prev.map(item =>
      item.id === itemId
        ? { ...item, quantity: newQuantity }
        : item
    ));
  };

  const handleSetDiners = (count: number, name?: string) => {
    setDinersCount(count);
    if (name) setClientName(name);
  };

  const handleConfirmOrder = async (diners: number, clientNameParam: string, itemsOverride?: OrderItem[]): Promise<boolean> => {
    const itemsToConfirm = itemsOverride || cartItemsRef.current || cartItems;

    if (!itemsToConfirm || itemsToConfirm.length === 0) {
      return false;
    }

    if (isSending) return false;
    setIsSending(true);

    // Generate numeric ID based on time for compatibility with Sheets "Numero_pedido"
    const simpleId = Math.floor(Date.now() / 1000).toString().slice(-6);

    const newOrder: ConfirmedOrder = {
      id: simpleId,
      tableNumber,
      items: [...itemsToConfirm],
      status: 'pending',
      timestamp: new Date().toISOString(),
      clientName: clientNameParam,
      diners,
      totalPrice: itemsToConfirm.reduce((acc, i) => acc + (i.menuItem.price * i.quantity), 0)
    };

    try {
      const webhookResult = await sendOrderToWebhook(newOrder);

      if (webhookResult.success) {
        setCartItems([]);
        cartItemsRef.current = [];

        // Instant feedback
        setConfirmedOrders(prev => [newOrder, ...prev]);
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      setIsSending(false);
    }
  };

  const handleKitchenStatusUpdate = async (orderId: string, newStatus: 'cooking' | 'ready') => {
    const orderToUpdate = confirmedOrders.find(o => o.id === orderId);
    if (!orderToUpdate) return;

    // Optimistic update
    const updatedOrder = { ...orderToUpdate, status: newStatus };
    setConfirmedOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o));

    await updateOrderInWebhook(orderId, newStatus);
  };

  // --- HOOK ---
  const {
    status,
    connect,
    disconnect,
    isMuted,
    setIsMuted,
    volumeLevel,
    logs
  } = useLiveSession({
    apiKey: process.env.API_KEY as string,
    tableNumber,
    menu,
    onAddToCart: handleAddToCart,
    onRemoveFromOrder: handleRemoveFromOrder,
    onConfirmOrder: handleConfirmOrder,
    onSetDiners: handleSetDiners,
    cartItems,
    dinersCount,
    clientName
  });

  const totalPrice = cartItems.reduce((acc, item) => acc + (item.menuItem.price * item.quantity), 0);

  // --- RENDER ---
  if (appMode === 'selection') {
    return (
      <div className="min-h-screen bg-[#1B4332] flex items-center justify-center p-4 font-sans relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#444 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
        <div className="bg-white rounded-sm p-10 max-w-lg w-full text-center shadow-2xl relative z-10 border border-stone-800">
          <ChefHat className="w-20 h-20 text-stone-800 mx-auto mb-6" strokeWidth={1.5} />
          <h1 className="text-4xl font-serif font-bold text-[#1B4332] mb-2">Patxi</h1>
          <p className="text-[#BC6C4F] mb-10 tracking-widest text-sm uppercase">Restaurante Garrote</p>
          <div className="space-y-4">
            <button onClick={() => setAppMode('kitchen')} className="w-full p-6 rounded-sm border border-stone-200 hover:border-amber-600 hover:bg-stone-50 transition-all group flex items-center gap-6 text-left">
              <div className="bg-stone-100 p-4 rounded-full group-hover:bg-amber-100 transition-colors">
                <ChefHat className="text-stone-700 group-hover:text-amber-700" size={24} />
              </div>
              <div>
                <h3 className="font-serif text-xl font-bold text-stone-800">Cocina</h3>
                <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Panel de Comandas</p>
              </div>
            </button>
            <button onClick={() => setAppMode('dining')} className="w-full p-6 rounded-sm border border-stone-200 hover:border-stone-800 hover:bg-stone-50 transition-all group flex items-center gap-6 text-left">
              <div className="bg-stone-100 p-4 rounded-full group-hover:bg-stone-200 transition-colors">
                <User className="text-stone-700 group-hover:text-stone-900" size={24} />
              </div>
              <div>
                <h3 className="font-serif text-xl font-bold text-stone-800">Sala / Cliente</h3>
                <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Asistente Virtual</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (appMode === 'kitchen') {
    return (
      <KitchenDashboard
        orders={confirmedOrders}
        onUpdateStatus={handleKitchenStatusUpdate}
        onBack={() => setAppMode('selection')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#FDF8F3] text-stone-800 flex flex-col font-sans">
      <header className="glass sticky top-0 z-20 border-b border-stone-200/50">
        <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button onClick={() => setAppMode('selection')} className="group flex items-center gap-2">
              <div className="w-10 h-10 bg-[#1B4332] rounded-sm flex items-center justify-center text-white group-hover:bg-[#BC6C4F] transition-colors shadow-lg">
                <ChefHat size={20} strokeWidth={1.5} />
              </div>
              <div className="hidden sm:block">
                <h1 className="font-serif font-bold text-xl leading-none text-[#1B4332]">Patxi</h1>
                <span className="text-[10px] tracking-[0.2em] text-[#BC6C4F] uppercase">Restaurante Garrote</span>
              </div>
            </button>
            <div className="h-8 w-px bg-stone-200 mx-2"></div>
            <div className="flex items-center gap-2 bg-stone-100/50 px-3 py-1.5 rounded-full border border-stone-200/50">
              <span className="text-xs text-stone-400 uppercase tracking-wide font-medium">Mesa</span>
              <input className="w-8 text-center bg-transparent font-serif font-bold text-lg text-stone-800 focus:outline-none" value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-4 items-center">
            <div className="flex bg-stone-200/50 p-1 rounded-full border border-stone-200/50">
              <button onClick={() => setActiveTab('chat')} className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide flex items-center gap-2 transition-all ${activeTab === 'chat' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'}`}>
                <Sparkles size={14} /> Asistente
              </button>
              <button onClick={() => setActiveTab('menu')} className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide flex items-center gap-2 transition-all ${activeTab === 'menu' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'}`}>
                <LayoutGrid size={14} /> Carta
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 flex flex-col md:flex-row gap-8 mb-32 md:mb-8">
        <div className="flex-1 min-w-0 flex flex-col h-full">
          {menuLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center h-64 bg-white rounded-sm border border-stone-100 shadow-sm">
              <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-stone-400 font-serif italic">Preparando la sala...</p>
            </div>
          ) : (
            <>
              {activeTab === 'chat' && (
                <div className="flex flex-col gap-6 animate-in fade-in duration-500 h-full">
                  <div className="bg-[#1B4332] text-stone-100 rounded-lg p-8 shadow-2xl relative overflow-hidden min-h-[300px] flex flex-col justify-center border border-[#D4A574]/30">
                    <div className="relative z-10 flex flex-col items-center justify-center text-center">
                      {status === 'disconnected' && (
                        <>
                          <div className="mb-6 p-6 bg-gradient-to-br from-[#1B4332] to-[#2D5A45] rounded-full border border-[#D4A574]/50 shadow-inner">
                            <Mic size={32} className="text-stone-400" />
                          </div>
                          <h2 className="text-3xl font-serif italic mb-3 text-white">¡Kaixo!</h2>
                          <p className="text-stone-400 mb-8 max-w-md font-light leading-relaxed">
                            Soy Patxi, ¿cuántos sois hoy?
                          </p>
                        </>
                      )}
                      {status === 'connecting' && (
                        <div className="animate-pulse flex flex-col items-center">
                          <div className="w-16 h-16 border-2 border-amber-500/50 border-t-transparent rounded-full animate-spin mb-6"></div>
                          <p className="font-serif italic text-stone-300">Conectando servicio...</p>
                        </div>
                      )}
                      {status === 'connected' && (
                        <div className="w-full flex flex-col items-center">
                          <div className="mb-6 w-full">
                            <Visualizer isActive={!isMuted} volume={volumeLevel} />
                          </div>
                          <p className="text-amber-500/80 font-medium animate-pulse mb-6 text-xs uppercase tracking-[0.2em]">
                            {isMuted ? "En pausa" : "Escuchando"}
                          </p>
                          <div className="w-full max-w-lg space-y-2">
                            {logs.slice(-3).map((log, i) => (
                              <div key={i} className={`text-sm py-2 px-4 rounded-lg backdrop-blur-md border ${log.role === 'system' ? 'bg-emerald-900/20 border-emerald-500/20 text-emerald-100 ml-auto text-right' :
                                  log.role === 'error' ? 'bg-red-900/20 border-red-500/20 text-red-200 mx-auto text-center' :
                                    'bg-stone-800/50 border-stone-700/50 text-stone-200 mr-auto text-left'
                                }`}>
                                {log.text.replace(/^[✓✗→] /, '')}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {status === 'error' && (
                        <div className="text-red-300 flex flex-col items-center">
                          <AlertCircle size={32} className="mb-2" />
                          <p>Error de conexión. Inténtalo de nuevo.</p>
                        </div>
                      )}
                    </div>
                    <div className="absolute top-[-50%] left-[-20%] w-96 h-96 bg-amber-900/10 rounded-full blur-[100px]"></div>
                    <div className="absolute bottom-[-50%] right-[-20%] w-96 h-96 bg-stone-700/10 rounded-full blur-[100px]"></div>
                  </div>
                  {menu.length > 0 && (
                    <div className="bg-white rounded-sm p-6 shadow-sm border border-stone-100 flex flex-col">
                      <h3 className="font-serif font-bold text-stone-900 mb-4 text-lg italic flex items-center gap-2">
                        <Sparkles size={16} className="text-amber-600" />
                        Sugerencias del Chef
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {menu.slice(0, 3).map(item => (
                          <button key={item.id} onClick={() => handleAddToCart(item, 1)} className="text-left p-4 bg-stone-50 hover:bg-white rounded-sm border border-stone-100 hover:border-amber-200 transition-all group hover:shadow-lg">
                            <div className="font-serif font-bold text-base truncate text-stone-800 group-hover:text-amber-900 mb-1">{item.name}</div>
                            <div className="text-stone-500 text-xs line-clamp-2 mb-2">{item.description}</div>
                            <div className="text-stone-900 font-mono text-xs">{item.price.toFixed(2)}€</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {activeTab === 'menu' && (
                <div className="h-full min-h-[600px] animate-in slide-in-from-bottom-4 duration-500 bg-white rounded-sm border border-stone-200 overflow-hidden shadow-sm">
                  <MenuExplorer menu={menu} onAddItem={(item) => handleAddToCart(item, 1)} />
                </div>
              )}
            </>
          )}
        </div>
        <div className="md:w-96 w-full flex flex-col gap-6 shrink-0">
          <div className="sticky top-24 space-y-6">
            <OrderSummary
              items={cartItems}
              total={totalPrice}
              tableNumber={tableNumber}
              onConfirm={() => handleConfirmOrder(dinersCount, clientName)}
              onRemoveItem={handleRemoveItem}
              onUpdateQuantity={handleUpdateQuantity}
              isSending={isSending}
            />
            <OrderStatus orders={confirmedOrders} tableNumber={tableNumber} />
          </div>
        </div>
      </main>
      {activeTab === 'chat' && (
        <div className="fixed bottom-8 left-0 right-0 flex justify-center z-50 px-4 pointer-events-none">
          <div className="pointer-events-auto">
            {status === 'disconnected' || status === 'error' ? (
              <button onClick={connect} disabled={menuLoading} className="bg-[#1B4332] hover:bg-[#2D5A45] text-white rounded-full px-8 py-4 flex items-center gap-4 shadow-2xl border border-[#D4A574] transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed group">
                <div className="relative">
                  <Mic size={24} className="relative z-10" />
                  <div className="absolute inset-0 bg-[#D4A574] rounded-full blur-md opacity-20 group-hover:opacity-40 transition-opacity"></div>
                </div>
                <span className="font-serif italic text-lg pr-2">Hablar con Patxi</span>
              </button>
            ) : (
              <div className="flex items-center gap-3 bg-stone-900/90 backdrop-blur-md p-2 rounded-full border border-stone-700 shadow-2xl">
                <button onClick={() => setIsMuted(!isMuted)} className={`p-4 rounded-full transition-all ${isMuted ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-stone-800 text-stone-200 hover:bg-stone-700'}`}>
                  {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                </button>
                <button onClick={disconnect} className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-full font-bold text-sm tracking-wide uppercase transition-colors">
                  Terminar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
