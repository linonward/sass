import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// 未开启 vitest globals 时 Testing Library 不会自动清理；
// 不卸载的话，React 可能在 jsdom 销毁后继续调度更新，报 "window is not defined"。
afterEach(() => {
  cleanup();
});
