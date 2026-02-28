/**
 * Spacer Component
 * Provides consistent spacing between elements and for edge padding
 */

export interface SpacerProps {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  horizontal?: boolean;
}

export function Spacer({ size = "md", horizontal = false }: SpacerProps) {
  const sizes = {
    xs: "h-1 w-1", // 4px
    sm: "h-1.5 w-1.5", // 6px
    md: "h-2 w-2", // 8px
    lg: "h-2.5 w-2.5", // 12px
    xl: "h-3 w-3", // 16px
  };

  return (
    <div
      className={`
        ${horizontal ? "inline-block" : "block"}
        ${sizes[size]}
      `}
    />
  );
}
