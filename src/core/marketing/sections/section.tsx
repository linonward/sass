import { cn } from "@/core/lib/utils";
import type { LandingSectionId } from "@/core/config/schema";

import { bandBg, type Band } from "./band";
import { Wave } from "./wave";

/**
 * 区块外壳：统一锚点 id、色带、间距，并用 data-section 标记，便于测试顺序。
 *
 * `waveFrom` 指上一段的色带。波浪由 Landing 按相邻两段的色带算出来传进来，
 * 不由区块自己猜，这样配置调换顺序时也不会画出对不上的波浪。
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
  /** 上一段的色带；与 band 相同（或没传）时不画波浪。 */
  waveFrom?: Band;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-section={id}
      className={cn(
        // scroll-mt 从顶栏高度推出来，锚点跳转后标题不会被顶栏压住。
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
  /** 区块单独成页时（例如 /pricing）用作页面的 h1。 */
  level?: 1 | 2;
  className?: string;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    // 左对齐，不居中：居中的区块标题配三张一样的卡是默认套路，去掉。
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
