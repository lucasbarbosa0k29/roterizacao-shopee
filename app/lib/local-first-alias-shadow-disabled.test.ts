import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const processRouteSource = readFileSync(
  new URL("../api/process/route.ts", import.meta.url),
  "utf8",
);

test("route processing has no active LocalFirst Alias Shadow integration", () => {
  assert.doesNotMatch(processRouteSource, /local-first-alias-shadow/);
  assert.doesNotMatch(processRouteSource, /runLocalFirstAliasShadow/);
  assert.doesNotMatch(processRouteSource, /localFirstAliasShadow/);
  assert.doesNotMatch(processRouteSource, /ROTTA_LOCAL_FIRST_ALIAS_SHADOW/);
});

test("enabling the legacy Alias Shadow flag cannot reconnect route processing", () => {
  const previous = process.env.ROTTA_LOCAL_FIRST_ALIAS_SHADOW;
  process.env.ROTTA_LOCAL_FIRST_ALIAS_SHADOW = "1";

  try {
    assert.doesNotMatch(processRouteSource, /local-first-alias-shadow/);
    assert.doesNotMatch(processRouteSource, /runLocalFirstAliasShadow/);
  } finally {
    if (previous === undefined) {
      delete process.env.ROTTA_LOCAL_FIRST_ALIAS_SHADOW;
    } else {
      process.env.ROTTA_LOCAL_FIRST_ALIAS_SHADOW = previous;
    }
  }
});

test("main Gemini normalization and per-job single-flight remain connected", () => {
  assert.match(processRouteSource, /async function geminiNormalize\(/);
  assert.match(processRouteSource, /function geminiNormalizeForRun\(/);
  assert.match(processRouteSource, /geminiNormalizeCache: new Map\(\)/);
  assert.match(processRouteSource, /await geminiNormalizeForRun\(/);
  assert.match(processRouteSource, /gemini-normalize-single-flight/);
});
