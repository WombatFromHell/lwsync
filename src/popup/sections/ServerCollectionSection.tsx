/**
 * ServerCollectionSection Component
 * Allows updating the target collection name on the server
 */

import { useState, useEffect } from "preact/hooks";
import { getDefaultCollectionName } from "../../browser";

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
    <div id="server-collection-section" className="section">
      <div className="section-title">Server Collection</div>

      <label htmlFor="targetCollectionName">Target Collection Name</label>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          type="text"
          id="targetCollectionName"
          placeholder="e.g. Bookmarks/Linkwarden"
          value={collectionName}
          style={{ marginBottom: "0" }}
          onInput={(e) =>
            setCollectionName((e.target as HTMLInputElement).value)
          }
        />
        <button
          id="updateCollectionBtn"
          className="btn-secondary"
          style={{ width: "auto", padding: "8px 16px" }}
          onClick={handleUpdate}
          disabled={isUpdating}
        >
          {isUpdating ? "Updating..." : "Update"}
        </button>
      </div>
      <p className="help-text">
        Case-sensitive. Use / for nested collections. Will be created if it
        doesn&apos;t exist.
      </p>
    </div>
  );
}
