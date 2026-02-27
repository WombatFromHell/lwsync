/**
 * ServerCollectionSection Component
 */

import { useState, useEffect } from "preact/hooks";
import { getDefaultCollectionName } from "../../browser";
import { Section, Input, Button } from "../ui";

export interface ServerCollectionSectionProps {
  targetCollectionName: string;
  onUpdate: (name: string) => Promise<void>;
}

export function ServerCollectionSection({
  targetCollectionName,
  onUpdate,
}: ServerCollectionSectionProps) {
  const [collectionName, setCollectionName] = useState(targetCollectionName);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setCollectionName(targetCollectionName);
  }, [targetCollectionName]);

  const handleUpdate = async () => {
    const name = collectionName.trim() || getDefaultCollectionName();
    if (!name) {
      return;
    }
    setIsUpdating(true);
    await onUpdate(name);
    setIsUpdating(false);
  };

  return (
    <Section id="server-collection-section" title="Server Collection">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            id="targetCollectionName"
            label="Target Collection Name"
            type="text"
            placeholder="e.g. Bookmarks/Linkwarden"
            value={collectionName}
            onInput={(e) =>
              setCollectionName((e.target as HTMLInputElement).value)
            }
          />
        </div>
        <Button
          id="updateCollectionBtn"
          variant="secondary"
          onClick={handleUpdate}
          disabled={isUpdating}
          loading={isUpdating}
          fullWidth={false}
        >
          {isUpdating ? "Updating..." : "Update"}
        </Button>
      </div>
      <p
        className="
          mt-[2px] mb-[14px] text-[11px] text-slate-500
          dark:text-slate-400
        "
      >
        Case-sensitive. Use / for nested collections. Will be created if it
        doesn&apos;t exist.
      </p>
    </Section>
  );
}
