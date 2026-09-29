import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Button } from "./button";
import {
  ConfirmActionDialog,
  confirmTextMatches,
  type ConfirmActionResult,
} from "./confirm-action-dialog";

type Action = (form: FormData) => Promise<ConfirmActionResult<"nope">>;

function renderDialog({
  action,
  onSuccess,
  confirmText,
  tone,
}: {
  action: Action;
  onSuccess?: () => void;
  confirmText?: { label: string; expected: string };
  tone?: "default" | "destructive";
}) {
  return render(
    <ConfirmActionDialog
      trigger={<Button>Delete project</Button>}
      title="Delete Apollo?"
      description="This can't be undone."
      tone={tone}
      confirmText={confirmText}
      fields={{ id: "p1" }}
      confirmLabel="Delete"
      pendingLabel="Deleting…"
      cancelLabel="Cancel"
      action={action}
      errorMessage={(error) => `Failed: ${error}`}
      onSuccess={onSuccess}
    />,
  );
}

const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
const confirm = () => screen.getByRole("button", { name: "Delete" });
const dialog = () => screen.queryByRole("alertdialog");

describe("confirmTextMatches", () => {
  test("ignores surrounding spaces and case", () => {
    expect(confirmTextMatches("  Ada@Example.com ", "ada@example.com")).toBe(
      true,
    );
    expect(confirmTextMatches("ada@example.co", "ada@example.com")).toBe(false);
  });
});

describe("ConfirmActionDialog", () => {
  test("opens as an alert dialog named by its title", () => {
    renderDialog({ action: vi.fn() });
    open();
    expect(
      screen.getByRole("alertdialog", { name: "Delete Apollo?" }),
    ).toBeDefined();
  });

  test("tone sets the confirm button's variant", () => {
    const { unmount } = renderDialog({ action: vi.fn(), tone: "destructive" });
    open();
    expect(confirm().className).toContain("destructive");
    unmount();
    renderDialog({ action: vi.fn() });
    open();
    expect(confirm().className).not.toContain("bg-destructive");
  });

  test("success closes it, then calls onSuccess with the fields submitted", async () => {
    const action = vi.fn<Action>().mockResolvedValue({ status: "success" });
    const onSuccess = vi.fn();
    renderDialog({ action, onSuccess });
    open();
    fireEvent.click(confirm());

    await waitFor(() => expect(dialog()).toBeNull());
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(action.mock.calls[0]![0].get("id")).toBe("p1");
  });

  test("an error keeps it open with the message", async () => {
    const onSuccess = vi.fn();
    renderDialog({
      action: vi.fn<Action>().mockResolvedValue({
        status: "error",
        error: "nope",
      }),
      onSuccess,
    });
    open();
    fireEvent.click(confirm());

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Failed: nope"),
    );
    expect(dialog()).not.toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test("the confirm button waits for matching text, trimmed and case-insensitive", () => {
    renderDialog({
      action: vi.fn(),
      confirmText: { label: "Type the email", expected: "ada@example.com" },
    });
    open();
    const input = screen.getByLabelText("Type the email");

    expect((confirm() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "someone@example.com" } });
    expect((confirm() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: " ADA@example.com " } });
    expect((confirm() as HTMLButtonElement).disabled).toBe(false);
  });

  test("a failed attempt keeps the typed text and sends it as `confirm`", async () => {
    const action = vi
      .fn<Action>()
      .mockResolvedValue({ status: "error", error: "nope" });
    renderDialog({
      action,
      confirmText: { label: "Type the email", expected: "ada@example.com" },
    });
    open();
    fireEvent.change(screen.getByLabelText("Type the email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(confirm());

    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(
      (screen.getByLabelText("Type the email") as HTMLInputElement).value,
    ).toBe("ada@example.com");
    expect(action.mock.calls[0]![0].get("confirm")).toBe("ada@example.com");
  });

  test("closing resets it: no leftover error or typed text on reopen", async () => {
    renderDialog({
      action: vi
        .fn<Action>()
        .mockResolvedValue({ status: "error", error: "nope" }),
      confirmText: { label: "Type the email", expected: "ada@example.com" },
    });
    open();
    fireEvent.change(screen.getByLabelText("Type the email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(confirm());
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(dialog()).toBeNull());

    open();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByLabelText("Type the email") as HTMLInputElement).value,
    ).toBe("");
  });

  test("while pending the button is disabled and shows the pending label", async () => {
    let finish!: (result: ConfirmActionResult<"nope">) => void;
    renderDialog({
      action: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    open();
    fireEvent.click(confirm());

    const pending = await screen.findByRole("button", { name: "Deleting…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    finish({ status: "success" });
    await waitFor(() => expect(dialog()).toBeNull());
  });
});
