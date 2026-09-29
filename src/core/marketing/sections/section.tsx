import { cn } from "@/core/lib/utils";
import type { LandingSectionId } from "@/core/config/schema";

import { bandBg, type Band } from "./band";
import { Wave } from "./wave";

/**
 * Section shell: consistent anchor id, band, and spacing, tagged with data-section so tests can
 * check order.
 *
 * `waveFrom` is the previous section's band. Landing computes the wave from the two adjacent bands
 * and passes it in rather than letting the section guess, so reordering the config never draws a
 * mismatched wave.
 */
export function Section({
  id,
  band = "canvas",
  waveFrom,
  className,
  children,
}: {
  id: LandingSectionId;
  band?: Band;
  /** The previous section's band; no wave is drawn when it equals band (or is omitted). */
  waveFrom?: Band;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-section={id}
      className={cn(
        // scroll-mt is derived from the header height so anchor jumps don't hide the title under the header.
        "scroll-mt-[calc(var(--header-height)+1rem)]",
        bandBg[band],
        className,
      )}
    >
      {waveFrom && waveFrom !== band && <Wave from={waveFrom} />}
      <div className="container-marketing py-14 sm:py-20">{children}</div>
    </section>
  );
}

export function SectionHeading({
  title,
  subtitle,
  level = 2,
  className,
}: {
  title: string;
  subtitle?: string;
  /** Used as the page h1 when the section is its own page (e.g. /pricing). */
  level?: 1 | 2;
  className?: string;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    // Left-aligned, not centered: a centered section title over three identical cards is the default
    // cliché, so we avoid it.
    <div className={cn("max-w-2xl", className)}>
      <Heading className="heading-display text-3xl sm:text-4xl">
        {title}
      </Heading>
      {subtitle && (
        <p className="text-muted-foreground mt-4 text-lg text-pretty">
          {subtitle}
        </p>
      )}
    </div>
  );
}
