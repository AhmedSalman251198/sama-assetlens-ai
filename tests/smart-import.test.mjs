import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { inspectSpreadsheet } from "../app/lib/excel-client.ts";

test("smart CSV inspection skips title rows and detects semicolon headers", async () => {
  const source = [
    "MOHRE Asset Register;;;;",
    "Generated 2026-09-10;;;;",
    "Asset No;Asset Type;Manufacturer;Model;Serial Number",
    "A-1;Chiller;Carrier;30XW;SN-001",
    ";;;;",
    "A-2;Light;Philips;L20;SN-002",
  ].join("\n");
  const result = await inspectSpreadsheet(new File([source], "register.csv", { type: "text/csv" }));
  assert.equal(result.sheets[0].headerRow, 3);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]["Asset Type"], "Chiller");
  assert.equal(result.rows[1]["Serial Number"], "SN-002");
  assert.equal(result.rows[1].__row, "6");
});

test("smart CSV inspection recognizes Arabic headers and source row metadata", async () => {
  const source = "تقرير الأصول,,,,\nرقم الأصل,نوع الأصل,الشركة المصنعة,الموديل,الرقم التسلسلي\n12,مكيف,Carrier,42Q,S-12";
  const result = await inspectSpreadsheet(new File([source], "assets-ar.csv", { type: "text/csv" }));
  assert.equal(result.sheets[0].headerRow, 2);
  assert.equal(result.rows[0]["نوع الأصل"], "مكيف");
  assert.equal(result.rows[0].__row, "3");
});

test("smart XLSX inspection reads every sheet and preserves shuffled columns", async () => {
  const workbook = new ExcelJS.Workbook();
  const hvac = workbook.addWorksheet("HVAC Assets");
  hvac.addRow(["Quarterly equipment register"]);
  hvac.addRow([]);
  hvac.addRow(["Serial Number", "Model", "Asset Type", "Asset No", "Manufacturer"]);
  hvac.addRow(["HV-001", "30XW", "Chiller", "A-100", "Carrier"]);
  const electrical = workbook.addWorksheet("Electrical");
  electrical.addRow(["تقرير الكهرباء"]);
  electrical.addRow(["نوع الأصل", "الرقم التسلسلي", "رقم الأصل", "الشركة المصنعة", "الموديل"]);
  electrical.addRow(["لوحة كهرباء", "EL-009", "A-200", "Schneider", "Prisma"]);
  const bytes = await workbook.xlsx.writeBuffer();
  const result = await inspectSpreadsheet(new File([bytes], "mixed-register.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  assert.equal(result.sheets.length, 2);
  assert.equal(result.sheets[0].headerRow, 3);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]["Asset Type"], "Chiller");
  assert.equal(result.rows[0].__sheet, "HVAC Assets");
  assert.equal(result.rows[1]["الشركة المصنعة"], "Schneider");
  assert.equal(result.rows[1].__sheet, "Electrical");
});

test("recognized headers win over wide text rows, and a reviewer may override a sheet header", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Strange export");
  sheet.addRow(["Asset No", "Asset Type", "Serial Number"]);
  sheet.addRow(["A-1", "Chiller", "SN-01", "very", "wide", "text", "data", "in", "a", "legacy", "row"]);
  sheet.addRow(["Tag", "Equipment", "Serial", "Condition"]);
  sheet.addRow(["A-2", "Light", "SN-02", "Poor"]);
  const bytes = await workbook.xlsx.writeBuffer();
  const file = new File([bytes], "wide.xlsx");
  const automatic = await inspectSpreadsheet(file);
  assert.equal(automatic.sheets[0].headerRow, 1);
  assert.equal(automatic.rows.length, 3);
  const reviewed = await inspectSpreadsheet(file, 100_000, { "Strange export": 3 });
  assert.equal(reviewed.sheets[0].headerRow, 3);
  assert.equal(reviewed.rows.length, 1);
  assert.equal(reviewed.rows[0].Tag, "A-2");
  assert.equal(reviewed.rows[0].__row, "4");
  await assert.rejects(inspectSpreadsheet(file, 100_000, { "Strange export": 999 }), /choose a non-empty header row/);
});

test("a multi-sheet XLSX register above 2,000 assets retains the first and last row of every sheet", async () => {
  const workbook = new ExcelJS.Workbook();
  const first = workbook.addWorksheet("HVAC");
  first.addRow(["Quarterly export"]);
  first.addRow(["Model", "Serial Number", "Asset No", "Asset Type", "Office"]);
  for (let index = 1; index <= 1100; index += 1) first.addRow(["X10", `H-${index}`, `HV-${index}`, "Chiller", `Office ${index}`]);
  const second = workbook.addWorksheet("Electrical");
  second.addRow(["Generated for review"]);
  second.addRow(["نوع الأصل", "رقم الأصل", "الرقم التسلسلي", "الموديل"]);
  for (let index = 1; index <= 1137; index += 1) second.addRow(["لوحة كهربائية", `EL-${index}`, `S-${index}`, "DB-2"]);
  const file = new File([await workbook.xlsx.writeBuffer()], "client-register.xlsx");
  const result = await inspectSpreadsheet(file);
  assert.equal(result.rows.length, 2237);
  assert.deepEqual(result.sheets.map(sheet => sheet.rowCount), [1100, 1137]);
  assert.equal(result.rows[0]["Asset No"], "HV-1");
  assert.equal(result.rows[1099]["Asset No"], "HV-1100");
  assert.equal(result.rows[1100]["رقم الأصل"], "EL-1");
  assert.equal(result.rows.at(-1)["رقم الأصل"], "EL-1137");
  assert.equal(result.rows.at(-1).__row, "1139");
});
