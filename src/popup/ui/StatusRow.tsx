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
        flex items-center justify-between border-b border-slate-200 py-1
        last:border-b-0
        dark:border-slate-700
      "
    >
      <span
        className="
          text-sm text-slate-500
          dark:text-slate-400
        "
      >
        {label}
      </span>
      <span
        id={id}
        className="
          text-sm font-medium text-slate-900
          dark:text-slate-100
        "
      >
        {value}
      </span>
    </div>
  );
}
