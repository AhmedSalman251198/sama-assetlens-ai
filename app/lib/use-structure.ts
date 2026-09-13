"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiClientError } from "./api-client";

export type StructureFloor = { id: string; name: string; sortOrder: number };
export type StructureZone = { id: string; floorId: string | null; name: string };
export type StructureOffice = { id: string; floorId: string | null; zoneId: string | null; name: string };
export type StructureLocationOption = { id: string; buildingId: string | null; floorId: string | null; zoneId: string | null; officeId: string | null; parentOptionId: string | null; name: string };
export type StructureLocationLevel = { id: string; key: string; labelAr: string; labelEn: string; required: boolean; sortOrder: number; parentLevelId: string; options: StructureLocationOption[] };
export type StructureBuilding = { id: string; name: string; floors: StructureFloor[]; zones: StructureZone[]; offices: StructureOffice[] };
export type StructureProject = {
  id: string; name: string; requireBuilding: boolean; requireFloor: boolean; requireZone: boolean; requireOffice: boolean; allowManual: boolean;
  buildings: StructureBuilding[];
  locationLevels: StructureLocationLevel[];
};
export type StructureConfig = { currentUser: { id: string; email: string; name: string; role: "admin" | "project_manager" | "reviewer" | "surveyor" | "viewer" }; projects: StructureProject[]; error?: string };

export function useStructure() {
  const [data, setData] = useState<StructureConfig | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (force = false) => {
    setError("");
    try {
      const payload = await apiGet<StructureConfig>("/api/config?scope=structure", { ttlMs: 5 * 60_000, force });
      setData(payload);
    } catch (reason) {
      if (reason instanceof ApiClientError && (reason.status === 401 || reason.status === 403)) { window.location.replace("/login"); return; }
      setError(reason instanceof Error ? reason.message : "تعذر تحميل هيكل المواقع.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => { if (active) void load(); }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [load]);
  return { data, error, reload: () => load(true) };
}
