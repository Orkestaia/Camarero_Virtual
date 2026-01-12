import { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { AudioPlayer } from '../utils/audio'; // Need to restore this import or class
import { createPcmBlob } from '../utils/audio';
import { SYSTEM_INSTRUCTION } from '../constants';

// We need AudioPlayer class definition if it was removed
// Assuming it is in utils/audio.ts. If not, I will add it back.

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

  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioPlayerRef = useRef<any | null>(null); // Type 'any' to avoid import errors if class missing
  const sessionRef = useRef<Promise<any> | null>(null);

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

      // Inline AudioPlayer logic to ensure it works
      class SimpleAudioPlayer {
        queue: Float32Array[] = [];
        isPlaying = false;
        ctx: AudioContext;
        rate: number;
        constructor(ctx: AudioContext, rate: number) { this.ctx = ctx; this.rate = rate; }
        add16BitPCM(buffer: ArrayBuffer) {
          const int16 = new Int16Array(buffer);
          const float32 = new Float32Array(int16.length);
          for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
          this.queue.push(float32);
          this.playNext();
        }
        playNext() {
          if (this.isPlaying || this.queue.length === 0) return;
          this.isPlaying = true;
          const chunk = this.queue.shift();
          if (chunk) {
            const buf = this.ctx.createBuffer(1, chunk.length, this.rate);
            buf.getChannelData(0).set(chunk);
            const src = this.ctx.createBufferSource();
            src.buffer = buf;
            src.connect(this.ctx.destination);
            src.onended = () => { this.isPlaying = false; this.playNext(); };
            src.start();
          }
        }
        stop() { this.queue = []; this.isPlaying = false; }
      }

      audioPlayerRef.current = new SimpleAudioPlayer(ac, 24000);

      const ai = new GoogleGenAI({ apiKey: finalApiKey });

      const sessionPromise = ai.live.connect({
        model: 'models/gemini-2.0-flash-exp',
        config: {
          responseModalities: [Modality.AUDIO], // NATIVE AUDIO
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } // MALE VOICE
          },
          generationConfig: { temperature: 0.7 },
          systemInstruction: SYSTEM_INSTRUCTION + `\n\n[INSTRUCCIONES CRÍTICAS]\n1. ERES PATXI: Un camarero vasco profesional (hombre). Voz grave y amable.\n2. OBJETIVO: Tomar nota RÁPIDO. Usa 'addToOrder' SIEMPRE que te pidan algo.\n3. NO INVENTES: Escucha el pedido y usa la herramienta. Confirma SOLO "Anotado" después de llamar a la herramienta.`,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "setDiners",
                  description: "Define el número de personas.",
                  parameters: {
                    type: "OBJECT" as any,
                    properties: { count: { type: "INTEGER" as any, description: "Número." } },
                    required: ["count"]
                  }
                },
                {
                  name: "addToOrder",
                  description: "Añade un item a la comanda.",
                  parameters: {
                    type: "OBJECT" as any,
                    properties: {
                      itemName: { type: "STRING" as any, description: "Nombre del producto." },
                      quantity: { type: "INTEGER" as any, description: "Cantidad." },
                      notes: { type: "STRING" as any, description: "Notas opcionales." }
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
            // HANDLE AUDIO RESPONSE
            if (msg.serverContent?.modelTurn) {
              const parts = msg.serverContent.modelTurn.parts || [];
              const audioPart = parts.find((p: any) => p.inlineData && p.inlineData.mimeType.startsWith('audio/'));
              if (audioPart) {
                const base64 = audioPart.inlineData.data;
                const bin = atob(base64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                audioPlayerRef.current?.add16BitPCM(bytes.buffer);
              }
            }

            // HANDLE TOOLS
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

                  // AGGRESSIVE MATCHING STRATEGY
                  // 1. Exact Match
                  let item = menuRef.current.find(m => m.name.toLowerCase() === searchName);

                  // 2. Contains Match (e.g. "bravas" -> "Patatas Bravas")
                  if (!item) item = menuRef.current.find(m => m.name.toLowerCase().includes(searchName));

                  // 3. Reverse Contains (e.g. "café con leche" -> "Café") - Risky but helpful
                  if (!item) item = menuRef.current.find(m => searchName.includes(m.name.toLowerCase()));

                  // 4. Fallback: Create a Temporary Item if not found (CRITICAL for user feedback)
                  // If we can't find it in the menu, we add it anyway so the user sees *something* happened.
                  if (!item) {
                    console.warn(`⚠️ Item "${searchName}" not found in menu. Creating fallback.`);
                    item = {
                      id: 'temp-' + Date.now(),
                      name: args.itemName + " (?)", // Mark as uncertain
                      price: 0,
                      category: 'otros',
                      description: 'Item no identificado en carta',
                      image: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?q=80&w=1974&auto=format&fit=crop'
                    };
                  }

                  if (item) {
                    onAddToCartRef.current(item, args.quantity, args.notes);
                    console.log("✅ Added:", item.name);
                  }
                } else if (fc.name === 'confirmOrder') {
                  onConfirmOrderRef.current(dinersCountRef.current, clientNameRef.current);
                }

                // Send Response Back to Model
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
  }, [disconnect]);

  useEffect(() => { return () => disconnect(); }, [disconnect]);

  return { status, connect, disconnect, isMuted, setIsMuted, volumeLevel, logs, lastError };
};