import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("recent stock searches are persisted with deletion controls and a ten-item limit", async () => {
  const [component, dashboard] = await Promise.all([
    readFile(new URL("../app/ui/RecentStockSearches.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/Dashboard.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(component, /window\.localStorage/);
  assert.match(component, /MAX_RECENT_SEARCHES = 10/);
  assert.match(component, /최근 검색어 삭제/);
  assert.match(component, /전체 삭제/);
  assert.match(component, /current\.filter\(\(item\) => item !== value\)/);
  assert.match(dashboard, /<RecentStockSearches latestSearch=\{submitted\}/);
});
