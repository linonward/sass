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

/** jsdom has no matchMedia. `isMobile` decides whether media queries match; defaults to desktop. */
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

/**
 * Simulates an app project that added one dashboard.nav item in site.config.ts. AI, the example
 * modules, and API keys are pinned off, independent of the demo site's flags (dedicated cases
 * below cover what each looks like when on).
 */
function configWithProjects() {
  return defineConfig({
    ...(siteConfig as SiteConfigInput),
    features: {
      ...siteConfig.features,
      ai: false,
      examples: { invoices: false },
    },
    apiKeys: { enabled: false },
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
  test("kit items come first; app items come from config", () => {
    const nav = dashboardNav(configWithProjects());
    expect(nav.suite).toBe(suiteNav);
    expect(nav.business.map((i) => i.href)).toEqual(["/projects"]);
  });

  test("with features.ai on, Playground follows Dashboard", () => {
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

  test("no Invoices item when features.examples.invoices is off", () => {
    const config = configWithProjects();
    expect(config.features.examples.invoices).toBe(false);
    expect(dashboardNav(config).suite.map((i) => i.href)).not.toContain(
      "/invoices",
    );
  });

  test("with features.examples.invoices on, Invoices follows Playground", () => {
    const base = configWithProjects();
    const invoicesOn = {
      ...base,
      features: { ...base.features, examples: { invoices: true } },
    };
    expect(dashboardNav(invoicesOn).suite.map((i) => i.href)).toEqual([
      "/dashboard",
      "/invoices",
      "/billing",
      "/settings",
    ]);
    // When both are on, Invoices comes after Playground.
    expect(
      dashboardNav({
        ...invoicesOn,
        features: { ...invoicesOn.features, ai: true },
      }).suite.map((i) => i.href),
    ).toEqual([
      "/dashboard",
      "/playground",
      "/invoices",
      "/billing",
      "/settings",
    ]);
  });

  test("no Referrals item when acquisition.referrals is off (factory default)", () => {
    const config = configWithProjects();
    expect(config.acquisition.referrals.enabled).toBe(false);
    expect(dashboardNav(config).suite.map((i) => i.href)).not.toContain(
      "/referrals",
    );
  });

  test("with acquisition.referrals on, Referrals follows Dashboard", () => {
    const base = configWithProjects();
    const nav = dashboardNav({
      ...base,
      acquisition: {
        ...base.acquisition,
        referrals: {
          enabled: true,
          rewards: { inviterCredits: 0, inviteeCredits: 0 },
        },
      },
    });
    expect(nav.suite.map((i) => i.href)).toEqual([
      "/dashboard",
      "/referrals",
      "/billing",
      "/settings",
    ]);
    // When both are on, Referrals comes after Playground.
    expect(
      dashboardNav({
        ...base,
        features: { ...base.features, ai: true },
        acquisition: {
          ...base.acquisition,
          referrals: {
            enabled: true,
            rewards: { inviterCredits: 0, inviteeCredits: 0 },
          },
        },
      }).suite.map((i) => i.href),
    ).toEqual([
      "/dashboard",
      "/playground",
      "/referrals",
      "/billing",
      "/settings",
    ]);
  });

  test("no API keys item when apiKeys is off (factory default)", () => {
    const config = configWithProjects();
    expect(config.apiKeys.enabled).toBe(false);
    expect(dashboardNav(config).suite.map((i) => i.href)).not.toContain(
      "/api-keys",
    );
  });

  test("with apiKeys on, API keys follows Referrals", () => {
    const base = configWithProjects();
    const nav = dashboardNav({
      ...base,
      apiKeys: { enabled: true },
      acquisition: {
        ...base.acquisition,
        referrals: { ...base.acquisition.referrals, enabled: true },
      },
    });
    expect(nav.suite.map((i) => i.href)).toEqual([
      "/dashboard",
      "/referrals",
      "/api-keys",
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

  test("with statusPage on, Status page comes after Metrics (same rule as other optional modules)", () => {
    expect(withStatusPage(true).map((i) => i.href)).toEqual([
      "/admin/metrics",
      "/admin/status",
      "/admin/users",
      "/admin/orders",
      "/admin/exceptions",
      "/admin/subscriptions",
    ]);
  });

  test("no Status page item when statusPage is off (the page 404s, and a link that leads to a 404 only looks broken)", () => {
    expect(withStatusPage(false).map((i) => i.href)).not.toContain(
      "/admin/status",
    );
  });
});

describe("adminNav", () => {
  test("no Flags item when userFlags is off (factory default)", () => {
    const config = defineConfig({
      ...(configWithProjects() as SiteConfigInput),
      statusPage: { enabled: false },
    });
    expect(config.userFlags.enabled).toBe(false);
    expect(adminNav(config).map((i) => i.href)).toEqual([
      "/admin/metrics",
      "/admin/users",
      "/admin/orders",
      "/admin/exceptions",
      "/admin/subscriptions",
    ]);
  });

  test("with userFlags on, Flags follows Metrics", () => {
    const base = configWithProjects();
    const nav = adminNav(
      defineConfig({
        ...(base as SiteConfigInput),
        statusPage: { enabled: false },
        userFlags: { ...base.userFlags, enabled: true },
      }),
    );
    expect(nav.map((i) => i.href)).toEqual([
      "/admin/metrics",
      "/admin/flags",
      "/admin/users",
      "/admin/orders",
      "/admin/exceptions",
      "/admin/subscriptions",
    ]);
  });

  test("with Flags and Acquisition both on, both items are inserted in order after Metrics", () => {
    const base = configWithProjects();
    const nav = adminNav(
      defineConfig({
        ...(base as SiteConfigInput),
        statusPage: { enabled: false },
        userFlags: { ...base.userFlags, enabled: true },
        acquisition: { ...base.acquisition, attribution: { enabled: true } },
      }),
    );
    expect(nav.map((i) => i.href)).toEqual([
      "/admin/metrics",
      "/admin/flags",
      "/admin/acquisition",
      "/admin/users",
      "/admin/orders",
      "/admin/exceptions",
      "/admin/subscriptions",
    ]);
  });
});

describe("AppSidebar", () => {
  test("adding a dashboard.nav item adds it to the sidebar", () => {
    renderSidebar();
    const business = screen.getByRole("list", {
      name: messages.Dashboard.businessNav,
    });
    expect(
      within(business).getByRole("link", { name: "Projects" }),
    ).toHaveProperty("href", expect.stringMatching(/\/projects$/));
  });

  test("does not render the app group when there are no app items", () => {
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

  test("sidebar shows Referrals when the module is on", () => {
    const base = configWithProjects();
    renderSidebar(
      defineConfig({
        ...(base as SiteConfigInput),
        acquisition: {
          ...base.acquisition,
          referrals: {
            enabled: true,
            rewards: { inviterCredits: 0, inviteeCredits: 0 },
          },
        },
      }),
    );
    expect(
      screen.getByRole("link", { name: messages.Dashboard.nav.referrals }),
    ).toHaveProperty("href", expect.stringMatching(/\/referrals$/));
  });

  test("sidebar shows Invoices when the example module is on", () => {
    const base = configWithProjects();
    renderSidebar(
      defineConfig({
        ...(base as SiteConfigInput),
        features: { ...base.features, examples: { invoices: true } },
      }),
    );
    expect(
      screen.getByRole("link", { name: messages.Dashboard.nav.invoices }),
    ).toHaveProperty("href", expect.stringMatching(/\/invoices$/));
  });

  function renderAdminSidebar(openExceptions: number) {
    const admin = adminNav(siteConfig).map((item) =>
      item.key === "adminExceptions"
        ? { ...item, badge: openExceptions }
        : item,
    );
    return render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar
              nav={{ suite: [], business: [], admin }}
              header={null}
              footer={null}
            />
          </SidebarProvider>
        </TooltipProvider>
      </NextIntlClientProvider>,
    );
  }

  test("open exception count shows on Exceptions; the link's accessible name is unchanged", () => {
    renderAdminSidebar(3);
    const badge = screen.getByTestId("nav-badge-adminExceptions");
    expect(badge.textContent).toBe("3");
    expect(badge.getAttribute("aria-label")).toBe("3 open");
    expect(
      screen.getByRole("link", {
        name: messages.Dashboard.nav.adminExceptions,
      }),
    ).toHaveProperty("href", expect.stringMatching(/\/admin\/exceptions$/));
  });

  test("the count disappears once open reaches zero", () => {
    renderAdminSidebar(0);
    expect(screen.queryByTestId("nav-badge-adminExceptions")).toBeNull();
    expect(
      screen.getByRole("link", {
        name: messages.Dashboard.nav.adminExceptions,
      }),
    ).toBeDefined();
  });

  test("highlights the current page's menu item", () => {
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

describe("AppSidebar accessible names", () => {
  /**
   * The sidebar's three accessible names (drawer title/description, trigger, rail) all come from
   * messages; they used to be hard-coded in `src/core/ui/sidebar.tsx`. This renders with
   * pseudo-translated copy: the names only count as wired to i18n if they follow messages, and
   * this turns red if they are hard-coded.
   */
  test("mobile drawer title, description, and rail name all come from messages", () => {
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
            {/* On the site the trigger lives in the shell's top bar (`DashboardShell` passes
                `t("toggleSidebar")`); one is added here to open the drawer. e2e locks the
                shell's path. */}
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

    // While the drawer is closed the rail is not in the DOM, so only the trigger matches.
    const trigger = screen.getByRole("button", { name: "[de] Toggle sidebar" });
    expect(trigger.dataset.slot).toBe("sidebar-trigger");
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "[de] Sidebar" })).toBeDefined();
    expect(screen.getByText("[de] Displays the mobile sidebar.")).toBeDefined();
    // Once the drawer opens, content outside the popup is hidden from assistive technology, so the
    // name now resolves to the rail inside the drawer (`SidebarRail`, with the label `AppSidebar`
    // passes itself).
    expect(
      screen.getByRole("button", { name: "[de] Toggle sidebar" }).dataset.slot,
    ).toBe("sidebar-rail");
  });
});
