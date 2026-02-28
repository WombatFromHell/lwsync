/**
 * Card Component
 * Provides consistent container styling for sections
 * Used by FoldingSection and standalone section components
 */

import type { ComponentChildren } from "preact";

export interface CardProps {
  children: ComponentChildren;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`
        rounded-lg border border-slate-200 bg-white px-2 py-2.5
        dark:border-slate-700 dark:bg-slate-800/50
        ${className}
      `}
    >
      {children}
    </div>
  );
}
