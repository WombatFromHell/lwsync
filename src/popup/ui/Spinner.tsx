/**
 * Spinner Component
 */

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  class?: string;
}

export function Spinner({ size = "md", class: className }: SpinnerProps) {
  const sizes = {
    sm: "w-[12px] h-[12px] border",
    md: "w-[14px] h-[14px] border-2",
    lg: "w-[18px] h-[18px] border-2",
  };

  return (
    <span
      className={`
        inline-block animate-spin rounded-full border-slate-200 border-t-sky-500
        dark:border-slate-700 dark:border-t-sky-400
        ${sizes[size]}
        ${className || ""}
      `}
    />
  );
}
