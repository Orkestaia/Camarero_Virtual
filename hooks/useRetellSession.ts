import { useEffect, useRef, useState, useCallback } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';

const AGENT_ID = 'agent_e469cb9774a51cfa601ba1da21';
const RETELL_API_KEY = 'key_84206584341d9e086a6ce02d7468';

interface UseRetellSessionProps {
    onAddToCart: (item: any, quantity: number, notes?: string) => void;
    onRemoveFromOrder: (itemName: string) => void;
    onConfirmOrder: (diners: number, name?: string, items?: any[]) => Promise<boolean>;
    menu: any[];
    cartItems: any[];
}

export const useRetellSession = ({
    onAddToCart,
    onRemoveFromOrder,
    onConfirmOrder,
    menu,
    cartItems
}: UseRetellSessionProps) => {
    const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
    const [logs, setLogs] = useState<{ role: string, text: string }[]>([]);
    const [lastError, setLastError] = useState<string | null>(null);

    const retellClientRef = useRef<RetellWebClient | null>(null);

    // Track which items we've already added in this conversation turn
    const addedItemsInTurnRef = useRef<Set<string>>(new Set());
    const lastProcessedTextRef = useRef<string>('');

    const menuRef = useRef(menu);
    const propsRef = useRef({ onAddToCart, onRemoveFromOrder, onConfirmOrder });

    useEffect(() => {
        menuRef.current = menu;
        propsRef.current = { onAddToCart, onRemoveFromOrder, onConfirmOrder };
    }, [menu, onAddToCart, onRemoveFromOrder, onConfirmOrder]);

    const processTranscriptForOrders = useCallback((role: 'user' | 'agent', text: string) => {
        if (!text || role !== 'agent') return;

        // Skip if we already processed this exact text
        if (text === lastProcessedTextRef.current) {
            console.log('⏭️ Already processed this text, skipping');
            return;
        }
        lastProcessedTextRef.current = text;

        const lower = text.toLowerCase();
        const normalized = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        console.log(`🔍 Processing: "${text}"`);

        // Check for negation
        const negations = ['no tenemos', 'no queda', 'lo siento', 'no hay'];
        if (negations.some(neg => lower.includes(neg))) {
            console.log('❌ Negation detected');
            return;
        }

        // 1. CONFIRM ORDER
        const confirmKeywords = ['marchando a cocina', 'envio a cocina', 'pedido confirmado', 'confirmo el pedido'];
        if (confirmKeywords.some(k => lower.includes(k))) {
            console.log('✅ CONFIRMING ORDER');
            propsRef.current.onConfirmOrder(1, 'Cliente');
            return;
        }

        // 2. SMART RECAP DETECTION
        // Count items mentioned
        let mentionedItems: any[] = [];
        menuRef.current.forEach(item => {
            if (lower.includes(item.name.toLowerCase())) {
                mentionedItems.push(item);
            }
        });

        // Detect recap phrases
        const recapPhrases = ['entonces tenemos', 'recapitulo', 'resumiendo', 'en total', 'para confirmar'];
        const hasRecapPhrase = recapPhrases.some(phrase => lower.includes(phrase));

        // CRITICAL: Only block if BOTH recap phrase AND 2+ items
        if (hasRecapPhrase && mentionedItems.length >= 2) {
            console.log(`📋 RECAP DETECTED (${mentionedItems.length} items) - BLOCKING`);
            return;
        }

        // 3. ADD ITEMS
        const addKeywords = [
            'marchando', 'anoto', 'apunto', 'añado',
            'ponme', 'pongo', 'quiero', 'dame', 'deme',
            'traeme', 'traiga', 'trae', 'pon'
        ];
        const hasAddKeyword = addKeywords.some(k => lower.includes(k));

        if (hasAddKeyword) {
            console.log('🎯 Add keyword detected');

            menuRef.current.forEach(item => {
                const itemNameLower = item.name.toLowerCase();
                const itemNameNormalized = itemNameLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                // Multiple matching strategies
                const exactMatch = lower.includes(itemNameLower);
                const normalizedMatch = normalized.includes(itemNameNormalized);

                // Partial word matching
                const itemWords = itemNameLower.split(' ');
                const partialMatch = itemWords.some(word => word.length > 3 && lower.includes(word));

                if (exactMatch || normalizedMatch || partialMatch) {
                    // CRITICAL FIX: Use item ID for deduplication, not text length
                    if (!addedItemsInTurnRef.current.has(item.id)) {
                        console.log(`✅ ADDING: ${item.name}`);
                        addedItemsInTurnRef.current.add(item.id);
                        propsRef.current.onAddToCart(item, 1);
                    } else {
                        console.log(`⏭️ Already added in this turn: ${item.name}`);
                    }
                }
            });
        }

        // 4. REMOVE ITEMS
        const removeKeywords = ['quito', 'quita', 'borro', 'borra', 'elimino', 'elimina', 'cancela', 'cancelo'];
        if (removeKeywords.some(k => lower.includes(k))) {
            console.log('🗑️ Remove keyword detected');
            menuRef.current.forEach(item => {
                if (lower.includes(item.name.toLowerCase())) {
                    console.log(`🗑️ REMOVING: ${item.name}`);
                    propsRef.current.onRemoveFromOrder(item.name);
                }
            });
        }
    }, []);

    useEffect(() => {
        const client = new RetellWebClient();

        client.on('call_started', () => {
            console.log('📞 Call started');
            setStatus('connected');
            addedItemsInTurnRef.current.clear();
            lastProcessedTextRef.current = '';
        });

        client.on('call_ended', () => {
            console.log('📞 Call ended');
            setStatus('disconnected');
            addedItemsInTurnRef.current.clear();
        });

        client.on('error', (err) => {
            console.error('❌ Retell Error:', err);
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
                        if (last && last.text === lastMsg.content) {
                            return prev;
                        }
                        return [...prev, { role, text: lastMsg.content }];
                    });

                    processTranscriptForOrders(lastMsg.role, lastMsg.content);
                }
            }
        });

        retellClientRef.current = client;
        return () => {
            console.log('🔌 Cleaning up');
            client.stopCall();
        };
    }, [processTranscriptForOrders]);

    const connect = useCallback(async () => {
        try {
            console.log('🔗 Connecting...');
            setStatus('connecting');
            setLastError(null);
            addedItemsInTurnRef.current.clear();
            lastProcessedTextRef.current = '';

            const response = await fetch('https://api.retellai.com/v2/create-web-call', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${RETELL_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ agent_id: AGENT_ID })
            });

            if (!response.ok) {
                throw new Error(await response.text());
            }

            const data = await response.json();

            if (retellClientRef.current) {
                await retellClientRef.current.startCall({ accessToken: data.access_token });
            }
        } catch (err: any) {
            console.error('❌ Connection Failed:', err);
            setLastError(err.message);
            setStatus('error');
        }
    }, []);

    const disconnect = useCallback(() => {
        if (retellClientRef.current) retellClientRef.current.stopCall();
    }, []);

    return { status, connect, disconnect, isMuted: false, setIsMuted: () => { }, volumeLevel: 50, logs, lastError };
};
