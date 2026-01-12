import { useEffect, useRef, useState, useCallback } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';

const AGENT_ID = 'agent_e469cb9774a51cfa601ba1da21';
const RETELL_API_KEY = 'key_84206584341d9e086a6ce02d7468'; // User provided

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

    // Initialize Client
    useEffect(() => {
        const client = new RetellWebClient();

        // Event Listeners
        client.on('call_started', () => {
            console.log("📞 Retell Call Started");
            setStatus('connected');
        });

        client.on('call_ended', () => {
            console.log("📞 Retell Call Ended");
            setStatus('disconnected');
            currentCallIdRef.current = null;
        });

        client.on('error', (err) => {
            console.error("❌ Retell Error:", err);
            setLastError(String(err));
            setStatus('error');
        });

        client.on('update', (update) => {
            // Log transcript
            if (update.transcript) {
                const lastMsg = update.transcript[update.transcript.length - 1];
                if (lastMsg) {
                    // Determine role (simplified)
                    const role = lastMsg.role === 'agent' ? 'assistant' : 'user';
                    setLogs(prev => {
                        // Avoid duplicates if possible, or just push
                        const last = prev[prev.length - 1];
                        if (last && last.text === lastMsg.content) return prev;
                        return [...prev, { role, text: lastMsg.content }];
                    });
                }
            }

            // --- EXPERIMENTAL: TOOL CALL INTERCEPTION ---
            // Retell client might not expose tools directly, but let's check the update object in logs
            console.log("Retell Update:", update);
        });

        retellClientRef.current = client;

        return () => {
            client.stopCall();
        };
    }, []);

    const connect = useCallback(async () => {
        try {
            setStatus('connecting');
            setLastError(null);

            // 1. Get Access Token (Client-side fetch - typically server-side)
            console.log("🔑 Fetching Retell Access Token...");
            const response = await fetch('https://api.retellai.com/v2/create-web-call', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${RETELL_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    agent_id: AGENT_ID,
                })
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Failed to create web call: ${err}`);
            }

            const data = await response.json();
            const accessToken = data.access_token;
            currentCallIdRef.current = data.call_id;
            console.log("✅ Token received. Call ID:", data.call_id);

            // 2. Start Call
            if (retellClientRef.current) {
                await retellClientRef.current.startCall({ accessToken });
            }

        } catch (err: any) {
            console.error("Connection Failed:", err);
            setLastError(err.message);
            setStatus('error');
        }
    }, []);

    const disconnect = useCallback(() => {
        if (retellClientRef.current) {
            retellClientRef.current.stopCall();
        }
    }, []);

    // Mute Toggle
    useEffect(() => {
        // Retell SDK manages mic, no direct mute method documented in simple docs?
        // Assuming generic behavior or handling upstream.
    }, [isMuted]);

    return { status, connect, disconnect, isMuted, setIsMuted, volumeLevel: 50, logs, lastError }; // Mock volume for now
};
