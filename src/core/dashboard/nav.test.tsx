import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, test, vi } from "vitest";

import messages from "../../../messages/en.json";
import { defineConfig, type SiteConfigInput } from "../config/schema";
import { SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { AppSidebar } from "./app-sidebar";
import { initials } from "./user-menu";
import { dashboardNav, isActiveNav, suiteNav } from "./nav";

import siteConfig from "../../../site.config";

let pathname = "/dashboard";
vi.mock("@/core/i18n/navigation", () => ({
  usePathname: () => pathname,
  Link: ({ href, ...props }: { href: string } & Record<string, unknown>) => (
    <a href={href} {...props} />
  ),
}));

beforeAll(() => {
  // jsdom 没有 matchMedia；按桌面端渲染。
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

/** 模拟业务项目在 site.config.ts 里加了一项 dashboard.nav。 */
function configWithProjects() {
  return defineConfig({
    ...(siteConfig as SiteConfigInput),
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
