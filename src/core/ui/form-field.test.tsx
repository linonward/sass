import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { FormField } from "./form-field";
import { Input } from "./input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { Textarea } from "./textarea";

/** The ids an element's `aria-describedby` points at, resolved to their text. */
function describedBy(element: HTMLElement) {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent);
}

describe("FormField", () => {
  test("names an Input without ids and leaves it valid when there is no error", () => {
    render(
      <FormField label="Name">
        <Input name="name" />
      </FormField>,
    );
    const input = screen.getByLabelText("Name");
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(describedBy(input)).toEqual([]);
  });

  test("description goes into aria-describedby", () => {
    render(
      <FormField label="Amount" description="Whole credits only">
        <Input name="amount" />
      </FormField>,
    );
    expect(describedBy(screen.getByLabelText("Amount"))).toEqual([
      "Whole credits only",
    ]);
  });

  test("error marks the control invalid and is described after the description", () => {
    render(
      <FormField
        label="Amount"
        description="Whole credits only"
        error="Too big"
      >
        <Input name="amount" />
      </FormField>,
    );
    const input = screen.getByLabelText("Amount");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(input)).toEqual(["Whole credits only", "Too big"]);
  });

  test("a button next to the control doesn't steal the label", () => {
    render(
      <FormField label="Name">
        <div>
          <Input name="name" />
          <Button type="submit">Save</Button>
        </div>
      </FormField>,
    );
    expect(screen.getByLabelText("Name").tagName).toBe("INPUT");
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
  });

  test('labelFor="button" names a Select trigger through aria-labelledby', () => {
    render(
      <FormField label="Status" labelFor="button" error="Pick one">
        <Select
          name="status"
          defaultValue="a"
          items={[{ value: "a", label: "A" }]}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">A</SelectItem>
          </SelectContent>
        </Select>
      </FormField>,
    );
    const trigger = screen.getByRole("combobox", { name: "Status" });
    // A plain-text label: clicking it must not reach the trigger.
    expect(document.querySelector('label[data-slot="label"]')).toBeNull();
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(trigger)).toEqual(["Pick one"]);
  });

  test("Textarea and Checkbox are wired too", () => {
    render(
      <>
        <FormField label="Message" error="Required">
          <Textarea name="message" />
        </FormField>
        <FormField label="Agree">
          <Checkbox name="agree" />
        </FormField>
      </>,
    );
    const textarea = screen.getByLabelText("Message");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "Agree" })).toBeDefined();
  });
});
