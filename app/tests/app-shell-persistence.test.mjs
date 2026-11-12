import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appSegment = fileURLToPath(new URL("../app/app/", import.meta.url));

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

test("the signed-in shell stays in the shared layout", () => {
  const layout = readFileSync(join(appSegment, "layout.tsx"), "utf8");
  assert.match(layout, /<AppShell>\{children\}<\/AppShell>/);

  const loading = readFileSync(join(appSegment, "loading.tsx"), "utf8");
  assert.doesNotMatch(loading, /<header[\s>]/);
  assert.match(loading, /role="status"/);
  assert.doesNotMatch(loading, /["']use client["']/);

  const pages = walk(appSegment).filter((path) => path.endsWith("/page.tsx"));
  assert.ok(pages.length >= 10);
  for (const page of pages) {
    assert.doesNotMatch(readFileSync(page, "utf8"), /AppShell/, page);
  }
});

test("activity and placeholder bodies do not mount another shell", () => {
  const activity = readFileSync(fileURLToPath(new URL("../components/portfolio/activity-timeline.tsx", import.meta.url)), "utf8");
  const placeholder = readFileSync(fileURLToPath(new URL("../components/shell/page-placeholder.tsx", import.meta.url)), "utf8");
  assert.doesNotMatch(activity, /AppShell/);
  assert.doesNotMatch(placeholder, /AppShell/);
});
