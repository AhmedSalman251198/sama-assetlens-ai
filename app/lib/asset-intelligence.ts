export type IntelligenceField = { key?: string; label?: string; value?: unknown };

export type IntelligenceAsset = {
  id: string;
  assetNo: string;
  projectId: string;
  assetType: string;
  location: string;
  building: string;
  conditionRating: number | null;
  criticalityRating: number | null;
  operationalStatus: string;
  replacementCost: number | null;
  priceCurrency?: string;
  remainingLifeYears: number | null;
  fields: IntelligenceField[];
};

export type AssetDependency = {
  id?: string;
  upstreamAssetId: string;
  downstreamAssetId: string;
  dependencyType: string;
  impact: "unassessed" | "low" | "medium" | "high" | "critical";
  note?: string;
};

export function assetRiskScore(asset: Pick<IntelligenceAsset, "conditionRating" | "criticalityRating">) {
  if (asset.conditionRating == null || asset.criticalityRating == null) return 0;
  const condition = Math.min(5, Math.max(1, Number(asset.conditionRating)));
  const criticality = Math.min(5, Math.max(1, Number(asset.criticalityRating)));
  return (6 - condition) * criticality;
}

export function dependencyImpact(rootAssetId: string, dependencies: AssetDependency[]) {
  const adjacency = new Map<string, AssetDependency[]>();
  for (const edge of dependencies) adjacency.set(edge.upstreamAssetId, [...(adjacency.get(edge.upstreamAssetId) || []), edge]);
  const visited = new Set<string>([rootAssetId]);
  const queue: Array<{ assetId: string; depth: number }> = [{ assetId: rootAssetId, depth: 0 }];
  const impacted: Array<{ assetId: string; depth: number; impact: AssetDependency["impact"]; via: string }> = [];
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    for (const edge of adjacency.get(current.assetId) || []) {
      if (visited.has(edge.downstreamAssetId)) continue;
      visited.add(edge.downstreamAssetId);
      const row = { assetId: edge.downstreamAssetId, depth: current.depth + 1, impact: edge.impact, via: edge.dependencyType };
      impacted.push(row);
      queue.push({ assetId: row.assetId, depth: row.depth });
    }
  }
  return impacted;
}

export function simulateCapitalPlan(assets: IntelligenceAsset[], annualBudget: number, horizonYears = 5) {
  const years = Math.min(20, Math.max(1, Math.trunc(horizonYears)));
  const budget = Math.max(0, Number(annualBudget) || 0);
  const ranked = assets
    .filter(asset => Number(asset.replacementCost) > 0 && asset.conditionRating != null && asset.criticalityRating != null)
    .map(asset => ({ ...asset, riskScore: assetRiskScore(asset), cost: Number(asset.replacementCost) }))
    .sort((left, right) => right.riskScore - left.riskScore || Number(left.remainingLifeYears ?? 999) - Number(right.remainingLifeYears ?? 999) || left.assetNo.localeCompare(right.assetNo));
  const remaining = [...ranked];
  const plan = Array.from({ length: years }, (_, index) => {
    let available = budget;
    const scheduled: typeof ranked = [];
    for (let cursor = 0; cursor < remaining.length;) {
      const candidate = remaining[cursor];
      if (candidate.cost <= available) {
        available -= candidate.cost;
        scheduled.push(candidate);
        remaining.splice(cursor, 1);
      } else cursor += 1;
    }
    return { year: index + 1, budget, spend: budget - available, remaining: available, assets: scheduled };
  });
  return {
    years: plan,
    deferred: remaining,
    totalBudget: budget * years,
    plannedSpend: plan.reduce((sum, year) => sum + year.spend, 0),
    addressedRisk: plan.reduce((sum, year) => sum + year.assets.reduce((risk, asset) => risk + asset.riskScore, 0), 0),
  };
}

function searchable(asset: IntelligenceAsset) {
  return [asset.assetNo, asset.assetType, asset.location, asset.building, asset.operationalStatus, ...asset.fields.flatMap(field => [field.key, field.label, field.value])].join(" ").toLowerCase();
}

export function isTotalAssetCountQuestion(question: string) {
  const query = question.trim().toLowerCase();
  if (!query) return false;
  const qualified = /critical|poor|weak|maintenance|building|floor|zone|type|category|حرج|ضعيف|صيانة|مبنى|طابق|زون|نوع|فئة/.test(query);
  if (qualified) return false;
  const english = /(?:how\s+many|total(?:\s+number)?|number\s+of|count)\s+(?:of\s+)?(?:the\s+)?assets?\b/.test(query)
    || /\bassets?\s+(?:total|count)\b/.test(query);
  const arabic = /(?:كم|ما)\s+(?:هو\s+)?(?:عدد|إجمالي|اجمالي)?\s*(?:الأصول|الاصول|أصل|اصل)/.test(query)
    || /(?:عدد|إجمالي|اجمالي)\s+(?:الأصول|الاصول)/.test(query);
  return english || arabic;
}

export function askAssetLens(question: string, assets: IntelligenceAsset[], language: "ar" | "en" = "en") {
  const query = question.trim().toLowerCase();
  if (isTotalAssetCountQuestion(question)) {
    const summary = language === "ar"
      ? `إجمالي الأصول المسجلة في نطاق المشروع المسموح لك به هو ${assets.length} أصلًا.`
      : `The authorized project register contains ${assets.length} assets in total.`;
    return { summary, matches: assets.slice(0, 50), totalMatches: assets.length, totalRisk: assets.reduce((sum, asset) => sum + assetRiskScore(asset), 0), grounded: true as const };
  }
  let matches = [...assets];
  let filtered = false;
  if (/critical|حرج/.test(query) && !/critical condition|حالة حرجة|high critical|عالي الأهمية/.test(query)) { matches = matches.filter(asset => Number(asset.criticalityRating) === 5); filtered = true; }
  if (/high|عالي/.test(query) && /critical|importance|أهم|أهمية/.test(query)) { matches = matches.filter(asset => Number(asset.criticalityRating) >= 4); filtered = true; }
  if (/poor|ضعيف|critical condition|حالة حرجة/.test(query)) { matches = matches.filter(asset => asset.conditionRating !== null && asset.conditionRating <= 2); filtered = true; }
  if (/maintenance|صيانة/.test(query)) { matches = matches.filter(asset => asset.operationalStatus === "maintenance"); filtered = true; }
  if (/out.?of.?service|متوقف/.test(query)) { matches = matches.filter(asset => asset.operationalStatus === "out_of_service"); filtered = true; }
  const explicitTerms = query.split(/\s+/).filter(term => term.length >= 3 && !/^(show|list|what|which|assets?|the|with|all|total|count|اعرض|اظهر|ماهي|الأصول|الاصول|الأصل|الاصل|أصل|عدد|التي|في)$/.test(term));
  if (!filtered && explicitTerms.length) {
    const lexical = matches.filter(asset => explicitTerms.some(term => searchable(asset).includes(term)));
    matches = lexical;
  }
  matches.sort((left, right) => assetRiskScore(right) - assetRiskScore(left));
  const totalRisk = matches.reduce((sum, asset) => sum + assetRiskScore(asset), 0);
  const summary = language === "ar"
    ? `${matches.length ? `وجدت ${matches.length} أصلًا مطابقًا` : "لم أجد أصلًا مطابقًا للكلمات المحددة"} من أصل ${assets.length}. مجموع درجات المخاطر ${totalRisk}.`
    : `${matches.length ? `Found ${matches.length} matching assets` : "No matching assets found for these search terms"} out of ${assets.length}. Combined risk score: ${totalRisk}.`;
  return { summary, matches: matches.slice(0, 50), totalMatches: matches.length, totalRisk, grounded: true as const };
}

export type AskQueryPlan = {
  assetId?: string;
  building?: string;
  assetType?: string;
  conditionMin?: number;
  conditionMax?: number;
  criticalityMin?: number;
  criticalityMax?: number;
  operationalStatus?: string;
};

export function validateAskQueryPlan(value: unknown, assets: IntelligenceAsset[]): AskQueryPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid query plan.");
  const raw = value as Record<string, unknown>;
  const plan: AskQueryPlan = {};
  if (typeof raw.assetId === "string" && raw.assetId.trim()) {
    const requestedId = raw.assetId.trim();
    const match = assets.find(asset => asset.id === requestedId);
    if (!match) throw new Error("Unknown asset in query plan.");
    plan.assetId = match.id;
  }
  for (const key of ["building", "assetType"] as const) {
    const requested = raw[key];
    if (typeof requested !== "string" || !requested.trim()) continue;
    const found = assets.find(asset => asset[key].toLocaleLowerCase() === requested.trim().toLocaleLowerCase());
    if (!found) throw new Error(`Unknown ${key} in query plan.`);
    plan[key] = found[key];
  }
  for (const key of ["conditionMin", "conditionMax", "criticalityMin", "criticalityMax"] as const) {
    if (raw[key] === undefined || raw[key] === null) continue;
    if (typeof raw[key] !== "number" || !Number.isInteger(raw[key]) || raw[key] < 1 || raw[key] > 5) throw new Error(`Invalid ${key} in query plan.`);
    plan[key] = raw[key];
  }
  if (typeof raw.operationalStatus === "string" && raw.operationalStatus) {
    if (!["unknown", "active", "maintenance", "out_of_service", "transferred", "disposed"].includes(raw.operationalStatus)) throw new Error("Unknown operational status in query plan.");
    plan.operationalStatus = raw.operationalStatus;
  }
  if ((plan.conditionMin || 1) > (plan.conditionMax || 5) || (plan.criticalityMin || 1) > (plan.criticalityMax || 5)) throw new Error("Contradictory query plan.");
  return plan;
}

export function applyAskQueryPlan(assets: IntelligenceAsset[], plan: AskQueryPlan) {
  return assets.filter(asset =>
    (!plan.assetId || asset.id === plan.assetId) &&
    (!plan.building || asset.building === plan.building) &&
    (!plan.assetType || asset.assetType === plan.assetType) &&
    ((plan.conditionMin === undefined && plan.conditionMax === undefined) || (asset.conditionRating !== null && Number(asset.conditionRating) >= (plan.conditionMin || 1) && Number(asset.conditionRating) <= (plan.conditionMax || 5))) &&
    ((plan.criticalityMin === undefined && plan.criticalityMax === undefined) || (asset.criticalityRating !== null && Number(asset.criticalityRating) >= (plan.criticalityMin || 1) && Number(asset.criticalityRating) <= (plan.criticalityMax || 5))) &&
    (!plan.operationalStatus || asset.operationalStatus === plan.operationalStatus)
  );
}

export function askAssetMetrics(assets: IntelligenceAsset[]) {
  const distribution = (key: "assetType" | "building" | "operationalStatus") =>
    Object.entries(assets.reduce<Record<string, number>>((counts, asset) => {
      const name = asset[key] || "Unassigned";
      counts[name] = (counts[name] || 0) + 1;
      return counts;
    }, {})).sort((left, right) => right[1] - left[1]).slice(0, 40).map(([name, count]) => ({ name, count }));
  return {
    total: assets.length,
    combinedRiskScore: assets.reduce((sum, asset) => sum + assetRiskScore(asset), 0),
    condition: [1, 2, 3, 4, 5].map(rating => assets.filter(asset => Number(asset.conditionRating) === rating).length),
    criticality: [1, 2, 3, 4, 5].map(rating => assets.filter(asset => Number(asset.criticalityRating) === rating).length),
    byType: distribution("assetType"), byBuilding: distribution("building"), byOperationalStatus: distribution("operationalStatus"),
    replacementCostCoverage: assets.filter(asset => asset.replacementCost !== null && Number.isFinite(asset.replacementCost)).length,
    knownReplacementCost: assets.reduce((sum, asset) => sum + (asset.replacementCost !== null && Number.isFinite(asset.replacementCost) ? Number(asset.replacementCost) : 0), 0),
  };
}

export function buildDigitalTwin(assets: IntelligenceAsset[]) {
  const buildings = new Map<string, Map<string, IntelligenceAsset[]>>();
  for (const asset of assets) {
    const building = asset.building || "Unassigned";
    const location = asset.location || building;
    const locations = buildings.get(building) || new Map<string, IntelligenceAsset[]>();
    locations.set(location, [...(locations.get(location) || []), asset]);
    buildings.set(building, locations);
  }
  return Array.from(buildings, ([building, locations]) => ({
    building,
    assetCount: Array.from(locations.values()).reduce((sum, rows) => sum + rows.length, 0),
    riskScore: Array.from(locations.values()).flat().reduce((sum, asset) => sum + assetRiskScore(asset), 0),
    locations: Array.from(locations, ([location, rows]) => ({ location, assetCount: rows.length, riskScore: rows.reduce((sum, asset) => sum + assetRiskScore(asset), 0), assets: rows })),
  })).sort((left, right) => right.riskScore - left.riskScore);
}
