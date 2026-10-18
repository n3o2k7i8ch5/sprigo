import type { ButtonHTMLAttributes } from "react";
import { speak, useTtsPreparing } from "./tts";

/** Speaks `text` on click (at `speed`, else the learner's setting). Busy and disabled while its voice is getting ready, so it can't be spammed (#74). */
export function SpeakButton({ text, lang, speed, onClick, ...rest }: { text: string; lang: string; speed?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const busy = useTtsPreparing(text);
  return <button {...rest} aria-busy={busy} disabled={busy || rest.disabled} onClick={(e) => { speak(text, lang, undefined, undefined, speed); onClick?.(e); }} />;
}
