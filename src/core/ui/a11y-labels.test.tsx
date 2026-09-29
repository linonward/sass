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
 * Accessible names of UI primitives are always passed in by the caller; primitives keep only an
 * English fallback.
 *
 * Why this contract exists: `sr-only` text, `aria-label` and `title` are all read aloud by screen
 * readers or shown on hover. Hard-coded in the primitive, a buyer could neither translate nor
 * override them. This locks both sides of "default + overridable": when nothing is passed the
 * behavior is unchanged (English); when a value is passed, that is what gets read.
 */

/** jsdom renders as desktop by default (the `useIsMobile` media query doesn't match). */
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

/** Opens the mobile sheet (on mobile `Sidebar` renders a Sheet, closed by default). */
function openMobileDrawer(labels?: SidebarLabels) {
  setMobile(true);
  renderSidebar(labels);
  fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
  return screen.getByRole("dialog");
}

describe("Sidebar mobile sheet", () => {
  test("falls back to English when labels are omitted", () => {
    const drawer = openMobileDrawer();
    expect(drawer.getAttribute("aria-labelledby")).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Sidebar" })).toBe(drawer);
    expect(
      within(drawer).getByText("Displays the mobile sidebar."),
    ).toBeDefined();
  });

  test("labels override the title and description", () => {
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

  test("passing only one field keeps the fallback for the other", () => {
    const drawer = openMobileDrawer({ title: "Seitenleiste" });
    expect(screen.getByRole("dialog", { name: "Seitenleiste" })).toBeDefined();
    expect(
      within(drawer).getByText("Displays the mobile sidebar."),
    ).toBeDefined();
  });
});

describe("SidebarTrigger", () => {
  test("the default accessible name is the English fallback", () => {
    setMobile(false);
    renderSidebar();
    expect(
      screen.getByRole("button", { name: "Toggle sidebar" }),
    ).toBeDefined();
  });

  test("label overrides the accessible name", () => {
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

  test("an explicit aria-label wins over label", () => {
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
  test("default aria-label and title are both English fallbacks", () => {
    render(
      <SidebarProvider>
        <SidebarRail />
      </SidebarProvider>,
    );
    const rail = screen.getByRole("button", { name: "Toggle sidebar" });
    expect(rail.getAttribute("title")).toBe("Toggle sidebar");
  });

  test("label overrides both aria-label and title", () => {
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

  test("an explicit aria-label / title can still override each separately", () => {
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

describe("SheetContent close button", () => {
  test("the default accessible name is Close", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Menu</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeDefined();
  });

  test("closeLabel overrides the accessible name", () => {
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

describe("Dialog close button", () => {
  test("the default accessible name is Close", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Delete account</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeDefined();
  });

  test("closeLabel overrides the accessible name", () => {
    render(
      <Dialog open>
        <DialogContent closeLabel="Schließen">
          <DialogTitle>Delete account</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Schließen" })).toBeDefined();
  });

  test("DialogFooter's showCloseButton uses the same closeLabel", () => {
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
