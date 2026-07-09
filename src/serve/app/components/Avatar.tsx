import { hue, initials } from "../runtime/dom";

// Ported from app.html:707.
export function Avatar({ name }: { name: string }) {
  const bg = `linear-gradient(140deg, hsl(${hue(name)} 65% 55%), hsl(${(hue(name) + 40) % 360} 60% 45%))`;
  return (
    <span class="avatar" style={{ background: bg }}>
      {initials(name)}
    </span>
  );
}
