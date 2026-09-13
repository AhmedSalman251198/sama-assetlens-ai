# AssetLens AI R21 — deployment and QA

## Deployment order

1. Back up the Supabase database and run migrations up to `016` if they have not already been applied.
2. Run `supabase/migrations/017_assistant_access_and_incomplete_imports.sql` in the Supabase SQL editor. Verify it completes without errors.
3. Deploy this application with its existing Supabase environment variables. Configure `GEMINI_API_KEY` or `OPENAI_API_KEY` server-side to enable real generative answers; without either, assistant questions return an explicitly labeled register-search fallback.
4. Grant **AssetLens AI Assistant** and **AI Reports** separately in Administration → Users & Roles. Both default to disabled for ordinary accounts; the original super administrator retains access.
5. Test an import, a review/approval, a restricted account, an authorized assistant question and AI report in your live environment before general rollout.

## Behavior and limits

- Smart import accepts incomplete entries and preserves missing location, category, condition, criticality and operation state for later review. Building/site can be supplied globally or per row at import, or completed later in the report detail. Approval still requires the configured mandatory data.
- Import is batched and idempotent. The automated import test imports **2,013** incomplete assets and verifies retry does not duplicate them. The source import inspector tests more than **2,400** rows, shuffled columns, CSV dialects and multiple sheets.
- AI answers are scoped to the caller's accessible assets. Cost comparisons use the recorded asset currency and either a recorded replacement cost or an explicitly entered estimate; no external market price is invented. Financial and energy opportunities are omitted when evidence is missing or currencies are mixed. Optional report notes are shown as unverified user input.
- Floating chat and AI reports are separately permission-gated on both the UI and the server. Pages and widgets have responsive/dark styles and reduced-motion handling.
- QR supports a direct offline snapshot; printed QR behavior still needs a real printer and browser check after deployment.

## Verification

Run `npm ci && npm test` from this folder. This checks ESLint, TypeScript, production build and automated tests. The package is not evidence of live Supabase migration success, a real AI provider response, or visual QA in a browser; those require deployment-specific checks. The optional `node scripts/visual-layout-r21.mjs` captures UI layouts when a local Playwright Chromium executable is installed.
