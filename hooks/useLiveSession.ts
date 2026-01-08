import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from "@google/genai";
import { createPcmBlob, decodeAudioData, base64ToUint8Array } from '../utils/audio';
import { SYSTEM_INSTRUCTION, ELEVENLABS_CONFIG } from '../constants';
import { MenuItem, OrderItem } from '../types';

interface UseLiveSessionProps {
  apiKey: string;
  tableNumber: string;
  menu: MenuItem[];
  onAddToCart: (item: MenuItem, quantity: number, notes?: string) => void;
  onRemoveFromOrder: (itemName: string) => void;
  onConfirmOrder: (diners: number, name?: string, items?: OrderItem[]) => Promise<boolean>;
  onSetDiners: (count: number, name?: string) => void;
  cartItems: OrderItem[];
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

  // Refs for audio handling
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Refs for state (CRITICAL for closures in callbacks)
  const cartItemsRef = useRef(cartItems);
  const dinersCountRef = useRef(dinersCount);
  const clientNameRef = useRef(clientName);
  const tableNumberRef = useRef(tableNumber);
  const menuRef = useRef(menu);

  // Sync refs with props
  useEffect(() => {
    cartItemsRef.current = cartItems;
    dinersCountRef.current = dinersCount;
    clientNameRef.current = clientName;
    tableNumberRef.current = tableNumber;
    menuRef.current = menu;
  }, [cartItems, dinersCount, clientName, tableNumber, menu]);

  // ===== ENHANCED SYSTEM INSTRUCTION WITH MENU INFO =====
  const enhancedSystemInstruction = useMemo(() => {
    const availableMenu = menu.filter(item => item.available);

    const byCategory = new Map<string, MenuItem[]>();
    availableMenu.forEach(item => {
      if (!byCategory.has(item.category)) {
        byCategory.set(item.category, []);
      }
      byCategory.get(item.category)!.push(item);
    });

    let menuDescription = "MENÚ DISPONIBLE ACTUAL:\n";
    byCategory.forEach((items, category) => {
      menuDescription += `\n${category.toUpperCase()}:\n`;
      items.forEach(item => {
        menuDescription += `- ${item.name} (${item.price}€): ${item.description}`;
        if (item.allergens.length > 0) {
          menuDescription += ` [Alérgenos: ${item.allergens.join(', ')}]`;
        }
        if (item.dietary.length > 0) {
          menuDescription += ` [${item.dietary.join(', ').toUpperCase()}]`;
        }
        menuDescription += "\n";
      });
    });

    return `${SYSTEM_INSTRUCTION.replace('{TIME}', new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))}

Número de mesa actual: ${tableNumber}

${menuDescription}

INSTRUCCIONES CRÍTICAS SOBRE DISPONIBILIDAD:
- SOLO PUEDES RECOMENDAR platos que aparecen en la lista anterior
- SOLO PUEDES ACEPTAR pedidos de platos de la lista anterior
- Si el cliente pide un plato que NO está en la lista, SIEMPRE:
  1. Comunica que NO está disponible
  2. Sugiere alternativas similares del menú disponible
  3. NUNCA intentes añadir platos no disponibles
- Usa los nombres EXACTOS de los platos como aparecen arriba

INSTRUCCIONES DE INICIO Y CIERRE:
- Cuando el pedido esté confirmado y hayas dicho la frase de despedida "Que aproveche" (o similar), DEBES ejecutar inmediatamente la herramienta 'endSession'.
`;
  }, [menu, tableNumber]);

  // --- Tool Definitions ---
  const getMenuTool: FunctionDeclaration = {
    name: 'getMenu',
    description: 'Get the full restaurant menu.',
  };

  const setDinersTool: FunctionDeclaration = {
    name: 'setDiners',
    description: 'Set the number of people eating.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        count: { type: Type.NUMBER, description: "Number of people" },
        name: { type: Type.STRING, description: "Name of the person" }
      },
      required: ['count']
    }
  }

  const addToOrderTool: FunctionDeclaration = {
    name: 'addToOrder',
    description: 'Add an item to the order. Do NOT use this if you are just summarizing what is already in the cart.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        itemName: { type: Type.STRING, description: "Exact name of the menu item" },
        quantity: { type: Type.NUMBER, description: "Number of items" },
        notes: { type: Type.STRING, description: "Special instructions" }
      },
      required: ['itemName', 'quantity']
    }
  };

  const removeFromOrderTool: FunctionDeclaration = {
    name: 'removeFromOrder',
    description: 'Remove an item from the current order.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        itemName: { type: Type.STRING, description: "Name of the item to remove" }
      },
      required: ['itemName']
    }
  };

  const confirmOrderTool: FunctionDeclaration = {
    name: 'confirmOrder',
    description: 'Confirm the order and send it to the kitchen.',
  };

  const endSessionTool: FunctionDeclaration = {
    name: 'endSession',
    description: 'Ends the voice session. Call this immediately after saying the closing phrase like "Que aproveche".',
  };

  const tools = [{ functionDeclarations: [getMenuTool, setDinersTool, addToOrderTool, removeFromOrderTool, confirmOrderTool, endSessionTool] }];

  const disconnect = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current = null;
    }

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

    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();

    setStatus('disconnected');
  }, []);

  const connect = useCallback(async () => {
    if (!apiKey) {
      alert("API Key is missing!");
      return;
    }

    try {
      setStatus('connecting');

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ac = new AudioContextClass({ sampleRate: 24000 });
      audioContextRef.current = ac;
      const inputAc = new AudioContextClass({ sampleRate: 16000 });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey });

      const speak = async (text: string) => {
        try {
          // Interrupt current audio if user starts speaking (handled via serverContent.interrupted usually)
          // But here we can also track the current elevenlabs audio and stop it.
          const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_CONFIG.VOICE_ID}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': ELEVENLABS_CONFIG.API_KEY
            },
            body: JSON.stringify({
              text,
              model_id: 'eleven_multilingual_v2',
              voice_settings: { stability: 0.5, similarity_boost: 0.75 }
            })
          });

          if (!response.ok) return;

          const blob = await response.blob();
          const buffer = await blob.arrayBuffer();
          if (!audioContextRef.current) return;
          const audioBuffer = await audioContextRef.current.decodeAudioData(buffer);

          const source = audioContextRef.current.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContextRef.current.destination);

          // Clear previous sources if needed, but Gemini usually handles interruption
          sourcesRef.current.add(source);
          source.start(0);
          source.onended = () => sourcesRef.current.delete(source);
        } catch (e) {
          console.error("ElevenLabs speak error:", e);
        }
      };

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.0-flash-exp', // Using a more stable model name if possible, or keeping the same
        config: {
          responseModalities: [Modality.TEXT],
          systemInstruction: enhancedSystemInstruction,
          tools: tools
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Session Opened");
            setStatus('connected');

            // --- AUTO-GREET IMPLEMENTATION ---
            setTimeout(() => {
              if (sessionRef.current) {
                sessionRef.current.then((session: any) => {
                  session.send({
                    clientContent: {
                      turns: [{
                        role: 'user',
                        parts: [{ text: "Hola" }]
                      }],
                      turnComplete: true
                    }
                  });
                });
              }
            }, 1500);

            const source = inputAc.createMediaStreamSource(stream);
            const processor = inputAc.createScriptProcessor(4096, 1, 1);
            inputProcessorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setVolumeLevel(rms);

              const pcmBlob = createPcmBlob(inputData);
              if (sessionRef.current) {
                sessionRef.current.then((session: any) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              }
            };

            source.connect(processor);
            processor.connect(inputAc.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.modelTurn) {
              const text = msg.serverContent.modelTurn.parts?.[0]?.text;
              if (text) {
                setLogs(prev => [...prev, { role: 'assistant', text }]);
                speak(text);
              }
            }

            if (msg.toolCall) {
              const responses = [];

              for (const fc of msg.toolCall.functionCalls) {
                let result: any = { status: 'ok' };

                if (fc.name === 'getMenu') {
                  result = {
                    message: "Menu available in context",
                    count: menuRef.current.length
                  };
                } else if (fc.name === 'setDiners') {
                  const args = fc.args as any;
                  onSetDiners(args.count, args.name);
                  result = { message: `Updated: ${args.count} diners` };
                  setLogs(prev => [...prev, { role: 'system', text: `👥 ${args.count} comensales` }]);
                } else if (fc.name === 'addToOrder') {
                  const args = fc.args as any;

                  const normalize = (str: string) => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                  const targetName = normalize(args.itemName);

                  // 1. Precise Match (Normalized)
                  let item = menuRef.current.find(m =>
                    m.available &&
                    normalize(m.name) === targetName
                  );

                  // 2. Fuzzy Match (Includes)
                  if (!item) {
                    item = menuRef.current.find(m =>
                      m.available &&
                      normalize(m.name).includes(targetName)
                    );
                  }

                  // 3. Reverse Fuzzy (Target includes Item name)
                  if (!item) {
                    item = menuRef.current.find(m =>
                      m.available &&
                      targetName.includes(normalize(m.name))
                    );
                  }

                  // 4. Word-based Matching (Heuristic for Plurals/Parts)
                  if (!item) {
                    const targetWords = targetName.split(' ').filter(w => w.length > 2);
                    item = menuRef.current.find(m => {
                      if (!m.available) return false;
                      const nameWords = normalize(m.name).split(' ');
                      return targetWords.some(w => nameWords.includes(w) || nameWords.some(nw => nw.startsWith(w) || w.startsWith(nw)));
                    });
                  }

                  if (item) {
                    onAddToCart(item, args.quantity, args.notes);
                    result = {
                      success: true,
                      message: `Added ${args.quantity}x ${item.name}`
                    };
                    setLogs(prev => [...prev, { role: 'system', text: `✓ Añadido: ${args.quantity}x ${item.name}` }]);
                  } else {
                    result = {
                      success: false,
                      error: "Item not found in menu",
                    };
                    setLogs(prev => [...prev, { role: 'error', text: `✗ No encontré: "${args.itemName}"` }]);
                  }
                } else if (fc.name === 'removeFromOrder') {
                  const args = fc.args as any;
                  onRemoveFromOrder(args.itemName);
                  result = { success: true, message: `Removed: ${args.itemName}` };
                  setLogs(prev => [...prev, { role: 'system', text: `🗑️ Eliminado: ${args.itemName}` }]);

                } else if (fc.name === 'confirmOrder') {
                  const currentCart = cartItemsRef.current;
                  const currentDiners = dinersCountRef.current;
                  const currentName = clientNameRef.current;

                  if (!currentCart || currentCart.length === 0) {
                    result = { success: false, error: "Cart is empty" };
                    setLogs(prev => [...prev, { role: 'error', text: `✗ Carrito vacío` }]);
                  } else {
                    const success = await onConfirmOrder(currentDiners, currentName, currentCart);

                    if (success) {
                      result = { success: true, message: "Order sent to kitchen" };
                      setLogs(prev => [...prev, { role: 'system', text: `✓ Pedido confirmado y enviado` }]);
                    } else {
                      result = { success: false, error: "Failed to send order" };
                      setLogs(prev => [...prev, { role: 'error', text: `✗ Fallo al enviar` }]);
                    }
                  }
                } else if (fc.name === 'endSession') {
                  result = { success: true, message: "Ending session" };
                  setLogs(prev => [...prev, { role: 'system', text: `👋 Finalizando llamada...` }]);

                  setTimeout(() => {
                    disconnect();
                  }, 4000);
                }

                responses.push({
                  id: fc.id,
                  name: fc.name,
                  response: { result }
                });
              }

              if (sessionRef.current) {
                sessionRef.current.then((session: any) => {
                  session.sendToolResponse({ functionResponses: responses });
                });
              }
            }

            if (msg.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
            }
          },
          onclose: () => {
            disconnect();
          },
          onerror: (err) => {
            console.error(err);
            disconnect();
            setStatus('error');
          }
        }
      });

      sessionRef.current = sessionPromise;

    } catch (error) {
      console.error("Connection failed", error);
      setStatus('error');
      disconnect();
    }
  }, [apiKey, enhancedSystemInstruction, isMuted, disconnect, onAddToCart, onRemoveFromOrder, onConfirmOrder, onSetDiners]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return {
    status,
    connect,
    disconnect,
    isMuted,
    setIsMuted,
    volumeLevel,
    logs
  };
};