import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has no ResizeObserver; Recharts' ResponsiveContainer needs one to mount.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserverStub, writable: true });
}

afterEach(() => {
  cleanup();
  document.cookie = "sa_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});
