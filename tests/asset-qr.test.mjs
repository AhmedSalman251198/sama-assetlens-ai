import assert from "node:assert/strict";
import test from "node:test";
import { buildAssetQrPayload, createAssetQrText, createAssetQrValue, parseAssetQrValue } from "../app/lib/asset-qr.ts";

test("offline QR roundtrip keeps only the core asset snapshot and selected custom fields", async () => {
  const payload = buildAssetQrPayload({
    id: "2a50d147-d12c-4d58-819f-c26620578d89",
    assetNo: "AST-00042",
    projectId: "7f31e024-0650-4955-b8e0-5d4908c01dc0",
    project: "MOEI",
    building: "Main Building",
    floor: "Ground",
    zone: "MEP Room",
    assetType: "Chiller",
    summary: "Water-cooled chiller",
    status: "completed",
    conditionRating: 4,
    criticalityRating: 5,
    confidence: 0,
    latitude: 0,
    longitude: 55.312345,
    capturedOffline: false,
    fields: [
      { key: "manufacturer", label: "Manufacturer", value: "Carrier" },
      { key: "model", label: "Model", value: "30XW" },
      { key: "ratedPower", label: "Rated Power", value: "0 kW" },
    ],
    customValues: [
      { key: "condition", labelEn: "Condition", value: "Good" },
      { key: "department", labelEn: "Department", value: "Facilities" },
    ],
  });

  const encoded = await createAssetQrValue("https://assetlens.example", payload);
  assert.match(encoded, /^https:\/\/assetlens\.example\/scan#alqr2\.[gj]\./);
  const decoded = await parseAssetQrValue(encoded);

  assert.equal(decoded?.assetId, payload.assetId);
  assert.equal(decoded?.assetNo, payload.assetNo);
  assert.deepEqual(decoded?.fields, payload.fields);
  assert.ok(decoded?.fields.some(field => field.label === "Manufacturer" && field.value === "Carrier"));
  assert.ok(decoded?.fields.some(field => field.label === "Asset Condition Rating" && field.value === "4/5"));
  assert.ok(decoded?.fields.some(field => field.label === "Asset Criticality" && field.value === "Critical (Weight 5)"));
  assert.ok(decoded?.fields.some(field => field.label === "Condition" && field.value === "Good"));
  assert.ok(decoded?.fields.some(field => field.label === "Department" && field.value === "Facilities"));
  assert.ok(!decoded?.fields.some(field => field.label === "AI Confidence"));
  assert.ok(!decoded?.fields.some(field => field.label === "Latitude"));
  assert.ok(!decoded?.fields.some(field => field.label === "Rated Power"));
});

test("offline QR refuses an empty database snapshot", () => {
  assert.throws(() => buildAssetQrPayload({ id: "2a50d147-d12c-4d58-819f-c26620578d89", assetNo: "AST-EMPTY" }), /does not contain enough asset data/);
});

test("direct offline QR is readable text and needs no URL or deployment", async () => {
  const payload = buildAssetQrPayload({
    id: "2a50d147-d12c-4d58-819f-c26620578d89",
    assetNo: "AST-DIRECT-01",
    project: "MOEI",
    assetType: "Air Conditioner",
    fields: [{ key: "serial", label: "Serial Number", value: "56P01085" }],
  });
  const direct = createAssetQrText(payload);
  assert.match(direct, /^ASSETLENS-OFFLINE-V2\n/);
  assert.match(direct, /Asset Number: AST-DIRECT-01/);
  assert.match(direct, /Serial Number: 56P01085/);
  assert.doesNotMatch(direct, /https?:\/\//);
  const decoded = await parseAssetQrValue(direct);
  assert.equal(decoded?.assetId, payload.assetId);
  assert.deepEqual(decoded?.fields, payload.fields);
});
