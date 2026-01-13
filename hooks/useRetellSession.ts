import { useEffect, useRef, useState, useCallback } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';

const AGENT_ID = 'agent_e469cb9774a51cfa601ba1da21';
const RETELL_API_KEY = 'key_84206584341d9e086a6ce02d7468';

interface UseRetellSessionProps {
    onConfirmOrder: (diners: number, name?: string, items?: any[]) => Promise<boolean>;
    cartItems: any[]; // Current cart state
}

export const useRetellSession = ({
    onConfirmOrder,
    cartItems
}: UseRetellSessionProps) => {
    const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
    const [logs, setLogs] = useState<{ role: string, text: string }[]>([]);
    const [lastError, setLastError] = useState<string | null>(null);

    const retellClientRef = useRef<RetellWebClient | null>(null);
    const currentCallIdRef = useRef<string | null>(null);

    // Update refs
    const propsRef = useRef({ onConfirmOrder });
    const cartItemsRef = useRef(cartItems);

    useEffect(() => {
        propsRef.current = { onConfirmOrder };
        cartItemsRef.current = cartItems;
        console.log('🛒 Cart updated, items:', cartItems.length);
    }, [onConfirmOrder, cartItems]);

    const processTranscriptForOrders = useCallback((role: 'user' | 'agent', text: string) => {
        console.log(`🔍 Processing transcript [${role}]:`, text);

        if (!text || role !== 'agent') {
            return;
        }

        const lower = text.toLowerCase();

        // ONLY HANDLE CONFIRMATION - Everything else is manual via UI
        const confirmKeywords = ['marchando a cocina', 'envio a cocina', 'pedido confirmado', 'confirmo el pedido'];
        if (confirmKeywords.some(k => lower.includes(k))) {
            console.log('✅ CONFIRM ORDER TRIGGERED');
            console.log('🛒 Current cart:', cartItemsRef.current);
            propsRef.current.onConfirmOrder(1, 'Cliente');
        }
    }, []);

    useEffect(() => {
        console.log('🔌 Initializing Retell Client');
        const client = new RetellWebClient();

        client.on('call_started', () => {
            console.log('📞 Call started');
            setStatus('connected');
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
            console.log('🔌 Cleaning up Retell Client');
            client.stopCall();
        };
    }, [processTranscriptForOrders]);

    const connect = useCallback(async () => {
        try {
            console.log('🔗 Connecting to Retell...');
            setStatus('connecting');
            setLastError(null);

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
