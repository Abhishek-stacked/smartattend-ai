import type { APIResponse } from "@playwright/test";
import { test as base } from "playwright-bdd";

export type ApiStepState = {
  response?: APIResponse;
};

// Per-scenario state for the steps that assert on one API answer across several
// Then steps. The step signature names the fixture, the playwright-bdd
// generator picks it up and the generated spec imports this test instance, so
// every scenario gets a fresh object and nothing leaks between parallel tests.
export const test = base.extend<{ api: ApiStepState }>({
  api: async ({}, use) => {
    await use({});
  },
});
