import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Label } from "./label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { chooseOption, selectedValue } from "./testing";

const fruits = [
  { value: "apple", label: "Apple" },
  { value: "pear", label: "Pear" },
];

function Fruit({ defaultValue = "apple" }: { defaultValue?: string }) {
  return (
    <form data-testid="form">
      <Label htmlFor="fruit">Fruit</Label>
      <Select
        id="fruit"
        name="fruit"
        defaultValue={defaultValue}
        items={fruits}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fruits.map((fruit) => (
            <SelectItem key={fruit.value} value={fruit.value}>
              {fruit.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </form>
  );
}

/**
 * Locks what must still hold after replacing native selects: an existing
 * `<Label htmlFor>` still names it, `name` still submits with the form, and the
 * styling follows docs/design.md.
 */
describe("Select", () => {
  test("an existing Label htmlFor names the trigger", () => {
    render(<Fruit />);
    const trigger = screen.getByLabelText("Fruit");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("role")).toBe("combobox");
  });

  test("the trigger shows the selected label, not the raw value", () => {
    render(<Fruit defaultValue="pear" />);
    // Exact match: Icon's default "▼" must not leak into the trigger text.
    expect(screen.getByLabelText("Fruit").textContent).toBe("Pear");
  });

  test("name submits with the form and follows the selection", async () => {
    render(<Fruit />);
    const form = screen.getByTestId("form") as HTMLFormElement;
    expect(new FormData(form).get("fruit")).toBe("apple");

    await chooseOption(screen.getByLabelText("Fruit"), "Pear");
    expect(new FormData(form).get("fruit")).toBe("pear");
    expect(selectedValue(form, "fruit")).toBe("pear");
  });

  test("the popup is a sticker surface with no blurred shadow", async () => {
    render(<Fruit />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Fruit"));
    });
    const popup = document.querySelector('[data-slot="select-content"]')!;
    expect(popup.className).toContain("sticker");
    expect(popup.className).not.toMatch(/\bshadow-(sm|md|lg|xl)\b/);
  });

  test("the trigger uses the --border hairline, not near-white --input", () => {
    render(<Fruit />);
    const className = screen.getByLabelText("Fruit").className;
    expect(className).toContain("border-border");
    expect(className).not.toContain("border-input");
  });
});
