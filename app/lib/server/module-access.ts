import { canUseModule, defaultModulePermissions, ModuleAction, ModuleKey, ModulePermission, UserRole } from "../module-permissions";
import { isSuperAdminEmail } from "./super-admin";
import { supabaseRest } from "./supabase";

type ActorRow = { id: string; email: string; name: string; role: UserRole; active: boolean };
type PermissionRow = { module_key: ModuleKey; can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean; can_approve: boolean; can_export: boolean };

export function mapPermissionRows(rows: PermissionRow[], role: UserRole, superAdmin = false): ModulePermission[] {
  if (superAdmin) return defaultModulePermissions("admin");
  if (!rows.length) return defaultModulePermissions(role);
  const byModule = new Map(rows.map(row => [row.module_key, row]));
  return defaultModulePermissions(role).map(fallback => {
    const row = byModule.get(fallback.module);
    return row ? {
      module: fallback.module,
      view: row.can_view,
      create: row.can_view && row.can_create,
      edit: row.can_view && row.can_edit,
      delete: row.can_view && row.can_delete,
      approve: row.can_view && row.can_approve,
      export: row.can_view && row.can_export,
    } : fallback;
  });
}

export async function moduleAccessFor(token: string, userId: string) {
  const actors = await supabaseRest<ActorRow[]>(`app_users?select=id,email,name,role,active&user_id=eq.${encodeURIComponent(userId)}&active=eq.true&limit=1`, token);
  const actor = actors[0];
  if (!actor) return null;
  const rows = await supabaseRest<PermissionRow[]>(`user_module_permissions?select=module_key,can_view,can_create,can_edit,can_delete,can_approve,can_export&app_user_id=eq.${encodeURIComponent(actor.id)}`, token).catch(() => []);
  return { actor, permissions: mapPermissionRows(rows, actor.role, isSuperAdminEmail(actor.email)) };
}

export async function hasModuleAccess(token: string, userId: string, module: ModuleKey, action: ModuleAction = "view") {
  const access = await moduleAccessFor(token, userId);
  return Boolean(access && canUseModule(access.permissions, module, action));
}

export async function hasAnyModuleAccess(token: string, userId: string, requests: Array<{ module: ModuleKey; action?: ModuleAction }>) {
  const access = await moduleAccessFor(token, userId);
  return Boolean(access && requests.some(request => canUseModule(access.permissions, request.module, request.action || "view")));
}
