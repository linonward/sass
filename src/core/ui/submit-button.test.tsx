import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { SubmitButton } from "./submit-button";

describe("SubmitButton", () => {
  test("is a submit button showing its label when idle", () => {
    render(<SubmitButton pendingLabel="Saving…">Save</SubmitButton>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("type")).toBe("submit");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  test("an explicit pending disables it and swaps the label", () => {
    render(
      <SubmitButton pending pendingLabel="Saving…">
        Save
      </SubmitButton>,
    );
    const button = screen.getByRole("button", { name: "Saving…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  test("keeps its label while pending when no pendingLabel is given", () => {
    render(<SubmitButton pending>Save</SubmitButton>);
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  test("follows the form action's pending state via useFormStatus", async () => {
    let finish!: () => void;
    const action = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    render(
      <form action={action}>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </form>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(
      (screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(async () => finish());
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
  });
});
