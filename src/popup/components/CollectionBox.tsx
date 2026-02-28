/**
 * CollectionBox Component
 * Unified component for displaying and updating collection/folder names
 * Replaces both ServerCollectionSection and BookmarkFolderSection
 */

import { useState, useEffect } from "preact/hooks";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Spacer } from "../ui/Spacer";

export interface CollectionBoxProps {
  /** Label displayed in the input field */
  label: string;
  /** Title displayed at the top of the box */
  title: string;
  /** Current value of the collection/folder name */
  value: string;
  /** Callback to update the collection/folder name */
  onUpdate: (name: string) => Promise<void | boolean>;
  /** Placeholder text for the input field */
  placeholder?: string;
  /** Help text displayed below the button */
  helpText?: string;
  /** Whether the component is disabled */
  disabled?: boolean;
}

export function CollectionBox({
  label,
  title,
  value,
  onUpdate,
  placeholder,
  helpText,
  disabled = false,
}: CollectionBoxProps) {
  const [localValue, setLocalValue] = useState(value);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleUpdate = async () => {
    if (disabled) return;
    const name = localValue.trim();
    if (!name) {
      return;
    }
    setIsUpdating(true);
    await onUpdate(name);
    setIsUpdating(false);
  };

  return (
    <div
      className="
        rounded-lg border border-slate-200 bg-white px-2 py-2.5
        dark:border-slate-700 dark:bg-slate-800/50
      "
    >
      <h3
        className="
          mb-2.5 text-base font-semibold text-slate-900
          dark:text-slate-100
        "
      >
        {title}
      </h3>

      <Input
        id={`${title.toLowerCase().replace(/\s+/g, "-")}-input`}
        label={label}
        type="text"
        placeholder={placeholder}
        value={localValue}
        onInput={(e) => setLocalValue((e.target as HTMLInputElement).value)}
      />

      <Spacer size="sm" />

      <Button
        id={`update-${title.toLowerCase().replace(/\s+/g, "-")}-btn`}
        variant="secondary"
        onClick={handleUpdate}
        disabled={disabled || isUpdating}
        loading={isUpdating}
      >
        {isUpdating ? "Updating..." : "Update"}
      </Button>

      {helpText && (
        <>
          <Spacer size="sm" />
          <p
            className="
              text-xs text-slate-500
              dark:text-slate-400
            "
          >
            {helpText}
          </p>
        </>
      )}
    </div>
  );
}
