# AssetLens AI R18 — Release Test Report

Date: 2026-09-10  
Release: 1.8.0

## Final result

All local release gates passed.

| Gate | Result |
|---|---|
| ESLint | PASS — 0 errors |
| TypeScript strict check | PASS — 0 errors |
| Production build | PASS — 23 routes generated |
| Automated quality tests | PASS — 34/34 |
| Production dependency audit | PASS — 0 vulnerabilities |
| Production HTTP smoke test | PASS — all 10 UI routes returned HTTP 200 |

## Tested release-critical behavior

- Compact self-contained QR snapshot with immutable Asset UUID and online Supabase refresh.
- Direct QR parsing without an internet connection or deployed URL.
- Mandatory per-asset Condition and Criticality across capture, manual entry and spreadsheet import.
- Poor/Critical condition justification enforcement.
- Review queue opening and permission-gated approval.
- Super-admin direct account creation, password reset and granular module/action permissions.
- Safe category add/edit/disable/delete and prohibition of category-level criticality defaults.
- Separate camera and gallery controls on mobile web.
- XLSX multi-sheet import with shuffled columns, title/blank rows and Arabic/English headers.
- Duplicate and invalid spreadsheet row rejection with source sheet/row reporting.
- Extended AI PDF data model: risk matrix, lifecycle, budget, action plan and data quality.
- AR/EN switching, RTL/LTR, high-contrast dark surfaces and PWA cache version R18.

## Environment boundary

The package contains only `.env.example`; therefore live Supabase authentication, RLS and AI-provider calls require the deployment credentials before end-to-end production testing. The database migration is supplied as `AssetLens_AI_R18_Supabase_Update.sql`.
