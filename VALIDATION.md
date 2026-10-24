# Integration checks — October 24, 2026

- App: all 160 automated tests and the production build passed after integrating the persistent model cache.
- Partner package: all 86 original tests passed. Its 13 normalization tests also passed against the adapted normalizer used by this app.
- Live SerpApi lookups returned the Little Tree table, Ambimall lamp, and a Virabit dining chair listing. A separate search result could not be retrieved by the product endpoint; the interface showed the failure instead of a placeholder.
- The concurrent color-selection changes were merged without discarding the importer or Mac experiment. A fresh live table import returned seven finish choices; selecting Black changed the model and its exact Amazon product link.
- The original browser checks covered sign-in prompting, real prices/photos/dimensions, model loading, a saved layout containing the table and lamp, combined model export, and saving/reopening a product without a model. The phone-sized layout was checked at 390 × 844. Guest access now replaces that sign-in flow; see below.
- Source and production output were scanned for the supplied SerpApi key and local Hugging Face token; neither was embedded.
- The previously published version loaded and rejected anonymous imports with a sign-in prompt. That deployment predates the guest-access changes below. The original signed-in flow was tested locally using the Sites development identity; the browser's hosted OpenAI login was not completed.

Physical iPhone/Android camera AR has not been tested here. Registered models are supplied approximations, and arbitrary Amazon photos do not yet generate models through the app. Listing measurements can be missing or disagree with model geometry; the interface keeps both sources distinct.

The separate [Mac SAM 3D experiment](experiments/README.md) generated and exported the isolated table example in 601.2 seconds. Its CPU-decoded mesh had zero invalid vertices/faces; the final 20,000-triangle textured GLB passed geometry/texture checks and visual inspection. Small reconstruction artifacts remain, and its scale has not been verified.

## Room scan integration

- The native SwiftUI / RoomPlan companion builds for arm64 iOS with Xcode 26.0.1 (unsigned generic-device build). Scanning requires a signed installation on a physical LiDAR device; the user will install it later, so real capture remains untested.
- Eight added automated tests cover import limits and malformed data, shared-coordinate recentering, native URL decoding, persisted scans and independent copies, rotated collision geometry, windows/doorway cutouts, and editing existing objects.
- Browser QA used the explicitly synthetic room fixture. File import, corrected decimal measurements, undo, save/reload, adding and removing missed objects, a live table import, and overlap warnings clearing after movement all passed. The layout was checked at 393 × 852 and 1440 × 1000 with no browser console errors.
- The existing furniture stays fixed during arrangement. Collision warnings are approximate 2D checks; capture accuracy, occlusion, glass/clutter detection, and native Safari handoff on the phone still need device testing. AR previews do not automatically align with the captured room.

## Amazon color sync — local verification

- All 126 app tests and the production build pass, including unavailable and missing-ASIN combinations, size/style isolation, ambiguous metadata, legacy snapshots, and client selection enforcement.
- Live imports reported seven Little Tree table colors and ten Ambimall lamp options. All seven registered table finishes were selectable; the lamp exposed only its compatible original model.
- Browser checks covered Black/White model selection and exact ASIN links, original-color price labeling, save/reopen, room placement, undo, and a 390 × 844 viewport. Older imported room items without color metadata retained their appearance and offered no unverified choices.
- The private SerpApi key was absent from changed source files and the browser build. Color options remain import snapshots subject to caching; no continuous stock check or additional lamp models were added.

The room scanner was merged with the newer GitHub Amazon search and observed-color changes. All 134 combined tests pass. The URL-fragment handoff was also checked in an already-open browser tab; the measurements opened for review and were removed from the address bar.

## Guest Amazon access — local verification

- All 129 app tests and the production build pass. Tests cover anonymous requests with no identity headers or cookies, and twelve distinct uncached sequential requests to each endpoint without an app-level per-user quota.
- Live HTTP requests with no authentication or cookies returned 200: a floor-lamp search returned 58 products, and a table import returned seven color options with seven modeled finishes.
- Browser verification followed a live search into the Ambimall lamp's 3D preview, with its single compatible Beige & Black color and room-view action available without a sign-in prompt. The private SerpApi key was absent from changed source files and the browser build.
- The client sends search/import requests without credentials, prevents login redirects, and presents a service error instead of a sign-in prompt if a hosting configuration still blocks anonymous access.
- Caching, request coalescing, and a maximum of four simultaneous provider lookups per Worker instance remain. SerpApi subscription limits still apply; no subscription change was made.
- This version has not been published. The configured Sites project could not be found in the connected account. Publishing through the account that owns the existing project is still required; a private hosting audience must separately allow public access.

## Generated model cache — local verification

- All 160 tests pass, including 23 new server/client cases for exact ASIN identity, tracking-link normalization, durable reuse across service instances, pending jobs, placeholder version changes, malformed GLBs, missing storage, failed writes, adapter timeouts, safe model status requests, and saved-item updates that preserve IDs and selected finishes. The production build includes the `MODEL_BUCKET` R2 binding and hosting declaration.
- A separate real Miniflare R2 integration verified conditional create/update behavior and stale-write rejection. An injected test generator stored a 41,020-byte test-only GLB for a synthetic ASIN; after disposing and recreating the storage runtime, a fresh service reused the model and served identical bytes while both provider functions were configured to throw if called. This fixture was kept out of the app's live product cache.
- A real Amazon search opened the Govee floor-lamp listing with its photo and the honest disabled-generator message. After restarting the local preview without any SerpApi key configured, a differently formatted link for the same ASIN returned the persisted product snapshot with `cached: true` and the same retrieval timestamp. No geometry was generated for that live product.
- Independent review caught and resolved a cross-Worker race where a late pending result could overwrite ready metadata. Conditional R2 writes now preserve the completed result. It also verified completion updates a previously saved item even when a fresh preview has a different ID.
- Changed files and the browser build contain no configured API credentials. The actual image-to-GLB adapter remains a dummy. Hosted storage and publication remain unverified because the existing Sites project is inaccessible through the connected account.
