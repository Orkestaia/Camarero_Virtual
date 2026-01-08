import React, { useState, useEffect, useRef } from 'react';
import { OrderItem } from '../types';
import { ShoppingCart, Send, Minus, Plus, Trash2, Loader2, Receipt } from 'lucide-react';

interface OrderSummaryProps {
  items: OrderItem[];
  total: number;
  tableNumber: string;
  onConfirm: () => void | Promise<void> | Promise<boolean>;
  onRemoveItem: (id: string) => void;
  onUpdateQuantity: (id: string, quantity: number) => void;
  isSending?: boolean;
}

const OrderSummary: React.FC<OrderSummaryProps> = ({
  items,
  total,
  tableNumber,
  onConfirm,
  onRemoveItem,
  onUpdateQuantity,
  isSending = false
}) => {
  const [isBumped, setIsBumped] = useState(false);
  const prevQuantityRef = useRef(0);

  const currentQuantity = items.reduce((acc, item) => acc + item.quantity, 0);

  useEffect(() => {
    // Trigger animation only when quantity increases
    if (currentQuantity > prevQuantityRef.current) {
      setIsBumped(true);
      const timer = setTimeout(() => setIsBumped(false), 200);
      return () => clearTimeout(timer);
    }
    prevQuantityRef.current = currentQuantity;
  }, [currentQuantity]);

  return (
    <div className="bg-white rounded-sm shadow-xl shadow-stone-200/50 border border-stone-100 flex flex-col h-[500px] relative overflow-hidden">
      {/* Receipt zig-zag pattern decoration at top (css pseudo optional, using border for now) */}
      <div className="h-1 bg-gradient-to-r from-stone-900 via-stone-700 to-stone-900"></div>

      <div className="p-5 pb-3 border-b border-dashed border-stone-300 bg-stone-50">
        <div className="flex justify-between items-center mb-1">
          <h3 className="font-serif font-bold text-xl text-[#1B4332] flex items-center gap-2">
            <Receipt
              size={20}
              className={`text-[#D4A574] transition-transform duration-200 ease-out ${isBumped ? 'scale-150 rotate-12 text-[#BC6C4F]' : 'scale-100'}`}
            />
            Su Comanda
          </h3>
          <span className="text-xs font-mono text-stone-500 uppercase tracking-widest">
            Mesa {tableNumber}
          </span>
        </div>
        <p className="text-[10px] text-stone-400 uppercase tracking-wide text-center mt-2">
          Restaurante Garrote Service
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pr-2 custom-scrollbar bg-white">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-stone-300 text-sm italic">
            <ShoppingCart size={32} className="mb-3 opacity-20" />
            <p className="font-serif text-lg text-stone-400">Sin productos</p>
            <p className="text-xs mt-1">Pídale una recomendación a Ramiro</p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="group flex flex-col gap-1 pb-3 border-b border-stone-100 last:border-0">
              <div className="flex justify-between items-start">
                <span className="font-serif text-stone-800 text-base leading-tight flex-1 mr-4">
                  {item.menuItem.name}
                </span>
                <span className="font-mono text-stone-900 text-sm font-medium">
                  {(item.menuItem.price * item.quantity).toFixed(2)}€
                </span>
              </div>

              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-3">
                  <div className="flex items-center border border-stone-200 rounded-sm">
                    <button
                      onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                      className="px-2 py-0.5 hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
                      disabled={isSending}
                    >
                      <Minus size={10} />
                    </button>
                    <span className="text-xs font-mono font-bold w-6 text-center bg-stone-50 text-stone-800 py-0.5">{item.quantity}</span>
                    <button
                      onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                      className="px-2 py-0.5 hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
                      disabled={isSending}
                    >
                      <Plus size={10} />
                    </button>
                  </div>

                  {item.notes && (
                    <span className="text-[10px] text-[#BC6C4F] italic truncate max-w-[120px]">
                      * {item.notes}
                    </span>
                  )}
                </div>

                <button
                  onClick={() => onRemoveItem(item.id)}
                  className="text-stone-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                  title="Eliminar"
                  disabled={isSending}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-5 bg-[#FDF8F3] border-t border-double border-stone-300">
        <div className="flex justify-between items-end mb-4">
          <span className="font-serif text-stone-600 italic">Total</span>
          <span className="text-3xl font-serif font-bold text-[#1B4332]">{total.toFixed(2)}€</span>
        </div>

        <button
          onClick={onConfirm}
          disabled={items.length === 0 || isSending}
          className="w-full bg-[#1B4332] hover:bg-[#2D5A45] disabled:bg-stone-300 disabled:cursor-not-allowed text-white py-3 rounded-sm font-medium tracking-widest text-xs uppercase shadow-lg shadow-stone-300 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
        >
          {isSending ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span>Tramitando...</span>
            </>
          ) : (
            <>
              <span>Confirmar Pedido</span>
              <Send size={14} />
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default OrderSummary;