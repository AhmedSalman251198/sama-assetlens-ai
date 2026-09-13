"use client";

import { useEffect, useState } from "react";
import { readUiLanguage, UI_LANGUAGE_EVENT, UiLanguage } from "./ui-preferences";

/** Reactive global language preference shared by every client route. */
export function useUiLanguage() {
  const [language, setLanguage] = useState<UiLanguage>("ar");

  useEffect(() => {
    const timer = window.setTimeout(() => setLanguage(readUiLanguage()), 0);
    const onLanguage = (event: Event) => setLanguage((event as CustomEvent<UiLanguage>).detail || readUiLanguage());
    window.addEventListener(UI_LANGUAGE_EVENT, onLanguage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(UI_LANGUAGE_EVENT, onLanguage);
    };
  }, []);

  return language;
}

export function languageText(language: UiLanguage, ar: string, en: string) {
  return language === "ar" ? ar : en;
}
