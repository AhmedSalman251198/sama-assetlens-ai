"use client";

import { FormEvent, useEffect, useState } from "react";

export function PaginationJump({
  page,
  pageCount,
  busy = false,
  language = "ar",
  onPageChange,
}: {
  page: number;
  pageCount: number;
  busy?: boolean;
  language?: "ar" | "en";
  onPageChange: (page: number) => void;
}) {
  const [draft, setDraft] = useState(String(page));
  useEffect(() => {
    const timer = window.setTimeout(() => setDraft(String(page)), 0);
    return () => window.clearTimeout(timer);
  }, [page]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const requested = Math.trunc(Number(draft));
    const next = Number.isFinite(requested)
      ? Math.max(1, Math.min(pageCount, requested))
      : page;
    setDraft(String(next));
    if (next !== page) onPageChange(next);
  }

  return (
    <form className="pagination-jump" onSubmit={submit}>
      <label htmlFor="pagination-page-number">
        {language === "ar" ? "انتقل إلى صفحة" : "Go to page"}
      </label>
      <input
        id="pagination-page-number"
        type="number"
        inputMode="numeric"
        min={1}
        max={pageCount}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        aria-label={language === "ar" ? "رقم الصفحة" : "Page number"}
      />
      <span>/ {pageCount}</span>
      <button type="submit" disabled={busy}>
        {language === "ar" ? "انتقال" : "Go"}
      </button>
    </form>
  );
}
