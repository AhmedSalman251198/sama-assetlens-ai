"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiClientError } from "./api-client";

export type StructureFloor = { id: string; name: string; sortOrder: number };
export type StructureZone = { id: string; floorId: string | null; name: string };
export type StructureBuilding = { id: string; name: string; floors: StructureFloor[]; zones: StructureZone[] };
export type StructureProject = {
  id: string; name: string; requireBuilding: boolean; requireFloor: boolean; requireZone: boolean; allowManual: boolean;
  buildings: StructureBuilding[];
};
export type StructureConfig = { currentUser: { id: string; email: string; name: string; role: "admin" | "surveyor" }; projects: StructureProject[]; error?: string };

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
