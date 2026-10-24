# Integration checks — October 24, 2026

- App: all 78 automated tests and the production build passed.
- Partner package: all 86 original tests passed. Its 13 normalization tests also passed against the adapted normalizer used by this app.
- Live SerpApi lookups returned the Little Tree table, Ambimall lamp, and a Virabit dining chair listing. A separate search result could not be retrieved by the product endpoint; the interface showed the failure instead of a placeholder.
- The concurrent color-selection changes were merged without discarding the importer or Mac experiment. A fresh live table import returned seven finish choices; selecting Black changed the model and its exact Amazon product link.
- The original browser checks covered sign-in prompting, real prices/photos/dimensions, model loading, a saved layout containing the table and lamp, combined model export, and saving/reopening a product without a model. The phone-sized layout was checked at 390 × 844. Guest access now replaces that sign-in flow; see below.
- Source and production output were scanned for the supplied SerpApi key and local Hugging Face token; neither was embedded.
- The previously published version loaded and rejected anonymous imports with a sign-in prompt. That deployment predates the guest-access changes below. The original signed-in flow was tested locally using the Sites development identity; the browser's hosted OpenAI login was not completed.

Physical iPhone/Android camera AR has not been tested here. Registered models are supplied approximations, and arbitrary Amazon photos do not yet generate models through the app. Listing measurements can be missing or disagree with model geometry; the interface keeps both sources distinct.

The separate [Mac SAM 3D experiment](experiments/README.md) generated and exported the isolated table example in 601.2 seconds. Its CPU-decoded mesh had zero invalid vertices/faces; the final 20,000-triangle textured GLB passed geometry/texture checks and visual inspection. Small reconstruction artifacts remain, and its scale has not been verified.

## Amazon color sync — local verification

- All 126 app tests and the production build pass, including unavailable and missing-ASIN combinations, size/style isolation, ambiguous metadata, legacy snapshots, and client selection enforcement.
- Live imports reported seven Little Tree table colors and ten Ambimall lamp options. All seven registered table finishes were selectable; the lamp exposed only its compatible original model.
- Browser checks covered Black/White model selection and exact ASIN links, original-color price labeling, save/reopen, room placement, undo, and a 390 × 844 viewport. Older imported room items without color metadata retained their appearance and offered no unverified choices.
- The private SerpApi key was absent from changed source files and the browser build. Color options remain import snapshots subject to caching; no continuous stock check or additional lamp models were added.

## Guest Amazon access — local verification

- All 129 app tests and the production build pass. Tests cover anonymous requests with no identity headers or cookies, and twelve distinct uncached sequential requests to each endpoint without an app-level per-user quota.
- Live HTTP requests with no authentication or cookies returned 200: a floor-lamp search returned 58 products, and a table import returned seven color options with seven modeled finishes.
- Browser verification followed a live search into the Ambimall lamp's 3D preview, with its single compatible Beige & Black color and room-view action available without a sign-in prompt. The private SerpApi key was absent from changed source files and the browser build.
- The client sends search/import requests without credentials, prevents login redirects, and presents a service error instead of a sign-in prompt if a hosting configuration still blocks anonymous access.
- Caching, request coalescing, and a maximum of four simultaneous provider lookups per Worker instance remain. SerpApi subscription limits still apply; no subscription change was made.
- This version has not been published. The configured Sites project could not be found in the connected account. Publishing through the account that owns the existing project is still required; a private hosting audience must separately allow public access.
