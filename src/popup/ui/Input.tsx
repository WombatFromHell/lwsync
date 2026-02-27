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
    "w-full px-[12px] py-[9px] border border-slate-200 rounded-[6px] text-[13px] bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-colors dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 dark:placeholder-slate-500";

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={id}
          className="
            mb-[6px] block font-medium text-slate-700
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
                focus:border-red-500 focus:ring-red-500
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
            mt-[2px] text-[11px] text-red-700
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
