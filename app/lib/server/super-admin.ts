const DEFAULT_SUPER_ADMIN_EMAIL = "eng.ahmedsalman96@gmail.com";

export function superAdminEmail() {
  return (process.env.SUPER_ADMIN_EMAIL || DEFAULT_SUPER_ADMIN_EMAIL).trim().toLowerCase();
}

export function isSuperAdminEmail(email: string | null | undefined) {
  return Boolean(email && email.trim().toLowerCase() === superAdminEmail());
}
