import { expect, type Locator } from "@playwright/test";

/**
 * Picks an option in `@/core/ui/select` (Base UI, not a native select, so there is no
 * `selectOption`): open the trigger, click the option by its accessible name, then wait
 * until the trigger shows it.
 */
export async function chooseOption(trigger: Locator, label: string) {
  await trigger.click();
  await trigger
    .page()
    .getByRole("option", { name: label, exact: true })
    .click();
  await expect(trigger).toHaveText(label);
}
