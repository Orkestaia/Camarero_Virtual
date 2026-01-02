
import { MenuItem, ConfirmedOrder, OrderItem } from "../types";

// --- CONFIGURATION ---
// --- CONFIGURATION ---
const MENU_SHEET_ID = "1lCnasTfceKEf1zCLaNN-pJ4dSoOcLXGSJqfhr5IjDaQ";

// Updated Webhook URL from provided JSON (Assuming same instance domain)
const N8N_WEBHOOK_URL = "https://acgrowthmarketing.app.n8n.cloud/webhook/9d2ccd81-7b77-4538-8f98-00fa0469331e";

// URLs to fetch data as CSV (Read Only - Fast)
const MENU_CSV_URL = `https://docs.google.com/spreadsheets/d/e/2PACX-1vSsGHRK2wtrNJg6a84Qd-Vae0tWY6waZ79MKpM6ouBYYc75jyWhG9BOtw0aceOFHB09E2MPFIeUjujV/pub?output=csv`;
const ORDERS_CSV_URL = `https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0ZEi4qlGwZ3g8dFBGjNTUynory53ETAqGNQ-WS4vjv_-ENfFRTZOOc4yI9ZcHiD9BICAPkQwiQgz6/pub?output=csv`;

// Local memory for optimistic UI updates
let localOrders: ConfirmedOrder[] = [];
let hasLoadedInitialOrders = false;

// --- CSV PARSING UTILS ---

function parseCSVLine(text: string): string[] {
    const result: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"') {
            if (inQuotes && text[i + 1] === '"') {
                cell += '"'; // Escaped quote
                i++;
            } else {
                inQuotes = !inQuotes; // Toggle quotes
            }
        } else if (char === ',' && !inQuotes) {
            result.push(cell.trim());
            cell = '';
        } else {
            cell += char;
        }
    }
    result.push(cell.trim());
    return result;
}

async function fetchSheetData(url: string): Promise<Record<string, string>[]> {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch CSV");
        const text = await response.text();

        const lines = text.split('\n').filter(line => line.trim() !== '');
        if (lines.length < 2) return [];

        const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/['"]/g, '').trim());

        return lines.slice(1).map(line => {
            const values = parseCSVLine(line);
            const row: Record<string, string> = {};
            headers.forEach((header, index) => {
                let value = values[index] || '';
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.slice(1, -1);
                }
                row[header] = value;
            });
            return row;
        });
    } catch (error) {
        console.error("Error fetching sheet:", error);
        return [];
    }
}

// --- MENU FUNCTIONS ---

export async function fetchMenuFromSheets(): Promise<MenuItem[]> {
    try {
        const data = await fetchSheetData(MENU_CSV_URL);

        // Helper for robust boolean parsing
        const isTrue = (val: any) => {
            if (!val) return false;
            const s = String(val).toLowerCase().trim();
            // Check for checkmarks, 'si', 'yes', etc.
            return ['true', 'si', 'yes', '1', 's', 'y', 'ok', 'x'].includes(s);
        };

        return data.map((row, index) => {
            const price = parseFloat(row['precio']?.replace('€', '').trim() || '0');

            return {
                id: `menu_${index}`,
                name: row['nombre'] || 'Desconocido',
                description: row['descripcion'] || '',
                price: isNaN(price) ? 0 : price,
                category: row['categoría'] || row['categoria'] || 'General',
                allergens: (row['alergenos'] || 'ninguno').split(',').map(s => s.trim()).filter(s => s !== 'ninguno'),
                dietary: (row['tipo_dieta'] || '').split(',').map(s => s.trim()),
                available: (row['disponibilidad'] || 'TRUE').toUpperCase() === 'TRUE',
                ingredients: (row['ingredientes'] || '').split(',').map(s => s.trim()),
                image: row['imagen'] || row['foto'] || undefined,
                // Check multiple possible column names for Chef/Top3
                isChefChoice: isTrue(row['chef']) || isTrue(row['sugerencia']) || isTrue(row['sugerencias']) || isTrue(row['recomendado']) || isTrue(row['sugerencias del chef']),
                isTop3: isTrue(row['top3']) || isTrue(row['top 3']) || isTrue(row['favorito']) || isTrue(row['popular']) || isTrue(row['mejores valorados por nuestros clientes'])
            };
        }).filter(item => item.name !== 'Desconocido');

    } catch (error) {
        console.error("Error loading menu:", error);
        return [];
    }
}

// --- ORDER FUNCTIONS ---

export async function fetchOrdersFromSheets(): Promise<ConfirmedOrder[]> {
    try {
        const data = await fetchSheetData(ORDERS_CSV_URL);

        // Use a Map to deduplicate orders by ID. 
        // Since we are appending updates to the sheet (Log style), the last row for a specific ID is the current state.
        const ordersMap = new Map<string, ConfirmedOrder>();

        data.forEach(row => {
            const id = row['numero_pedido'];
            if (!id) return;

            const pedidoStr = row['pedido'] || '';
            const items: OrderItem[] = pedidoStr.split(',').map(p => {
                const parts = p.trim().split('x ');
                if (parts.length >= 2) {
                    const qty = parseInt(parts[0]);
                    const name = parts.slice(1).join('x ').trim();
                    if (!isNaN(qty)) {
                        return {
                            id: Math.random().toString(36).substr(2, 9),
                            menuItem: {
                                id: name, name: name, price: 0,
                                category: 'General', allergens: [], dietary: [],
                                available: true, description: '', ingredients: []
                            },
                            quantity: qty,
                            timestamp: row['hora_pedido'] || '',
                            notes: row['notas_especiales']
                        };
                    }
                }
                return null;
            }).filter(Boolean) as OrderItem[];

            if (items.length === 0) return;

            // Normalize status
            let status = (row['estado'] || 'pending').toLowerCase();
            if (status === 'aceptado' || status === 'cooking') status = 'cooking';
            if (status === 'entregado' || status === 'served') status = 'served';
            if (status === 'listo' || status === 'ready') status = 'ready';
            if (!['pending', 'cooking', 'ready', 'served'].includes(status)) status = 'pending';

            const order: ConfirmedOrder = {
                id: id,
                tableNumber: row['número_mesa'] || row['numero_mesa'] || '?',
                items: items,
                status: status as any,
                timestamp: row['hora_pedido'] ? new Date().toISOString().split('T')[0] + 'T' + row['hora_pedido'] : new Date().toISOString(), // Approximation if date missing
                acceptedTimestamp: row['hora_aceptado'] || undefined,
                servedTimestamp: row['hora_entrega'] || undefined,
                clientName: 'Cliente',
                diners: parseInt(row['comensales'] || '1'),
                totalPrice: parseFloat(row['total_pedido'] || '0')
            };

            // Overwrite existing entry -> Last one wins (Current state)
            ordersMap.set(id, order);
        });

        const sheetOrders = Array.from(ordersMap.values());

        if (!hasLoadedInitialOrders) {
            localOrders = [...sheetOrders];
            hasLoadedInitialOrders = true;
        } else {
            // Smart Merge: Preserve local state if it's "ahead" of the sheet
            // Status hierarchy: pending (0) < cooking (1) < ready (2) < served (3)
            const statusValue = { 'pending': 0, 'cooking': 1, 'ready': 2, 'served': 3 };

            // Create a map of sheet orders for fast lookup
            const sheetMap = new Map(sheetOrders.map(o => [o.id, o]));

            // 1. Keep local orders that are NOT in sheet yet (Optimistic creation)
            const newLocalOrders = localOrders.filter(o => !sheetMap.has(o.id));

            // 2. Update existing orders, but respect local status if ahead
            const mergedOrders = sheetOrders.map(sheetOrder => {
                const localOrder = localOrders.find(o => o.id === sheetOrder.id);
                if (localOrder) {
                    const localVal = statusValue[localOrder.status] || 0;
                    const sheetVal = statusValue[sheetOrder.status] || 0;

                    // If local is ahead (e.g. we clicked 'cooking' but sheet is still 'pending'), keep local status
                    if (localVal > sheetVal) {
                        return {
                            ...sheetOrder,
                            status: localOrder.status,
                            acceptedTimestamp: localOrder.acceptedTimestamp || sheetOrder.acceptedTimestamp,
                            servedTimestamp: localOrder.servedTimestamp || sheetOrder.servedTimestamp
                        };
                    }
                }
                return sheetOrder;
            });

            // Combine
            localOrders = [...newLocalOrders, ...mergedOrders];

            return localOrders.sort((a, b) => b.id.localeCompare(a.id));

        } catch (error) {
            console.error("Error loading orders:", error);
            return localOrders;
        }
    }

// --- N8N WRITING FUNCTIONS ---

async function sendToN8N(payload: any): Promise<boolean> {
        try {
            // N8N usually accepts JSON
            await fetch(N8N_WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });
            return true;
        } catch (e) {
            console.error("Error calling N8N:", e);
            // Fallback: Try with no-cors if CORS is an issue (common with direct browser calls)
            try {
                await fetch(N8N_WEBHOOK_URL, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify(payload)
                });
                return true;
            } catch (e2) {
                return false;
            }
        }
    }

    export async function sendOrderToSheets(order: ConfirmedOrder): Promise<boolean> {
        // 1. Update local state immediately (Optimistic UI)
        localOrders.unshift(order);

        // 2. Prepare payload matching the N8N Workflow expectation
        const pedidoString = order.items.map(i => `${i.quantity}x ${i.menuItem.name}`).join(', ');
        const notesString = order.items.map(i => i.notes).filter(Boolean).join('. ');
        const timeStr = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

        const payload = {
            Numero_pedido: order.id,
            numero_mesa: order.tableNumber,
            Pedido: pedidoString,
            hora_pedido: timeStr,
            hora_aceptado: "",
            hora_entrega: "",
            estado: 'pendiente',
            notas_especiales: notesString,
            comensales: order.diners.toString(),
            total_pedido: order.totalPrice.toFixed(2)
        };

        // 3. Send to N8N
        return sendToN8N(payload);
    }

    export async function updateOrderStatus(orderId: string, status: 'cooking' | 'ready' | 'served'): Promise<boolean> {
        // 1. Find the order data to resend (since N8N appends, we need the full row)
        const orderIndex = localOrders.findIndex(o => o.id === orderId);
        if (orderIndex === -1) return false;

        // Update local state
        const order = localOrders[orderIndex];
        order.status = status;

        // 2. Prepare Payload
        const pedidoString = order.items.map(i => `${i.quantity}x ${i.menuItem.name}`).join(', ');
        const notesString = order.items.map(i => i.notes).filter(Boolean).join('. ');
        const timeStr = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

        // Determine Status string and Timestamps
        let sheetStatus: string = status;

        // Update local timestamps based on status change
        if (status === 'cooking') {
            sheetStatus = 'aceptado';
            order.acceptedTimestamp = timeStr; // Store accepted time
        } else if (status === 'ready' || status === 'served') {
            sheetStatus = 'entregado';
            order.servedTimestamp = timeStr; // Store served time
        }

        // CRITICAL: Ensure we send existing acceptedTimestamp if it exists, so we don't wipe it out in the DB
        const finalHoraAceptado = order.acceptedTimestamp || "";
        const finalHoraEntrega = order.servedTimestamp || "";

        const payload = {
            Numero_pedido: order.id,
            numero_mesa: order.tableNumber,
            Pedido: pedidoString,
            hora_pedido: new Date(order.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
            hora_aceptado: finalHoraAceptado, // Send preserved accepted time
            hora_entrega: finalHoraEntrega,   // Send new or preserved delivered time
            estado: sheetStatus,
            notas_especiales: notesString,
            comensales: order.diners.toString(),
            total_pedido: order.totalPrice.toFixed(2)
        };

        // 3. Send to N8N
        return sendToN8N(payload);
    }

    // Aliases
    export const fetchMenuFromWebhook = fetchMenuFromSheets;
    export const fetchOrdersFromWebhook = fetchOrdersFromSheets;
    export const sendOrderToWebhook = async (order: ConfirmedOrder) => {
        const success = await sendOrderToSheets(order);
        return { success, message: success ? 'Pedido enviado' : 'Error' };
    };
    export const updateOrderInWebhook = updateOrderStatus;
