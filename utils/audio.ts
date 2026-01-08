import { Blob } from "@google/genai";

export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Convert Int16 to Float32 [-1.0, 1.0]
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function createPcmBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Convert Float32 [-1.0, 1.0] to Int16
    const s = Math.max(-1, Math.min(1, data[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return {
    data: arrayBufferToBase64(int16.buffer),
    mimeType: 'audio/pcm;rate=16000',
  };
}
export class AudioPlayer {
  private queue: Float32Array[] = [];
  private isCcPlaying = false;
  private audioContext: AudioContext | null = null;
  private sampleRate: number;

  constructor(context: AudioContext, sampleRate: number = 24000) {
    this.audioContext = context;
    this.sampleRate = sampleRate;
  }

  add16BitPCM(arrayBuffer: ArrayBuffer) {
    if (!this.audioContext) return;

    // Convert Int16 to Float32
    const dataInt16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(dataInt16.length);
    for (let i = 0; i < dataInt16.length; i++) {
      float32[i] = dataInt16[i] / 32768.0;
    }

    this.queue.push(float32);
    this.playNext();
  }

  private playNext() {
    if (this.isCcPlaying || this.queue.length === 0 || !this.audioContext) return;

    this.isCcPlaying = true;
    const chunk = this.queue.shift();

    if (!chunk) {
      this.isCcPlaying = false;
      return;
    }

    const buffer = this.audioContext.createBuffer(1, chunk.length, this.sampleRate);
    buffer.getChannelData(0).set(chunk);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    source.onended = () => {
      this.isCcPlaying = false;
      this.playNext();
    };

    source.start();
  }

  stop() {
    this.queue = [];
    this.isCcPlaying = false;
  }
}
