// Kokoro runs here so onnx inference never blocks the UI thread (it froze the app for seconds per line).
// In: { type: "load" } | { type: "speak", id, text, voice } | { type: "cancel" }
// Out: progress/ready/error for load; chunk (one sentence)/end/error with the speak id.
type KokoroModule = typeof import("kokoro-js");
type Kokoro = KokoroModule["KokoroTTS"]["prototype"];

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
let tts: Promise<Kokoro> | undefined;
let lib: KokoroModule | undefined;
let current = 0; // speak id being generated; a newer speak or a cancel drops the rest of the old one

function load() {
  return (tts ??= (async () => {
    const { KokoroTTS } = (lib = await import("kokoro-js"));
    const files: Record<string, [number, number]> = {};
    const progress_callback = (e: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (e.status !== "progress" || !e.file || !e.total) return;
      files[e.file] = [e.loaded ?? 0, e.total];
      const all = Object.values(files);
      post({ type: "progress", p: all.reduce((n, f) => n + f[0], 0) / all.reduce((n, f) => n + f[1], 0) });
    };
    // ponytail: wasm only; kokoro-js wants fp32 (~320 MB) on webgpu, q8 keeps the download at ~90 MB
    return KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "wasm", progress_callback });
  })().catch((e) => { tts = undefined; throw e; }));
}

self.onmessage = async ({ data: m }: MessageEvent) => {
  if (m.type === "load") load().then(() => post({ type: "ready" }), (e) => post({ type: "error", message: String(e?.message ?? e) }));
  else if (m.type === "cancel") current = 0;
  else if (m.type === "speak") {
    current = m.id;
    try {
      const k = await load();
      // kokoro-js 1.2.1 never closes the splitter it makes for a string, so the last sentence would hang; hand it a closed one.
      const text = new lib!.TextSplitterStream();
      text.push(m.text);
      text.close();
      for await (const { audio } of k.stream(text, { voice: m.voice, speed: m.speed ?? 1 })) {
        if (current !== m.id) return;
        const a = audio.audio as Float32Array;
        post({ type: "chunk", id: m.id, audio: a, rate: audio.sampling_rate }, [a.buffer]);
        await new Promise((r) => setTimeout(r)); // let a cancel or a newer speak in between sentences
      }
      if (current === m.id) post({ type: "end", id: m.id });
    } catch (e) {
      post({ type: "error", id: m.id, message: String((e as Error)?.message ?? e) });
    }
  }
};
