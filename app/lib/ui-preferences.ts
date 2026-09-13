export type UiLanguage = "ar" | "en";
export type UiTheme = "light" | "dark" | "system";

export const UI_LANGUAGE_EVENT = "assetlens-language-change";
export const UI_THEME_EVENT = "assetlens-theme-change";

export function readUiLanguage(): UiLanguage {
  if (typeof window === "undefined") return "ar";
  return window.localStorage.getItem("assetlens_language") === "en" ? "en" : "ar";
}

export function readUiTheme(): UiTheme {
  if (typeof window === "undefined") return "light";
  const value = window.localStorage.getItem("assetlens_theme");
  return value === "dark" || value === "system" ? value : "light";
}

export function resolvedTheme(theme: UiTheme): "light" | "dark" {
  if (theme !== "system" || typeof window === "undefined") return theme === "dark" ? "dark" : "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyUiPreferences(language: UiLanguage, theme: UiTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  document.documentElement.dataset.theme = resolvedTheme(theme);
  document.documentElement.dataset.themePreference = theme;
}

export function saveUiLanguage(language: UiLanguage) {
  window.localStorage.setItem("assetlens_language", language);
  window.dispatchEvent(new CustomEvent(UI_LANGUAGE_EVENT, { detail: language }));
}

export function saveUiTheme(theme: UiTheme) {
  window.localStorage.setItem("assetlens_theme", theme);
  window.dispatchEvent(new CustomEvent(UI_THEME_EVENT, { detail: theme }));
}
