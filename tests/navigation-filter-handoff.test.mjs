import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assetListHref,
  parseAssetListFilters,
} from "../app/lib/asset-list-filters.ts";

const source = path => readFile(new URL(path, import.meta.url), "utf8");

test("dashboard drill-down preserves its location scope and selected metric", () => {
  const href = assetListHref(
    { project: "project-1", building: "building-2", floor: "floor-3" },
    { criticality: "5" },
  );
  assert.equal(
    href,
    "/locations?project=project-1&building=building-2&floor=floor-3&criticality=5",
  );
  assert.deepEqual(
    parseAssetListFilters(new URL(href, "https://assetlens.local").searchParams),
    {
      project: "project-1",
      building: "building-2",
      floor: "floor-3",
      zone: "",
      status: "",
      workflow: "",
      criticality: "5",
      condition: "",
      category: "",
      operationalStatus: "",
      search: "",
    },
  );
});

test("invalid URL ratings and workflow states cannot become hidden filters", () => {
  const parsed = parseAssetListFilters(
    new URLSearchParams("criticality=9&condition=x&status=deleted&workflow=all"),
  );
  assert.equal(parsed.criticality, "");
  assert.equal(parsed.condition, "");
  assert.equal(parsed.status, "");
  assert.equal(parsed.workflow, "");
});

test("dashboard cards and criticality legend open filtered asset management", async () => {
  const page = await source("../app/page.tsx");
  assert.match(page, /href: assetListHref\(assetListScope, \{ criticality: "5" \}\)/);
  assert.match(page, /href: assetListHref\(assetListScope, \{ status: "review" \}\)/);
  assert.match(page, /href: assetListHref\(assetListScope, \{ workflow: "active" \}\)/);
  assert.match(page, /<Link className=\{`dashboard-metric/);
  assert.match(page, /CriticalityRadialChart[\s\S]*scope=\{assetListScope\}/);
});

test("organization building view hands project and building to asset management", async () => {
  const page = await source("../app/organization/page.tsx");
  assert.match(
    page,
    /assetListHref\(\{ project: project\.id, building: building\.id \}\)/,
  );
});

test("asset management reads deep-link filters before its first request", async () => {
  const page = await source("../app/locations/page.tsx");
  assert.match(page, /parseAssetListFilters\(new URLSearchParams\(window\.location\.search\)\)/);
  assert.match(page, /setProject\(initial\.project\)/);
  assert.match(page, /setBuilding\(initial\.building\)/);
  assert.match(page, /setFloor\(initial\.floor\)/);
  assert.match(page, /setZone\(initial\.zone\)/);
  assert.match(page, /if \(!routeReady\) return;/);
});

test("asset API applies project hierarchy and active-workflow filters server-side", async () => {
  const route = await source("../app/api/assets/route.ts");
  assert.match(route, /building_id=eq\.\$\{encodeURIComponent\(buildingId\)\}/);
  assert.match(route, /floor_id=eq\.\$\{encodeURIComponent\(floorId\)\}/);
  assert.match(route, /zone_id=eq\.\$\{encodeURIComponent\(zoneId\)\}/);
  assert.match(route, /status=in\.\(queued,processing\)/);
});
