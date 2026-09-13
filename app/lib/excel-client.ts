type ExcelCellValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | { text?: string; result?: unknown; formula?: string; richText?: Array<{ text?: string }> }
  | { hyperlink?: string; text?: string };

type ExcelRow = Record<string, string | number | boolean>;

function columnName(index: number) {
  let name = "";
  let current = index;
  while (current > 0) {
    const mod = (current - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    current = Math.floor((current - mod) / 26);
  }
  return name;
}

function normalizeCell(value: ExcelCellValue) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map(part => part.text || "").join("").trim();
  if ("text" in value && typeof value.text === "string") return value.text.trim();
  if ("result" in value) return normalizeCell(value.result as ExcelCellValue);
  if ("hyperlink" in value && typeof value.hyperlink === "string") return value.hyperlink.trim();
  return "";
}

function parseDelimited(text: string, limit: number, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      // Keep the possible 30-line preamble and one overflow row. Never
      // silently discard records from a large legacy register.
      if (rows.length > limit + 31) break;
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  if (quoted) throw new Error("The CSV file has an unclosed quoted cell.");
  return rows;
}

const HEADER_ALIASES = new Set([
  "assetno", "assetnumber", "tagno", "رقمالأصل", "assettype", "equipmenttype", "نوعالأصل",
  "manufacturer", "make", "brand", "الشركةالمصنعة", "model", "modelno", "modelnumber", "الموديل",
  "serial", "serialno", "serialnumber", "sn", "الرقمالتسلسلي", "building", "site", "location", "المبنى", "الموقع",
  "floor", "level", "الطابق", "zone", "area", "الزون", "المنطقة", "office", "room", "المكتب", "الغرفة",
  "condition", "assetcondition", "حالةالأصل", "criticality", "importance", "الأهمية", "category", "assetcategory", "التصنيف",
  "operationalstatus", "replacementcost", "estimatedprice", "purchaseprice", "currency", "pricecurrency", "usefullife", "remaininglife", "installationdate",
  "حالةالتشغيل", "تكلفةالاستبدال", "السعرالتقديري", "العملة", "العمرالافتراضي", "العمرالمتبقي", "تاريخالتركيب",
]);

function normalizedHeader(value: string) {
  return value.toLowerCase().replace(/[\s_\-/.()#:]+/g, "").trim();
}

function headerScore(row: string[]) {
  const cells = row.map(cell => cell.trim()).filter(Boolean);
  if (cells.length < 2) return -1;
  const recognized = cells.filter(cell => HEADER_ALIASES.has(normalizedHeader(cell))).length;
  const textCells = cells.filter(cell => !/^[-+]?\d+(\.\d+)?$/.test(cell)).length;
  const unique = new Set(cells.map(normalizedHeader)).size;
  // A wide data row must not beat a short but correctly recognized heading.
  return (recognized ? 100 + recognized * 20 : 0) + textCells * 1.2 + unique * .5 - Math.max(0, cells.length - unique) * 2;
}

function uniqueHeaders(values: string[]) {
  const used = new Map<string, number>();
  return values.map((value, index) => {
    const base = value.trim() || `Column ${index + 1}`;
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function inspectMatrix(matrix: string[][], sheet: string, limit: number, selectedHeaderRow?: number) {
  const candidates = matrix.slice(0, Math.min(100, matrix.length));
  let headerRow = 0;
  let bestScore = -Infinity;
  candidates.forEach((row, index) => {
    const score = headerScore(row);
    if (score > bestScore) { bestScore = score; headerRow = index; }
  });
  if (selectedHeaderRow !== undefined) {
    if (!Number.isInteger(selectedHeaderRow) || selectedHeaderRow < 1 || selectedHeaderRow > matrix.length || !matrix[selectedHeaderRow - 1]?.some(value => value.trim())) {
      throw new Error(`Sheet ${sheet}: choose a non-empty header row between 1 and ${matrix.length}.`);
    }
    headerRow = selectedHeaderRow - 1;
  }
  const headers = uniqueHeaders(matrix[headerRow] || []);
  const dataRows = matrix.slice(headerRow + 1)
    .map((values, index) => ({ values, sourceRow: headerRow + index + 2 }))
    .filter(item => item.values.some(value => value.trim()));
  if (dataRows.length > limit) throw new Error(`The spreadsheet contains more than ${limit.toLocaleString("en-US")} data rows. Split it by project and import each file separately.`);
  const rows = dataRows
    .map(item => ({
      ...Object.fromEntries(headers.map((header, column) => [header, item.values[column]?.trim() || ""])),
      __sheet: sheet,
      __row: String(item.sourceRow),
    }));
  return { sheet, headerRow: headerRow + 1, headers, rows };
}

export type SpreadsheetInspection = {
  sheets: Array<{ sheet: string; headerRow: number; headers: string[]; rowCount: number }>;
  headers: string[];
  rows: Record<string, string>[];
};

export async function inspectSpreadsheet(file: File, limit = 100_000, headerRows: Record<string, number> = {}): Promise<SpreadsheetInspection> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv") || lowerName.endsWith(".tsv")) {
    const source = await file.text();
    const candidates = lowerName.endsWith(".tsv") ? ["\t"] : [",", ";", "\t"];
    const delimiter = candidates.map(candidate => {
      const sample = parseDelimited(source, 35, candidate).slice(0, 35);
      return { candidate, score: Math.max(...sample.map(headerScore)) };
    }).sort((left, right) => right.score - left.score)[0].candidate;
    const inspected = inspectMatrix(parseDelimited(source, limit, delimiter), file.name, limit, headerRows[file.name]);
    return { sheets: [{ sheet: inspected.sheet, headerRow: inspected.headerRow, headers: inspected.headers, rowCount: inspected.rows.length }], headers: inspected.headers, rows: inspected.rows };
  }

  if (lowerName.endsWith(".xls")) throw new Error("Legacy .xls files are not supported safely. Save the file as .xlsx or CSV and try again.");
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const inspectedSheets = workbook.worksheets.map(worksheet => {
    const matrix: string[][] = [];
    worksheet.eachRow({ includeEmpty: true }, row => {
      const values = row.values as ExcelCellValue[];
      const width = Math.max(0, values.length - 1);
      matrix.push(Array.from({ length: width }, (_, index) => normalizeCell(row.getCell(index + 1).value as ExcelCellValue)));
    });
    return inspectMatrix(matrix, worksheet.name, limit, headerRows[worksheet.name]);
  }).filter(sheet => sheet.rows.length > 0);
  const headers = Array.from(new Set(inspectedSheets.flatMap(sheet => sheet.headers)));
  const rows = inspectedSheets.flatMap(sheet => sheet.rows);
  if (rows.length > limit) throw new Error(`The spreadsheet contains more than ${limit.toLocaleString("en-US")} data rows. Split it by project and import each file separately.`);
  return { sheets: inspectedSheets.map(sheet => ({ sheet: sheet.sheet, headerRow: sheet.headerRow, headers: sheet.headers, rowCount: sheet.rows.length })), headers, rows };
}

export async function exportWorkbook(
  filename: string,
  sheets: Array<{ name: string; rows: ExcelRow[]; columns?: string[] }>
) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AssetLens AI";
  workbook.created = new Date();

  for (const sheet of sheets) {
    const columns = sheet.columns || Object.keys(sheet.rows[0] || {});
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.columns = columns.map(key => ({
      header: key,
      key,
      width: Math.min(42, Math.max(12, key.length + 3, ...sheet.rows.map(row => String(row[key] ?? "").length + 2))),
    }));
    sheet.rows.forEach(row => worksheet.addRow(row));
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    if (columns.length > 0) {
      worksheet.autoFilter = { from: "A1", to: `${columnName(columns.length)}1` };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function readSpreadsheetRows(file: File, limit = 500) {
  return (await inspectSpreadsheet(file, limit)).rows;
}
