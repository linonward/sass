import {
  expect,
  type FileChooser,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

import messages from "../messages/en.json";
import { signIn, uniqueEmail, useRandomIp } from "./auth-helpers";

const u = messages.Upload;

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

// CI has no R2, so the upload API is faked at the network layer: presign returns a same-origin
// PUT URL (a cross-origin one would be blocked by the CSP's connect-src before routing), and
// complete confirms. This covers the field's behavior; the real R2 round trip is verified on a
// deployment with R2 configured.
const PUT_URL = "/e2e-fake-r2/put";

async function fakeUploadApi(page: Page, { holdPut = false } = {}) {
  const seen = { presign: 0, put: 0, complete: 0 };
  await page.route("**/api/upload/presign", async (route) => {
    seen.presign++;
    await route.fulfill({
      json: { fileId: "file_e2e", uploadUrl: PUT_URL, headers: {} },
    });
  });
  await page.route(`**${PUT_URL}`, async (route) => {
    seen.put++;
    // A held PUT never answers, so the test can cancel it mid-flight.
    if (!holdPut) await route.fulfill({ status: 200, body: "" });
  });
  await page.route("**/api/upload/complete", async (route) => {
    seen.complete++;
    await route.fulfill({
      json: {
        file: {
          id: "file_e2e",
          key: "user/2026-09/file_e2e.png",
          url: "/api/upload/files/file_e2e",
        },
      },
    });
  });
  return seen;
}

const png = {
  name: "photo.png",
  mimeType: "image/png",
  // 1×1 transparent PNG.
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
};

/**
 * Opens the file chooser from the drop zone, by keyboard or by click. Before hydration the button
 * has no handler and nothing opens, so retry until a chooser really appears. Every step is bounded
 * (see openUserMenu in auth-helpers.ts): one unbounded wait would burn the whole toPass budget.
 */
async function openChooser(
  page: Page,
  zone: Locator,
  via: "keyboard" | "click",
): Promise<FileChooser> {
  let chooser: FileChooser | undefined;
  await expect(async () => {
    const opened = page.waitForEvent("filechooser", { timeout: 1000 });
    if (via === "keyboard") {
      await zone.focus({ timeout: 1000 });
      await page.keyboard.press("Enter");
    } else {
      await zone.click({ timeout: 1000 });
    }
    chooser = await opened;
  }).toPass({ timeout: 15_000 });
  return chooser!;
}

async function openDashboard(page: Page) {
  await signIn(page, uniqueEmail("upload"));
  await expect(page).toHaveURL("/onboarding");
  await page.goto("/dashboard");
  return page.getByRole("button", { name: new RegExp(u.choose) });
}

test("choosing a file with the keyboard uploads it and links the result", async ({
  page,
}) => {
  const seen = await fakeUploadApi(page);
  const zone = await openDashboard(page);

  await (await openChooser(page, zone, "keyboard")).setFiles(png);

  await expect(page.getByRole("status")).toHaveText(
    u.done.replace("{name}", png.name),
  );
  await expect(page.getByRole("link", { name: png.name })).toHaveAttribute(
    "href",
    "/api/upload/files/file_e2e",
  );
  expect(seen).toEqual({ presign: 1, put: 1, complete: 1 });
});

test("a disallowed file type is rejected before any request", async ({
  page,
}) => {
  const seen = await fakeUploadApi(page);
  const zone = await openDashboard(page);

  await (
    await openChooser(page, zone, "click")
  ).setFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });

  // Filtered by text: Next's route announcer is also role="alert".
  await expect(
    page.getByRole("alert").filter({ hasText: u.errors.invalid_type }),
  ).toBeVisible();
  expect(seen.presign).toBe(0);
});

test("canceling mid-upload never confirms the file", async ({ page }) => {
  const seen = await fakeUploadApi(page, { holdPut: true });
  const zone = await openDashboard(page);

  await (await openChooser(page, zone, "click")).setFiles(png);

  await expect(page.getByRole("status")).toHaveText(
    u.uploading.replace("{name}", png.name),
  );
  await page.getByRole("button", { name: u.cancel }).click();

  await expect(page.getByRole("status")).toHaveText(u.canceled);
  // The drop zone is back so another file can be chosen.
  await expect(zone).toBeVisible();
  expect(seen.put).toBe(1);
  expect(seen.complete).toBe(0);
});
