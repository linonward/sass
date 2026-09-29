import { act, fireEvent, screen } from "@testing-library/react";

/**
 * Drives `@/core/ui/select` in jsdom for component tests.
 *
 * It is not a native select: there is no `.value` / `.options`, options only render
 * while the popup is open, and the value lives in the hidden input named by `name`
 * (so `FormData` sees it). Options only react to a full pointer sequence — a lone
 * `click` does not select.
 */
export async function chooseOption(trigger: HTMLElement, label: string) {
  await act(async () => {
    fireEvent.click(trigger);
  });
  const option = screen
    .getAllByRole("option")
    .find((element) => element.textContent === label);
  if (!option) throw new Error(`No option labeled: ${label}`);
  await act(async () => {
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.mouseDown(option);
    fireEvent.pointerUp(option, { pointerType: "mouse" });
    fireEvent.mouseUp(option);
    fireEvent.click(option);
  });
}

/** Opens the select and returns each option's text, then closes it without changing the value. */
export async function optionLabels(trigger: HTMLElement) {
  await act(async () => {
    fireEvent.click(trigger);
  });
  const labels = screen
    .getAllByRole("option")
    .map((element) => element.textContent);
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? trigger, { key: "Escape" });
  });
  return labels;
}

/** The value a select would submit: reads the hidden input named `name`. */
export function selectedValue(container: HTMLElement, name: string) {
  const input = container.querySelector<HTMLInputElement>(
    `input[name="${name}"]`,
  );
  if (!input) throw new Error(`No field named: ${name}`);
  return input.value;
}
