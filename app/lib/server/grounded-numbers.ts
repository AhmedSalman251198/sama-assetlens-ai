const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

function normalizedDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => ARABIC_DIGITS[digit] || digit)
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "");
}

function numberTokens(value: string) {
  return normalizedDigits(value).match(/-?\d+(?:\.\d+)?/g) || [];
}

function canonicalNumber(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : value;
}

/** Reject model prose containing a number absent from the supplied evidence. */
export function hasOnlyGroundedNumbers(text: string, evidence: unknown) {
  const allowed = new Set(
    numberTokens(JSON.stringify(evidence)).map(canonicalNumber),
  );
  return numberTokens(text).every((token) => allowed.has(canonicalNumber(token)));
}
