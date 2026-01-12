import { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { createPcmBlob } from '../utils/audio'; // Removed AudioPlayer import if it was external, we'll inline logic or use utils
import { SYSTEM_INSTRUCTION } from '../constants';

// INLINE AUDIO PLAYER CLASS (To ensure no dependency issues)
class AudioPlayer {
  queue: Float32Array[] = [];
  isPlaying = false;
  ctx: AudioContext;
  rate: number;

  constructor(ctx: AudioContext, rate: number = 24000) {
    this.ctx = ctx;
    this.rate = rate; // Gemini 2.0 Flash returns 24kHz usually
  }

  add16BitPCM(buffer: ArrayBuffer) {
    // Convert Int16 -> Float32
    const int16 = new Int16Array(buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }
    this.queue.push(float32);
    this.playNext();
  }

  playNext() {
    if (this.isPlaying || this.queue.length === 0) return;
    this.isPlaying = true;

    const chunk = this.queue.shift();
    if (!chunk) {
      this.isPlaying = false;
      return;
    }

    const audioBuffer = this.ctx.createBuffer(1, chunk.length, this.rate);
    audioBuffer.getChannelData(0).set(chunk);

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.ctx.destination);
    source.onended = () => {
      this.isPlaying = false;
      this.playNext();
    };
    source.start();
  }

  stop() {
    this.queue = [];
    this.isPlaying = false;
  }
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

  // Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
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
    const finalApiKey = 'AIzaSyAjfPyUl3OBHYAyp4Acc4VlFYtI-Pj-Kgg'; // Legacy Hardcoded for Reliability

    try {
      setStatus('connecting');

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ac = new AudioContextClass({ sampleRate: 16000 }); // Worklet usually 16k
      await ac.resume();
      audioContextRef.current = ac;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      mediaStreamRef.current = stream;

      // INIT AUDIO PLAYER
      const player = new AudioPlayer(ac, 24000); // 24kHz matches Gemini Flash response
      audioPlayerRef.current = player;

      const ai = new GoogleGenAI({ apiKey: finalApiKey });
      const sessionPromise = ai.live.connect({
        model: 'models/gemini-2.0-flash-exp',
        config: {
          responseModalities: [Modality.AUDIO], // NATIVE AUDIO IS BACK
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } // "Kore" = Standard Male
          },
          generationConfig: { temperature: 0.7 },
          // SIMPLIFIED PROMPT FOR NATURAL FLOW
          systemInstruction: `Eres Patxi, el camarero del Bar Jaizkibel.
Tu voz debe ser amable, masculina y profesional.
Tu objetivo principal es TOMAR NOTA de los pedidos y enviarlos a cocina.

REGLAS DE ORO:
1. SIEMPRE que el cliente pida algo, usa la herramienta 'addToOrder'. ES TU PRIORIDAD.
2. Si no entiendes el plato exacto, busca el más parecido o anótalo como puedas.
3. Sé breve. No hables por hablar. Confirma el pedido y listo.
4. Si hablan de número de personas, usa 'setDiners'.
`,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "setDiners",
                  description: "Establece el número de comensales.",
                  parameters: {
                    type: "OBJECT" as any,
                    properties: { count: { type: "INTEGER" as any } },
                    required: ["count"]
                  }
                },
                {
                  name: "addToOrder",
                  description: "Añade un plato a la comanda.",
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
                  description: "Envía el pedido.",
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
            // PLAY AUDIO
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

            // EXECUTE TOOLS
            if (msg.toolCall) {
              console.log("🛠️ Tool Call:", msg.toolCall);
              msg.toolCall.functionCalls.forEach((fc: any) => {
                const args = fc.args;
                let result: any = { success: true };

                if (fc.name === 'setDiners') {
                  onSetDinersRef.current(args.count);
                } else if (fc.name === 'addToOrder') {
                  const searchName = (args.itemName || '').toLowerCase().trim();
                  console.log(`🔎 Buscando: "${searchName}"`);

                  // 1. Exact
                  let item = menuRef.current.find(m => m.name.toLowerCase() === searchName);
                  // 2. Partial
                  if (!item) item = menuRef.current.find(m => m.name.toLowerCase().includes(searchName));
                  if (!item) item = menuRef.current.find(m => searchName.includes(m.name.toLowerCase()));

                  // 3. Fallback (CRITICAL)
                  if (!item) {
                    item = {
                      id: 'temp-' + Date.now(),
                      name: args.itemName + " *", // Marked
                      price: 0,
                      category: 'otros',
                      description: 'No en carta',
                      image: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1'
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
          onerror: (e) => {
            console.error(e);
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
  }, [disconnect]);

  useEffect(() => { return () => disconnect(); }, [disconnect]);

  return { status, connect, disconnect, isMuted, setIsMuted, volumeLevel, logs, lastError };
};