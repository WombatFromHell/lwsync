/**
 * Button Component
 */

import type { ComponentChildren } from "preact";
import type { ButtonHTMLAttributes } from "preact";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  children: ComponentChildren;
}

export function Button({
  variant = "primary",
  loading = false,
  fullWidth = true,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900";

  const variants = {
    primary:
      "bg-sky-600 text-white hover:bg-sky-700 focus:ring-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400",
    secondary:
      "bg-slate-100 text-slate-700 hover:bg-slate-200 focus:ring-slate-500 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600",
    danger:
      "bg-red-100 text-red-700 hover:bg-red-200 focus:ring-red-500 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50",
  };

  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`
        ${base}
        ${variants[variant]}
        ${fullWidth ? "w-full" : "w-auto"}
        ${className || ""}
      `}
      {...props}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span
            className="
              inline-block size-2 animate-spin rounded-full border-2
              border-slate-300 border-t-sky-600
              dark:border-slate-600 dark:border-t-sky-400
            "
            role="status"
            aria-label="Loading"
          />
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
