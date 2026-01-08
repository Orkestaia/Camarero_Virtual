import { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { createPcmBlob } from '../utils/audio';
import { ELEVENLABS_CONFIG, SYSTEM_INSTRUCTION } from '../constants';

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
  const sessionRef = useRef<Promise<any> | null>(null);

  const disconnect = useCallback(() => {
    if (sessionRef.current) sessionRef.current = null;
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

  const processSpeechQueue = useCallback(async () => {
    if (isSpeakingRef.current || speechQueueRef.current.length === 0 || !audioContextRef.current) return;

    isSpeakingRef.current = true;
    const textToSpeak = speechQueueRef.current.shift();

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_CONFIG.VOICE_ID}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_CONFIG.API_KEY
        },
        body: JSON.stringify({
          text: textToSpeak,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      });

      if (!response.ok) throw new Error("ElevenLabs API Error");

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);

      source.onended = () => {
        isSpeakingRef.current = false;
        processSpeechQueue(); // Process next in queue
      };

      source.start(0);

    } catch (error) {
      console.error("Speech Error:", error);
      isSpeakingRef.current = false;
      processSpeechQueue();
    }
  }, []);

  const speak = useCallback((text: string) => {
    if (!text) return;
    speechQueueRef.current.push(text);
    processSpeechQueue();
  }, [processSpeechQueue]);

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_CONFIG.VOICE_ID}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_CONFIG.API_KEY
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });

    if (!response.ok) throw new Error("ElevenLabs API Error");

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    source.start(0);

  } catch (error) {
    console.error("Speech Error:", error);
  }
}, []);

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

    const ai = new GoogleGenAI({ apiKey: finalApiKey });
    const sessionPromise = ai.live.connect({
      model: 'models/gemini-2.0-flash-exp',
      config: {
        responseModalities: [Modality.TEXT],
        systemInstruction: SYSTEM_INSTRUCTION + `\n\n[CONTEXTO ACTUAL: MESA ${tableNumber}. CLIENTE: ${clientName || 'Cliente'}].`,
        tools: [
          {
            functionDeclarations: [
              {
                name: "setDiners",
                description: "Establece el número de comensales de la mesa.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    count: { type: "INTEGER", description: "Número de personas." }
                  },
                  required: ["count"]
                }
              },
              {
                name: "addToOrder",
                description: "Añade un plato o bebida al pedido.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    itemName: { type: "STRING", description: "Nombre exacto del plato o bebida." },
                    quantity: { type: "INTEGER", description: "Cantidad." },
                    notes: { type: "STRING", description: "Notas (ej: 'sin cebolla')." }
                  },
                  required: ["itemName", "quantity"]
                }
              },
              {
                name: "confirmOrder",
                description: "Confirma y envía el pedido a cocina.",
                parameters: {
                  type: "OBJECT",
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
            const text = msg.serverContent.modelTurn.parts?.find((p: any) => p.text)?.text;
            if (text) {
              textBufferRef.current += text;
              // Only log final turn or if turn is explicitly complete
            }
          }

          if (msg.serverContent?.turnComplete) {
            if (textBufferRef.current.trim()) {
              setLogs(prev => [...prev, { role: 'assistant', text: textBufferRef.current }]);
              speak(textBufferRef.current);
              textBufferRef.current = '';
            }
          }

          // TOOL EXECUTION
          if (msg.toolCall) {
            msg.toolCall.functionCalls.forEach((fc: any) => {
              const args = fc.args;
              let result: { success: boolean; error?: string } = { success: true };

              if (fc.name === 'setDiners') {
                onSetDiners(args.count);
              } else if (fc.name === 'addToOrder') {
                const item = menu.find(m => m.name.toLowerCase() === args.itemName.toLowerCase());
                if (item) {
                  onAddToCart(item, args.quantity, args.notes);
                } else {
                  // Try fuzzy match or fallback
                  const fallback = menu.find(m => m.name.toLowerCase().includes(args.itemName.toLowerCase()));
                  if (fallback) {
                    onAddToCart(fallback, args.quantity, args.notes);
                  } else {
                    result = { success: false, error: 'Item not found' };
                  }
                }
              } else if (fc.name === 'confirmOrder') {
                onConfirmOrder(dinersCount, clientName).then(success => {
                  // Can handle post-confirmation logic here
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