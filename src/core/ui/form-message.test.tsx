import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FormMessage } from "./form-message";

describe("FormMessage", () => {
  test("renders nothing when idle", () => {
    const { container } = render(<FormMessage />);
    expect(container.innerHTML).toBe("");
  });

  test("an error is an alert", () => {
    render(<FormMessage error="Could not save" />);
    expect(screen.getByRole("alert").textContent).toBe("Could not save");
  });

  test("success is a status", () => {
    render(<FormMessage success="Saved" />);
    expect(screen.getByRole("status").textContent).toBe("Saved");
  });

  test("an error wins over success", () => {
    render(<FormMessage error="Could not save" success="Saved" />);
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
