import { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
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

  const textBufferRef = useRef<string>('');
  const speechQueueRef = useRef<string[]>([]);
  const isSpeakingRef = useRef<boolean>(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<Promise<any> | null>(null);

  // --- OPENAI TTS LOGIC ---
  const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || ''; // Securely load from Env

  const processSpeechQueue = useCallback(async () => {
    if (isSpeakingRef.current || speechQueueRef.current.length === 0 || !audioContextRef.current) return;

    isSpeakingRef.current = true;
    const textToSpeak = speechQueueRef.current.shift();

    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: textToSpeak,
          voice: 'onyx', // Deep male voice
          response_format: 'mp3',
          speed: 1.0
        })
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("OpenAI TTS Error:", err);
        throw new Error("OpenAI TTS Failed");
      }

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
    speechQueueRef.current = [];
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
          responseModalities: [Modality.TEXT], // TEXT ONLY FOR RELIABILITY
          generationConfig: { temperature: 0.7 },
          systemInstruction: SYSTEM_INSTRUCTION + `\n\n[INSTRUCCIONES CRÍTICAS]\n1. VOZ: Eres Patxi, camarero del Jaizkibel.\n2. COMANDAS: Tu prioridad ABSOLUTA es anotar pedidos. Si el usuario pide algo, USA 'addToOrder'.\n3. INTELIGENCIA: Si el usuario pide "bravas" y no está exacto, usa 'addToOrder' con "Patatas Bravas" (o lo más parecido). NO preguntes "qué bravas", ANOTA lo que creas mejor.`,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "setDiners",
                  description: "Número de personas.",
                  parameters: {
                    type: "OBJECT" as any,
                    properties: { count: { type: "INTEGER" as any } },
                    required: ["count"]
                  }
                },
                {
                  name: "addToOrder",
                  description: "Añadir item.",
                  parameters: {
                    type: "OBJECT" as any,
                    properties: {
                      itemName: { type: "STRING" as any },
                      quantity: { type: "INTEGER" as any },
                      notes: { type: "STRING" as any }
                    },
                    required: ["itemName", "quantity"]
                  }
                },
                {
                  name: "confirmOrder",
                  description: "Enviar a cocina.",
                  parameters: { type: "OBJECT" as any, properties: {} }
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
              if (sessionRef.current) {
                sessionRef.current.then((s: any) => s.sendRealtimeInput({ media: createPcmBlob(inputData) }));
              }
            };
            source.connect(processor);
            processor.connect(ac.destination);
          },
          onmessage: (msg: any) => {
            // HANDLE TEXT RESPONSE
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
                // SPEAK WITH OPENAI
                speak(finalText);
                textBufferRef.current = '';
              }
            }

            // TOOL EXECUTION
            if (msg.toolCall) {
              console.log("🛠️ Tool Call:", msg.toolCall);
              msg.toolCall.functionCalls.forEach((fc: any) => {
                const args = fc.args;
                let result: any = { success: true };

                if (fc.name === 'setDiners') {
                  onSetDinersRef.current(args.count);
                } else if (fc.name === 'addToOrder') {
                  const searchName = (args.itemName || '').toLowerCase().trim();
                  console.log(`🔎 Searching for: "${searchName}"`);

                  // AGGRESSIVE MATCHING
                  let item = menuRef.current.find(m => m.name.toLowerCase() === searchName);
                  if (!item) item = menuRef.current.find(m => m.name.toLowerCase().includes(searchName));
                  if (!item) item = menuRef.current.find(m => searchName.includes(m.name.toLowerCase()));

                  // FALLBACK FOR FEEDBACK
                  if (!item) {
                    item = {
                      id: 'temp-' + Date.now(),
                      name: args.itemName + " (Manual)",
                      price: 0,
                      category: 'otros',
                      description: 'Item fuera de carta',
                      image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c'
                    };
                  }

                  if (item) {
                    onAddToCartRef.current(item, args.quantity, args.notes);
                  }
                } else if (fc.name === 'confirmOrder') {
                  onConfirmOrderRef.current(dinersCountRef.current, clientNameRef.current);
                }

                if (sessionRef.current) {
                  sessionRef.current.then((s: any) => {
                    s.sendToolResponse({
                      functionResponses: [{ id: fc.id, response: { result } }]
                    });
                  });
                }
              });
            }
          },
          onclose: () => disconnect(),
          onerror: () => disconnect()
        }
      });
      sessionRef.current = sessionPromise;
    } catch (e) {
      console.error(e);
      setStatus('error');
      disconnect();
    }
  }, [disconnect, speak]);

  useEffect(() => { return () => disconnect(); }, [disconnect]);

  return { status, connect, disconnect, isMuted, setIsMuted, volumeLevel, logs, lastError };
};