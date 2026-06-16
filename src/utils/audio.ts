/**
 * Converts a Float32Array of audio samples (typically from standard AudioNodes/Web Audio API)
 * into a 16-bit signed Integer PCM ArrayBuffer, which is required by the Gemini Live API (16kHz, 16-bit little-endian).
 */
export function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true); // true = little-endian
  }
  return buffer;
}

/**
 * Converts an ArrayBuffer to a Base64 string for WebSocket network transport.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Decodes a Base64 string back into an ArrayBuffer.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Converts standard Base64 16-bit Signed Little-Endian PCM data (at 24000Hz output sample rate from Gemini)
 * into a Web Audio API playable AudioBuffer.
 * 
 * @param audioCtx The playback AudioContext
 * @param base64PCM Base64 string containing PCM 16-bit little-endian samples
 * @param sampleRate The output sample rate of the stream (Gemini sends 24000Hz)
 */
export function pcmToAudioBuffer(
  audioCtx: AudioContext,
  base64PCM: string,
  sampleRate = 24000
): AudioBuffer {
  const arrayBuffer = base64ToArrayBuffer(base64PCM);
  const view = new DataView(arrayBuffer);
  const numSamples = arrayBuffer.byteLength / 2;
  const float32Data = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const int16Sample = view.getInt16(i * 2, true); // true for little-endian
    
    // Convert 16-bit Integer to Float32 [-1.0, 1.0]
    float32Data[i] = int16Sample / 32768.0;
  }

  const audioBuffer = audioCtx.createBuffer(1, numSamples, sampleRate);
  audioBuffer.getChannelData(0).set(float32Data);
  return audioBuffer;
}
