/**
 * Spinner Component
 */

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  class?: string;
}

export function Spinner({ size = "md", class: className }: SpinnerProps) {
  const sizes = {
    sm: "h-3 w-3 border",
    md: "h-3.5 w-3.5 border-2",
    lg: "h-4.5 w-4.5 border-2",
  };

  return (
    <span
      className={`
        inline-block animate-spin rounded-full border-slate-300 border-t-sky-600
        dark:border-slate-600 dark:border-t-sky-400
        ${sizes[size]}
        ${className || ""}
      `}
    />
  );
}
