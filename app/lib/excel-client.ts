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

function parseCsv(text: string, limit: number) {
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
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (rows.length > limit) break;
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = (rows[0] || []).map(value => value.trim());
  return rows.slice(1, limit + 1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ""])));
}

export async function exportWorkbook(
  filename: string,
  sheets: Array<{ name: string; rows: ExcelRow[]; columns?: string[] }>
) {
  const ExcelJS = await import("exceljs");
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
  if (file.name.toLowerCase().endsWith(".csv")) {
    return parseCsv(await file.text(), limit);
  }

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headers = (worksheet.getRow(1).values as ExcelCellValue[])
    .slice(1)
    .map(value => normalizeCell(value));
  const rows: Record<string, string>[] = [];
  const maxRow = Math.min(worksheet.rowCount, limit + 1);
  for (let rowNumber = 2; rowNumber <= maxRow; rowNumber += 1) {
    const worksheetRow = worksheet.getRow(rowNumber);
    const row = Object.fromEntries(headers.map((header, index) => [header, normalizeCell(worksheetRow.getCell(index + 1).value as ExcelCellValue)]));
    rows.push(row);
  }
  return rows;
}
