import React from 'react';
import { ConfirmedOrder } from '../types';
import { Clock, ChefHat, Check, Utensils } from 'lucide-react';

interface OrderStatusProps {
  orders: ConfirmedOrder[];
  tableNumber: string;
}

const OrderStatus: React.FC<OrderStatusProps> = ({ orders, tableNumber }) => {
  const myOrders = orders.filter(o => o.tableNumber === tableNumber).sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (myOrders.length === 0) return null;

  const getStatusConfig = (status: string) => {
    switch(status) {
        case 'pending': return { icon: <Clock size={16}/>, text: 'Enviado', color: 'text-slate-500 bg-slate-100' };
        case 'cooking': return { icon: <ChefHat size={16}/>, text: 'Cocinando', color: 'text-yellow-700 bg-yellow-100 animate-pulse' };
        case 'ready': 
        case 'served': return { icon: <Utensils size={16}/>, text: 'Listo / Servido', color: 'text-green-700 bg-green-100' };
        default: return { icon: <Check size={16}/>, text: status, color: 'text-slate-500' };
    }
  };

  return (
    <div className="bg-white rounded-t-xl shadow-[0_-5px_20px_rgba(0,0,0,0.1)] border-t border-slate-200 p-4 max-h-64 overflow-y-auto">
      <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
        <Utensils size={18} /> Tus Pedidos
      </h3>
      <div className="space-y-3">
        {myOrders.map(order => {
            const statusConfig = getStatusConfig(order.status);
            return (
                <div key={order.id} className="border border-slate-100 rounded-lg p-3 bg-slate-50">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs text-slate-400">
                             {new Date(order.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                        <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${statusConfig.color}`}>
                            {statusConfig.icon}
                            <span>{statusConfig.text}</span>
                        </div>
                    </div>
                    <div className="space-y-1">
                        {order.items.map((item, i) => (
                            <div key={i} className="flex justify-between text-sm">
                                <span className="text-slate-700"><span className="font-bold text-slate-900">{item.quantity}x</span> {item.menuItem.name}</span>
                                <span className="text-slate-500">{(item.quantity * item.menuItem.price).toFixed(2)}€</span>
                            </div>
                        ))}
                    </div>
                </div>
            );
        })}
      </div>
    </div>
  );
};

export default OrderStatus;
