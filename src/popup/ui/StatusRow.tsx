/**
 * StatusRow Component
 */

import type { ComponentChildren } from "preact";

export interface StatusRowProps {
  label: string;
  value: ComponentChildren;
  id?: string;
}

export function StatusRow({ label, value, id }: StatusRowProps) {
  return (
    <div
      className="
        flex items-center justify-between border-b border-slate-50 py-[10px]
        last:border-b-0
        dark:border-slate-800
      "
    >
      <span
        className="
          text-[13px] text-slate-500
          dark:text-slate-400
        "
      >
        {label}
      </span>
      <span
        id={id}
        className="
          text-[13px] font-medium text-slate-900
          dark:text-slate-100
        "
      >
        {value}
      </span>
    </div>
  );
}
