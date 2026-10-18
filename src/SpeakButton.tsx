import type { ButtonHTMLAttributes } from "react";
import { speak, useTtsPreparing } from "./tts";

/** Speaks `text` on click. Busy and disabled while its voice is getting ready, so it can't be spammed (#74). */
export function SpeakButton({ text, lang, onClick, ...rest }: { text: string; lang: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const busy = useTtsPreparing(text);
  return <button {...rest} aria-busy={busy} disabled={busy || rest.disabled} onClick={(e) => { speak(text, lang); onClick?.(e); }} />;
}
