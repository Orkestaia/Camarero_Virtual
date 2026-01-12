import { useEffect, useRef, useState, useCallback } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';

const AGENT_ID = 'agent_e469cb9774a51cfa601ba1da21';
const RETELL_API_KEY = 'key_84206584341d9e086a6ce02d7468';

interface UseRetellSessionProps {
    onAddToCart: (item: any, quantity: number, notes?: string) => void;
    onRemoveFromOrder: (itemName: string) => void;
    onSetDiners: (count: number, name?: string) => void;
    onConfirmOrder: (diners: number, name?: string, items?: any[]) => Promise<boolean>;
    menu: any[];
}

export const useRetellSession = ({
    onAddToCart,
    onRemoveFromOrder,
    onSetDiners,
    onConfirmOrder,
    menu
}: UseRetellSessionProps) => {
    const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
    const [isMuted, setIsMuted] = useState(false);
    const [logs, setLogs] = useState<{ role: string, text: string }[]>([]);
    const [lastError, setLastError] = useState<string | null>(null);

    const retellClientRef = useRef<RetellWebClient | null>(null);
    const currentCallIdRef = useRef<string | null>(null);

    // SHADOW LOGIC REFS
    const processedTextRef = useRef<Set<string>>(new Set());
    const menuRef = useRef(menu);
    const onAddToCartRef = useRef(onAddToCart);

    useEffect(() => {
        menuRef.current = menu;
        onAddToCartRef.current = onAddToCart;
    }, [menu, onAddToCart]);

    const processTranscriptForOrders = (role: 'user' | 'agent', text: string) => {
        if (!text || processedTextRef.current.has(text)) return;
        processedTextRef.current.add(text);

        const lower = text.toLowerCase();
        console.log(`🧠 Shadow Logic (${role}):`, lower);

        // STRATEGY: 
        // If Agent matches "marchando X" or "anoto X" or "añado X", it verified the order.
        // If User matches "ponme X", we *could* add it, but risky if Agent refuses.
        // HYBRID: We trust the AGENT'S confirmation. 
        // Why? Because Agent prompt says "Marchando..." only when confirmed.

        if (role === 'agent') {
            const confirmationKeywords = ['marchando', 'oido', 'anoto', 'añado', 'aquí tienes', 'perfecto', 'tomo nota'];
            const negationKeywords = ['no tenemos', 'no queda', 'lo siento'];

            // If Agent is NEGATING, do nothing.
            if (negationKeywords.some(k => lower.includes(k))) return;

            // Check for Menu Items
            menuRef.current.forEach(item => {
                const itemName = item.name.toLowerCase();
                // Simplified matching: exact or mostly exact
                if (lower.includes(itemName) ||
                    (itemName.includes('bravas') && lower.includes('bravas')) ||
                    (itemName.includes('hamburguesa') && lower.includes('hamburguesa'))
                ) {
                    // Trigger!
                    console.log("🚀 Shadow Trigger: Adding", item.name);
                    onAddToCartRef.current(item, 1); // Default to 1 for safety
                }
            });
        }
    };

    useEffect(() => {
        const client = new RetellWebClient();

        client.on('call_started', () => setStatus('connected'));
        client.on('call_ended', () => {
            setStatus('disconnected');
            currentCallIdRef.current = null;
            processedTextRef.current.clear();
        });
        client.on('error', (err) => {
            console.error("❌ Retell Error:", err);
            setLastError(String(err));
            setStatus('error');
        });

        client.on('update', (update) => {
            if (update.transcript) {
                const lastMsg = update.transcript[update.transcript.length - 1];
                if (lastMsg) {
                    const role = lastMsg.role === 'agent' ? 'assistant' : 'user';
                    setLogs(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.text === lastMsg.content) return prev;
                        return [...prev, { role, text: lastMsg.content }];
                    });

                    // TRIGGER SHADOW LOGIC
                    processTranscriptForOrders(lastMsg.role, lastMsg.content);
                }
            }
        });

        retellClientRef.current = client;
        return () => client.stopCall();
    }, []);

    const connect = useCallback(async () => {
        try {
            setStatus('connecting');
            setLastError(null);
            processedTextRef.current.clear();

            const response = await fetch('https://api.retellai.com/v2/create-web-call', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${RETELL_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ agent_id: AGENT_ID })
            });

            if (!response.ok) throw new Error(await response.text());
            const data = await response.json();

            if (retellClientRef.current) {
                await retellClientRef.current.startCall({ accessToken: data.access_token });
            }
        } catch (err: any) {
            console.error("Connection Failed:", err);
            setLastError(err.message);
            setStatus('error');
        }
    }, []);

    const disconnect = useCallback(() => {
        if (retellClientRef.current) retellClientRef.current.stopCall();
    }, []);

    return { status, connect, disconnect, isMuted, setIsMuted, volumeLevel: 50, logs, lastError };
};
