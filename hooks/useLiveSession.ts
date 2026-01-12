import { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { createPcmBlob } from '../utils/audio';

// --- USER PROVIDED PROMPT (ADAPTED) ---
const RETELL_PROMPT = `
SISTEMA: Eres Patxi, el camarero virtual del Bar Jaisquibel.
Voz masculina, acento español con ligero toque vasco.
Profesional, cercano, eficiente y con conocimiento experto del producto.

SALUDOS:
"Egun on! Bienvenidos al Jaisquibel. Soy Patxi, cuantos sois?"

REGLAS DE HERRAMIENTAS:
1. setDiners: Preguntar siempre al inicio. "Somos 3" -> setDiners(3).
2. addToOrder:
   - SOLO cuando el cliente pida AÑADIR algo explícitamente.
   - "Ponme unas ostras" -> addToOrder("Ostra S dos by Sorlut", 1).
   - "Dos de gambas" -> addToOrder("Gamba blanca a la plancha", 2).
   - NO usar cuando recapitulas el pedido.
3. removeFromOrder:
   - Cuando dicen "quita", "borra", "sin", "ya no quiero".
   - "Quita los calamares" -> removeFromOrder("Calamares a la romana").
4. confirmOrder:
   - SOLO cuando confirman el pedido final ("marcha", "eso es todo").
   - ANTES de confirmar, haz un RESUMEN VERBAL. "Entonces tenemos X e Y. Correcto?".

LO QUE PATXI NO DEBE HACER:
- NO inventar platos. Si piden algo fuera de carta, di que no lo tienes.
- NO repetir información innecesaria.
- SOLO confirma verbalmente "Anotado" TRAS llamar a la herramienta.

CARTA (REFERENCIA):
- Ostra S dos by Sorlut, Gamba blanca, Mejillones Diablo, Calamares a la romana, Pulpo
- Anchoas, Paletilla Iberica, Ensalada aguacate, Tabla Quesos
- Hamburguesa Jaisquibel, Mini croquetas, Patatas salsas, Sandwich Mixto
- Torrija con helado
`;

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
  const [logs, setLogs] = useState<{ role: string, text: string }[]>([]);
  const [lastError, setLastError] = useState<{ code: number; reason: string; time: string } | null>(null);

  const textBufferRef = useRef<string>('');
  const speechQueueRef = useRef<string[]>([]);
  const isSpeakingRef = useRef<boolean>(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<Promise<any> | null>(null);

  // --- OPENAI TTS ---
  const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

  const processSpeechQueue = useCallback(async () => {
    if (isSpeakingRef.current || speechQueueRef.current.length === 0 || !audioContextRef.current) return;

    isSpeakingRef.current = true;
    const textToSpeak = speechQueueRef.current.shift();
    if (!textToSpeak) { isSpeakingRef.current = false; return; }

    try {
      if (!OPENAI_API_KEY) throw new Error("No OpenAI Key");

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'tts-1',
          input: textToSpeak,
          voice: 'onyx',
          response_format: 'mp3',
          speed: 1.05
        })
      });

      if (!response.ok) throw new Error("OpenAI API Error");

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
      console.warn("⚠️ TTS Fallback to Browser", error);
      // Fallback
      const u = new SpeechSynthesisUtterance(textToSpeak);
      u.lang = 'es-ES';
      const voices = performance.now() > 0 ? window.speechSynthesis.getVoices() : []; // Tickle voices
      const es = voices.find(v => v.lang.includes('es-ES'));
      if (es) u.voice = es;
      u.onend = () => { isSpeakingRef.current = false; processSpeechQueue(); };
      window.speechSynthesis.speak(u);
    }
  }, [OPENAI_API_KEY]);

  const speak = useCallback((text: string) => {
    speechQueueRef.current.push(text);
    processSpeechQueue();
  }, [processSpeechQueue]);

  const disconnect = useCallback(() => {
    if (sessionRef.current) sessionRef.current = null;
    speechQueueRef.current = [];
    isSpeakingRef.current = false;
    window.speechSynthesis.cancel();
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    mediaStreamRef.current = null;
    if (inputProcessorRef.current) { inputProcessorRef.current.disconnect(); inputProcessorRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    setStatus('disconnected');
  }, []);

  // Sync Props
  const menuRef = useRef(menu);
  const onAddToCartRef = useRef(onAddToCart);
  const onRemoveFromOrderRef = useRef(onRemoveFromOrder);
  const onSetDinersRef = useRef(onSetDiners);
  const onConfirmOrderRef = useRef(onConfirmOrder);
  const dinersCountRef = useRef(dinersCount);
  const clientNameRef = useRef(clientName);

  useEffect(() => {
    menuRef.current = menu;
    onAddToCartRef.current = onAddToCart;
    onRemoveFromOrderRef.current = onRemoveFromOrder;
    onSetDinersRef.current = onSetDiners;
    onConfirmOrderRef.current = onConfirmOrder;
    dinersCountRef.current = dinersCount;
    clientNameRef.current = clientName;
  }, [menu, onAddToCart, onRemoveFromOrder, onSetDiners, onConfirmOrder, dinersCount, clientName]);

  const connect = useCallback(async () => {
    const finalApiKey = 'AIzaSyAjfPyUl3OBHYAyp4Acc4VlFYtI-Pj-Kgg';

    try {
      setStatus('connecting');
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ac = new AudioContextClass({ sampleRate: 16000 });
      await ac.resume();
      audioContextRef.current = ac;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
      mediaStreamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey: finalApiKey });
      const sessionPromise = ai.live.connect({
        model: 'models/gemini-2.0-flash-exp',
        config: {
          responseModalities: [Modality.TEXT], // BRAIN IS TEXT (SMART)
          generationConfig: { temperature: 0.6 },
          systemInstruction: RETELL_PROMPT,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "setDiners",
                  description: "Define comensales.",
                  parameters: { type: "OBJECT" as any, properties: { count: { type: "INTEGER" as any } }, required: ["count"] }
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
                  name: "removeFromOrder",
                  description: "Quitar item.",
                  parameters: {
                    type: "OBJECT" as any,
                    properties: { itemName: { type: "STRING" as any } },
                    required: ["itemName"]
                  }
                },
                {
                  name: "confirmOrder",
                  description: "Confirmar.",
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
              const data = e.inputBuffer.getChannelData(0);
              const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
              setVolumeLevel(rms * 10);
              if (sessionRef.current) sessionRef.current.then((s: any) => s.sendRealtimeInput({ media: createPcmBlob(data) }));
            };
            source.connect(processor);
            processor.connect(ac.destination);
          },
          onmessage: (msg: any) => {
            if (msg.serverContent?.modelTurn) {
              const parts = msg.serverContent.modelTurn.parts || [];
              const txt = parts.find((p: any) => p.text)?.text;
              if (txt) textBufferRef.current += txt;
            }
            if (msg.serverContent?.turnComplete && textBufferRef.current.trim()) {
              const ft = textBufferRef.current;
              setLogs(p => [...p, { role: 'assistant', text: ft }]);
              speak(ft);
              textBufferRef.current = '';
            }

            if (msg.toolCall) {
              console.log("🛠️ Tool:", msg.toolCall);
              msg.toolCall.functionCalls.forEach((fc: any) => {
                const args = fc.args;
                let result = { success: true, message: "OK" };

                if (fc.name === 'addToOrder') {
                  const search = (args.itemName || '').toLowerCase().trim();
                  // Strict Menu Check
                  let item = menuRef.current.find(m => m.name.toLowerCase() === search);
                  if (!item) item = menuRef.current.find(m => m.name.toLowerCase().includes(search));
                  if (!item) item = menuRef.current.find(m => search.includes(m.name.toLowerCase()));

                  if (item) {
                    onAddToCartRef.current(item, args.quantity, args.notes);
                  } else {
                    result = { success: false, message: "Item not found. Ask user to choose from menu." };
                    console.warn("Item not found:", search);
                  }
                } else if (fc.name === 'removeFromOrder') {
                  onRemoveFromOrderRef.current(args.itemName);
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
  }, [disconnect, speak]);

  useEffect(() => { return () => disconnect(); }, [disconnect]);

  return { status, connect, disconnect, isMuted, setIsMuted, volumeLevel, logs, lastError };
};