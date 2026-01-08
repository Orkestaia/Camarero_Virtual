import React from 'react';
import { ConfirmedOrder } from '../types';
import { Clock, ChefHat, Check, Utensils } from 'lucide-react';

interface OrderStatusProps {
  orders: ConfirmedOrder[];
  tableNumber: string;
}

const OrderStatus: React.FC<OrderStatusProps> = ({ orders, tableNumber }) => {
  const [isOpen, setIsOpen] = React.useState(true);

  // Filter for TODAY's orders only (ignore old tests)
  const isToday = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
  };

  const myOrders = orders
    .filter(o => o.tableNumber === tableNumber && isToday(o.timestamp))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (myOrders.length === 0) return null;

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'pending': return { icon: <Clock size={14} />, text: 'Enviado', color: 'text-stone-500 bg-stone-100' };
      case 'cooking': return { icon: <ChefHat size={14} />, text: 'Cocinando', color: 'text-amber-700 bg-amber-100 animate-pulse' };
      case 'ready':
      case 'served': return { icon: <Utensils size={14} />, text: 'Servido', color: 'text-emerald-700 bg-emerald-100' };
      default: return { icon: <Check size={14} />, text: status, color: 'text-stone-500' };
    }
  };

  return (
    <div className={`transition-all duration-300 ease-in-out ${isOpen ? 'w-64' : 'w-12'} bg-white rounded-xl shadow-lg border border-stone-200 overflow-hidden`}>
      {/* Header / Toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-stone-50 p-3 flex items-center justify-between hover:bg-stone-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Utensils size={16} className="text-[#1B4332]" />
          {isOpen && <span className="font-bold text-xs text-[#1B4332] uppercase tracking-wide">Tus Pedidos</span>}
        </div>
        {!isOpen && (
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>
        )}
      </button>

      {/* Content */}
      {isOpen && (
        <div className="max-h-60 overflow-y-auto p-2 space-y-2 bg-stone-50/50 scrollbar-hide">
          {myOrders.map(order => {
            const statusConfig = getStatusConfig(order.status);
            return (
              <div key={order.id} className="bg-white border border-stone-100 rounded-lg p-2 shadow-sm">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] text-stone-400 font-mono">
                    {new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${statusConfig.color}`}>
                    {statusConfig.icon}
                    <span>{statusConfig.text}</span>
                  </div>
                </div>
                <div className="space-y-0.5">
                  {order.items.map((item, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-stone-600 truncate max-w-[120px]"><span className="font-bold text-stone-900">{item.quantity}x</span> {item.menuItem.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OrderStatus;
