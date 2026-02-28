/**
 * Content Component
 * Provides consistent edge padding for popup content
 * Matches original popup.css body padding (16px)
 * Children manage their own internal spacing
 *
 * Usage:
 * <Content>
 *   <Section1 />
 *   <Section2 />
 * </Content>
 */

export interface ContentProps {
  /** Children elements */
  children: preact.ComponentChildren;
  /** Additional CSS classes */
  className?: string;
}

export function Content({ children, className = "" }: ContentProps) {
  return (
    <div
      className={`
        p-2
        ${className}
      `}
    >
      {children}
    </div>
  );
}
