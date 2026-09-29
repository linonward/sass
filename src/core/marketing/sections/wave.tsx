import { cn } from "@/core/lib/utils";

import { bandFill, type Band } from "./band";

/**
 * Wave divider between sections.
 *
 * It's a standalone element rather than a section's own decoration: the background takes the next
 * section's color and the SVG takes the previous one's. That way the wave always matches its two
 * neighbors however `landing.sections` is ordered.
 *
 * The SVG is drawn wider than the viewport (200%) and centered so the size of the crests and troughs
 * doesn't distort with screen width; the parent's overflow-hidden clips the overflow. Stretching it
 * with preserveAspectRatio="none" would squash the two waves into something scrawny on narrow
 * screens.
 */
export function Wave({ from, className }: { from: Band; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("relative h-10 overflow-hidden sm:h-16", className)}
    >
      <svg
        viewBox="0 0 1920 64"
        preserveAspectRatio="none"
        className={cn("absolute -left-1/2 h-full w-[200%]", bandFill[from])}
      >
        {/* Control points reach both ends, 0 and 64, giving crests and troughs of about 24px each so
            the band transition is visible. Too shallow and the wave degrades into a straight line,
            and the page's horizontal rhythm falls apart. */}
        <path d="M0,0 H1920 V32 C1700,64 1500,64 1280,32 C1060,0 860,0 640,32 C420,64 220,64 0,32 Z" />
      </svg>
    </div>
  );
}
