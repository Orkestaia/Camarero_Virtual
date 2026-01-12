import { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { createPcmBlob } from '../utils/audio';
import { SYSTEM_INSTRUCTION } from '../constants';

// SIMPLE AUDIO PLAYER (Native/No Libs)
class Player {
  ctx: AudioContext;
  queue: Float32Array[] = [];
  isPlaying = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  add(data: ArrayBuffer) {
    const int16 = new Int16Array(data);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
    this.queue.push(float32);
    this.play();
  }

  play() {
    if (this.isPlaying || this.queue.length === 0) return;
    this.isPlaying = true;
    const chunk = this.queue.shift();
    if (!chunk) { this.isPlaying = false; return; }

    const buf = this.ctx.createBuffer(1, chunk.length, 24000);
    buf.getChannelData(0).set(chunk);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.onended = () => { this.isPlaying = false; this.play(); };
    src.start();
  }
  stop() { this.queue = []; this.isPlaying = false; }
}

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

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const playerRef = useRef<Player | null>(null);
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
    playerRef.current?.stop();

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

      playerRef.current = new Player(ac);

      const ai = new GoogleGenAI({ apiKey: finalApiKey });
      const sessionPromise = ai.live.connect({
        model: 'models/gemini-2.0-flash-exp',
        config: {
          responseModalities: [Modality.AUDIO], // NATIVE AUDIO (Original)
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Fenrir" } } // DEEP MALE
          },
          generationConfig: { temperature: 0.7 },
          systemInstruction: `Eres Patxi, un camarero del País Vasco.
Tu voz es grave, amable y profesional.
HABLA SIEMPRE EN ESPAÑOL DE ESPAÑA.

TU MISIÓN ES TOMAR COMANDAS.
1. Cuando te pidan comida/bebida, USA 'addToOrder'.
2. Si no entiendes el plato, pregunta.
3. Sé rápido. "Marchando una de bravas".
`,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "setDiners",
                  description: "Set diners count",
                  parameters: {
                    type: "OBJECT" as any,
                    properties: { count: { type: "INTEGER" as any } },
                    required: ["count"]
                  }
                },
                {
                  name: "addToOrder",
                  description: "Add item to order",
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
                  description: "Send to kitchen",
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
            // AUDIO
            if (msg.serverContent?.modelTurn) {
              const parts = msg.serverContent.modelTurn.parts || [];
              const audio = parts.find((p: any) => p.inlineData);
              if (audio) {
                const bin = atob(audio.inlineData.data);
                const buf = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
                playerRef.current?.add(buf.buffer);
              }
            }

            // TOOLS
            if (msg.toolCall) {
              console.log("🛠️ Tool Call:", msg.toolCall);
              msg.toolCall.functionCalls.forEach((fc: any) => {
                const args = fc.args;
                let result: any = { success: true };

                if (fc.name === 'addToOrder') {
                  const cleanName = args.itemName.trim().toLowerCase();
                  console.log(`🔎 Searching: ${cleanName}`);

                  // Logic: 1. Exact -> 2. Partial -> 3. Fallback
                  let item = menuRef.current.find(m => m.name.toLowerCase() === cleanName);
                  if (!item) item = menuRef.current.find(m => m.name.toLowerCase().includes(cleanName));
                  if (!item) item = menuRef.current.find(m => cleanName.includes(m.name.toLowerCase()));

                  if (item) {
                    onAddToCartRef.current(item, args.quantity, args.notes);
                    console.log("✅ Added Real Item:", item.name);
                  } else {
                    // FALLBACK IS REQUIRED TO SHOW FEEDBACK
                    item = {
                      id: 'link-' + Date.now(),
                      name: args.itemName + " (?)",
                      price: 0,
                      category: 'otros',
                      description: 'Item manual',
                      image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c'
                    };
                    onAddToCartRef.current(item, args.quantity, args.notes);
                    console.log("⚠️ Added Fallback Item:", item.name);
                  }
                } else if (fc.name === 'setDiners') {
                  onSetDinersRef.current(args.count);
                } else if (fc.name === 'confirmOrder') {
                  onConfirmOrderRef.current(dinersCountRef.current, clientNameRef.current);
                }

                if (sessionRef.current) {
                  sessionRef.current.then((s: any) => s.sendToolResponse({
                    functionResponses: [{ id: fc.id, response: { result } }]
                  }));
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