# Roomify

A mobile web app with two ways to plan furniture:

- **One product:** search Amazon or paste a link, browse its photos, optionally generate or load its 3D model, choose a finish, then preview it in AR or add it to a layout. There is no standalone saved-items library.
- **A whole room:** create a named layout from manual dimensions or a scan in the iPhone app, arrange pieces on a floor plan, use **Design my room** for suggestions, then preview the layout in 3D or AR. Browser scanning remains an app handoff placeholder.

The home screen is a workspace. **Search Amazon by keyword** or paste an **Amazon.com product link** to import real product details. Search opens a photo-card list with prices and ratings when supplied, model-availability labels, and pagination. Selecting a result checks the saved model for that exact Amazon product before fetching more product details. The table and lamp supplied by the project team have approximate 3D previews. Other products can be viewed with their details; AR and room placement remain unavailable until a matching model exists. No unrelated placeholder is substituted.

Product previews open with photos. Choose **Load 3D model** for an available model, or **Generate 3D model** to request one. Browsing alone neither starts generation nor downloads a GLB. The **3D models** panel keeps requested jobs and their progress while you browse or edit a room. Accepted jobs continue on the GPU service after the tab closes; reopening resumes status checks without resubmitting them. Products are saved as furniture only when added to a layout.

Search is also available inside each room layout. It returns the products supplied for each Amazon search page, rather than attempting to download the entire catalog. Search results do not guarantee current stock; confirm price, availability, size, and finish on Amazon. Product search and import share the configured SerpApi account allowance; search runs only on submission or pagination, not on every keystroke.

## Run

Requires Node.js 22.12+ (or a supported newer version).

```sh
npm ci
cp .dev.vars.example .dev.vars
# Add SERPAPI_API_KEY for Amazon search/import and MODEL_API_URL + MODEL_API_KEY for SAM 3D.
# These are server-only values. Preserve an existing .dev.vars instead of overwriting it.
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

## Generated model cache

Amazon selections share a persistent model cache, keyed by marketplace and exact ASIN rather than tracking parameters in a product link. A completed model is reused before calling SerpApi or the generator again. Its GLB and product-link metadata live under `generated-models/amazon-com/<ASIN>/` in the website's R2 storage. Local development uses persistent local R2 storage; deployed storage is shared across visitors and devices.

The image-to-GLB adapter calls the team’s existing SAM 3D Runpod service only after an explicit generation request. The app tracks the job’s real stage independently of the product preview. A completed GLB is normalized and stored by the server; viewing it remains a separate **Load 3D model** action. Known registered models and completed cached models are reused. No sample shape is substituted for an unknown product. This change avoids unnecessary work and allows continued browsing; GPU worker concurrency is unchanged. See [generator integration and storage](MODEL_GENERATION.md) for the adapter contract, cache layout, and deployment requirements. Stored prices, stock, and colors are snapshots; the cache does not continuously refresh Amazon availability.

## Camera → GLB → AR

Choose **Photo to 3D** or **Open camera**, sign in, capture/upload a photo, and press **Generate 3D model**. The model runs on the existing GPU; a real status animation tracks preparation, reconstruction and export. Enter a measured height before placing the generated model in AR, or download its GLB. See [PHOTO_TO_3D.md](./PHOTO_TO_3D.md) and [the Runpod service](./services/sam3d/README.md).

For Amazon models, scale uses the first available labeled height, width or depth while preserving proportions. Without a usable measurement, the model is a clearly labeled 1 m reference preview; AR and room placement stay unavailable. A single photo cannot determine real dimensions.

## Design my room — Claude Opus

**Current deployment: prepared Urban High-Rise demo.** Live Claude design is disabled by `ROOM_DESIGN_DEMO_ENABLED` in `src/lib/design-mode.ts`, including the Worker endpoint, even when provider credentials are configured. Any prompt followed by **Generate designs** runs a short, cancelable preparation animation and shows three arrangements of the supplied `Room-D91C5C1E` scan. Choose **Use this design** to save only that arrangement as a new layout and open 3D/AR. Existing layouts remain unchanged. The Overview also offers a direct **Open furnished 3D layout** shortcut.

All three arrangements use the same five modeled pieces: the [KAIRNE three-panel abstract canvas set](https://www.amazon.com/dp/B0D7MGQ5H6), [JONATHAN Y Khalil 4 × 6 rug](https://www.amazon.com/dp/B081D81DBX), and [Ambimall floor lamp](https://www.amazon.com/dp/B0C4DGFFCM). Listings were verified when preparing the demo; prices and stock are not cached or claimed. Bundled GLBs are original product-inspired approximations, with measured dimensions and estimates recorded in `public/models/urban-demo/metadata.json`. Existing scanned furniture remains outlines, not newly generated furniture. Wall art retains its height in saved layouts, GLB and native AR exports. The demo performs no Claude, SerpApi or photo-to-3D calls.

To restore the live designer described below, set `ROOM_DESIGN_DEMO_ENABLED` to `false`, rebuild and redeploy both browser and Worker together. The other Amazon search and photo-to-3D features keep their normal behavior.

Open a layout and choose **Design my room**. Describe the goal, choose a style, set a USD budget for additions, and optionally attach up to four room photos. Existing layout pieces can be kept in place, moved, or left out. Scanned obstacles remain fixed and anonymous. Photos help describe appearance; they do not create a measured floor plan or automatically identify scanned objects.

The designer returns up to three distinct, validated proposals. Compare their floor plans and product subtotals, refine a direction in plain language, then choose **Use this design**. It saves a new editable layout; the starting layout is preserved. The usual floor-plan dragging, undo/redo, 3D, and grouped AR preview work on the result.

**Connection:** add `ANTHROPIC_API_KEY` to the ignored `.dev.vars` file locally, or as a server secret on the deployed Site. Optional `CLAUDE_MODEL` defaults to `claude-opus-5-5`; set it to the Opus model enabled for your account. Restart local development after changing secrets. Never use a `VITE_` prefix or put the key in the hosting manifest. No OpenAI key or credits are used. This uses Anthropic's Messages API over HTTP, compatible with Cloudflare Workers; a Claude consumer subscription alone is not configured as an API credential.

Guests can use **Design my room** on the hosted site without signing in. The browser sends the room brief to the same-origin server endpoint; only the server uses the Claude key. Keep the key in the deployed Site’s secret configuration. Guest requests share a per-IP allowance within each Worker instance; signed-in requests use the platform user ID.

Without a key, the form saves the text brief on this device, but generation stays disconnected. Photos remain in memory, are re-encoded without metadata, and are only sent to Claude when Generate is pressed. They are not saved in localStorage or included in the resulting layout. Closing the designer clears them.

Amazon shopping uses the existing server-side SerpApi connection. Only exact retrieved products with a positive USD price and usable 3D geometry can be added. The supplied prototype inventory is available to the designer after checking exact ASIN, title similarity, and any reported dimensions against the live listing. These are approximate models, not manufacturer CAD. Products without usable previews are excluded while the separate 3D generator remains unconfigured. A $0 budget rearranges existing layout pieces without shopping calls.

The backend checks required pieces, budget, rotated footprints, collisions, scan boundaries and doorway clearance, and searches for nearby valid positions. Incomplete scan outlines fail closed. These checks do not guarantee continuous walking routes or compensate for objects omitted from the scan. Prices exclude delivery and tax.

See [the integration guide](INTEGRATION.md#claude-room-designer) for endpoints, limits, and activation details.

## Room layouts

Layouts save automatically in this browser, including names, room dimensions, source links, product metadata, each piece’s selected finish, positions, and rotations. Create, reopen, rename, duplicate, or delete layouts. Deletion offers Undo. Editing supports Undo/Redo, pointer/touch dragging that commits once on release, optional 5 cm grid snapping (hold Shift to bypass), arrow-key nudges (Shift for larger steps), and R to rotate. Rotation, duplicate, and remove controls stay beside the floor plan, including on phones. Escape clears selection. Ctrl/Command Z undoes and Shift Z redoes. Selected pieces also have finish choices, numeric positions, rotation, duplicate, and remove controls. Finish changes participate in layout Undo. Room dimensions can be changed after creation for manually measured rooms. Scanned layouts preserve their measured outline.

A room supports up to 30 pieces. Floor-plan units are meters. The editor keeps rotated footprints within room bounds when the item fits. Enter dimensions manually or create a layout from a room scan. Scanned layouts keep their walls, openings, and obstacles. Real AR alignment is performed on the phone.

Products are saved only as part of a layout. Single-product previews are temporary. Adding a product to a layout keeps its selected finish; duplicated pieces and layouts retain their choices and can then be changed independently. Persistence is **local to the current browser/device**, with no cross-device or account sync. Existing v1 favorites remain untouched in their original storage key; the new workspace uses `furniture-ar:workspace:v2`. Previously saved Little Tree placeholders still reopen with their approximate finish palette.

## Scan your room

Choose **New layout → Scan your room**, then upload a saved JSON room file or open the native [Roomify Scan companion](./ios/FurnitureARScan/README.md) on a LiDAR iPhone or iPad. Completed files, Safari fragment links, and native scan handoffs automatically create a new saved layout and open the regular editor. There is no separate scan-review editor, and starting a scan from an existing layout never replaces that layout.

The importer finds the dominant parallel/perpendicular wall directions and rotates the entire room to the nearest grid axes before centering it. Walls, doors, windows, and detected furniture share one rigid transform; lengths, scale, relative placement, and genuinely diagonal wall angles are preserved. This normalization runs only on new imports, not when reopening an existing layout.

Scanned objects appear as hatched outlines in the same **In this layout** list as added products. Drag or keyboard-nudge them on the floor plan, rotate them, edit measurements, add missed outlines, or remove false detections. They share the editor’s Undo/Redo and autosave; they remain approximate outlines, not generated 3D models. Overlaps with other pieces or existing furniture, oversized footprints, wall crossings, and doorway access warnings appear in the editor. Corrections and scans persist with the layout and participate in Undo and duplication. Incomplete wall geometry requires rescanning. All measurements and overlap warnings are estimates.

The companion is an Xcode development project, not an App Store release. See [setup instructions](./public/room-scanner.html) or the companion README for signing and installing it. The iPhone app now opens the web planner inside a WKWebView while keeping the scanner’s ARSession alive. Scanned layouts export a metre-scale USDZ to the native camera viewer, preserving the room origin. On return visits the app restores a private on-device ARWorldMap; missing maps or failed recognition use a two-corner wall alignment flow. The regular website still uses manually placed browser AR and does not access LiDAR or sync layouts. Both the updated app and updated web build are needed; physical alignment has not yet been verified on the phone.

## Finish previews

Choose a named finish in the product preview or on a selected room piece when its product includes multiple variants. A variant can supply its own GLB, or apply explicit color overrides to named materials in a shared GLB. Same-model color changes keep the camera, shape, scale, and placement; returning to the original finish restores its original colors and wood texture. Normal and roughness textures remain intact. Missing target materials show an error and prevent AR activation.

The retained Little Tree sample palette offers textured Oak plus Black, Grey, Light Brown, Rustic Brown, White, and Brown **approximate solid-color previews**. These are authored previews, not color-matched scans or verified live availability. Dedicated GLBs can represent alternate appearances more faithfully. Exact variant ASINs and product links are optional metadata; when available, the product link follows the selected variant.

Every Amazon import now carries the listing’s observed color options and exact variant ASINs. Product, room, and in-AR color controls offer only reported options that also have a compatible modeled finish. Explicitly unavailable choices and different size/style combinations are excluded. Missing or ambiguous color data keeps the current model appearance but offers no unverified color changes. Saved model results reuse their listing snapshot; reopening or reimporting them does not promise refreshed stock or colors.

Color discovery also works for listings without a model, but does not create new geometry or material presets. The Little Tree table maps supported options to its authored palette; the lamp currently has only its original Beige and Black model. Options reflect the import snapshot and provider cache, not a continuous stock check. Changing color follows the exact variant’s Amazon link; the originally imported price and stock are not presented as the new variant’s price and stock.

## AR

Open the HTTPS deployment in Safari on iPhone or Chrome on an ARCore-compatible Android phone. Amazon search and product import work for guests without a ChatGPT or Amazon account. The app has no per-user API request quota. A plain HTTP LAN development URL will not enable WebXR. If the hosting platform applies a separate private-site access gate, its audience must be public for guests to reach the app.

- Single products use the selected finish’s GLB and material colors at actual scale.
- Layouts load each selected variant and export one combined GLB with independent per-piece materials, preserving colors, positions, and rotations in meters. Its floor stays at y=0.
- The phone places the **whole arrangement as one group**. Edit relative positions in the floor plan, then reopen AR. Individual object movement inside the AR session and automatic alignment to a previously scanned room are not implemented.
- `<model-viewer>` uses WebXR and iOS Quick Look. Single-product WebXR has live finish controls for finishes that share the currently selected GLB; choose finishes with a different GLB before opening AR. On iPhone, choose the finish before opening Quick Look; native Quick Look cannot display the app’s buttons. To change it, return to the app and reopen AR.
- Runtime material overrides use automatically generated USDZ, ignoring any supplied `iosSrc`, so the exported solid colors follow the selection. Dedicated unmodified variants can use their matching prebuilt USDZ. The implemented AR paths are WebXR and Quick Look; Scene Viewer remains disabled.
- Browser layout AR allows pinch resizing so large arrangements are not locked at 100% scale. Use 100% when checking physical fit. Saved layouts, exported geometry, individual product AR, and native room-aligned previews retain their original scale. The app still checks GLB bounds against product dimensions before enabling AR and validates each constituent layout model.
- Material changes and GLB/USDZ export are covered by automated tests. Live WebXR placement and iPhone Quick Look remain **untested on a physical device**. A compatible phone is required to verify camera tracking. AR is a visual guide; confirm purchase-critical measurements with a tape measure.

## Supplied models

The [30-model catalog](public/models/catalog/README.md) organizes the supplied 10-model and 20-model bundles into seating, tables/desks, storage, and beds. Its [JSON inventory](public/models/catalog/catalog.json) preserves the embedded product metadata, original filenames, archive provenance, dimensions, and SHA-256 checksums. GLB contents are unchanged. These additional assets are inventoried for integration; they are not yet registered with the live Amazon importer.

`public/models/little-tree-oak-table.glb` is the user-supplied file, preserved without rescaling or changing its textures. Its embedded metadata specifies a 1.199896 m diameter and 0.750062 m height (displayed as 120 × 120 × 75 cm). Geometry is centered on X/Z with its base at Y=0. The model describes itself as a photo-based reconstruction: overall dimensions follow the listing, with some hidden construction details estimated. These measurements come from the supplied file, not a new independent product verification.

Amazon ASIN B0F2ML48Y6 and the six registered table finish ASINs listed in [INTEGRATION.md](./INTEGRATION.md) use this table geometry. ASIN B0C4DGFFCM uses the supplied Ambimall lamp. The lamp is 1.524 m tall, and its footprint includes the cord. Both models are manually created approximations, not Amazon-provided assets. Model bounds and Amazon listing measurements are displayed separately. Previously saved products retain their original models. Round furniture uses an elliptical footprint in the floor plan and in room-boundary checks.

## Amazon importer

The partner’s SerpApi implementation is integrated into `POST /api/products/import` and `POST /api/products/search`. See [INTEGRATION.md](./INTEGRATION.md) for setup, request/response details, material variants, supported links, limitations, and model provenance. The API key is a server secret; it is never bundled into the phone app.

The same-origin route runs in the Cloudflare Worker for local development and hosted deployment. Amazon imports look up details and existing models by default; `generateModel: true` explicitly requests SAM 3D through `server/model-generator.js`. Camera uploads use [Photo to 3D](./PHOTO_TO_3D.md). The [older local experiment](./experiments/README.md) is retained for reference. Product photos and URLs alone do not provide accurate geometry. See [VALIDATION.md](./VALIDATION.md) for the tested behavior and remaining limits.

## Source map

- `src/App.tsx`: workspace overview, layouts, scan handoff, navigation and background model updates.
- `src/components/NewLayout.tsx`: manual room dimensions or room scan entry.
- `src/components/LinkInput.tsx`: Amazon product-link entry and importer connection.
- `src/components/PreviewModal.tsx`: photos-first listing details, generation choice and lazy product/AR preview.
- `src/components/ModelJobsPanel.tsx`: app-wide model progress, status checks and reopening requested items.
- `src/lib/model-jobs.ts` and `src/lib/use-model-jobs.ts`: persistent job tracking, explicit starts and status-only recovery after reload.
- `src/components/FinishPicker.tsx`: named finish choices and approximate-preview labels.
- `src/components/RoomEditor.tsx`: arrangement editing and undo.
- `src/components/FloorPlan.tsx`: dimensioned SVG plan with touch, pointer and keyboard controls.
- `src/components/LayoutViewer.tsx`: whole-layout 3D/AR preview and temporary asset lifecycle.
- `src/lib/layout-model.ts`: model loading, geometry checks and combined scene export.
- `src/lib/material-colors.ts`: exact-name material overrides, original texture restoration and isolated instance materials.
- `src/lib/workspace.ts`: workspace types, validation, persistence and layout operations.
- `src/components/Viewer.tsx`: AR activation with fixed or adjustable scale, tracking, errors and capability fallback.
- `src/lib/products.ts`: product/variant schema and geometry dimension validation.
- `src/lib/amazon.ts`: live listing validation and import request.
- `src/lib/amazon-search.ts`: search result validation and keyword-search requests.
- `server/`: adapted partner transport, normalizer, importer, caching and access checks.
- `server/model-generator.js`: live SAM 3D start/poll adapter for the Amazon cache; `server/sam3d-glb.js` preserves proportions and establishes metric bounds.
- `server/model-service.js`: exact-product model resolution, persistent files, and generation status.
- `worker/index.ts`: hosted API route and static asset serving.
- `tests/`: dimensions, importer contracts, input validation, finish persistence, material isolation/restoration and combined GLB/USDZ colors and transforms.

Original procedural furniture GLBs remain as development fixtures and can be regenerated with `npm run models`. Live imports associate registered models or completed generated models cached for the exact product. Procedural fixtures are never substituted for an unmodeled Amazon product. The supplied table and lamp are independent of those fixtures.

## Credits

The room photograph is from [Unsplash](https://images.unsplash.com/photo-1600210492486-724fe5c67fb0), downloaded as a local UI asset. It illustrates the room-planning entry point and is not a saved user layout. The original procedural fixture geometry is CC0-1.0; this does not apply to the separately supplied Little Tree table or Ambimall lamp. Package licenses apply to dependencies. AR support uses Google's [model-viewer](https://modelviewer.dev/docs/index.html).
