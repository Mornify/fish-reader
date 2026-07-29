import type { CSSProperties } from "react";
import { hueFromString } from "./books";

/** ElevenReader-style mesh-gradient orb avatar, deterministic per seed. */
export function orbStyle(seed: string): CSSProperties {
  const h = hueFromString(seed);
  const h2 = (h + 70) % 360;
  const h3 = (h + 200) % 360;
  return {
    background: `radial-gradient(circle at 30% 30%, hsl(${h} 85% 70%), transparent 60%),
       radial-gradient(circle at 70% 40%, hsl(${h2} 80% 65%), transparent 55%),
       radial-gradient(circle at 50% 80%, hsl(${h3} 75% 60%), transparent 60%),
       hsl(${h2} 40% 45%)`,
  };
}
