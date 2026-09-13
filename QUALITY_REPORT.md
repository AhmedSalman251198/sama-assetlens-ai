# AssetLens AI R17 — Quality Report

Release status: production-ready candidate  
Verification date: 2026-09-10

## Automated verification

| Check | Result |
| --- | --- |
| ESLint | Passed — 0 errors, 0 warnings |
| TypeScript strict check | Passed |
| Next.js production build | Passed |
| Static/dynamic routes built | 23/23 |
| Automated quality tests | 29/29 passed |
| Production dependency audit | 0 known vulnerabilities |
| Production HTTP smoke test | 8/8 primary pages returned HTTP 200 |

Smoke-tested pages: `/`, `/login`, `/capture`, `/locations`, `/reports`, `/reports/ai`, `/scan`, `/admin`.

## R17 test coverage

- Required Category, Condition and Criticality in camera, gallery, Manual and Bulk entry flows.
- Separate operational status and automatic Criticality weight.
- Condition justification for Critical/Poor assets.
- Idempotent manual asset creation and complete form reset after success.
- Project categories and administrator category management.
- Per-user project, sidebar and action permissions with server-side API enforcement.
- Direct password account creation without public signup or email confirmation.
- Stable QR ID, online Supabase refresh, local offline cache and compatibility with legacy QR formats.
- Nameplate-only 30-day retention metadata and protected daily cleanup endpoint.
- Asset Management editing and online exact-model enrichment route.
- Dashboard filters and radial Criticality chart.
- Report filters, enriched Excel columns and AI project PDF view.
- Global language/theme controls and versioned PWA cache.

## Deployment-bound checks

Live database writes, Supabase Auth administration, Storage deletion, Gemini grounded search, camera/gallery permissions and real offline behavior require the target project's credentials and HTTPS deployment. Run the acceptance checklist in `VERCEL_DEPLOYMENT.md` after applying migration 013 and redeploying.

## Required server secrets

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`)
- `GEMINI_API_KEY` for AI analysis, enrichment and generated narrative
- `CRON_SECRET` for the daily nameplate cleanup endpoint

No secret value is included in this package.
