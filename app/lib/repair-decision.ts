export function compareRepairAndReplacement(repairCost: number, replacementCost: number | null) {
  if (!Number.isFinite(repairCost) || repairCost < 0 || repairCost > 1_000_000_000) throw new Error("Enter a valid repair cost.");
  if (replacementCost !== null && (!Number.isFinite(replacementCost) || replacementCost <= 0 || replacementCost > 1_000_000_000)) throw new Error("Enter a valid replacement cost.");
  const gap = replacementCost === null ? null : Math.round((replacementCost - repairCost) * 100) / 100;
  return { repairCost, replacementCost, gap, ratio: replacementCost === null ? null : Math.round(repairCost * 100 / replacementCost) };
}
