"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { apiGet, ApiClientError, invalidateApiCache } from "../lib/api-client";
import { getAccessToken } from "../lib/supabase-auth";
import { useStructure } from "../lib/use-structure";
import { languageText, useUiLanguage } from "../lib/use-ui-language";

type DynamicLocationValue = {
  levelId: string;
  key: string;
  labelAr: string;
  labelEn: string;
  valueId: string;
  value: string;
};
type Asset = {
  id: string;
  assetNo: string;
  assetType: string;
  projectId: string;
  project: string;
  building: string;
  floor: string;
  zone: string;
  office: string;
  additionalLocations: DynamicLocationValue[];
  canTransfer: boolean;
  status: string;
};
type AssetPayload = { records: Asset[]; total: number; error?: string };

function TransfersContent() {
  const language = useUiLanguage();
  const l = (ar: string, en: string) => languageText(language, ar, en);
  const params = useSearchParams();
  const { data: structure, error: structureError } = useStructure();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [locationSelections, setLocationSelections] = useState<
    Record<string, string>
  >({});
  const [manualLocationValues, setManualLocationValues] = useState<
    Record<string, string>
  >({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warning, setWarning] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadAssets = useCallback(
    async (force = false) => {
      try {
        const query = new URLSearchParams({
          view: "transfer",
          page: "1",
          pageSize: "100",
        });
        const requestedAsset = params.get("asset") || "";
        if (requestedAsset && !search) query.set("asset", requestedAsset);
        else if (search) query.set("search", search);
        const payload = await apiGet<AssetPayload>(`/api/assets?${query}`, {
          ttlMs: 20_000,
          force,
        });
        const editable = payload.records.filter((asset) => asset.canTransfer);
        setAssets(editable);
        if (
          requestedAsset &&
          editable.some((asset) => asset.id === requestedAsset)
        )
          setAssetId(requestedAsset);
      } catch (reason) {
        if (
          reason instanceof ApiClientError &&
          (reason.status === 401 || reason.status === 403)
        ) {
          window.location.replace("/login");
          return;
        }
        setError(
          reason instanceof Error ? reason.message : "تعذر تحميل الأصول.",
        );
      }
    },
    [params, search],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAssets(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAssets]);
  const selectedAsset = assets.find((asset) => asset.id === assetId);
  const project = structure?.projects.find(
    (item) => item.id === selectedAsset?.projectId,
  );
  const building = project?.buildings.find((item) => item.id === buildingId);
  const zones =
    building?.zones.filter(
      (zone) => !zone.floorId || !floorId || zone.floorId === floorId,
    ) || [];
  const offices =
    building?.offices.filter(
      (office) =>
        (!office.floorId || !floorId || office.floorId === floorId) &&
        (!office.zoneId || !zoneId || office.zoneId === zoneId),
    ) || [];
  const dynamicOptionsFor = (
    level: NonNullable<typeof project>["locationLevels"][number],
  ) =>
    level.options.filter(
      (option) =>
        (!option.buildingId || option.buildingId === buildingId) &&
        (!option.floorId || option.floorId === floorId) &&
        (!option.zoneId || option.zoneId === zoneId) &&
        (!option.officeId || option.officeId === officeId) &&
        (!level.parentLevelId ||
          Boolean(
            locationSelections[level.parentLevelId] &&
            option.parentOptionId === locationSelections[level.parentLevelId],
          )),
    );
  const dynamicLocations: DynamicLocationValue[] = (
    project?.locationLevels || []
  ).map((level) => {
    if (level.key === "office")
      return {
        levelId: level.id,
        key: level.key,
        labelAr: level.labelAr,
        labelEn: level.labelEn,
        valueId: "",
        value: offices.find((item) => item.id === officeId)?.name || "",
      };
    const selectedId = locationSelections[level.id] || "";
    const options = dynamicOptionsFor(level);
    const option = options.find((item) => item.id === selectedId);
    return {
      levelId: level.id,
      key: level.key,
      labelAr: level.labelAr,
      labelEn: level.labelEn,
      valueId: option?.id || "",
      value:
        selectedId === "__manual__"
          ? (manualLocationValues[level.id] || "").trim()
          : option?.name || "",
    };
  });

  useEffect(() => {
    if (!project || buildingId) return;
    const requestedBuilding = params.get("building") || "";
    if (
      !requestedBuilding ||
      !project.buildings.some((item) => item.id === requestedBuilding)
    )
      return;
    const timer = window.setTimeout(() => setBuildingId(requestedBuilding), 0);
    return () => window.clearTimeout(timer);
  }, [project, buildingId, params]);

  async function transfer() {
    if (!selectedAsset || !project) return;
    if (project.requireBuilding && !buildingId) {
      setError(
        l(
          "اختر المبنى المستهدف قبل حفظ النقل.",
          "Choose the target building before transferring.",
        ),
      );
      return;
    }
    if (project.requireFloor && !floorId) {
      setError(
        l(
          "اختر الطابق المستهدف قبل حفظ النقل.",
          "Choose the target floor before transferring.",
        ),
      );
      return;
    }
    if (project.requireZone && !zoneId) {
      setError(
        l(
          "اختر الزون المستهدف قبل حفظ النقل.",
          "Choose the target zone before transferring.",
        ),
      );
      return;
    }
    if (project.requireOffice && !officeId) {
      setError(
        l(
          "اختر المكتب المستهدف قبل حفظ النقل.",
          "Choose the target office before transferring.",
        ),
      );
      return;
    }
    const missingDynamic = (project.locationLevels || []).find(
      (level) =>
        level.required &&
        !dynamicLocations.find((item) => item.levelId === level.id)?.value,
    );
    if (missingDynamic) {
      setError(
        l(
          `اختر ${missingDynamic.labelAr} قبل حفظ النقل.`,
          `Choose ${missingDynamic.labelEn || missingDynamic.labelAr} before transferring.`,
        ),
      );
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setWarning("");
    try {
      const token = await getAccessToken();
      if (!token) {
        window.location.replace("/login");
        return;
      }
      const response = await fetch("/api/assets", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "transfer",
          id: selectedAsset.id,
          projectId: selectedAsset.projectId,
          buildingId,
          floorId,
          zoneId,
          officeId,
          additionalLocations: dynamicLocations.filter((item) => item.value),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        relationshipWarning?: { count: number; code: string } | null;
      };
      if (!response.ok) throw new Error(payload.error || "تعذر نقل الأصل.");
      invalidateApiCache("/api/assets");
      invalidateApiCache("/api/dashboard");
      invalidateApiCache("/api/reports");
      setNotice(
        l(
          `تم نقل الأصل ${selectedAsset.assetNo} بنجاح إلى ${building?.name || project.name}.`,
          `Asset ${selectedAsset.assetNo} was transferred to ${building?.name || project.name}.`,
        ),
      );
      if (payload.relationshipWarning?.count) {
        setWarning(
          l(
            `تنبيه: لدى الأصل ${payload.relationshipWarning.count} علاقة مسجلة. راجع الربط لأن الأصل المرتبط قد يكون بقي في المبنى السابق.`,
            `Warning: this asset has ${payload.relationshipWarning.count} recorded relationship(s). Review them because a linked asset may remain in the previous building.`,
          ),
        );
      }
      await loadAssets(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر نقل الأصل.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="al-page transfers-page"
      dir={language === "ar" ? "rtl" : "ltr"}
    >
      <header className="al-page-head">
        <div>
          <span className="al-page-kicker">Controlled movement</span>
          <h2>
            {l(
              "نقل أصل داخل المشروع بأمان",
              "Safely transfer an asset within its project",
            )}
          </h2>
          <p>
            {l(
              "اختر الأصل ثم الموقع الجديد. يمنع النظام النقل بين مشروعين مختلفين ويحفظ العملية في سجل التدقيق.",
              "Choose the asset and its new location. Cross-project transfers are blocked and every move is audited.",
            )}
          </p>
        </div>
      </header>
      {(error || structureError) && (
        <div className="al-alert error" role="alert" data-scroll-alert>
          {error || structureError}
        </div>
      )}
      {notice && (
        <div
          className="transfer-notice al-alert success"
          role="status"
          aria-live="polite"
          data-scroll-alert
        >
          ✓ {notice}
        </div>
      )}
      {warning && (
        <div
          className="al-alert warning"
          role="status"
          aria-live="polite"
          data-scroll-alert
        >
          ⚠ {warning}
        </div>
      )}
      <div className="transfer-layout">
        <article className="al-card transfer-select-card">
          <div className="al-card-head">
            <div>
              <h3>{l("1. اختر الأصل", "1. Choose asset")}</h3>
              <p>
                {l(
                  "ابحث برقم الأصل أو النوع أو الموقع",
                  "Search by asset number, type or location",
                )}
              </p>
            </div>
          </div>
          <div className="transfer-select-body">
            <label>
              <span>{l("بحث سريع", "Quick search")}</span>
              <div>
                ⌕
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="AST-001 or Chiller"
                />
              </div>
            </label>
            <label>
              <span>{l("الأصل القابل للنقل", "Transferable asset")}</span>
              <select
                value={assetId}
                onChange={(event) => {
                  setAssetId(event.target.value);
                  setBuildingId("");
                  setFloorId("");
                  setZoneId("");
                  setOfficeId("");
                  setLocationSelections({});
                  setManualLocationValues({});
                  setNotice("");
                  setWarning("");
                }}
              >
                <option value="">{l("اختر الأصل", "Choose asset")}</option>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.assetNo || asset.id.slice(0, 8)} —{" "}
                    {asset.assetType || "Asset"} — {asset.project}
                  </option>
                ))}
              </select>
            </label>
            {selectedAsset ? (
              <div className="selected-asset-card">
                <span>ASSET</span>
                <strong>{selectedAsset.assetNo}</strong>
                <h4>
                  {selectedAsset.assetType ||
                    l("أصل بدون تصنيف", "Unclassified asset")}
                </h4>
                <p>{selectedAsset.project}</p>
                <small>
                  {[
                    selectedAsset.building,
                    selectedAsset.floor,
                    selectedAsset.zone,
                    selectedAsset.office,
                    ...(selectedAsset.additionalLocations || []).map(
                      (item) => item.value,
                    ),
                  ]
                    .filter(Boolean)
                    .join(" · ") || l("لا يوجد موقع حالي", "Not set")}
                </small>
              </div>
            ) : (
              <div className="transfer-placeholder">
                {l(
                  "اختر أصلًا لعرض موقعه الحالي.",
                  "Choose an asset to view its current location.",
                )}
              </div>
            )}
          </div>
        </article>
        <article className="al-card transfer-target-card">
          <div className="al-card-head">
            <div>
              <h3>{l("2. حدد الموقع الجديد", "2. Choose new location")}</h3>
              <p>
                {l(
                  "الخيارات مرتبطة بمشروع الأصل فقط",
                  "Options are limited to the asset's project",
                )}
              </p>
            </div>
          </div>
          <div className="transfer-target-body">
            <label>
              <span>{l("المشروع", "Project")}</span>
              <input
                value={selectedAsset?.project || ""}
                readOnly
                placeholder={l("اختر الأصل أولًا", "Choose an asset first")}
              />
            </label>
            <label>
              <span>
                {l("المبنى / الموقع", "Building / site")}{" "}
                {project?.requireBuilding && <em>{l("إلزامي", "Required")}</em>}
              </span>
              <select
                value={buildingId}
                disabled={!project}
                onChange={(event) => {
                  setBuildingId(event.target.value);
                  setFloorId("");
                  setZoneId("");
                  setOfficeId("");
                  setLocationSelections({});
                  setManualLocationValues({});
                }}
              >
                <option value="">{l("اختر المبنى", "Choose building")}</option>
                {project?.buildings.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                {l("الطابق", "Floor")}{" "}
                {project?.requireFloor && <em>{l("إلزامي", "Required")}</em>}
              </span>
              <select
                value={floorId}
                disabled={!building}
                onChange={(event) => {
                  setFloorId(event.target.value);
                  setZoneId("");
                  setOfficeId("");
                  setLocationSelections({});
                  setManualLocationValues({});
                }}
              >
                <option value="">{l("اختر الطابق", "Choose floor")}</option>
                {building?.floors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                {l("الزون", "Zone")}{" "}
                {project?.requireZone && <em>{l("إلزامي", "Required")}</em>}
              </span>
              <select
                value={zoneId}
                disabled={!building}
                onChange={(event) => {
                  setZoneId(event.target.value);
                  setOfficeId("");
                  setLocationSelections({});
                  setManualLocationValues({});
                }}
              >
                <option value="">{l("اختر الزون", "Choose zone")}</option>
                {zones.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {project &&
              buildingId &&
              (project.requireOffice || offices.length > 0) && (
                <label>
                  <span>
                    {l("المكتب / الغرفة", "Office / room")}{" "}
                    {project.requireOffice && (
                      <em>{l("إلزامي", "Required")}</em>
                    )}
                  </span>
                  <select
                    value={officeId}
                    onChange={(event) => {
                      setOfficeId(event.target.value);
                      setLocationSelections({});
                      setManualLocationValues({});
                    }}
                  >
                    <option value="">
                      {l("اختر المكتب", "Choose office")}
                    </option>
                    {offices.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            {(project?.locationLevels || [])
              .filter((level) => level.key !== "office")
              .map((level) => {
                const options = dynamicOptionsFor(level);
                const selected = locationSelections[level.id] || "";
                return (
                  <label key={level.id}>
                    <span>
                      {l(level.labelAr, level.labelEn || level.labelAr)}{" "}
                      {level.required && <em>{l("إلزامي", "Required")}</em>}
                    </span>
                    <select
                      value={selected}
                      disabled={!building}
                      onChange={(event) => {
                        const descendants = (project?.locationLevels || [])
                          .filter((child) => child.sortOrder > level.sortOrder)
                          .map((child) => child.id);
                        setLocationSelections((current) => {
                          const next = {
                            ...current,
                            [level.id]: event.target.value,
                          };
                          for (const id of descendants) delete next[id];
                          return next;
                        });
                        setManualLocationValues((current) => {
                          const next = { ...current, [level.id]: "" };
                          for (const id of descendants) delete next[id];
                          return next;
                        });
                      }}
                    >
                      <option value="">
                        {l(
                          `اختر ${level.labelAr}`,
                          `Choose ${level.labelEn || level.labelAr}`,
                        )}
                      </option>
                      {options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                      {project?.allowManual && (
                        <option value="__manual__">
                          {l(
                            "غير موجود — إدخال يدوي",
                            "Not listed — enter manually",
                          )}
                        </option>
                      )}
                    </select>
                    {selected === "__manual__" && (
                      <input
                        value={manualLocationValues[level.id] || ""}
                        onChange={(event) =>
                          setManualLocationValues((current) => ({
                            ...current,
                            [level.id]: event.target.value,
                          }))
                        }
                        placeholder={l(
                          `اكتب ${level.labelAr}`,
                          `Enter ${level.labelEn || level.labelAr}`,
                        )}
                      />
                    )}
                  </label>
                );
              })}
            <div className="transfer-preview">
              <div>
                <span>{l("من", "From")}</span>
                <strong>
                  {[
                    selectedAsset?.building,
                    selectedAsset?.floor,
                    selectedAsset?.zone,
                    selectedAsset?.office,
                    ...(selectedAsset?.additionalLocations || []).map(
                      (item) => item.value,
                    ),
                  ]
                    .filter(Boolean)
                    .join(" / ") || l("غير محدد", "Not set")}
                </strong>
              </div>
              <i>←</i>
              <div>
                <span>{l("إلى", "To")}</span>
                <strong>
                  {[
                    building?.name,
                    building?.floors.find((item) => item.id === floorId)?.name,
                    zones.find((item) => item.id === zoneId)?.name,
                    ...dynamicLocations.map((item) => item.value),
                  ]
                    .filter(Boolean)
                    .join(" / ") || l("اختر الموقع", "Choose location")}
                </strong>
              </div>
            </div>
            <button
              className="transfer-submit"
              disabled={!selectedAsset || busy}
              onClick={() => void transfer()}
            >
              {busy
                ? l("جاري حفظ النقل…", "Saving transfer…")
                : l("تأكيد نقل الأصل", "Confirm transfer")}
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}

export default function TransfersPage() {
  return (
    <Suspense
      fallback={
        <section className="al-page al-loading-grid">
          <div className="al-skeleton" />
          <div className="al-skeleton" />
        </section>
      }
    >
      <TransfersContent />
    </Suspense>
  );
}
