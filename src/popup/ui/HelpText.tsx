/**
 * HelpText Component
 */

import type { ComponentChildren } from "preact";

export interface HelpTextProps {
  children: ComponentChildren;
}

export function HelpText({ children }: HelpTextProps) {
  return (
    <p
      className="
        mt-1 mb-3 text-xs text-slate-500
        dark:text-slate-400
      "
    >
      {children}
    </p>
  );
}
