
export interface MenuItem {
  id: string; // Will map from 'row_number'
  name: string; // Nombre
  description: string; // Descripción
  price: number; // Precio
  category: string; // Categoría
  allergens: string[]; // Alergenos (split by comma)
  dietary: string[]; // Tipo dieto
  available: boolean; // Disponibilidad
  ingredients: string[]; // Ingredientes
}

export interface OrderItem {
  id: string;
  menuItem: MenuItem;
  quantity: number;
  notes?: string;
  timestamp: string;
}

export interface ConfirmedOrder {
  id: string;
  tableNumber: string;
  items: OrderItem[];
  status: 'pending' | 'cooking' | 'ready' | 'served';
  timestamp: string;
  acceptedTimestamp?: string; // Hora cuando pasó a cooking
  servedTimestamp?: string;   // Hora cuando pasó a ready/served
  clientName?: string;
  diners?: number;
  totalPrice: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface LogMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
}
