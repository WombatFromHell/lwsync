/**
 * Input Component
 */

import type { ComponentChildren } from "preact";
import type { InputHTMLAttributes } from "preact";
import { HelpText } from "./HelpText";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label?: string;
  helpText?: ComponentChildren;
  type?: "text" | "password" | "number";
  error?: string;
}

export function Input({
  id,
  label,
  helpText,
  type = "text",
  error,
  class: className,
  ...props
}: InputProps) {
  const base =
    "w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-sm bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-500";

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={id}
          className="
            mb-1.5 block text-sm font-medium text-slate-700
            dark:text-slate-300
          "
        >
          {label}
        </label>
      )}
      <input
        id={id}
        type={type}
        className={`
          ${base}
          ${className || ""}
          ${
            error
              ? `
                border-red-500
                focus:border-red-500 focus:ring-red-500/20
              `
              : ""
          }
        `}
        {...props}
      />
      {helpText && <HelpText>{helpText}</HelpText>}
      {error && (
        <p
          className="
            mt-1 text-xs text-red-600
            dark:text-red-400
          "
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
