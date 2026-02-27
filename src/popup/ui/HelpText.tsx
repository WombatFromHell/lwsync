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
        mt-[2px] mb-[14px] text-[11px] text-slate-500
        dark:text-slate-400
      "
    >
      {children}
    </p>
  );
}
