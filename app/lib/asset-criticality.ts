export type AssetCriticalityLevel = {
  rating: 1 | 2 | 3 | 4 | 5;
  weight: 1 | 2 | 3 | 4 | 5;
  labelAr: string;
  labelEn: string;
  descriptionAr: string;
  descriptionEn: string;
};

// Criticality is the single user input. Weight is always derived from it and
// is never entered separately, so reporting remains consistent.
export const ASSET_CRITICALITY_LEVELS: AssetCriticalityLevel[] = [
  { rating: 1, weight: 1, labelAr: "غير مهم", labelEn: "Very Low", descriptionAr: "تأثير محدود عند التعطل", descriptionEn: "Limited impact if it fails" },
  { rating: 2, weight: 2, labelAr: "أهمية منخفضة", labelEn: "Low", descriptionAr: "تأثير منخفض على التشغيل", descriptionEn: "Low operational impact" },
  { rating: 3, weight: 3, labelAr: "مهم", labelEn: "Important", descriptionAr: "يؤثر على جزء من التشغيل", descriptionEn: "Affects part of the operation" },
  { rating: 4, weight: 4, labelAr: "عالي الأهمية", labelEn: "High", descriptionAr: "تعطله يؤثر بقوة على الموقع", descriptionEn: "Failure strongly affects the site" },
  { rating: 5, weight: 5, labelAr: "حرج جداً", labelEn: "Critical", descriptionAr: "ضروري لاستمرارية الأعمال أو السلامة", descriptionEn: "Essential for continuity or safety" },
];

export function assetCriticalityLevel(value: number | null | undefined) {
  return ASSET_CRITICALITY_LEVELS.find(level => level.rating === Number(value)) || null;
}

export function assetCriticalityLabel(value: number | null | undefined, language: "ar" | "en" = "ar") {
  const level = assetCriticalityLevel(value);
  return level ? (language === "ar" ? level.labelAr : level.labelEn) : "";
}

export function assetCriticalityWeight(value: number | null | undefined) {
  return assetCriticalityLevel(value)?.weight || 0;
}
