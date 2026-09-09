export type AssetConditionRating = 1 | 2 | 3 | 4 | 5;

export const ASSET_CONDITION_LEVELS: ReadonlyArray<{
  rating: AssetConditionRating;
  labelAr: string;
  labelEn: string;
}> = [
  { rating: 1, labelAr: "حرج", labelEn: "Critical" },
  { rating: 2, labelAr: "ضعيف / يحتاج صيانة", labelEn: "Poor / Needs Maintenance" },
  { rating: 3, labelAr: "مقبول", labelEn: "Fair" },
  { rating: 4, labelAr: "جيد", labelEn: "Good" },
  { rating: 5, labelAr: "ممتاز", labelEn: "Excellent" },
];

export function assetConditionLabel(rating: number | null | undefined, language: "ar" | "en" = "ar") {
  const level = ASSET_CONDITION_LEVELS.find(item => item.rating === rating);
  return level ? (language === "ar" ? level.labelAr : level.labelEn) : "";
}
