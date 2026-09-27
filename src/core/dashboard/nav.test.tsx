import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";

import messages from "../../../messages/en.json";
import { defineConfig, type SiteConfigInput } from "../config/schema";
import { SidebarProvider, SidebarTrigger } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { AppSidebar } from "./app-sidebar";
import { initials } from "./user-menu";
import { adminNav, dashboardNav, isActiveNav, suiteNav } from "./nav";

import siteConfig from "../../../site.config";

let pathname = "/dashboard";
vi.mock("@/core/i18n/navigation", () => ({
  usePathname: () => pathname,
  Link: ({ href, ...props }: { href: string } & Record<string, unknown>) => (
    <a href={href} {...props} />
  ),
}));

/** jsdom 没有 matchMedia。`isMobile` 决定媒体查询是否匹配；默认桌面端。 */
function setViewport(isMobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isMobile && query.includes("max-width"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  setViewport(false);
});

/** 模拟业务项目在 site.config.ts 里加了一项 dashboard.nav。AI 固定关闭，不受演示站点的开关影响。 */
function configWithProjects() {
  return defineConfig({
    ...(siteConfig as SiteConfigInput),
    features: { ...siteConfig.features, ai: false },
    dashboard: {
      nav: [{ key: "projects", href: "/projects", icon: "layers" }],
    },
  });
}

function renderSidebar(config = configWithProjects()) {
  const copy = {
    ...messages,
    Dashboard: {
      ...messages.Dashboard,
      nav: { ...messages.Dashboard.nav, projects: "Projects" },
    },
  };
  return render(
    <NextIntlClientProvider locale="en" messages={copy}>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar nav={dashboardNav(config)} header={null} footer={null} />
        </SidebarProvider>
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

describe("dashboardNav", () => {
  test("套件项在前，业务项来自配置", () => {
    const nav = dashboardNav(configWithProjects());
    expect(nav.suite).toBe(suiteNav);
    expect(nav.business.map((i) => i.href)).toEqual(["/projects"]);
  });

  test("features.ai 开启时，Dashboard 之后多一个 Playground", () => {
    const base = configWithProjects();
    expect(dashboardNav(base).suite.map((i) => i.href)).not.toContain(
      "/playground",
    );
    const nav = dashboardNav({
      ...base,
      features: { ...base.features, ai: true },
    });
    expect(nav.suite.map((i) => i.href)).toEqual([
      "/dashboard",
      "/playground",
      "/billing",
      "/settings",
    ]);
  });

  test.each([
    ["/dashboard", "/dashboard", true],
    ["/projects/42", "/projects", true],
    ["/projects-archive", "/projects", false],
    ["/settings", "/dashboard", false],
  ])("isActiveNav(%s, %s) = %s", (path, href, expected) => {
    expect(isActiveNav(path, href)).toBe(expected);
  });

  test("acquisition.referrals 关闭时没有 Referrals 入口（出厂默认）", () => {
    const config = configWithProjects();
    expect(config.acquisition.referrals.enabled).toBe(false);
    expect(dashboardNav(config).suite.map((i) => i.href)).not.toContain(
      "/referrals",
    );
  });

  test("acquisition.referrals 开启时，Dashboard 之后多一个 Referrals", () => {
    const base = configWithProjects();
    const nav = dashboardNav({
      ...base,
      acquisition: {
        ...base.acquisition,
        referrals: { enabled: true },
      },
    });
    expect(nav.suite.map((i) => i.href)).toEqual([
      "/dashboard",
      "/referrals",
      "/billing",
      "/settings",
    ]);
    // 与 Playground 同时开启时，Referrals 排在它后面。
    expect(
      dashboardNav({
        ...base,
        features: { ...base.features, ai: true },
        acquisition: { ...base.acquisition, referrals: { enabled: true } },
      }).suite.map((i) => i.href),
    ).toEqual([
      "/dashboard",
      "/playground",
      "/referrals",
      "/billing",
      "/settings",
    ]);
  });
});

describe("adminNav", () => {
  const withStatusPage = (enabled: boolean) => {
    const base = configWithProjects();
    return adminNav({
      ...base,
      statusPage: { ...base.statusPage, enabled },
    });
  };

  test("statusPage 开启时菜单末尾多一个 Status page", () => {
    const nav = withStatusPage(true);
    expect(nav.map((i) => i.href)).toContain("/admin/status");
    expect(nav.at(-1)?.href).toBe("/admin/status");
  });

  test("statusPage 关闭时没有 Status page 入口（页面 404，留个点进去就 404 的入口只会让人以为坏了）", () => {
    expect(withStatusPage(false).map((i) => i.href)).not.toContain(
      "/admin/status",
    );
  });
});

describe("AppSidebar", () => {
  test("在 dashboard.nav 加一项后，侧边栏出现对应入口", () => {
    renderSidebar();
    const business = screen.getByRole("list", {
      name: messages.Dashboard.businessNav,
    });
    expect(
      within(business).getByRole("link", { name: "Projects" }),
    ).toHaveProperty("href", expect.stringMatching(/\/projects$/));
  });

  test("没有业务项时不渲染业务分组", () => {
    renderSidebar(
      defineConfig({
        ...(siteConfig as SiteConfigInput),
        dashboard: { nav: [] },
      }),
    );
    expect(
      screen.queryByRole("list", { name: messages.Dashboard.businessNav }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: messages.Dashboard.nav.settings }),
    ).toBeDefined();
  });

  test("模块开启时侧边栏出现 Referrals 入口", () => {
    const base = configWithProjects();
    renderSidebar(
      defineConfig({
        ...(base as SiteConfigInput),
        acquisition: { ...base.acquisition, referrals: { enabled: true } },
      }),
    );
    expect(
      screen.getByRole("link", { name: messages.Dashboard.nav.referrals }),
    ).toHaveProperty("href", expect.stringMatching(/\/referrals$/));
  });

  test("当前页的菜单项高亮", () => {
    pathname = "/projects/42";
    renderSidebar();
    const link = screen.getByRole("link", { name: "Projects" });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.getAttribute("data-active")).not.toBeNull();
    expect(
      screen
        .getByRole("link", { name: messages.Dashboard.nav.home })
        .getAttribute("aria-current"),
    ).toBeNull();
  });
});

describe("initials", () => {
  test.each([
    [{ name: "Ada Lovelace", email: "ada@x.com" }, "AL"],
    [{ name: "ada", email: "ada@x.com" }, "A"],
    [{ name: "", email: "zoe@x.com" }, "Z"],
  ])("%o → %s", (user, expected) => {
    expect(initials(user)).toBe(expected);
  });
});

describe("AppSidebar 的可访问名", () => {
  /**
   * 侧栏的三处可访问名（抽屉标题/描述、触发器、导轨）都来自 messages，以前是
   * 写死在 `src/core/ui/sidebar.tsx` 里的。这里用一份伪翻译的文案渲染：名字跟着 messages
   * 走才算接上了 i18n，写死的话这条会红。
   */
  test("移动端抽屉的标题、描述与导轨的名字都来自 messages", () => {
    const copy = {
      ...messages,
      Dashboard: {
        ...messages.Dashboard,
        sidebar: "[de] Sidebar",
        sidebarDescription: "[de] Displays the mobile sidebar.",
        toggleSidebar: "[de] Toggle sidebar",
      },
    };
    setViewport(true);

    render(
      <NextIntlClientProvider locale="de" messages={copy}>
        <TooltipProvider>
          <SidebarProvider>
            {/* 站点里的触发器在 shell 的顶栏（`DashboardShell` 传 `t("toggleSidebar")`），
                这里补一个打开抽屉；外壳那条链路由 e2e 锁。 */}
            <SidebarTrigger label={copy.Dashboard.toggleSidebar} />
            <AppSidebar
              nav={dashboardNav(configWithProjects())}
              header={null}
              footer={null}
            />
          </SidebarProvider>
        </TooltipProvider>
      </NextIntlClientProvider>,
    );

    // 抽屉关着时导轨不在 DOM 里，只有触发器能匹配。
    const trigger = screen.getByRole("button", { name: "[de] Toggle sidebar" });
    expect(trigger.dataset.slot).toBe("sidebar-trigger");
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "[de] Sidebar" })).toBeDefined();
    expect(screen.getByText("[de] Displays the mobile sidebar.")).toBeDefined();
    // 抽屉打开后 popup 之外的内容对辅助技术不可见，此时按名字取到的就是抽屉里的导轨
    //（`SidebarRail`，`AppSidebar` 自己传的 label）。
    expect(
      screen.getByRole("button", { name: "[de] Toggle sidebar" }).dataset.slot,
    ).toBe("sidebar-rail");
  });
});
