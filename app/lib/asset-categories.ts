export type AssetCategory = {
  id: string;
  code: string;
  labelAr: string;
  labelEn: string;
  color: string;
  icon: string;
  defaultUsefulLifeYears: number | null;
  defaultEstimatedPrice: number | null;
  currency: string;
  defaultCriticalityRating: number | null;
  technicalFields: string[];
  active?: boolean;
};

export const DEFAULT_ASSET_CATEGORIES = [
  { code: "civil", labelAr: "مدني", labelEn: "Civil", color: "#9c6b45", icon: "▦" },
  { code: "electrical", labelAr: "كهرباء", labelEn: "Electrical", color: "#e0a100", icon: "ϟ" },
  { code: "fire_fighting", labelAr: "مكافحة الحريق", labelEn: "Fire Fighting", color: "#d74949", icon: "◉" },
  { code: "fire_alarm", labelAr: "إنذار الحريق", labelEn: "Fire Alarm", color: "#ef6c47", icon: "⌁" },
  { code: "hvac", labelAr: "التكييف والتهوية", labelEn: "HVAC", color: "#0b91a7", icon: "❄" },
  { code: "plumbing", labelAr: "السباكة", labelEn: "Plumbing", color: "#2581ca", icon: "◌" },
  { code: "mechanical", labelAr: "ميكانيكا", labelEn: "Mechanical", color: "#596d78", icon: "⚙" },
  { code: "elv_ict", labelAr: "أنظمة خفيفة وتقنية", labelEn: "ELV / ICT", color: "#7c62c7", icon: "⌘" },
  { code: "furniture", labelAr: "أثاث", labelEn: "Furniture", color: "#7b8060", icon: "▰" },
  { code: "equipment", labelAr: "معدات", labelEn: "Equipment", color: "#087f75", icon: "◇" },
  { code: "other", labelAr: "أخرى", labelEn: "Other", color: "#87939a", icon: "+" },
] as const;
