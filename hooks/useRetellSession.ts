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
    const processedActionsRef = useRef<Set<string>>(new Set());
    const menuRef = useRef(menu);

    // Update refs
    const propsRef = useRef({ onAddToCart, onRemoveFromOrder, onSetDiners, onConfirmOrder });
    useEffect(() => {
        menuRef.current = menu;
        propsRef.current = { onAddToCart, onRemoveFromOrder, onSetDiners, onConfirmOrder };
        console.log('📋 Menu updated, items:', menu.length);
    }, [menu, onAddToCart, onRemoveFromOrder, onSetDiners, onConfirmOrder]);

    const processTranscriptForOrders = useCallback((role: 'user' | 'agent', text: string) => {
        console.log(`🔍 Processing transcript [${role}]:`, text);

        if (!text) {
            console.log('⚠️ Empty text, skipping');
            return;
        }

        const lower = text.toLowerCase();
        const normalized = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Remove accents

        // ONLY PROCESS AGENT RESPONSES (when he confirms)
        if (role !== 'agent') {
            console.log('👤 User message, skipping Shadow Logic');
            return;
        }

        console.log('🤖 Agent message detected');

        // Check for negation first
        const negations = ['no tenemos', 'no queda', 'lo siento', 'no hay'];
        if (negations.some(neg => lower.includes(neg))) {
            console.log('❌ Negation detected, skipping');
            return;
        }

        // 1. CONFIRM ORDER (to kitchen)
        const confirmKeywords = ['marchando a cocina', 'envio a cocina', 'pedido confirmado', 'lo confirmo'];
        if (confirmKeywords.some(k => lower.includes(k))) {
            const actionKey = `confirm_${Date.now()}`;
            if (!processedActionsRef.current.has(actionKey)) {
                console.log('✅ CONFIRM ORDER TRIGGERED');
                processedActionsRef.current.add(actionKey);
                propsRef.current.onConfirmOrder(1, 'Cliente');
            }
        }

        // 2. ADD TO ORDER - Check each menu item
        // BUT FIRST: Check if this is a RECAP (summary) rather than a new confirmation
        const recapPhrases = [
            'entonces tenemos',
            'recapitulo',
            'resumiendo',
            'en total',
            'para confirmar',
            'correcto?',
            'es correcto',
            'todo bien',
            'perfecto entonces',
            'tenemos entonces'
        ];

        const isRecap = recapPhrases.some(phrase => lower.includes(phrase));

        if (isRecap) {
            console.log('📋 RECAP DETECTED - Skipping item addition to avoid duplicates');
            return; // Don't add items during recaps
        }

        const addKeywords = ['marchando', 'anoto', 'apunto', 'añado'];
        const hasAddKeyword = addKeywords.some(k => lower.includes(k));

        if (hasAddKeyword) {
            console.log('🎯 Add keyword detected, checking menu items...');
            console.log('📋 Current menu:', menuRef.current.map(m => m.name));

            menuRef.current.forEach(item => {
                const itemNameLower = item.name.toLowerCase();
                const itemNameNormalized = itemNameLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                // Multiple matching strategies
                const exactMatch = lower.includes(itemNameLower);
                const normalizedMatch = normalized.includes(itemNameNormalized);

                // Partial word matching (e.g., "bravas" matches "Patatas Bravas")
                const itemWords = itemNameLower.split(' ');
                const partialMatch = itemWords.some(word => word.length > 3 && lower.includes(word));

                if (exactMatch || normalizedMatch || partialMatch) {
                    const actionKey = `add_${item.id}_${text.substring(0, 20)}`;

                    if (!processedActionsRef.current.has(actionKey)) {
                        console.log(`✅ ADDING ITEM: ${item.name}`);
                        processedActionsRef.current.add(actionKey);
                        propsRef.current.onAddToCart(item, 1);
                    } else {
                        console.log(`⏭️ Already added: ${item.name}`);
                    }
                }
            });
        }

        // 3. REMOVE FROM ORDER
        const removeKeywords = ['quito', 'borro', 'elimino', 'sin'];
        if (removeKeywords.some(k => lower.includes(k))) {
            console.log('🗑️ Remove keyword detected');
            menuRef.current.forEach(item => {
                if (lower.includes(item.name.toLowerCase())) {
                    const actionKey = `remove_${item.id}_${text.substring(0, 20)}`;
                    if (!processedActionsRef.current.has(actionKey)) {
                        console.log(`🗑️ REMOVING ITEM: ${item.name}`);
                        processedActionsRef.current.add(actionKey);
                        propsRef.current.onRemoveFromOrder(item.name);
                    }
                }
            });
        }
    }, []);

    useEffect(() => {
        console.log('🔌 Initializing Retell Client');
        const client = new RetellWebClient();

        client.on('call_started', () => {
            console.log('📞 Call started');
            setStatus('connected');
            processedActionsRef.current.clear();
        });

        client.on('call_ended', () => {
            console.log('📞 Call ended');
            setStatus('disconnected');
            currentCallIdRef.current = null;
        });

        client.on('error', (err) => {
            console.error('❌ Retell Error:', err);
            setLastError(String(err));
            setStatus('error');
        });

        client.on('update', (update) => {
            console.log('📨 Retell update received:', update);

            if (update.transcript) {
                const lastMsg = update.transcript[update.transcript.length - 1];
                if (lastMsg) {
                    console.log('💬 New transcript message:', lastMsg);
                    const role = lastMsg.role === 'agent' ? 'assistant' : 'user';

                    setLogs(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.text === lastMsg.content) {
                            return prev;
                        }
                        return [...prev, { role, text: lastMsg.content }];
                    });

                    // TRIGGER SHADOW LOGIC
                    processTranscriptForOrders(lastMsg.role, lastMsg.content);
                }
            }
        });

        retellClientRef.current = client;
        return () => {
            console.log('🔌 Cleaning up Retell Client');
            client.stopCall();
        };
    }, [processTranscriptForOrders]);

    const connect = useCallback(async () => {
        try {
            console.log('🔗 Connecting to Retell...');
            setStatus('connecting');
            setLastError(null);
            processedActionsRef.current.clear();

            const response = await fetch('https://api.retellai.com/v2/create-web-call', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${RETELL_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ agent_id: AGENT_ID })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Failed to create call:', errorText);
                throw new Error(errorText);
            }

            const data = await response.json();
            console.log('✅ Access token received');

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
        console.log('🔌 Disconnecting...');
        if (retellClientRef.current) retellClientRef.current.stopCall();
    }, []);

    return { status, connect, disconnect, isMuted: false, setIsMuted: () => { }, volumeLevel: 50, logs, lastError };
};
