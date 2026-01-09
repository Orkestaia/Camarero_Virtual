import { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { AudioPlayer } from '../utils/audio';
import { createPcmBlob } from '../utils/audio';
import { SYSTEM_INSTRUCTION } from '../constants';

interface UseLiveSessionProps {
  apiKey: string;
  tableNumber: string;
  menu: any[];
  onAddToCart: (item: any, quantity: number, notes?: string) => void;
  onRemoveFromOrder: (itemName: string) => void;
  onConfirmOrder: (diners: number, name?: string, items?: any[]) => Promise<boolean>;
  onSetDiners: (count: number, name?: string) => void;
  cartItems: any[];
  dinersCount: number;
  clientName: string;
}

export const useLiveSession = ({
  apiKey,
  tableNumber,
  menu,
  onAddToCart,
  onRemoveFromOrder,
  onConfirmOrder,
  onSetDiners,
  cartItems,
  dinersCount,
  clientName
}: UseLiveSessionProps) => {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [isMuted, setIsMuted] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [lastError, setLastError] = useState<{ code: number; reason: string; time: string } | null>(null);
  const [logs, setLogs] = useState<{ role: string, text: string }[]>([]);
  const textBufferRef = useRef<string>(''); // Buffer for accumulating text
  const speechQueueRef = useRef<string[]>([]); // Queue for speech synthesis
  const isSpeakingRef = useRef<boolean>(false); // Flag to track if currently speaking

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const sessionRef = useRef<Promise<any> | null>(null);

  const disconnect = useCallback(() => {
    if (sessionRef.current) sessionRef.current = null;
    audioPlayerRef.current?.stop();
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (inputProcessorRef.current) {
      inputProcessorRef.current.disconnect();
      inputProcessorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setStatus('disconnected');
  }, []);





  // REFS FOR DYNAMIC PROPS (Prevent Stale Closures in WebSocket Cbs)
  const menuRef = useRef(menu);
  const onAddToCartRef = useRef(onAddToCart);
  const onSetDinersRef = useRef(onSetDiners);
  const onConfirmOrderRef = useRef(onConfirmOrder);
  const dinersCountRef = useRef(dinersCount);
  const clientNameRef = useRef(clientName);

  // Sync refs on render
  useEffect(() => {
    menuRef.current = menu;
    onAddToCartRef.current = onAddToCart;
    onSetDinersRef.current = onSetDiners;
    onConfirmOrderRef.current = onConfirmOrder;
    dinersCountRef.current = dinersCount;
    clientNameRef.current = clientName;
  }, [menu, onAddToCart, onSetDiners, onConfirmOrder, dinersCount, clientName]);

  const connect = useCallback(async () => {
    // FORCE USER API KEY FOR STABILITY
    const finalApiKey = 'AIzaSyAjfPyUl3OBHYAyp4Acc4VlFYtI-Pj-Kgg';

    try {
      setStatus('connecting');

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ac = new AudioContextClass({ sampleRate: 16000 });
      await ac.resume();
      audioContextRef.current = ac;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      mediaStreamRef.current = stream;

      const audioPlayer = new AudioPlayer(ac, 24000);
      audioPlayerRef.current = audioPlayer;

      const ai = new GoogleGenAI({ apiKey: finalApiKey });
      const sessionPromise = ai.live.connect({
        model: 'models/gemini-2.0-flash-exp',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
          },
          generationConfig: { temperature: 0.7 },
          systemInstruction: SYSTEM_INSTRUCTION + `\n\n[INSTRUCCIONES CRÍTICAS]\n1. VOZ: Habla en Español de España (es-ES) neutro. NO uses acento latino ni inglés.\n2. HERRAMIENTAS: ERES UN CAMARERO, NO UN CHATBOT. TU PRINCIPAL FUNCIÓN ES ANOTAR.\n   - SI EL USUARIO PIDE ALGO ("quiero unas bravas"), LLAMA INMEDIATAMENTE A 'addToOrder'.\n   - NO digas "tomo nota" si no has llamado a la herramienta.\n   - Solo confirma verbalmente "Anotado X" DESPUÉS de ver el resultado de la herramienta.\n3. SILENCIO: Si el usuario calla, espera. Si habla, cállate.\n\n[CONTEXTO: MESA ${tableNumber}. CLIENTE: ${clientName || 'Cliente'}].`,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "setDiners",
                  description: "Establece el número de comensales de la mesa.",
                  parameters: {
                    type: "OBJECT" as any,
                    properties: {
                      count: { type: "INTEGER" as any, description: "Número de personas." }
                    },
                    required: ["count"]
                  }
                },
                {
                  name: "addToOrder",
                  description: "Añade un plato o bebida al pedido.",
                  parameters: {
                    type: "OBJECT" as any,
                    properties: {
                      itemName: { type: "STRING" as any, description: "Nombre exacto del plato o bebida." },
                      quantity: { type: "INTEGER" as any, description: "Cantidad." },
                      notes: { type: "STRING" as any, description: "Notas (ej: 'sin cebolla')." }
                    },
                    required: ["itemName", "quantity"]
                  }
                },
                {
                  name: "confirmOrder",
                  description: "Confirma y envía el pedido a cocina.",
                  parameters: {
                    type: "OBJECT" as any,
                    properties: {},
                  }
                }
              ]
            }
          ]
        },
        callbacks: {
          onopen: () => {
            setStatus('connected');
            const source = ac.createMediaStreamSource(stream);
            const processor = ac.createScriptProcessor(4096, 1, 1);
            inputProcessorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const rms = Math.sqrt(inputData.reduce((s, v) => s + v * v, 0) / inputData.length);
              setVolumeLevel(rms * 10); // Boost for visualizer

              const pcmBlob = createPcmBlob(inputData);
              if (sessionRef.current) {
                sessionRef.current.then((session: any) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              }
            };

            source.connect(processor);
            processor.connect(ac.destination);
          },
          onmessage: (msg: any) => {
            if (msg.serverContent?.modelTurn) {
              const parts = msg.serverContent.modelTurn.parts || [];

              // Handle Audio
              const audioPart = parts.find((p: any) => p.inlineData && p.inlineData.mimeType.startsWith('audio/'));
              if (audioPart && audioPart.inlineData) {
                const base64 = audioPart.inlineData.data;
                const binaryHelper = atob(base64);
                const len = binaryHelper.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                  bytes[i] = binaryHelper.charCodeAt(i);
                }
                // Play PCM
                audioPlayerRef.current?.add16BitPCM(bytes.buffer);
              }

              // Handle Text (for logs)
              const textPart = parts.find((p: any) => p.text);
              if (textPart) {
                textBufferRef.current += textPart.text;
              }
            }

            if (msg.serverContent?.turnComplete) {
              if (textBufferRef.current.trim()) {
                setLogs(prev => [...prev, { role: 'assistant', text: textBufferRef.current }]);
                textBufferRef.current = '';
              }
            }

            // TOOL EXECUTION
            if (msg.toolCall) {
              console.log("🛠️ Tool Call Received:", JSON.stringify(msg.toolCall, null, 2));

              msg.toolCall.functionCalls.forEach((fc: any) => {
                const args = fc.args;
                let result: { success: boolean; error?: string } = { success: true };

                console.log(`🔨 Executing: ${fc.name}`, args);

                if (fc.name === 'setDiners') {
                  onSetDiners(args.count);
                } else if (fc.name === 'addToOrder') {
                  // Clean args
                  const searchName = args.itemName.trim().toLowerCase();

                  // 1. Exact Match
                  let item = menu.find(m => m.name.toLowerCase() === searchName);

                  // 2. Fuzzy / Partial Match
                  if (!item) {
                    item = menu.find(m => m.name.toLowerCase().includes(searchName) || searchName.includes(m.name.toLowerCase()));
                  }

                  // 3. Fallback: Check synonyms or simplified names (e.g. "Gildas" -> "Gilda")
                  if (!item) {
                    // Remove trailing 's' or 'es' for plural
                    const singular = searchName.replace(/s$/, '').replace(/es$/, '');
                    item = menuRef.current.find(m => m.name.toLowerCase().includes(singular));
                  }

                  if (item) {
                    console.log("✅ Item Found & Added:", item.name);
                    onAddToCart(item, args.quantity, args.notes);
                  } else {
                    console.error("❌ Item NOT Found in Menu:", searchName);
                    result = { success: false, error: 'Item not found in menu. Please ask user to clarify.' };
                  }
                } else if (fc.name === 'confirmOrder') {
                  console.log("✅ Confirming Order...");
                  onConfirmOrder(dinersCount, clientName).then(success => {
                    if (success) {
                      console.log("🚀 Order Sent to Webhook/Sheet");
                    } else {
                      console.error("❌ Failed to send order");
                    }
                  });
                }

                if (sessionRef.current) {
                  sessionRef.current.then((session: any) => {
                    session.sendToolResponse({
                      functionResponses: [
                        {
                          id: fc.id,
                          response: { result }
                        }
                      ]
                    });
                  });
                }
              });
            }
          },
          onclose: (ev?: { code: number; reason: string }) => {
            console.log("❌ La sesión se ha CERRADO (onclose).", ev?.code, ev?.reason);
            setLastError({ code: ev?.code || 0, reason: ev?.reason || 'Unknown reason', time: new Date().toLocaleTimeString() });
            setStatus('disconnected'); // Assuming setIsConnected(false) maps to setStatus('disconnected')
            // setIsSending(false); // This state is not defined in the current context
            disconnect();
          },
          onerror: (err) => {
            console.error("Live Session Error:", err);
            setLastError({ code: 0, reason: String(err), time: new Date().toLocaleTimeString() });
            setStatus('error'); // Assuming setIsConnected(false) maps to setStatus('error')
            // setIsSending(false); // This state is not defined in the current context
            disconnect();
          }
        }
      });

      sessionRef.current = sessionPromise;

    } catch (error) {
      console.error("Connect Failure:", error);
      setStatus('error');
      disconnect();
    }
  }, [isMuted, disconnect]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return { status, connect, disconnect, isMuted, setIsMuted, volumeLevel, logs, lastError };
};