# AssetLens AI R21.0.1 — assistant click hotfix

This is the attached R21 source plus a focused interaction fix. It is **not** the R22 implementation described in the user's notes.

Changes:

- The closed assistant's invisible dock no longer intercepts clicks on buttons or fields behind it. The visible launcher and open panel still receive input.
- The assistant is excluded from printed reports.
- The service-worker cache version advances to `21.0.1` so a deployed PWA can pick up the new UI assets.

No SQL migration is added. Existing R21 deployment still requires migrations through `017` as documented in `RELEASE_R21.md`.

Validation: `npm test` (lint, TypeScript, production build and 57 tests). Browser interaction and production Supabase were not available in this review. After deploying, test clicks on the Save / Print PDF button and the right edges of input fields and tabs with the assistant closed, then open/close the assistant and repeat on desktop and mobile. Also check printed PDF omits the assistant. Other open R22 items are documented in `REVIEW_R21_AND_ASSISTANT_CLICK_HOTFIX_AR.md`.
