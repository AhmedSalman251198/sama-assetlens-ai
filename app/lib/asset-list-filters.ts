export type AssetListFilters = {
  project: string;
  building: string;
  floor: string;
  zone: string;
  status: string;
  workflow: string;
  criticality: string;
  condition: string;
  category: string;
  operationalStatus: string;
  search: string;
};

export const EMPTY_ASSET_LIST_FILTERS: AssetListFilters = {
  project: "",
  building: "",
  floor: "",
  zone: "",
  status: "",
  workflow: "",
  criticality: "",
  condition: "",
  category: "",
  operationalStatus: "",
  search: "",
};

export function parseAssetListFilters(params: URLSearchParams) {
  const value = (key: keyof AssetListFilters, max = 100) =>
    (params.get(key) || "").trim().slice(0, max);
  const status = value("status", 20);
  const workflow = value("workflow", 20);
  const rating = (key: "criticality" | "condition") => {
    const candidate = value(key, 1);
    return /^[1-5]$/.test(candidate) ? candidate : "";
  };
  return {
    project: value("project"),
    building: value("building"),
    floor: value("floor"),
    zone: value("zone"),
    status: ["queued", "processing", "completed", "review", "failed"].includes(status)
      ? status
      : "",
    workflow: workflow === "active" ? workflow : "",
    criticality: rating("criticality"),
    condition: rating("condition"),
    category: value("category"),
    operationalStatus: value("operationalStatus", 40),
    search: value("search", 80),
  } satisfies AssetListFilters;
}

export function assetListHref(
  scope: Partial<AssetListFilters>,
  extra: Partial<AssetListFilters> = {},
) {
  const params = new URLSearchParams();
  Object.entries({ ...scope, ...extra }).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return `/locations${params.size ? `?${params.toString()}` : ""}`;
}
