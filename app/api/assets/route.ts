import {
  drainAnalysisQueue,
  findDuplicateWarning,
} from "../../lib/server/asset-queue";
import {
  deleteAssetImages,
  requestToken,
  supabaseRest,
  supabaseRestAll,
  supabaseRestWithCount,
  uploadAssetImage,
  verifyAuthUser,
} from "../../lib/server/supabase";
import type { AnalysisResult } from "../../lib/server/analyze-images";
import {
  hasAnyModuleAccess,
  hasModuleAccess,
} from "../../lib/server/module-access";
import { isAssetOperationalStatus } from "../../lib/asset-operational-status";
import { isSuperAdminEmail } from "../../lib/server/super-admin";
import { after } from "next/server";
import { apiErrorResponse } from "../../lib/server/api-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 5;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type AssetRow = {
  id: string;
  asset_no: string;
  project_id: string;
  building_id: string | null;
  floor_id: string | null;
  zone_id: string | null;
  office_id: string | null;
  survey_config_id: string | null;
  created_by: string;
  project_name: string;
  building_name: string;
  floor_name: string;
  zone_name: string;
  office_name: string;
  additional_locations: DynamicLocationValue[];
  surveyor_email: string;
  source_file_names: string[];
  asset_type: string;
  summary: string;
  fields: AnalysisResult["fields"];
  warnings: string[];
  raw_text: string;
  overall_confidence: number;
  condition_rating: number | null;
  condition_justification: string;
  criticality_rating: number | null;
  status: string;
  error: string | null;
  created_at: string;
  category_id: string | null;
  operational_status: string;
  estimated_price: number | null;
  replacement_cost: number | null;
  price_currency: string;
  useful_life_years: number | null;
  installation_date: string | null;
  remaining_life_years: number | null;
  estimate_source: string;
  estimate_confidence: string;
  enrichment_data: Record<string, unknown>;
  enrichment_source_url: string;
  enrichment_fetched_at: string | null;
  archived_at: string | null;
};
type JobRow = {
  id: string;
  asset_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  error: string | null;
  created_at: string;
};
type ProjectRow = {
  id: string;
  name: string;
  require_building: boolean;
  require_floor: boolean;
  require_zone: boolean;
  require_office: boolean;
  allow_manual: boolean;
};
type NamedRow = { id: string; name: string };
type OfficeRow = NamedRow & { floor_id: string | null; zone_id: string | null };
type ZoneRow = NamedRow & { floor_id: string | null };
type DynamicLocationValue = {
  levelId: string;
  key: string;
  labelAr: string;
  labelEn: string;
  valueId: string;
  value: string;
};
type LocationLevelRow = {
  id: string;
  level_key: string;
  label_ar: string;
  label_en: string;
  required: boolean;
  sort_order: number;
  parent_level_id: string | null;
};
type LocationOptionRow = {
  id: string;
  level_id: string;
  building_id: string | null;
  floor_id: string | null;
  zone_id: string | null;
  office_id: string | null;
  parent_option_id: string | null;
  name: string;
};
type SurveyConfigRow = { id: string; project_id: string };
type CustomFieldRow = {
  id: string;
  config_id: string;
  field_key: string;
  label_ar: string;
  label_en: string;
  field_type: "text" | "textarea" | "number" | "date" | "select" | "boolean";
  enabled: boolean;
  required: boolean;
  option_values: unknown;
  sort_order: number;
  asset_types?: string[];
  unit?: string;
  ai_extract?: boolean;
  show_in_reports?: boolean;
  show_in_qr?: boolean;
};
type CustomValueRow = {
  asset_id: string;
  custom_field_id: string;
  value_text: string;
};
type CategoryRow = {
  id: string;
  code: string;
  label_ar: string;
  label_en: string;
  color: string;
  icon: string;
  default_useful_life_years: number | null;
  default_estimated_price: number | null;
  currency: string;
  default_criticality_rating: number | null;
  technical_fields: string[];
  active: boolean;
};
type RelationshipAssetRow = {
  id: string;
  asset_no: string;
  asset_type: string;
  project_id: string;
  building_id: string | null;
  building_name: string;
  floor_name: string;
  zone_name: string;
  office_name: string;
};
type PreliminaryRelationship = {
  enabled: boolean;
  relatedAssetId: string;
  currentAssetRole: "parent" | "child";
};
type RelationshipSummaryRow = {
  upstream_asset_id: string;
  downstream_asset_id: string;
  dependency_type: string;
  impact: string;
};

const ASSET_SELECT =
  "id,asset_no,project_id,building_id,floor_id,zone_id,office_id,survey_config_id,created_by,project_name,building_name,floor_name,zone_name,office_name,additional_locations,surveyor_email,source_file_names,asset_type,summary,fields,warnings,raw_text,overall_confidence,condition_rating,condition_justification,criticality_rating,status,error,created_at,category_id,operational_status,estimated_price,replacement_cost,price_currency,useful_life_years,installation_date,remaining_life_years,estimate_source,estimate_confidence,enrichment_data,enrichment_source_url,enrichment_fetched_at,archived_at";

function mapResult(asset: AssetRow): AnalysisResult {
  return {
    assetType: asset.asset_type,
    summary: asset.summary,
    fields: asset.fields || [],
    warnings: asset.warnings || [],
    rawText: asset.raw_text,
    overallConfidence: Number(asset.overall_confidence) || 0,
    conditionRating: asset.condition_rating,
    conditionJustification: asset.condition_justification || "",
    criticalityRating: asset.criticality_rating,
  };
}

function surveyContext(asset: AssetRow) {
  return {
    projectId: asset.project_id,
    project: asset.project_name,
    buildingId: asset.building_id || "",
    building: asset.building_name,
    floorId: asset.floor_id || "",
    floor: asset.floor_name,
    zoneId: asset.zone_id || "",
    zone: asset.zone_name,
    officeId: asset.office_id || "",
    office: asset.office_name,
    additionalLocations: Array.isArray(asset.additional_locations)
      ? asset.additional_locations
      : [],
    categoryId: asset.category_id || "",
    conditionRating: asset.condition_rating,
    conditionJustification: asset.condition_justification || "",
    criticalityRating: asset.criticality_rating,
    operationalStatus: asset.operational_status || "active",
    estimatedPrice:
      asset.estimated_price == null ? null : Number(asset.estimated_price),
    replacementCost:
      asset.replacement_cost == null ? null : Number(asset.replacement_cost),
    priceCurrency: asset.price_currency || "AED",
    usefulLifeYears:
      asset.useful_life_years == null ? null : Number(asset.useful_life_years),
    installationDate: asset.installation_date || "",
    remainingLifeYears:
      asset.remaining_life_years == null
        ? null
        : Number(asset.remaining_life_years),
    estimateSource: asset.estimate_source || "",
    surveyorEmail: asset.surveyor_email,
  };
}

function canEditAsset(role: string, ownerId: string, viewerId: string) {
  return (
    role === "admin" ||
    role === "project_manager" ||
    role === "reviewer" ||
    (role === "surveyor" && ownerId === viewerId)
  );
}

function canTransferAsset(role: string, ownerId: string, viewerId: string) {
  return (
    role === "admin" ||
    role === "project_manager" ||
    (role === "surveyor" && ownerId === viewerId)
  );
}

function canDeleteAsset(role: string, ownerId: string, viewerId: string) {
  return role === "admin" || (role === "surveyor" && ownerId === viewerId);
}

function mapWorkspace(
  assets: AssetRow[],
  jobs: JobRow[],
  customFields: CustomFieldRow[],
  customValues: CustomValueRow[],
  viewerId: string,
  viewerRole: string,
) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const fieldsById = new Map(customFields.map((field) => [field.id, field]));
  const valuesByAsset = new Map<string, CustomValueRow[]>();
  for (const value of customValues)
    valuesByAsset.set(value.asset_id, [
      ...(valuesByAsset.get(value.asset_id) || []),
      value,
    ]);
  const valuesFor = (assetId: string) =>
    (valuesByAsset.get(assetId) || [])
      .map((value) => {
        const field = fieldsById.get(value.custom_field_id);
        return field
          ? {
              key: field.field_key,
              labelAr: field.label_ar,
              labelEn: field.label_en,
              value: value.value_text,
              unit: field.unit || "",
            }
          : null;
      })
      .filter(Boolean);
  const records = assets
    .filter(
      (asset) => asset.status === "completed" || asset.status === "review",
    )
    .map((asset) => ({
      ...mapResult(asset),
      id: asset.id,
      assetNo: asset.asset_no,
      createdAt: asset.created_at,
      fileName: asset.source_file_names.join(" | "),
      surveyContext: surveyContext(asset),
      canEdit: canEditAsset(viewerRole, asset.created_by, viewerId),
      status: asset.status,
      customValues: valuesFor(asset.id),
      isDuplicate: (asset.warnings || []).some((warning) =>
        warning.startsWith("Duplicate serial detected:"),
      ),
    }));
  const queue = jobs
    .map((job, index) => {
      const asset = byId.get(job.asset_id);
      if (!asset) return null;
      if (job.status === "completed" && asset.status === "completed")
        return null;
      return {
        id: job.id,
        assetId: asset.id,
        order: index + 1,
        imageCount: asset.source_file_names.length,
        fileName: asset.source_file_names.join(" | "),
        createdAt: job.created_at,
        status: job.status,
        surveyContext: surveyContext(asset),
        customValues: valuesFor(asset.id),
        result: job.status === "completed" ? mapResult(asset) : undefined,
        error: job.error || asset.error || undefined,
      };
    })
    .filter(Boolean);
  return { records, jobs: queue };
}

async function workspace(token: string, viewerId: string) {
  const profileRows = await supabaseRest<
    Array<{ id: string; role: string; email: string }>
  >(
    `app_users?select=id,role,email&user_id=eq.${encodeURIComponent(viewerId)}&active=eq.true&limit=1`,
    token,
  );
  const profile = profileRows[0];
  if (!profile) return { records: [], jobs: [] };

  let projectFilter = "";
  if (!isSuperAdminEmail(profile.email)) {
    const assignments = await supabaseRest<Array<{ project_id: string }>>(
      `user_projects?select=project_id&app_user_id=eq.${encodeURIComponent(profile.id)}`,
      token,
    );
    const assignedIds = assignments.map((a) => a.project_id);
    if (assignedIds.length === 0) return { records: [], jobs: [] };
    projectFilter = `project_id=in.(${assignedIds.map(encodeURIComponent).join(",")})`;
  }

  const recentQueueCutoff = encodeURIComponent(
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  );
  const [assets, jobs, customFields, customValues] = await Promise.all([
    supabaseRest<AssetRow[]>(
      `assets?select=${ASSET_SELECT}&${projectFilter}&order=created_at.desc&limit=5000`,
      token,
    ),
    supabaseRest<JobRow[]>(
      `analysis_jobs?select=id,asset_id,status,error,created_at&created_at=gte.${recentQueueCutoff}&order=created_at.asc&limit=100`,
      token,
    ),
    supabaseRest<CustomFieldRow[]>(
      "custom_fields?select=id,config_id,field_key,label_ar,label_en,field_type,enabled,required,option_values,sort_order&order=sort_order&limit=10000",
      token,
    ),
    supabaseRest<CustomValueRow[]>(
      "asset_custom_values?select=asset_id,custom_field_id,value_text&limit=10000",
      token,
    ),
  ]);

  // For jobs, we need to ensure the underlying asset is actually accessible
  const accessibleAssetIds = new Set(assets.map((a) => a.id));
  const filteredJobs = jobs.filter((j) => accessibleAssetIds.has(j.asset_id));

  return mapWorkspace(
    assets,
    filteredJobs,
    customFields,
    customValues,
    viewerId,
    profile.role,
  );
}

async function relationshipOptions(request: Request, token: string) {
  const params = new URL(request.url).searchParams;
  const projectId = text(params.get("project"), 80);
  const buildingId = text(params.get("building"), 80);
  const search = text(params.get("search"), 80)
    .replace(/[,*()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!projectId || !buildingId)
    throw new Error(
      "Choose a registered project and building before linking assets.",
    );
  const projects = await supabaseRest<Array<{ id: string }>>(
    `projects?select=id&id=eq.${encodeURIComponent(projectId)}&active=eq.true&limit=1`,
    token,
  );
  if (!projects[0])
    throw new Error("The selected project is unavailable for this account.");
  const buildings = await supabaseRest<Array<{ id: string }>>(
    `buildings?select=id&id=eq.${encodeURIComponent(buildingId)}&project_id=eq.${encodeURIComponent(projectId)}&active=eq.true&limit=1`,
    token,
  );
  if (!buildings[0])
    throw new Error("The selected building is unavailable for this account.");
  const searchFilter = search
    ? `&or=${encodeURIComponent(`(asset_no.ilike.*${search}*,asset_type.ilike.*${search}*,floor_name.ilike.*${search}*,zone_name.ilike.*${search}*,office_name.ilike.*${search}*)`)}`
    : "";
  const assets = await supabaseRestAll<RelationshipAssetRow>(
    `assets?select=id,asset_no,asset_type,project_id,building_id,building_name,floor_name,zone_name,office_name&project_id=eq.${encodeURIComponent(projectId)}&building_id=eq.${encodeURIComponent(buildingId)}&archived_at=is.null&status=in.(review,completed)${searchFilter}&order=asset_no&limit=5000`,
    token,
    { maxRows: 5000 },
  );
  return {
    assets: assets.map((asset) => ({
      id: asset.id,
      assetNo: asset.asset_no,
      assetType: asset.asset_type,
      building: asset.building_name,
      floor: asset.floor_name,
      zone: asset.zone_name,
      office: asset.office_name,
    })),
  };
}

async function queueWorkspace(token: string, viewerId: string) {
  const profileRows = await supabaseRest<Array<{ id: string; role: string }>>(
    `app_users?select=id,role&user_id=eq.${encodeURIComponent(viewerId)}&active=eq.true&limit=1`,
    token,
  );
  const profile = profileRows[0];
  if (!profile) return { records: [], jobs: [] };
  const cutoff = encodeURIComponent(
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  );
  const jobs = await supabaseRest<JobRow[]>(
    `analysis_jobs?select=id,asset_id,status,error,created_at&created_at=gte.${cutoff}&order=created_at.asc&limit=100`,
    token,
  );
  const assetIds = Array.from(new Set(jobs.map((job) => job.asset_id)));
  if (!assetIds.length) return { records: [], jobs: [] };
  const assetFilter = `id=in.(${assetIds.map(encodeURIComponent).join(",")})`;
  const assets = await supabaseRest<AssetRow[]>(
    `assets?select=${ASSET_SELECT}&${assetFilter}&order=created_at.desc&limit=100`,
    token,
  );
  const accessibleAssetIds = new Set(assets.map((asset) => asset.id));
  const filteredJobs = jobs.filter((job) =>
    accessibleAssetIds.has(job.asset_id),
  );
  const [customFields, customValues] = await Promise.all([
    supabaseRest<CustomFieldRow[]>(
      "custom_fields?select=id,config_id,field_key,label_ar,label_en,field_type,enabled,required,option_values,sort_order&order=sort_order&limit=1000",
      token,
    ),
    supabaseRest<CustomValueRow[]>(
      `asset_custom_values?select=asset_id,custom_field_id,value_text&asset_id=in.(${assetIds.map(encodeURIComponent).join(",")})&limit=2000`,
      token,
    ),
  ]);
  return mapWorkspace(
    assets,
    filteredJobs,
    customFields,
    customValues,
    viewerId,
    profile.role,
  );
}

function listField(
  fields: AnalysisResult["fields"] | null | undefined,
  patterns: string[],
) {
  const normalized = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = patterns.map(normalized);
  return (
    (fields || []).find(
      (field) =>
        wanted.includes(normalized(field.key)) ||
        wanted.includes(normalized(field.label)),
    )?.value || ""
  );
}

async function listWorkspace(
  request: Request,
  token: string,
  viewerId: string,
) {
  const profileRows = await supabaseRest<
    Array<{ id: string; role: string; email: string }>
  >(
    `app_users?select=id,role,email&user_id=eq.${encodeURIComponent(viewerId)}&active=eq.true&limit=1`,
    token,
  );
  const profile = profileRows[0];
  if (!profile) return { records: [], total: 0, page: 1, pageSize: 50 };
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(100000, Number(params.get("page")) || 1));
  const pageSize = Math.max(
    10,
    Math.min(100, Number(params.get("pageSize")) || 50),
  );
  const status = text(params.get("status"), 20);
  const workflow = text(params.get("workflow"), 20);
  const projectId = text(params.get("project"), 80);
  const buildingId = text(params.get("building"), 80);
  const floorId = text(params.get("floor"), 80);
  const zoneId = text(params.get("zone"), 80);
  const assetId = text(params.get("asset"), 80);
  const categoryId = text(params.get("category"), 80);
  const operationalStatus = text(params.get("operationalStatus"), 40);
  const condition = Number(params.get("condition"));
  const criticality = Number(params.get("criticality"));
  const search = text(params.get("search"), 80)
    .replace(/[,*()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const allowedStatuses = new Set([
    "queued",
    "processing",
    "completed",
    "review",
    "failed",
  ]);
  let permissionFilter = "";
  if (!isSuperAdminEmail(profile.email)) {
    const assignments = await supabaseRest<Array<{ project_id: string }>>(
      `user_projects?select=project_id&app_user_id=eq.${encodeURIComponent(profile.id)}`,
      token,
    );
    const assignedIds = assignments.map((item) => item.project_id);
    if (!assignedIds.length)
      return { records: [], total: 0, page: 1, pageSize };
    permissionFilter = `project_id=in.(${assignedIds.map(encodeURIComponent).join(",")})`;
  }
  const filters = [
    permissionFilter,
    status && allowedStatuses.has(status)
      ? `status=eq.${encodeURIComponent(status)}`
      : workflow === "active"
        ? "status=in.(queued,processing)"
      : "",
    projectId ? `project_id=eq.${encodeURIComponent(projectId)}` : "",
    buildingId ? `building_id=eq.${encodeURIComponent(buildingId)}` : "",
    floorId ? `floor_id=eq.${encodeURIComponent(floorId)}` : "",
    zoneId ? `zone_id=eq.${encodeURIComponent(zoneId)}` : "",
    assetId ? `id=eq.${encodeURIComponent(assetId)}` : "",
    categoryId ? `category_id=eq.${encodeURIComponent(categoryId)}` : "",
    operationalStatus && isAssetOperationalStatus(operationalStatus)
      ? `operational_status=eq.${encodeURIComponent(operationalStatus)}`
      : "",
    Number.isInteger(condition) && condition >= 1 && condition <= 5
      ? `condition_rating=eq.${condition}`
      : "",
    Number.isInteger(criticality) && criticality >= 1 && criticality <= 5
      ? `criticality_rating=eq.${criticality}`
      : "",
    "archived_at=is.null",
    search
      ? `or=${encodeURIComponent(`(asset_no.ilike.*${search}*,asset_type.ilike.*${search}*,project_name.ilike.*${search}*,building_name.ilike.*${search}*,floor_name.ilike.*${search}*,zone_name.ilike.*${search}*,office_name.ilike.*${search}*,surveyor_email.ilike.*${search}*)`)}`
      : "",
  ].filter(Boolean);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const query = `assets?select=${ASSET_SELECT}&${filters.join("&")}${filters.length ? "&" : ""}order=created_at.desc`;
  const assets = await supabaseRest<AssetRow[]>(query, token, {
    headers: { Range: `${from}-${to}` },
  });
  let count = 0;
  try {
    const result = await supabaseRest<{ count?: number }>(
      "rpc/assetlens_asset_list_count",
      token,
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          filters: {
            status,
            workflow,
            project: projectId,
            building: buildingId,
            floor: floorId,
            zone: zoneId,
            asset: assetId,
            category: categoryId,
            operationalStatus,
            condition: Number.isInteger(condition) ? String(condition) : "",
            criticality: Number.isInteger(criticality)
              ? String(criticality)
              : "",
            search,
          },
        }),
      },
    );
    count = Number(result?.count) || 0;
  } catch (error) {
    if (
      !/assetlens_asset_list_count|schema cache|pgrst202|could not find the function/i.test(
        error instanceof Error ? error.message : "",
      )
    )
      throw error;
    count = (
      await supabaseRestWithCount<AssetRow[]>(query, token, {
        headers: { Range: `${from}-${to}` },
      })
    ).count;
  }
  const pageAssetIds = assets.map((asset) => asset.id);
  const pageAssetIdSet = new Set(pageAssetIds);
  const relationshipRows = pageAssetIds.length
    ? await supabaseRestAll<RelationshipSummaryRow>(
        `asset_dependencies?select=upstream_asset_id,downstream_asset_id,dependency_type,impact&or=${encodeURIComponent(`(upstream_asset_id.in.(${pageAssetIds.join(",")}),downstream_asset_id.in.(${pageAssetIds.join(",")}))`)}&limit=10000`,
        token,
        { maxRows: 10_000 },
      )
    : [];
  const relationshipCounts = new Map<string, number>();
  const preliminaryRelationshipCounts = new Map<string, number>();
  for (const relationship of relationshipRows) {
    for (const assetKey of [
      relationship.upstream_asset_id,
      relationship.downstream_asset_id,
    ]) {
      if (!pageAssetIdSet.has(assetKey)) continue;
      relationshipCounts.set(
        assetKey,
        (relationshipCounts.get(assetKey) || 0) + 1,
      );
      if (
        relationship.dependency_type === "unverified" ||
        relationship.impact === "unassessed"
      )
        preliminaryRelationshipCounts.set(
          assetKey,
          (preliminaryRelationshipCounts.get(assetKey) || 0) + 1,
        );
    }
  }
  return {
    records: assets.map((asset) => ({
      id: asset.id,
      assetNo: asset.asset_no,
      assetType: asset.asset_type,
      conditionRating: asset.condition_rating,
      conditionJustification: asset.condition_justification || "",
      criticalityRating: asset.criticality_rating,
      categoryId: asset.category_id || "",
      operationalStatus: asset.operational_status || "active",
      estimatedPrice:
        asset.estimated_price == null ? null : Number(asset.estimated_price),
      replacementCost:
        asset.replacement_cost == null ? null : Number(asset.replacement_cost),
      priceCurrency: asset.price_currency || "AED",
      usefulLifeYears:
        asset.useful_life_years == null
          ? null
          : Number(asset.useful_life_years),
      installationDate: asset.installation_date || "",
      remainingLifeYears:
        asset.remaining_life_years == null
          ? null
          : Number(asset.remaining_life_years),
      estimateSource: asset.estimate_source || "",
      estimateConfidence: asset.estimate_confidence || "",
      enrichmentData: asset.enrichment_data || {},
      enrichmentSourceUrl: asset.enrichment_source_url || "",
      enrichmentFetchedAt: asset.enrichment_fetched_at,
      archivedAt: asset.archived_at,
      summary: asset.summary,
      manufacturer: listField(asset.fields, ["manufacturer", "brand", "make"]),
      model: listField(asset.fields, ["model", "modelnumber", "modelno"]),
      serial: listField(asset.fields, [
        "serial",
        "serialnumber",
        "serialno",
        "sn",
      ]),
      confidence: Number(asset.overall_confidence) || 0,
      status: asset.status,
      error: asset.error || "",
      warnings: asset.warnings || [],
      isDuplicate: (asset.warnings || []).some((warning) =>
        /duplicate serial|serial.*duplicate|سيريال.*مكرر/i.test(warning),
      ),
      canEdit: canEditAsset(profile.role, asset.created_by, viewerId),
      canTransfer: canTransferAsset(profile.role, asset.created_by, viewerId),
      canDelete: canDeleteAsset(profile.role, asset.created_by, viewerId),
      relationshipCount: relationshipCounts.get(asset.id) || 0,
      preliminaryRelationshipCount:
        preliminaryRelationshipCounts.get(asset.id) || 0,
      createdAt: asset.created_at,
      surveyorEmail: asset.surveyor_email,
      projectId: asset.project_id,
      project: asset.project_name,
      building: asset.building_name,
      floor: asset.floor_name,
      zone: asset.zone_name,
      office: asset.office_name,
      additionalLocations: Array.isArray(asset.additional_locations)
        ? asset.additional_locations
        : [],
      sourceFiles: asset.source_file_names || [],
    })),
    total: count,
    page,
    pageSize,
  };
}

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function normalizedAnalysisFields(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const key = text(source.key, 80);
    if (!key) return [];
    const numericConfidence = Number(source.confidence);
    return [
      {
        key,
        label: text(source.label, 120) || key,
        value: text(source.value, 2_000),
        confidence: Number.isFinite(numericConfidence)
          ? Math.max(0, Math.min(1, numericConfidence))
          : 0,
      },
    ];
  });
}

function responseStatusFor(message: string) {
  return /required|invalid|must |not part of|not available|not allowed|choose |belongs to|published configuration/i.test(
    message,
  )
    ? 400
    : 500;
}

function mobileCapture(raw: Record<string, unknown>) {
  const source =
    raw.mobile && typeof raw.mobile === "object" && !Array.isArray(raw.mobile)
      ? (raw.mobile as Record<string, unknown>)
      : {};
  const latitude = Number(source.latitude);
  const longitude = Number(source.longitude);
  const accuracy = Number(source.accuracy);
  const capturedAt = text(source.capturedAt, 80);
  const offlineClientId = text(source.offlineClientId, 80);
  return {
    latitude:
      Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
        ? latitude
        : null,
    longitude:
      Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
        ? longitude
        : null,
    gps_accuracy_m:
      Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
    barcode: text(source.barcode, 200),
    captured_offline: source.capturedOffline === true,
    device_captured_at:
      capturedAt && !Number.isNaN(Date.parse(capturedAt))
        ? new Date(capturedAt).toISOString()
        : new Date().toISOString(),
    offline_client_id:
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        offlineClientId,
      )
        ? offlineClientId
        : null,
  };
}

function validatedConditionRating(raw: Record<string, unknown>) {
  const rating = Number(raw.conditionRating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new Error(
      "Choose the asset condition rating from 1 to 5 before attaching images.",
    );
  return rating;
}

function validatedConditionJustification(
  raw: Record<string, unknown>,
  conditionRating: number,
) {
  const justification = text(raw.conditionJustification, 1000);
  if (conditionRating <= 2 && justification.length < 3)
    throw new Error(
      "Explain why the asset condition is Critical or Poor before saving.",
    );
  return justification;
}

function validatedCriticalityRating(raw: Record<string, unknown>) {
  const rating = Number(raw.criticalityRating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new Error(
      "Choose the asset criticality from 1 to 5 before attaching images.",
    );
  return rating;
}

function optionalNumber(
  raw: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new Error(`${label} is invalid.`);
  return value;
}

function remainingLifeYears(
  usefulLifeYears: number | null,
  installationDate: string | null,
) {
  if (usefulLifeYears == null || !installationDate) return null;
  const installed = Date.parse(`${installationDate}T00:00:00Z`);
  if (!Number.isFinite(installed)) return null;
  const age = Math.max(
    0,
    (Date.now() - installed) / (365.2425 * 24 * 60 * 60 * 1000),
  );
  return Math.max(0, Number((usefulLifeYears - age).toFixed(2)));
}

function validatedLifecycle(raw: Record<string, unknown>) {
  const operationalStatus = text(raw.operationalStatus, 40) || "active";
  if (!isAssetOperationalStatus(operationalStatus))
    throw new Error("Operational status is invalid.");
  const installationDate = text(raw.installationDate, 20);
  if (installationDate && !/^\d{4}-\d{2}-\d{2}$/.test(installationDate))
    throw new Error("Installation date is invalid.");
  return {
    operationalStatus,
    estimatedPrice: optionalNumber(raw.estimatedPrice, "Estimated price"),
    replacementCost: optionalNumber(raw.replacementCost, "Replacement cost"),
    priceCurrency:
      (text(raw.priceCurrency, 3) || "AED")
        .toUpperCase()
        .replace(/[^A-Z]/g, "") || "AED",
    usefulLifeYears: optionalNumber(
      raw.usefulLifeYears,
      "Useful life",
      0.01,
      100,
    ),
    installationDate: installationDate || null,
    estimateSource: text(raw.estimateSource, 500),
  };
}

async function validatedCategory(
  token: string,
  projectId: string,
  rawCategoryId: unknown,
) {
  const categoryId = text(rawCategoryId, 80);
  if (!categoryId) throw new Error("Asset category is required.");
  const rows = await supabaseRest<CategoryRow[]>(
    `asset_categories?select=id,code,label_ar,label_en,color,icon,default_useful_life_years,default_estimated_price,currency,default_criticality_rating,technical_fields,active,project_asset_categories!inner(project_id,active)&id=eq.${encodeURIComponent(categoryId)}&active=eq.true&project_asset_categories.project_id=eq.${encodeURIComponent(projectId)}&project_asset_categories.active=eq.true&limit=1`,
    token,
  );
  if (!rows[0])
    throw new Error(
      "The selected asset category is not enabled for this project.",
    );
  return rows[0];
}

async function validatedLocation(token: string, raw: Record<string, unknown>) {
  const projectId = text(raw.projectId, 80);
  if (!projectId) throw new Error("Project is required.");
  const projects = await supabaseRest<ProjectRow[]>(
    `projects?select=id,name,require_building,require_floor,require_zone,require_office,allow_manual&id=eq.${encodeURIComponent(projectId)}&active=eq.true&limit=1`,
    token,
  );
  const project = projects[0];
  if (!project)
    throw new Error("The selected project is unavailable for this account.");

  const buildingId = text(raw.buildingId, 80);
  const floorId = text(raw.floorId, 80);
  const zoneId = text(raw.zoneId, 80);
  const officeId = text(raw.officeId, 80);
  let buildingName = "";
  let floorName = "";
  let zoneName = "";
  let officeName = "";
  if (buildingId) {
    const rows = await supabaseRest<NamedRow[]>(
      `buildings?select=id,name&id=eq.${encodeURIComponent(buildingId)}&project_id=eq.${encodeURIComponent(projectId)}&active=eq.true&limit=1`,
      token,
    );
    if (!rows[0])
      throw new Error("The selected building does not belong to this project.");
    buildingName = rows[0].name;
  } else buildingName = text(raw.building);
  if (floorId) {
    if (!buildingId) throw new Error("Choose a building before the floor.");
    const rows = await supabaseRest<NamedRow[]>(
      `floors?select=id,name&id=eq.${encodeURIComponent(floorId)}&building_id=eq.${encodeURIComponent(buildingId)}&limit=1`,
      token,
    );
    if (!rows[0])
      throw new Error("The selected floor does not belong to this building.");
    floorName = rows[0].name;
  } else floorName = text(raw.floor);
  if (zoneId) {
    if (!buildingId) throw new Error("Choose a building before the zone.");
    const rows = await supabaseRest<ZoneRow[]>(
      `zones?select=id,name,floor_id&id=eq.${encodeURIComponent(zoneId)}&building_id=eq.${encodeURIComponent(buildingId)}&limit=1`,
      token,
    );
    if (!rows[0])
      throw new Error("The selected zone does not belong to this building.");
    if (rows[0].floor_id && rows[0].floor_id !== floorId)
      throw new Error("The selected zone does not belong to this floor.");
    zoneName = rows[0].name;
  } else zoneName = text(raw.zone);
  if (officeId) {
    if (!buildingId) throw new Error("Choose a building before the office.");
    const rows = await supabaseRest<OfficeRow[]>(
      `offices?select=id,name,floor_id,zone_id&id=eq.${encodeURIComponent(officeId)}&building_id=eq.${encodeURIComponent(buildingId)}&active=eq.true&limit=1`,
      token,
    );
    if (!rows[0])
      throw new Error("The selected office does not belong to this building.");
    if (rows[0].floor_id && rows[0].floor_id !== floorId)
      throw new Error("The selected office does not belong to this floor.");
    if (rows[0].zone_id && rows[0].zone_id !== zoneId)
      throw new Error("The selected office does not belong to this zone.");
    officeName = rows[0].name;
  } else officeName = text(raw.office);

  if (
    !project.allow_manual &&
    ((!buildingId && buildingName) ||
      (!floorId && floorName) ||
      (!zoneId && zoneName) ||
      (!officeId && officeName))
  )
    throw new Error("Manual location values are not allowed for this project.");
  if (project.require_building && !buildingName)
    throw new Error("Building is required for this project.");
  if (project.require_floor && !floorName)
    throw new Error("Floor is required for this project.");
  if (project.require_zone && !zoneName)
    throw new Error("Zone is required for this project.");
  if (project.require_office && !officeName)
    throw new Error("Office is required for this project.");
  const locationLevels = await supabaseRest<LocationLevelRow[]>(
    `location_levels?select=id,level_key,label_ar,label_en,required,sort_order,parent_level_id&project_id=eq.${encodeURIComponent(projectId)}&active=eq.true&order=sort_order`,
    token,
  );
  const submittedRows = Array.isArray(raw.additionalLocations)
    ? (raw.additionalLocations
        .slice(0, 50)
        .filter((item) => item && typeof item === "object") as Record<
        string,
        unknown
      >[])
    : [];
  const allowedLevelIds = new Set(locationLevels.map((level) => level.id));
  if (submittedRows.some((row) => !allowedLevelIds.has(text(row.levelId, 80))))
    throw new Error(
      "A submitted location level is not configured for this project.",
    );
  const levelIds = locationLevels.map((level) => level.id);
  const locationOptions = levelIds.length
    ? await supabaseRestAll<LocationOptionRow>(
        `location_options?select=id,level_id,building_id,floor_id,zone_id,office_id,parent_option_id,name&level_id=in.(${levelIds.map(encodeURIComponent).join(",")})&active=eq.true`,
        token,
      )
    : [];
  const additionalLocations: DynamicLocationValue[] = [];
  for (const level of locationLevels) {
    const submitted = submittedRows.find(
      (row) =>
        text(row.levelId, 80) === level.id ||
        text(row.key, 64) === level.level_key,
    );
    const valueId = text(submitted?.valueId, 80);
    const option = valueId
      ? locationOptions.find(
          (item) => item.id === valueId && item.level_id === level.id,
        )
      : undefined;
    if (valueId && !option)
      throw new Error(
        `${level.label_en || level.label_ar} contains an invalid option.`,
      );
    if (option?.building_id && option.building_id !== buildingId)
      throw new Error(
        `${level.label_en || level.label_ar} does not belong to this building.`,
      );
    if (option?.floor_id && option.floor_id !== floorId)
      throw new Error(
        `${level.label_en || level.label_ar} does not belong to this floor.`,
      );
    if (option?.zone_id && option.zone_id !== zoneId)
      throw new Error(
        `${level.label_en || level.label_ar} does not belong to this zone.`,
      );
    if (option?.office_id && option.office_id !== officeId)
      throw new Error(
        `${level.label_en || level.label_ar} does not belong to this office.`,
      );
    const preceding = level.parent_level_id
      ? additionalLocations.find(
          (item) => item.levelId === level.parent_level_id,
        )
      : undefined;
    if (
      level.parent_level_id &&
      option &&
      (!preceding?.valueId || option.parent_option_id !== preceding.valueId)
    )
      throw new Error(
        `${level.label_en || level.label_ar} does not belong to the selected preceding level.`,
      );
    const manualValue = valueId
      ? ""
      : level.level_key === "office" && officeId
        ? officeName
        : text(submitted?.value, 300);
    if (
      manualValue &&
      !project.allow_manual &&
      !(level.level_key === "office" && officeId)
    )
      throw new Error(
        `Manual ${level.label_en || level.label_ar} values are not allowed for this project.`,
      );
    const finalValue = option?.name || manualValue;
    if (level.parent_level_id && finalValue && !preceding?.value)
      throw new Error(
        `${level.label_en || level.label_ar} requires a value for its preceding level.`,
      );
    if (level.required && !finalValue)
      throw new Error(`${level.label_en || level.label_ar} is required.`);
    if (finalValue)
      additionalLocations.push({
        levelId: level.id,
        key: level.level_key,
        labelAr: level.label_ar,
        labelEn: level.label_en,
        valueId: option?.id || "",
        value: finalValue,
      });
  }
  return {
    projectId,
    projectName: project.name,
    buildingId: buildingId || null,
    buildingName,
    floorId: floorId || null,
    floorName,
    zoneId: zoneId || null,
    zoneName,
    officeId: officeId || null,
    officeName,
    additionalLocations,
  };
}

function preliminaryRelationship(raw: Record<string, unknown>) {
  const source =
    raw.relationship &&
    typeof raw.relationship === "object" &&
    !Array.isArray(raw.relationship)
      ? (raw.relationship as Record<string, unknown>)
      : {};
  const enabled = source.enabled === true;
  const relatedAssetId = text(source.relatedAssetId, 80);
  const currentAssetRole = text(source.currentAssetRole, 20);
  if (!enabled) return null;
  if (!relatedAssetId)
    throw new Error("Choose the related asset before saving this link.");
  if (currentAssetRole !== "parent" && currentAssetRole !== "child")
    throw new Error("Choose whether the new asset is the parent or child.");
  return {
    enabled,
    relatedAssetId,
    currentAssetRole,
  } as PreliminaryRelationship;
}

async function createPreliminaryRelationship(
  token: string,
  userId: string,
  newAssetId: string,
  projectId: string,
  buildingId: string | null,
  relationship: PreliminaryRelationship | null,
) {
  if (!relationship) return null;
  if (!buildingId)
    throw new Error(
      "A registered building is required before linking this asset to another asset.",
    );
  if (relationship.relatedAssetId === newAssetId)
    throw new Error("An asset cannot be linked to itself.");
  const rows = await supabaseRest<RelationshipAssetRow[]>(
    `assets?select=id,asset_no,asset_type,project_id,building_id,building_name,floor_name,zone_name,office_name&id=eq.${encodeURIComponent(relationship.relatedAssetId)}&project_id=eq.${encodeURIComponent(projectId)}&building_id=eq.${encodeURIComponent(buildingId)}&archived_at=is.null&status=in.(review,completed)&limit=1`,
    token,
  );
  const related = rows[0];
  if (!related)
    throw new Error(
      "The related asset is unavailable or does not belong to the same project and building.",
    );
  const upstreamAssetId =
    relationship.currentAssetRole === "parent" ? newAssetId : related.id;
  const downstreamAssetId =
    relationship.currentAssetRole === "parent" ? related.id : newAssetId;
  const created = await supabaseRest<
    Array<{
      id: string;
      upstream_asset_id: string;
      downstream_asset_id: string;
    }>
  >("asset_dependencies", token, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      project_id: projectId,
      upstream_asset_id: upstreamAssetId,
      downstream_asset_id: downstreamAssetId,
      dependency_type: "unverified",
      impact: "unassessed",
      note: "Preliminary parent/child link created during asset capture; engineering type and impact require review.",
      created_by: userId,
    }),
  });
  return {
    id: created[0]?.id || "",
    relatedAssetId: related.id,
    relatedAssetNo: related.asset_no,
    currentAssetRole: relationship.currentAssetRole,
    dependencyType: "unverified",
    impact: "unassessed",
  };
}

function optionCodes(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) =>
      typeof item === "string"
        ? item
        : item &&
            typeof item === "object" &&
            typeof (item as Record<string, unknown>).code === "string"
          ? String((item as Record<string, unknown>).code)
          : "",
    )
    .filter(Boolean);
}

async function customFieldsForConfig(token: string, configId: string) {
  const modern = `custom_fields?select=id,config_id,field_key,label_ar,label_en,field_type,enabled,required,option_values,sort_order,asset_types,unit,ai_extract,show_in_reports,show_in_qr&config_id=eq.${encodeURIComponent(configId)}&enabled=eq.true&order=sort_order`;
  try {
    return await supabaseRest<CustomFieldRow[]>(modern, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      !/schema cache|column.*(asset_types|unit|ai_extract|show_in_reports|show_in_qr)/i.test(
        message,
      )
    )
      throw error;
    return supabaseRest<CustomFieldRow[]>(
      `custom_fields?select=id,config_id,field_key,label_ar,label_en,field_type,enabled,required,option_values,sort_order&config_id=eq.${encodeURIComponent(configId)}&enabled=eq.true&order=sort_order`,
      token,
    );
  }
}

function normalizedAssetType(value: string) {
  return value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
}

function appliesToAsset(field: CustomFieldRow, assetType: string) {
  const targets = field.asset_types || [];
  if (targets.length === 0) return true;
  if (!assetType) return false;
  const normalized = normalizedAssetType(assetType);
  return targets.some((target) => normalizedAssetType(target) === normalized);
}

async function validatedCustomValues(
  token: string,
  projectId: string,
  raw: unknown,
  assetType = "",
  enforceRequired = true,
) {
  const configs = await supabaseRest<SurveyConfigRow[]>(
    `survey_config_versions?select=id,project_id&project_id=eq.${encodeURIComponent(projectId)}&status=eq.published&limit=1`,
    token,
  );
  const config = configs[0];
  if (!config)
    throw new Error("The project has no published survey configuration.");
  const fields = (await customFieldsForConfig(token, config.id)).filter(
    (field) => appliesToAsset(field, assetType),
  );
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const allowedKeys = new Set(fields.map((field) => field.field_key));
  if (Object.keys(source).some((key) => !allowedKeys.has(key)))
    throw new Error(
      "The submitted survey fields are not part of the published configuration.",
    );
  const values = fields.map((field) => ({
    field,
    value: text(source[field.field_key], 1000),
  }));
  const missing = enforceRequired
    ? values.find((item) => item.field.required && !item.value)
    : undefined;
  if (missing)
    throw new Error(
      `${missing.field.label_en || missing.field.label_ar} is required.`,
    );
  for (const item of values) {
    if (!item.value) continue;
    if (
      item.field.field_type === "number" &&
      !Number.isFinite(Number(item.value))
    )
      throw new Error(
        `${item.field.label_en || item.field.label_ar} must be a number.`,
      );
    if (
      item.field.field_type === "date" &&
      !/^\d{4}-\d{2}-\d{2}$/.test(item.value)
    )
      throw new Error(
        `${item.field.label_en || item.field.label_ar} must be a valid date.`,
      );
    if (
      item.field.field_type === "boolean" &&
      !["true", "false"].includes(item.value)
    )
      throw new Error(
        `${item.field.label_en || item.field.label_ar} must be yes or no.`,
      );
    if (
      item.field.field_type === "select" &&
      !optionCodes(item.field.option_values).includes(item.value)
    )
      throw new Error(
        `${item.field.label_en || item.field.label_ar} contains an invalid option.`,
      );
  }
  return {
    configId: config.id,
    values: values
      .filter((item) => item.value)
      .map((item) => ({
        custom_field_id: item.field.id,
        value_text: item.value,
      })),
  };
}

function extension(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

export async function GET(request: Request) {
  try {
    const token = requestToken(request);
    const user = await verifyAuthUser(token);
    if (!user)
      return Response.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    const view = new URL(request.url).searchParams.get("view");
    const selectedModule =
      view === "transfer"
        ? "transfers"
        : view === "list"
          ? "reports"
          : view === "manage"
            ? "locations"
            : "capture";
    if (!(await hasModuleAccess(token, user.id, selectedModule)))
      return Response.json(
        { error: "Your account cannot access this asset module." },
        { status: 403 },
      );
    const payload =
      view === "relationship-options"
        ? await relationshipOptions(request, token)
        : view === "queue"
          ? await queueWorkspace(token, user.id)
          : view === "list" || view === "transfer" || view === "manage"
            ? await listWorkspace(request, token, user.id)
            : await workspace(token, user.id);
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "تعذر تحميل سجل الأصول.");
  }
}

export async function POST(request: Request) {
  let token = "";
  let assetId = "";
  const uploadedPaths: string[] = [];
  try {
    token = requestToken(request);
    const user = await verifyAuthUser(token);
    if (!user)
      return Response.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!(await hasModuleAccess(token, user.id, "capture", "create")))
      return Response.json(
        { error: "Capture and asset creation permission is required." },
        { status: 403 },
      );
    if (
      (request.headers.get("content-type") || "").includes("application/json")
    ) {
      const body = (await request.json()) as Record<string, unknown>;
      if (text(body.action, 40) !== "createManual")
        return Response.json(
          { error: "Unsupported asset action." },
          { status: 400 },
        );
      const context =
        body.context &&
        typeof body.context === "object" &&
        !Array.isArray(body.context)
          ? (body.context as Record<string, unknown>)
          : {};
      const location = await validatedLocation(token, context);
      const relationship = preliminaryRelationship(context);
      const category = await validatedCategory(
        token,
        location.projectId,
        context.categoryId,
      );
      const lifecycle = validatedLifecycle(context);
      const conditionRating = validatedConditionRating(context);
      const conditionJustification = validatedConditionJustification(
        context,
        conditionRating,
      );
      const criticalityRating = validatedCriticalityRating(context);
      const assetType = text(body.assetType, 200);
      if (!assetType)
        return Response.json(
          { error: "Asset type is required." },
          { status: 400 },
        );
      const custom = await validatedCustomValues(
        token,
        location.projectId,
        context.customValues,
        assetType,
        true,
      );
      const mobile = mobileCapture(context);
      if (mobile.offline_client_id) {
        const existing = await supabaseRest<
          Array<{ id: string; asset_no: string }>
        >(
          `assets?select=id,asset_no&offline_client_id=eq.${encodeURIComponent(mobile.offline_client_id)}&limit=1`,
          token,
        ).catch(() => []);
        if (existing[0])
          return Response.json(
            {
              assetId: existing[0].id,
              assetNo: existing[0].asset_no,
              created: false,
              duplicate: true,
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
      }
      const manualFields = [
        {
          key: "assetName",
          label: "Asset Name",
          value: assetType,
          confidence: 1,
        },
        {
          key: "manufacturer",
          label: "Manufacturer / Brand",
          value: text(body.manufacturer, 500),
          confidence: 1,
        },
        {
          key: "modelNumber",
          label: "Model Number",
          value: text(body.model, 500),
          confidence: 1,
        },
        {
          key: "serialNumber",
          label: "Serial Number",
          value: text(body.serial, 500),
          confidence: 1,
        },
      ];
      const baseAsset = {
        project_id: location.projectId,
        building_id: location.buildingId,
        floor_id: location.floorId,
        zone_id: location.zoneId,
        office_id: location.officeId,
        survey_config_id: custom.configId,
        category_id: category.id,
        operational_status: lifecycle.operationalStatus,
        estimated_price:
          lifecycle.estimatedPrice ?? category.default_estimated_price,
        replacement_cost: lifecycle.replacementCost,
        price_currency: lifecycle.priceCurrency || category.currency || "AED",
        useful_life_years:
          lifecycle.usefulLifeYears ?? category.default_useful_life_years,
        installation_date: lifecycle.installationDate,
        remaining_life_years: remainingLifeYears(
          lifecycle.usefulLifeYears ??
            (category.default_useful_life_years == null
              ? null
              : Number(category.default_useful_life_years)),
          lifecycle.installationDate,
        ),
        estimate_source:
          lifecycle.estimateSource || `Category default: ${category.label_en}`,
        project_name: location.projectName,
        building_name: location.buildingName,
        floor_name: location.floorName,
        zone_name: location.zoneName,
        office_name: location.officeName,
        additional_locations: location.additionalLocations,
        created_by: user.id,
        surveyor_email: user.email,
        source_file_names: [],
        asset_type: assetType,
        summary: text(body.summary, 1000) || `Manual ${assetType} record`,
        fields: manualFields,
        warnings: [],
        raw_text: "",
        overall_confidence: 1,
        condition_rating: conditionRating,
        condition_justification: conditionJustification,
        criticality_rating: criticalityRating,
        status: "review",
        error: null,
      };
      let assets: AssetRow[];
      try {
        assets = await supabaseRest<AssetRow[]>("assets", token, {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ ...baseAsset, ...mobile }),
        });
      } catch (insertError) {
        const message = insertError instanceof Error ? insertError.message : "";
        if (
          !/schema cache|column.*(latitude|longitude|gps_accuracy_m|barcode|captured_offline|device_captured_at|offline_client_id)/i.test(
            message,
          )
        )
          throw insertError;
        assets = await supabaseRest<AssetRow[]>("assets", token, {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(baseAsset),
        });
      }
      assetId = assets[0]?.id || "";
      if (!assetId)
        throw new Error("The manual asset record could not be created.");
      const savedRelationship = await createPreliminaryRelationship(
        token,
        user.id,
        assetId,
        location.projectId,
        location.buildingId,
        relationship,
      );
      if (custom.values.length)
        await supabaseRest("asset_custom_values", token, {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(
            custom.values.map((item) => ({ asset_id: assetId, ...item })),
          ),
        });
      return Response.json(
        {
          assetId,
          assetNo: assets[0]?.asset_no || "",
          created: true,
          relationship: savedRelationship,
        },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    }
    const compact = new URL(request.url).searchParams.get("compact") === "1";
    const activeJobs = await supabaseRestWithCount<Array<{ id: string }>>(
      `analysis_jobs?select=id&created_by=eq.${encodeURIComponent(user.id)}&status=in.(queued,processing)`,
      token,
    );
    if (activeJobs.count >= 50)
      return Response.json(
        {
          error: "لديك 50 مهمة تحليل نشطة. انتظر اكتمال بعضها قبل رفع المزيد.",
        },
        { status: 429, headers: { "Retry-After": "30" } },
      );
    const form = await request.formData();
    const images = form
      .getAll("images")
      .filter((item): item is File => item instanceof File);
    if (images.length === 0 || images.length > MAX_IMAGES)
      return Response.json(
        { error: `Upload between 1 and ${MAX_IMAGES} images.` },
        { status: 400 },
      );
    if (
      images.some(
        (image) =>
          !ALLOWED_TYPES.has(image.type) ||
          image.size === 0 ||
          image.size > MAX_BYTES,
      )
    )
      return Response.json(
        {
          error:
            "Use JPG, PNG or WEBP images no larger than 4 MB after optimization.",
        },
        { status: 415 },
      );
    if (images.reduce((sum, image) => sum + image.size, 0) > MAX_TOTAL_BYTES)
      return Response.json(
        { error: "The optimized upload request must not exceed 4 MB." },
        { status: 413 },
      );

    let context: Record<string, unknown>;
    try {
      context = JSON.parse(text(form.get("context"), 50_000)) as Record<
        string,
        unknown
      >;
    } catch {
      return Response.json(
        { error: "Asset location data is invalid." },
        { status: 400 },
      );
    }
    const location = await validatedLocation(token, context);
    const relationship = preliminaryRelationship(context);
    const category = await validatedCategory(
      token,
      location.projectId,
      context.categoryId,
    );
    const lifecycle = validatedLifecycle(context);
    const conditionRating = validatedConditionRating(context);
    const conditionJustification = validatedConditionJustification(
      context,
      conditionRating,
    );
    const criticalityRating = validatedCriticalityRating(context);
    const custom = await validatedCustomValues(
      token,
      location.projectId,
      context.customValues,
      "",
      true,
    );
    const mobile = mobileCapture(context);
    if (mobile.offline_client_id) {
      const existing = await supabaseRest<Array<{ id: string }>>(
        `assets?select=id&offline_client_id=eq.${encodeURIComponent(mobile.offline_client_id)}&limit=1`,
        token,
      ).catch(() => []);
      if (existing[0]) {
        if (compact)
          return Response.json(
            { accepted: true, assetId: existing[0].id },
            { status: 200 },
          );
        return Response.json(await queueWorkspace(token, user.id), {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }
    const baseAsset = {
      project_id: location.projectId,
      building_id: location.buildingId,
      floor_id: location.floorId,
      zone_id: location.zoneId,
      office_id: location.officeId,
      survey_config_id: custom.configId,
      category_id: category.id,
      operational_status: lifecycle.operationalStatus,
      estimated_price:
        lifecycle.estimatedPrice ?? category.default_estimated_price,
      replacement_cost: lifecycle.replacementCost,
      price_currency: lifecycle.priceCurrency || category.currency || "AED",
      useful_life_years:
        lifecycle.usefulLifeYears ?? category.default_useful_life_years,
      installation_date: lifecycle.installationDate,
      remaining_life_years: remainingLifeYears(
        lifecycle.usefulLifeYears ??
          (category.default_useful_life_years == null
            ? null
            : Number(category.default_useful_life_years)),
        lifecycle.installationDate,
      ),
      estimate_source:
        lifecycle.estimateSource || `Category default: ${category.label_en}`,
      project_name: location.projectName,
      building_name: location.buildingName,
      floor_name: location.floorName,
      zone_name: location.zoneName,
      office_name: location.officeName,
      additional_locations: location.additionalLocations,
      created_by: user.id,
      surveyor_email: user.email,
      source_file_names: images.map((image) => image.name),
      condition_rating: conditionRating,
      condition_justification: conditionJustification,
      criticality_rating: criticalityRating,
      status: "queued",
    };
    let assets: AssetRow[];
    try {
      assets = await supabaseRest<AssetRow[]>("assets", token, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ ...baseAsset, ...mobile }),
      });
    } catch (insertError) {
      const message = insertError instanceof Error ? insertError.message : "";
      if (
        !/schema cache|column.*(latitude|longitude|gps_accuracy_m|barcode|captured_offline|device_captured_at|offline_client_id)/i.test(
          message,
        )
      )
        throw insertError;
      assets = await supabaseRest<AssetRow[]>("assets", token, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(baseAsset),
      });
    }
    assetId = assets[0]?.id;
    if (!assetId) throw new Error("The asset record could not be created.");

    await createPreliminaryRelationship(
      token,
      user.id,
      assetId,
      location.projectId,
      location.buildingId,
      relationship,
    );

    if (custom.values.length)
      await supabaseRest("asset_custom_values", token, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(
          custom.values.map((item) => ({ asset_id: assetId, ...item })),
        ),
      });

    const imageRows = await Promise.all(
      images.map(async (image, index) => {
        const path = `${user.id}/${assetId}/${String(index + 1).padStart(2, "0")}-${crypto.randomUUID()}.${extension(image)}`;
        await uploadAssetImage(path, token, image);
        uploadedPaths.push(path);
        return {
          asset_id: assetId,
          storage_path: path,
          file_name: image.name,
          mime_type: image.type,
          size_bytes: image.size,
          sort_order: index,
          image_role: index === 0 ? "nameplate" : "asset",
          delete_after:
            index === 0
              ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
              : null,
        };
      }),
    );
    await supabaseRest("asset_images", token, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(imageRows),
    });
    await supabaseRest("analysis_jobs", token, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        asset_id: assetId,
        created_by: user.id,
        status: "queued",
      }),
    });
    const sessionGeminiKey =
      request.headers.get("x-gemini-api-key")?.trim() || "";
    after(async () => {
      await drainAnalysisQueue(token, sessionGeminiKey).catch(() => undefined);
    });
    if (compact)
      return Response.json({ accepted: true, assetId }, { status: 202 });
    return Response.json(await queueWorkspace(token, user.id), {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (token && uploadedPaths.length)
      await deleteAssetImages(uploadedPaths, token).catch(() => undefined);
    if (token && assetId)
      await supabaseRest(`assets?id=eq.${encodeURIComponent(assetId)}`, token, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      }).catch(() => undefined);
    const message =
      error instanceof Error ? error.message : "The asset could not be queued.";
    return apiErrorResponse(
      error,
      "تعذر إضافة الأصل إلى قائمة التحليل.",
      responseStatusFor(message) === 400 ? 400 : undefined,
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const token = requestToken(request);
    const user = await verifyAuthUser(token);
    if (!user)
      return Response.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    const profiles = await supabaseRest<Array<{ role: string }>>(
      `app_users?select=role&user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`,
      token,
    );
    const profile = profiles[0];
    if (!profile)
      return Response.json(
        { error: "This account is disabled or unauthorized." },
        { status: 403 },
      );
    const body = (await request.json()) as {
      id?: unknown;
      result?: Partial<AnalysisResult>;
      action?: unknown;
      projectId?: unknown;
      buildingId?: unknown;
      floorId?: unknown;
      zoneId?: unknown;
      officeId?: unknown;
      building?: unknown;
      floor?: unknown;
      zone?: unknown;
      office?: unknown;
      additionalLocations?: unknown;
      customValues?: unknown;
      assetType?: unknown;
      summary?: unknown;
      manufacturer?: unknown;
      model?: unknown;
      serial?: unknown;
      categoryId?: unknown;
      operationalStatus?: unknown;
      conditionRating?: unknown;
      conditionJustification?: unknown;
      criticalityRating?: unknown;
      estimatedPrice?: unknown;
      replacementCost?: unknown;
      priceCurrency?: unknown;
      usefulLifeYears?: unknown;
      installationDate?: unknown;
      estimateSource?: unknown;
    };
    const id = text(body.id, 80);
    const action = text(body.action, 30);
    if (action === "amendLocation") {
      if (
        !(await hasModuleAccess(token, user.id, "locations", "edit")) &&
        !(await hasModuleAccess(token, user.id, "reports", "edit"))
      )
        return Response.json(
          { error: "Asset edit permission is required." },
          { status: 403 },
        );
      const currentRows = await supabaseRest<
        Array<{ project_id: string; created_by: string; status: string }>
      >(
        `assets?select=project_id,created_by,status&id=eq.${encodeURIComponent(id)}&limit=1`,
        token,
      );
      const current = currentRows[0];
      if (!current || !canEditAsset(profile.role, current.created_by, user.id))
        return Response.json(
          { error: "Asset is unavailable for editing." },
          { status: 403 },
        );
      if (current.status !== "review")
        return Response.json(
          {
            error:
              "Location correction here is available for assets awaiting review.",
          },
          { status: 409 },
        );
      const changes: Record<string, string> = {};
      for (const key of ["building", "floor", "zone", "office"] as const) {
        if (body[key] !== undefined)
          changes[`${key}_name`] = text(body[key], 200);
      }
      if (!Object.keys(changes).length)
        return Response.json(
          { error: "Enter a location to update." },
          { status: 400 },
        );
      await supabaseRest(`assets?id=eq.${encodeURIComponent(id)}`, token, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(changes),
      });
      return Response.json(
        { updated: true, id },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (action === "transfer") {
      if (!(await hasModuleAccess(token, user.id, "transfers", "edit")))
        return Response.json(
          { error: "Asset transfer permission is required." },
          { status: 403 },
        );
      if (!id)
        return Response.json(
          { error: "Asset id is required." },
          { status: 400 },
        );
      const currentRows = await supabaseRest<
        Array<{
          project_id: string;
          building_id: string | null;
          created_by: string;
        }>
      >(
        `assets?select=project_id,building_id,created_by&id=eq.${encodeURIComponent(id)}&limit=1`,
        token,
      );
      const current = currentRows[0];
      if (!current)
        return Response.json(
          { error: "Asset was not found or is not accessible." },
          { status: 404 },
        );
      if (!canTransferAsset(profile.role, current.created_by, user.id))
        return Response.json(
          { error: "Your role cannot transfer this asset." },
          { status: 403 },
        );
      const projectId = text(body.projectId, 80) || current.project_id;
      if (projectId !== current.project_id)
        return Response.json(
          { error: "Asset transfer is allowed only inside the same project." },
          { status: 400 },
        );
      const location = await validatedLocation(token, {
        projectId,
        buildingId: text(body.buildingId, 80),
        floorId: text(body.floorId, 80),
        zoneId: text(body.zoneId, 80),
        officeId: text(body.officeId, 80),
        additionalLocations: body.additionalLocations,
      });
      let relationshipCount = 0;
      if (current.building_id !== location.buildingId) {
        const dependencyFilter = encodeURIComponent(
          `(upstream_asset_id.eq.${id},downstream_asset_id.eq.${id})`,
        );
        relationshipCount = (
          await supabaseRestWithCount<Array<{ id: string }>>(
            `asset_dependencies?select=id&project_id=eq.${encodeURIComponent(projectId)}&or=${dependencyFilter}`,
            token,
          )
        ).count;
      }
      await supabaseRest(`assets?id=eq.${encodeURIComponent(id)}`, token, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          building_id: location.buildingId,
          floor_id: location.floorId,
          zone_id: location.zoneId,
          office_id: location.officeId,
          building_name: location.buildingName,
          floor_name: location.floorName,
          zone_name: location.zoneName,
          office_name: location.officeName,
          additional_locations: location.additionalLocations,
        }),
      });
      return Response.json({
        ...(await queueWorkspace(token, user.id)),
        relationshipWarning:
          relationshipCount > 0
            ? {
                count: relationshipCount,
                code: "linked_asset_changed_building",
              }
            : null,
      });
    }
    if (action === "manage") {
      if (!(await hasModuleAccess(token, user.id, "locations", "edit")))
        return Response.json(
          { error: "Asset management edit permission is required." },
          { status: 403 },
        );
      if (!id)
        return Response.json(
          { error: "Asset id is required." },
          { status: 400 },
        );
      const currentRows = await supabaseRest<
        Array<{
          project_id: string;
          created_by: string;
          fields: AnalysisResult["fields"];
        }>
      >(
        `assets?select=project_id,created_by,fields&id=eq.${encodeURIComponent(id)}&limit=1`,
        token,
      );
      const current = currentRows[0];
      if (!current)
        return Response.json(
          { error: "Asset was not found or is not accessible." },
          { status: 404 },
        );
      if (!canEditAsset(profile.role, current.created_by, user.id))
        return Response.json(
          { error: "Your role cannot edit this asset." },
          { status: 403 },
        );
      const category = await validatedCategory(
        token,
        current.project_id,
        body.categoryId,
      );
      const lifecycle = validatedLifecycle(body as Record<string, unknown>);
      const conditionRating = validatedConditionRating(
        body as Record<string, unknown>,
      );
      const conditionJustification = validatedConditionJustification(
        body as Record<string, unknown>,
        conditionRating,
      );
      const criticalityRating = validatedCriticalityRating(
        body as Record<string, unknown>,
      );
      const assetType = text(body.assetType, 200);
      if (!assetType)
        return Response.json(
          { error: "Asset type is required." },
          { status: 400 },
        );
      const aliases = {
        manufacturer: ["manufacturer", "brand", "make"],
        model: ["model", "modelnumber", "modelno"],
        serial: ["serial", "serialnumber", "serialno", "sn"],
      };
      const normalize = (value: string) =>
        value.toLowerCase().replace(/[^a-z0-9]/g, "");
      const nextFields = [...(current.fields || [])];
      const setCoreField = (
        name: keyof typeof aliases,
        label: string,
        raw: unknown,
      ) => {
        const value = text(raw, 500);
        const index = nextFields.findIndex(
          (field) =>
            aliases[name].includes(normalize(field.key)) ||
            aliases[name].includes(normalize(field.label)),
        );
        if (index >= 0) nextFields[index] = { ...nextFields[index], value };
        else if (value)
          nextFields.push({
            key:
              name === "model"
                ? "modelNumber"
                : name === "serial"
                  ? "serialNumber"
                  : "manufacturer",
            label,
            value,
            confidence: 1,
          });
      };
      setCoreField("manufacturer", "Manufacturer / Brand", body.manufacturer);
      setCoreField("model", "Model Number", body.model);
      setCoreField("serial", "Serial Number", body.serial);
      const duplicate = await findDuplicateWarning(token, id, nextFields);
      const currentWarnings = await supabaseRest<Array<{ warnings: string[] }>>(
        `assets?select=warnings&id=eq.${encodeURIComponent(id)}&limit=1`,
        token,
      );
      const warnings = Array.from(
        new Set([
          ...(currentWarnings[0]?.warnings || []).filter(
            (item) => !item.startsWith("Duplicate serial detected:"),
          ),
          ...(duplicate ? [duplicate] : []),
        ]),
      );
      await supabaseRest(`assets?id=eq.${encodeURIComponent(id)}`, token, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          asset_type: assetType,
          summary: text(body.summary, 1000),
          fields: nextFields,
          warnings,
          category_id: category.id,
          operational_status: lifecycle.operationalStatus,
          condition_rating: conditionRating,
          condition_justification: conditionJustification,
          criticality_rating: criticalityRating,
          estimated_price: lifecycle.estimatedPrice,
          replacement_cost: lifecycle.replacementCost,
          price_currency: lifecycle.priceCurrency,
          useful_life_years: lifecycle.usefulLifeYears,
          installation_date: lifecycle.installationDate,
          remaining_life_years: remainingLifeYears(
            lifecycle.usefulLifeYears,
            lifecycle.installationDate,
          ),
          estimate_source: lifecycle.estimateSource,
        }),
      });
      return Response.json(
        { updated: true, id },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const result = body.result;
    const allowedAction =
      action === "approve"
        ? await hasModuleAccess(token, user.id, "reports", "approve")
        : await hasAnyModuleAccess(token, user.id, [
            { module: "capture", action: "edit" },
            { module: "reports", action: "edit" },
          ]);
    if (!allowedAction)
      return Response.json(
        { error: "Asset edit or approval permission is required." },
        { status: 403 },
      );
    if (
      !id ||
      !result ||
      !Array.isArray(result.fields) ||
      !Array.isArray(result.warnings)
    )
      return Response.json(
        { error: "A valid asset result is required." },
        { status: 400 },
      );
    const fields = normalizedAnalysisFields(result.fields);
    const assetType = text(result.assetType);
    if (!assetType)
      return Response.json(
        { error: "Asset type is required." },
        { status: 400 },
      );
    const conditionRating = Number(result.conditionRating);
    if (
      !Number.isInteger(conditionRating) ||
      conditionRating < 1 ||
      conditionRating > 5
    )
      return Response.json(
        {
          error: "Choose the asset condition rating from 1 to 5 before saving.",
        },
        { status: 400 },
      );
    const conditionJustification = validatedConditionJustification(
      result as Record<string, unknown>,
      conditionRating,
    );
    const criticalityRating = Number(result.criticalityRating);
    if (
      !Number.isInteger(criticalityRating) ||
      criticalityRating < 1 ||
      criticalityRating > 5
    )
      return Response.json(
        { error: "Choose the asset criticality from 1 to 5 before saving." },
        { status: 400 },
      );
    const currentRows = await supabaseRest<
      Array<{ project_id: string; created_by: string }>
    >(
      `assets?select=project_id,created_by&id=eq.${encodeURIComponent(id)}&limit=1`,
      token,
    );
    const current = currentRows[0];
    if (!current)
      return Response.json(
        { error: "Asset was not found or is not accessible." },
        { status: 404 },
      );
    if (!canEditAsset(profile.role, current.created_by, user.id))
      return Response.json(
        { error: "Your role cannot edit or review this asset." },
        { status: 403 },
      );
    const custom = await validatedCustomValues(
      token,
      current.project_id,
      body.customValues,
      assetType,
      action === "approve",
    );
    const duplicate = await findDuplicateWarning(token, id, fields);
    const warnings = Array.from(
      new Set([
        ...result.warnings
          .map((item) => text(item, 500))
          .filter(
            (item) => item && !item.startsWith("Duplicate serial detected:"),
          ),
        ...(duplicate ? [duplicate] : []),
      ]),
    );
    await supabaseRest(`assets?id=eq.${encodeURIComponent(id)}`, token, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        asset_type: assetType,
        summary: text(result.summary, 1000),
        fields,
        warnings,
        raw_text: text(result.rawText, 20_000),
        overall_confidence: Math.max(
          0,
          Math.min(1, Number(result.overallConfidence) || 0),
        ),
        condition_rating: conditionRating,
        condition_justification: conditionJustification,
        criticality_rating: criticalityRating,
        status: action === "approve" ? "completed" : "review",
        error: null,
      }),
    });
    await supabaseRest(
      `asset_custom_values?asset_id=eq.${encodeURIComponent(id)}`,
      token,
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
    );
    if (custom.values.length)
      await supabaseRest("asset_custom_values", token, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(
          custom.values.map((item) => ({ asset_id: id, ...item })),
        ),
      });
    return Response.json(await queueWorkspace(token, user.id));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The asset changes could not be saved.";
    return apiErrorResponse(
      error,
      "تعذر حفظ تعديلات الأصل.",
      responseStatusFor(message) === 400 ? 400 : undefined,
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const token = requestToken(request);
    const user = await verifyAuthUser(token);
    if (!user)
      return Response.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    let body: { ids?: unknown } = {};
    if (
      (request.headers.get("content-type") || "").includes("application/json")
    )
      body = await request.json().catch(() => ({}));
    const queryId = new URL(request.url).searchParams.get("id")?.trim() || "";
    const supplied = Array.isArray(body.ids)
      ? body.ids
      : queryId
        ? [queryId]
        : [];
    const ids = Array.from(
      new Set(
        supplied
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim()),
      ),
    );
    if (!ids.length)
      return Response.json(
        { error: "Choose at least one asset." },
        { status: 400 },
      );
    if (ids.length > 500)
      return Response.json(
        { error: "Delete at most 500 assets in one safe batch." },
        { status: 400 },
      );
    if (
      ids.some(
        (id) => !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id),
      )
    )
      return Response.json(
        { error: "One or more asset ids are invalid." },
        { status: 400 },
      );
    if (
      !(await hasAnyModuleAccess(token, user.id, [
        { module: "capture", action: "delete" },
        { module: "reports", action: "delete" },
      ]))
    )
      return Response.json(
        { error: "Asset deletion permission is required." },
        { status: 403 },
      );
    const idFilter = `in.(${ids.join(",")})`;
    const [profiles, assets] = await Promise.all([
      supabaseRest<Array<{ role: string }>>(
        `app_users?select=role&user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`,
        token,
      ),
      supabaseRest<Array<{ id: string; asset_no: string; created_by: string }>>(
        `assets?select=id,asset_no,created_by&id=${encodeURIComponent(idFilter)}`,
        token,
      ),
    ]);
    if (!profiles[0])
      return Response.json(
        { error: "This account is disabled or unauthorized." },
        { status: 403 },
      );
    if (assets.length !== ids.length)
      return Response.json(
        {
          error:
            "At least one asset was not found or is not accessible; nothing was deleted.",
        },
        { status: 404 },
      );
    const denied = assets.find(
      (asset) => !canDeleteAsset(profiles[0].role, asset.created_by, user.id),
    );
    if (denied)
      return Response.json(
        {
          error: `Your role cannot delete asset ${denied.asset_no || denied.id}; nothing was deleted.`,
        },
        { status: 403 },
      );
    const images = await supabaseRest<Array<{ storage_path: string }>>(
      `asset_images?select=storage_path&asset_id=${encodeURIComponent(idFilter)}`,
      token,
    );
    await supabaseRest(`assets?id=${encodeURIComponent(idFilter)}`, token, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    let cleanupWarning = "";
    await deleteAssetImages(
      images.map((image) => image.storage_path),
      token,
    ).catch((error) => {
      cleanupWarning =
        "Asset records were deleted, but some stored images need cleanup.";
      console.error(cleanupWarning, error);
    });
    return Response.json({
      deleted: assets.map((asset) => ({
        id: asset.id,
        assetNo: asset.asset_no,
      })),
      count: assets.length,
      cleanupWarning,
    });
  } catch (error) {
    return apiErrorResponse(error, "تعذر حذف الأصل أو مجموعة الأصول.");
  }
}
