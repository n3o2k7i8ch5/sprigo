// Piper runs here for the same reason as Kokoro (src/kokoro.worker.ts): onnx inference would block the UI thread.
// Same messages as the Kokoro worker, plus the voice id in "load"; one sentence per chunk.
import { TtsSession } from "@mintplex-labs/piper-tts-web";

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
// Shipped with the app instead of the library's CDN defaults (~29 MB a cold start, #74). Only the voice model is downloaded.
// The webview is not cross-origin isolated, so onnxruntime runs single-threaded and only asks for ort-wasm-simd.wasm.
const wasmPaths = {
  onnxWasm: { "ort-wasm-simd.wasm": new URL("../node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm", import.meta.url).href },
  piperWasm: new URL("../node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm", import.meta.url).href,
  piperData: new URL("../node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data", import.meta.url).href,
};
const sessions = new Map<string, Promise<TtsSession>>();
let current = 0;

function load(voice: string) {
  let s = sessions.get(voice);
  if (!s) {
    // The library keeps one session and would only swap the voice id, not the model: start a fresh one per voice.
    (TtsSession as unknown as { _instance: unknown })._instance = null;
    const progress = (p: { loaded: number; total: number }) => { if (p.total) post({ type: "progress", voice, p: p.loaded / p.total }); };
    s = TtsSession.create({ voiceId: voice as never, progress, wasmPaths: wasmPaths as never });
    s.catch(() => sessions.delete(voice));
    sessions.set(voice, s);
  }
  return s;
}

/** The 16-bit mono wav the library returns, as samples. */
async function samples(wav: Blob) {
  const v = new DataView(await wav.arrayBuffer()), audio = new Float32Array((v.byteLength - 44) / 2);
  for (let i = 0; i < audio.length; i++) audio[i] = v.getInt16(44 + i * 2, true) / 32768;
  return { audio, rate: v.getUint32(24, true) };
}

self.onmessage = async ({ data: m }: MessageEvent) => {
  if (m.type === "load") load(m.voice).then(() => post({ type: "ready", voice: m.voice }), (e) => post({ type: "error", voice: m.voice, message: String(e?.message ?? e) }));
  else if (m.type === "cancel") current = 0;
  else if (m.type === "speak") {
    current = m.id;
    try {
      const s = await load(m.voice);
      (s as unknown as { speed: number }).speed = m.speed ?? 1; // read by our patch of the library (patches/), as length_scale / speed
      const sentences = (m.text as string).match(/[^.!?…\n]+[.!?…]*/g)?.map((x) => x.trim()).filter((x) => /\p{L}|\d/u.test(x)) ?? [];
      for (const text of sentences) {
        const { audio, rate } = await samples(await s.predict(text));
        if (current !== m.id) return;
        post({ type: "chunk", id: m.id, audio, rate }, [audio.buffer]);
      }
      if (current === m.id) post({ type: "end", id: m.id });
    } catch (e) {
      post({ type: "error", id: m.id, message: String((e as Error)?.message ?? e) });
    }
  }
};
