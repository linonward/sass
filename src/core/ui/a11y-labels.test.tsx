import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./dialog";
import { Sheet, SheetContent, SheetTitle } from "./sheet";
import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  type SidebarLabels,
} from "./sidebar";

/**
 * UI 原语的可访问名一律由调用方传入，原语只留英文兜底值。
 *
 * 为什么要有这条契约：`sr-only` 文本、`aria-label`、`title` 都是读屏/悬停会念出来的
 * 文案，写死在原语里买家就没法翻译，也盖不住。这里锁的是「默认值 + 可覆盖」两面：
 * 兜底值不传时行为不变（英文），传了就按传的念。
 */

/** jsdom 默认按桌面端渲染（`useIsMobile` 的媒体查询不匹配）。 */
function setMobile(isMobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isMobile && query.includes("max-width"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function renderSidebar(labels?: SidebarLabels) {
  return render(
    <SidebarProvider>
      <SidebarTrigger />
      <Sidebar labels={labels}>
        <span>content</span>
      </Sidebar>
    </SidebarProvider>,
  );
}

/** 打开移动端抽屉（移动端 `Sidebar` 渲染的是 Sheet，默认关着）。 */
function openMobileDrawer(labels?: SidebarLabels) {
  setMobile(true);
  renderSidebar(labels);
  fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
  return screen.getByRole("dialog");
}

describe("Sidebar 的移动端抽屉", () => {
  test("不传 labels 时是英文兜底值", () => {
    const drawer = openMobileDrawer();
    expect(drawer.getAttribute("aria-labelledby")).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Sidebar" })).toBe(drawer);
    expect(
      within(drawer).getByText("Displays the mobile sidebar."),
    ).toBeDefined();
  });

  test("labels 覆盖标题与描述", () => {
    const drawer = openMobileDrawer({
      title: "[de] Sidebar",
      description: "[de] Displays the mobile sidebar.",
    });
    expect(screen.getByRole("dialog", { name: "[de] Sidebar" })).toHaveProperty(
      "role",
      "dialog",
    );
    expect(
      within(drawer).getByText("[de] Displays the mobile sidebar."),
    ).toBeDefined();
  });

  test("只传一个字段时另一个仍用兜底值", () => {
    const drawer = openMobileDrawer({ title: "Seitenleiste" });
    expect(screen.getByRole("dialog", { name: "Seitenleiste" })).toBeDefined();
    expect(
      within(drawer).getByText("Displays the mobile sidebar."),
    ).toBeDefined();
  });
});

describe("SidebarTrigger", () => {
  test("默认可访问名是英文兜底值", () => {
    setMobile(false);
    renderSidebar();
    expect(
      screen.getByRole("button", { name: "Toggle sidebar" }),
    ).toBeDefined();
  });

  test("label 覆盖可访问名", () => {
    setMobile(false);
    render(
      <SidebarProvider>
        <SidebarTrigger label="Seitenleiste umschalten" />
      </SidebarProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Seitenleiste umschalten" }),
    ).toBeDefined();
  });

  test("显式 aria-label 优先于 label", () => {
    setMobile(false);
    render(
      <SidebarProvider>
        <SidebarTrigger label="from-label" aria-label="from-aria-label" />
      </SidebarProvider>,
    );
    expect(
      screen.getByRole("button", { name: "from-aria-label" }),
    ).toBeDefined();
  });
});

describe("SidebarRail", () => {
  test("默认 aria-label 与 title 都是英文兜底值", () => {
    render(
      <SidebarProvider>
        <SidebarRail />
      </SidebarProvider>,
    );
    const rail = screen.getByRole("button", { name: "Toggle sidebar" });
    expect(rail.getAttribute("title")).toBe("Toggle sidebar");
  });

  test("label 同时覆盖 aria-label 与 title", () => {
    render(
      <SidebarProvider>
        <SidebarRail label="Seitenleiste umschalten" />
      </SidebarProvider>,
    );
    const rail = screen.getByRole("button", {
      name: "Seitenleiste umschalten",
    });
    expect(rail.getAttribute("title")).toBe("Seitenleiste umschalten");
  });

  test("显式 aria-label / title 仍可各自覆盖", () => {
    render(
      <SidebarProvider>
        <SidebarRail
          label="from-label"
          aria-label="from-aria-label"
          title="from-title"
        />
      </SidebarProvider>,
    );
    const rail = screen.getByRole("button", { name: "from-aria-label" });
    expect(rail.getAttribute("title")).toBe("from-title");
  });
});

describe("SheetContent 的关闭按钮", () => {
  test("默认可访问名是 Close", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Menu</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeDefined();
  });

  test("closeLabel 覆盖可访问名", () => {
    render(
      <Sheet open>
        <SheetContent closeLabel="Schließen">
          <SheetTitle>Menu</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "Schließen" })).toBeDefined();
  });
});

describe("Dialog 的关闭按钮", () => {
  test("默认可访问名是 Close", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Delete account</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeDefined();
  });

  test("closeLabel 覆盖可访问名", () => {
    render(
      <Dialog open>
        <DialogContent closeLabel="Schließen">
          <DialogTitle>Delete account</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Schließen" })).toBeDefined();
  });

  test("DialogFooter 的 showCloseButton 用同一个 closeLabel", () => {
    render(
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Delete account</DialogTitle>
          <DialogFooter showCloseButton closeLabel="Schließen" />
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Schließen" })).toBeDefined();
  });
});
