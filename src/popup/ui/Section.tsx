/**
 * Section Component
 */

import type { ComponentChildren } from "preact";

export interface SectionProps {
  id?: string;
  title: string;
  action?: ComponentChildren;
  children: ComponentChildren;
}

export function Section({ id, title, action, children }: SectionProps) {
  return (
    <section id={id} className="mb-6">
      <div className="mb-[10px] flex items-center justify-between">
        <h2
          className="
            text-[12px] font-semibold text-slate-600 uppercase
            dark:text-slate-400
          "
        >
          {title}
        </h2>
        {action && <div>{action}</div>}
      </div>
      {children}
    </section>
  );
}
