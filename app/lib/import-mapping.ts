export function findImportCell(row: Record<string, unknown>, aliases: string[], mappedHeader = "") {
  // An explicit mapping is preferred, but can be absent on another sheet of
  // the same workbook. Match that sheet's localized headers instead.
  if (mappedHeader && row[mappedHeader] != null && String(row[mappedHeader]).trim()) return String(row[mappedHeader]).trim();
  const wanted = new Set(aliases.map(value => value.toLowerCase().replace(/[\s_\-/.()]+/g, "").trim()));
  const entry = Object.entries(row).find(([key, value]) => wanted.has(key.toLowerCase().replace(/[\s_\-/.()]+/g, "").trim()) && value != null && String(value).trim());
  return entry ? String(entry[1]).trim() : "";
}

export function reconcileImportCounts(totalRows: number, imported: number, skipped: number, rejected: number) {
  if (![totalRows, imported, skipped, rejected].every(value => Number.isSafeInteger(value) && value >= 0) || imported + skipped + rejected !== totalRows) {
    throw new Error(`Import is incomplete: ${imported} imported + ${skipped} duplicates + ${rejected} rejected does not equal ${totalRows} source rows. Do not discard the source file; retry missing batches.`);
  }
  return true;
}
