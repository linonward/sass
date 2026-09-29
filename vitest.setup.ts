import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Without vitest globals, Testing Library doesn't clean up automatically; if components aren't
// unmounted, React may keep scheduling updates after jsdom is torn down and throw
// "window is not defined".
afterEach(() => {
  cleanup();
});
