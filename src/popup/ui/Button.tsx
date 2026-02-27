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
  children,
  ...props
}: ButtonProps) {
  const base =
    "w-full px-4 py-[10px] rounded-[6px] text-[13px] font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed";

  const variants = {
    primary:
      "bg-sky-500 text-white hover:bg-sky-600 dark:bg-sky-500 dark:hover:bg-sky-400",
    secondary:
      "bg-slate-50 text-slate-700 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600",
    danger:
      "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-100 dark:hover:bg-red-800",
  };

  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`
        ${base}
        ${variants[variant]}
        ${fullWidth ? "" : "w-auto"}
      `}
      {...props}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span
            className="
              inline-block h-[14px] w-[14px] animate-spin rounded-full border-2
              border-slate-200 border-t-sky-500
              dark:border-slate-700 dark:border-t-sky-400
            "
          />
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
