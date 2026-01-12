import { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { createPcmBlob } from '../utils/audio';
import { SYSTEM_INSTRUCTION, ELEVENLABS_CONFIG } from '../constants';

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
  const textBufferRef = useRef<string>('');
  const speechQueueRef = useRef<string[]>([]);
  const isSpeakingRef = useRef<boolean>(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<Promise<any> | null>(null);

  // ELEVENLABS TTS LOGIC
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
        processSpeechQueue();
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

  const disconnect = useCallback(() => {
    if (sessionRef.current) sessionRef.current = null;
    speechQueueRef.current = []; // Clear queue
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

  // REFS FOR PROPS
  const menuRef = useRef(menu);
  const onAddToCartRef = useRef(onAddToCart);
  const onSetDinersRef = useRef(onSetDiners);
  const onConfirmOrderRef = useRef(onConfirmOrder);
  const dinersCountRef = useRef(dinersCount);
  const clientNameRef = useRef(clientName);

  useEffect(() => {
    menuRef.current = menu;
    onAddToCartRef.current = onAddToCart;
    onSetDinersRef.current = onSetDiners;
    onConfirmOrderRef.current = onConfirmOrder;
    dinersCountRef.current = dinersCount;
    clientNameRef.current = clientName;
  }, [menu, onAddToCart, onSetDiners, onConfirmOrder, dinersCount, clientName]);

  const connect = useCallback(async () => {
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
          generationConfig: { temperature: 0.7 },
          systemInstruction: SYSTEM_INSTRUCTION + `\n\n[INSTRUCCIONES CRÍTICAS]\n1. VOZ: Eres Patxi. Habla breve y conciso.\n2. COMANDAS: Si el usuario pide platos, USA 'addToOrder' aunque no estés seguro del nombre exacto. Intenta acertar.\n3. ERRORES: Si no encuentras un plato, pregunta.\n\n[CONTEXTO: MESA ${tableNumber}. CLIENTE: ${clientName || 'Cliente'}.]`,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "setDiners",
                  description: "Establece el número de comensales.",
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
                  description: "Añade plato o bebida.",
                  parameters: {
                    type: "OBJECT" as any,
                    properties: {
                      itemName: { type: "STRING" as any, description: "Nombre del plato." },
                      quantity: { type: "INTEGER" as any, description: "Cantidad." },
                      notes: { type: "STRING" as any, description: "Notas." }
                    },
                    required: ["itemName", "quantity"]
                  }
                },
                {
                  name: "confirmOrder",
                  description: "Envía pedido a cocina.",
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
              setVolumeLevel(rms * 10);

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
              const textPart = parts.find((p: any) => p.text);
              if (textPart) {
                textBufferRef.current += textPart.text;
              }
            }

            if (msg.serverContent?.turnComplete) {
              if (textBufferRef.current.trim()) {
                const finalText = textBufferRef.current;
                setLogs(prev => [...prev, { role: 'assistant', text: finalText }]);
                // SPEAK WITH ELEVENLABS
                speak(finalText);
                textBufferRef.current = '';
              }
            }

            if (msg.toolCall) {
              console.log("🛠️ Tool Call:", msg.toolCall);
              msg.toolCall.functionCalls.forEach((fc: any) => {
                const args = fc.args;
                let result: any = { success: true };

                if (fc.name === 'setDiners') {
                  onSetDinersRef.current(args.count);
                } else if (fc.name === 'addToOrder') {
                  const searchName = args.itemName.toLowerCase().trim();
                  // Improved matching logic
                  let item = menuRef.current.find(m => m.name.toLowerCase() === searchName);
                  if (!item) item = menuRef.current.find(m => m.name.toLowerCase().includes(searchName));
                  if (!item) {
                    const singular = searchName.replace(/s$/, '').replace(/es$/, '');
                    item = menuRef.current.find(m => m.name.toLowerCase().includes(singular));
                  }

                  if (item) {
                    onAddToCartRef.current(item, args.quantity, args.notes);
                  } else {
                    result = { success: false, error: "Item not found" };
                  }
                } else if (fc.name === 'confirmOrder') {
                  onConfirmOrderRef.current(dinersCountRef.current, clientNameRef.current);
                }

                if (sessionRef.current) {
                  sessionRef.current.then((session: any) => {
                    session.sendToolResponse({
                      functionResponses: [{ id: fc.id, response: { result } }]
                    });
                  });
                }
              });
            }
          },
          onclose: () => {
            // Silence on close
          },
          onerror: (err) => {
            setStatus('error');
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
  }, [isMuted, disconnect, speak]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return { status, connect, disconnect, isMuted, setIsMuted, volumeLevel, logs, lastError };
};