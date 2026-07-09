import type { ComponentChildren, JSX } from "preact";

// Ported from app.html btn/btn-primary/btn-ghost styles (~220-225).
export interface ButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, "class"> {
  variant?: "primary" | "ghost";
  children?: ComponentChildren;
}

export function Button({ variant = "primary", children, ...rest }: ButtonProps) {
  return (
    <button class={`btn btn-${variant}`} {...rest}>
      {children}
    </button>
  );
}
