/**
 * FoldingSection Component
 * Collapsible section with animation and persistent state
 */

import { useState, useEffect } from "preact/hooks";
import { toggleSection, getSectionState } from "../../storage/main";
import { Card } from "./Card";

export interface FoldingSectionProps {
  sectionId: string;
  title: string;
  defaultExpanded?: boolean;
  children: preact.ComponentChildren;
  className?: string;
}

export function FoldingSection({
  sectionId,
  title,
  defaultExpanded = true,
  children,
  className = "",
}: FoldingSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load persisted state on mount
  useEffect(() => {
    getSectionState()
      .then((state) => {
        if (sectionId in state) {
          setIsExpanded(state[sectionId]);
        }
        setIsLoaded(true);
      })
      .catch(() => {
        setIsLoaded(true);
      });
  }, [sectionId]);

  const handleToggle = async () => {
    const newState = await toggleSection(sectionId);
    setIsExpanded(newState);
  };

  return (
    <Card className={className}>
      <button
        type="button"
        onClick={handleToggle}
        className="
          flex w-full items-center justify-between px-1.5 py-1 transition-colors
          hover:bg-slate-50
          dark:hover:bg-slate-800
        "
      >
        <h2
          className="
            text-base font-semibold text-slate-900
            dark:text-slate-100
          "
        >
          {title}
        </h2>
        <span
          className={`
            ml-4 inline-flex size-5 items-center justify-center rounded-sm
            text-slate-500 transition-transform
            dark:text-slate-400
            ${isExpanded ? "rotate-180" : "rotate-0"}
          `}
        >
          ▼
        </span>
      </button>
      <div
        className={`
          overflow-hidden transition-all duration-200 ease-in-out
          ${isExpanded ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"}
        `}
      >
        {children}
      </div>
    </Card>
  );
}
