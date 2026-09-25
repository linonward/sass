import { cn } from "@/core/lib/utils";
import type { LandingSectionId } from "@/core/config/schema";

/** 区块外壳：统一锚点 id、间距，并用 data-section 标记，便于测试顺序。 */
export function Section({
  id,
  className,
  children,
}: {
  id: LandingSectionId;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-section={id}
      className={cn("scroll-mt-16 px-4 py-20 sm:py-24", className)}
    >
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

export function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      {subtitle && (
        <p className="text-muted-foreground mt-4 text-lg text-pretty">
          {subtitle}
        </p>
      )}
    </div>
  );
}
