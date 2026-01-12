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

  // Audio Context Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<Promise<any> | null>(null);

  // --- OPENAI TTS INTEGRATION (v12.0) ---
  const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

  const processSpeechQueue = useCallback(async () => {
    if (isSpeakingRef.current || speechQueueRef.current.length === 0 || !audioContextRef.current) return;

    isSpeakingRef.current = true;
    const textToSpeak = speechQueueRef.current.shift();
    if (!textToSpeak) { isSpeakingRef.current = false; return; }

    try {
      if (!OPENAI_API_KEY) {
        throw new Error("Missing OpenAI API Key");
      }

      console.log("🗣️ Speaking with OpenAI (Onyx):", textToSpeak.substring(0, 20) + "...");
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: textToSpeak,
          voice: 'onyx', // Robust Male Voice
          response_format: 'mp3',
          speed: 1.05 // Slightly faster for responsiveness
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("OpenAI TTS Failed:", errText);
        throw new Error("OpenAI API Response not OK");
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
      console.warn("⚠️ TTS Fail. Falling back to Browser Voice.", error);
      // FALLBACK TO BROWSER TTS
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.lang = 'es-ES';
      utterance.onend = () => {
        isSpeakingRef.current = false;
        processSpeechQueue();
      };
      window.speechSynthesis.speak(utterance);
    }
  }, [OPENAI_API_KEY]);

  const speak = useCallback((text: string) => {
    if (!text) return;
    speechQueueRef.current.push(text);
    processSpeechQueue();
  }, [processSpeechQueue]);

  const disconnect = useCallback(() => {
    if (sessionRef.current) sessionRef.current = null;
    speechQueueRef.current = [];
    isSpeakingRef.current = false;
    window.speechSynthesis.cancel();

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

  // Sync Props
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
          responseModalities: [Modality.TEXT], // TEXT MODALITY (Critical for Logic)
          generationConfig: { temperature: 0.6 }, // Lower temp for strictness
          systemInstruction: SYSTEM_INSTRUCTION + `\n\n[INSTRUCCIONES CLAVE v12]\n1. ERES UN CAMARERO EFICIENTE. Tu trabajo es ANOTAR PEDIDOS.\n2. SIEMPRE usa 'addToOrder' si el usuario pide algo.\n3. NO INVENTES PLATOS: Si el usuario pide algo que no está en la carta, DILE QUE NO LO TIENES y ofrece una alternativa.\n4. MENÚ RIGUROSO: Solo puedes añadir items que existen. Intenta buscar coincidencias (ej: 'bravas' -> 'Patatas Bravas').\n\n[CONTEXTO: MESA ${tableNumber}. CLIENTE: ${clientName || 'Cliente'}]`,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "setDiners",
                  description: "Define el número de personas.",
                  parameters: {
                    type: "OBJECT" as any,
                    properties: { count: { type: "INTEGER" as any } },
                    required: ["count"]
                  }
                },
                {
                  name: "addToOrder",
                  description: "Añade un item existente a la comanda.",
                  parameters: {
                    type: "OBJECT" as any,
                    properties: {
                      itemName: { type: "STRING" as any, description: "Nombre del item." },
                      quantity: { type: "INTEGER" as any },
                      notes: { type: "STRING" as any }
                    },
                    required: ["itemName", "quantity"]
                  }
                },
                {
                  name: "confirmOrder",
                  description: "Envía el pedido a cocina.",
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
                // SPEAK (OpenAI with Fallback)
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
                  console.log(`🔎 Searching: "${searchName}"`);

                  // STRICTER MATCHING (Reverted 'Temp Item' creation)
                  // 1. Exact
                  let item = menuRef.current.find(m => m.name.toLowerCase() === searchName);
                  // 2. Contains
                  if (!item) item = menuRef.current.find(m => m.name.toLowerCase().includes(searchName));
                  if (!item) item = menuRef.current.find(m => searchName.includes(m.name.toLowerCase()));
                  // 3. Normalized Plural (last ditch)
                  if (!item) {
                    const singular = searchName.replace(/s$/, '').replace(/es$/, '');
                    item = menuRef.current.find(m => m.name.toLowerCase().includes(singular));
                  }

                  if (item) {
                    onAddToCartRef.current(item, args.quantity, args.notes);
                    console.log("✅ Added:", item.name);
                  } else {
                    console.warn("❌ Item not found (Strict Mode):", searchName);
                    result = { success: false, error: "Item no encontrado en carta. Pide al usuario que elija algo del menú." };
                  }

                } else if (fc.name === 'confirmOrder') {
                  console.log("✅ Confirm Order Triggered");
                  onConfirmOrderRef.current(dinersCountRef.current, clientNameRef.current)
                    .then(ok => console.log("Order Sent Result:", ok));
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
          onerror: (e) => {
            console.error(e);
            disconnect();
          }
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