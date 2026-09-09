export type UserRole = "admin" | "project_manager" | "reviewer" | "surveyor" | "viewer";

export const MODULE_KEYS = ["dashboard", "capture", "organization", "locations", "transfers", "reports", "administration"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
export type ModuleAction = "view" | "create" | "edit" | "delete" | "approve" | "export";

export type ModulePermission = {
  module: ModuleKey;
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
  export: boolean;
};

export const MODULE_LABELS: Record<ModuleKey, { ar: string; en: string }> = {
  dashboard: { ar: "لوحة التحكم", en: "Dashboard" },
  capture: { ar: "التقاط وتحليل", en: "Capture & Analyze" },
  organization: { ar: "المشاريع والهيكل", en: "Organization" },
  locations: { ar: "المواقع", en: "Locations" },
  transfers: { ar: "نقل الأصول", en: "Asset Transfer" },
  reports: { ar: "التقارير", en: "Reports" },
  administration: { ar: "الإدارة", en: "Administration" },
};

const noAccess = (moduleKey: ModuleKey): ModulePermission => ({ module: moduleKey, view: false, create: false, edit: false, delete: false, approve: false, export: false });
const access = (moduleKey: ModuleKey, actions: Partial<Omit<ModulePermission, "module">> = {}): ModulePermission => ({
  module: moduleKey,
  view: true,
  create: false,
  edit: false,
  delete: false,
  approve: false,
  export: false,
  ...actions,
});

export function defaultModulePermissions(role: UserRole): ModulePermission[] {
  const permissions = new Map<ModuleKey, ModulePermission>(MODULE_KEYS.map(moduleKey => [moduleKey, noAccess(moduleKey)]));
  const allow = (permission: ModulePermission) => permissions.set(permission.module, permission);
  if (role === "admin") {
    for (const moduleKey of MODULE_KEYS) allow(access(moduleKey, { create: true, edit: true, delete: true, approve: true, export: true }));
  } else if (role === "project_manager") {
    allow(access("dashboard", { export: true }));
    allow(access("capture", { create: true, edit: true }));
    allow(access("organization"));
    allow(access("locations"));
    allow(access("transfers", { create: true, edit: true }));
    allow(access("reports", { edit: true, approve: true, export: true }));
  } else if (role === "reviewer") {
    allow(access("dashboard"));
    allow(access("organization"));
    allow(access("locations"));
    allow(access("reports", { edit: true, approve: true, export: true }));
  } else if (role === "surveyor") {
    allow(access("capture", { create: true, edit: true, delete: true }));
    allow(access("locations"));
    allow(access("reports", { edit: true, export: true }));
  } else {
    allow(access("dashboard"));
    allow(access("reports", { export: true }));
  }
  return MODULE_KEYS.map(moduleKey => permissions.get(moduleKey) || noAccess(moduleKey));
}

export function normalizeModulePermissions(value: unknown, role: UserRole, superAdmin = false): ModulePermission[] {
  if (superAdmin) return defaultModulePermissions("admin");
  const defaults = defaultModulePermissions(role);
  if (!Array.isArray(value) || value.length === 0) return defaults;
  const submitted = new Map<ModuleKey, Record<string, unknown>>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.module === "string" && MODULE_KEYS.includes(row.module as ModuleKey)) submitted.set(row.module as ModuleKey, row);
  }
  return defaults.map(fallback => {
    const row = submitted.get(fallback.module);
    if (!row) return fallback;
    const view = row.view === true;
    return {
      module: fallback.module,
      view,
      create: view && row.create === true,
      edit: view && row.edit === true,
      delete: view && row.delete === true,
      approve: view && row.approve === true,
      export: view && row.export === true,
    };
  });
}

export function canUseModule(permissions: ModulePermission[] | undefined, moduleKey: ModuleKey, action: ModuleAction = "view") {
  const row = permissions?.find(permission => permission.module === moduleKey);
  return row ? row[action] : false;
}
