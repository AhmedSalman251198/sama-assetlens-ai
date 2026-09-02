# AssetLens AI R14 — Quality Report

Release date: 2026-09-02  
Release status: production-ready candidate

## What was improved

- Replaced the monolithic dashboard with a focused analytics dashboard and dedicated pages for capture, assets, organization, locations, transfers, reports, and administration.
- Removed the recent-assets table and every legacy embedded module from the dashboard render tree; sidebar destinations now own their content exclusively.
- Added authenticated per-user request caching, in-flight request deduplication, route/API prefetching, bounded network timeouts, and visible navigation progress.
- Consolidated dashboard, profile, structure, capture configuration, and administration reads into RLS-aware Supabase snapshot functions with safe fallbacks.
- Changed bulk capture to return compact acknowledgements and refresh the workspace once after the batch instead of returning and reloading the whole queue for every image.
- Limited browser image compression to two workers to avoid freezing mobile devices on large batches.
- Removed unused Cloudflare D1/Vite starter files and Drizzle packages from the Next.js/Supabase release, reducing install work and eliminating a conflicting second deployment path.
- Added a responsive application shell with working desktop navigation, mobile drawer, hamburger menu, active-page states, mobile bottom navigation, profile access, and sign-out.
- Standardized the visual system across main and secondary pages: typography, spacing, cards, controls, empty states, loading states, errors, and responsive RTL/LTR behavior.
- Fixed report deep-linking so a selected report can be opened directly.
- Added server-side asset pagination and a compact dashboard snapshot endpoint to avoid loading thousands of records during initial rendering.
- Added an optimized Supabase dashboard RPC with a safe REST fallback.
- Reduced upload payloads with client-side image compression and matching server limits.
- Bounded Gemini and OpenAI requests with timeouts, normalized AI output, live Gemini model discovery, and modern 3.7/3.6/3.5 fallbacks.
- Moved queued analysis work out of the request lifecycle and limited active jobs to prevent runaway processing.
- Protected direct-analysis and user-profile endpoints with authenticated, active-profile checks.
- Removed hard-coded personal administrator data and project-specific Supabase configuration.
- Replaced browser prompts/confirms in administration flows with accessible in-app dialogs.
- Added route-level loading, error, and not-found experiences.
- Updated the PWA cache and shortcuts for the new route structure, while explicitly excluding Next.js RSC/prefetch payloads to prevent mixed old/new layouts.
- Added security headers and removed the mobile zoom restriction.

## R14 corrective verification

- Removed `gemini-2.5-flash` from runtime fallback selection. A stale 1.x/2.x environment value is ignored automatically.
- Added a mocked provider test that reproduces a retired-model response and verifies successful failover from Gemini 3.7 Flash to 3.6 Flash.
- Added a second provider test that verifies `models.list` discovery can adopt a future compatible Flash model when all known fallbacks fail.
- Versioned and globally registered the service worker, deleted older AssetLens caches, and excluded Next.js RSC/prefetch payloads that could mix an old dashboard tree with the new application shell.
- Added defensive layout rules so a legacy cached shell cannot display a second sidebar while an update is activating.
- Added a building filter that consumes location deep links from the organization page.
- Bumped the application, service-worker, and cache versions to R14 so older route trees are retired cleanly.

## Verification completed

| Check | Result |
| --- | --- |
| ESLint | Passed |
| TypeScript type checking | Passed |
| Next.js production build | Passed |
| Automated quality assertions | 15/15 passed |
| Production dependency audit | 0 known vulnerabilities |
| Secret/config scan | No bundled credentials found |

Validated application routes:

- `/`
- `/capture`
- `/assets`
- `/organization`
- `/locations`
- `/transfers`
- `/reports`
- `/admin`
- `/login`

## Required deployment setup

1. Copy `.env.example` to `.env.local` and add the real Supabase and AI provider credentials.
2. Run the Supabase setup and migrations through `supabase/migrations/006_performance_config_snapshot.sql` in numeric order.
3. Create the first account, then promote it to administrator from the Supabase SQL editor as documented in `README.md`.
4. Deploy over HTTPS. Camera and precise geolocation permissions require HTTPS (or localhost during development).
5. Run `npm ci`, `npm test`, and then `npm run dev` or `npm run build && npm start`.

## Integration boundary

The application code, navigation structure, production build, and automated checks were verified locally. Live Supabase mutations, Gemini/OpenAI responses, camera permission, and GPS permission require the project's real credentials and a browser environment with HTTPS, so they must be exercised once in the target deployment before public launch.
