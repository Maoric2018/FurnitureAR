# Furniture AR

A mobile web app with two ways to plan furniture:

- **One product:** search Amazon or paste a link, inspect its 3D model, choose a finish, and preview it in AR. This flow does not save products.
- **A whole room:** enter room dimensions to create a named layout (scanning is a placeholder for the future unified app), find products through search or links, move and rotate pieces on a floor plan, choose each piece’s finish, then view the complete arrangement in 3D or AR.

The home screen is a workspace. **Search Amazon by keyword** or paste an **Amazon.com product link** to import real product details. Search opens a photo-card list with prices and ratings when supplied, model-availability labels, and pagination. Selecting a result checks the saved model for that exact Amazon product before fetching more product details. The table and lamp supplied by the project team have approximate 3D previews. Other products can be viewed with their details; AR and room placement remain unavailable until a matching model exists. No unrelated placeholder is substituted.

Search is also available inside each room layout. It returns the products supplied for each Amazon search page, rather than attempting to download the entire catalog. Search results do not guarantee current stock; confirm price, availability, size, and finish on Amazon. Product search and import share the configured SerpApi account allowance; search runs only on submission or pagination, not on every keystroke.

## Run

Requires Node.js 22.12+ (or a supported newer version).

```sh
npm ci
cp .dev.vars.example .dev.vars
# Add the supplied SerpApi key to .dev.vars (server-only).
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

## Generated model cache

Amazon selections share a persistent model cache, keyed by marketplace and exact ASIN rather than tracking parameters in a product link. A completed model is reused before calling SerpApi or the generator again. Its GLB and product-link metadata live under `generated-models/amazon-com/<ASIN>/` in the website's R2 storage. Local development uses persistent local R2 storage; deployed storage is shared across visitors and devices.

The image-to-GLB generator is deliberately a disabled adapter for now. It receives the verified product's photo and supports both immediate results and jobs that finish later. No sample shape is substituted for an unknown product. See [generator integration and storage](MODEL_GENERATION.md) for the adapter contract, cache layout, and deployment requirements. Stored prices, stock, and colors are snapshots; the cache does not continuously refresh Amazon availability.

## Room layouts

Layouts save automatically in this browser, including names, room dimensions, source links, product metadata, each piece’s selected finish, positions, and rotations. Create, reopen, rename, duplicate, or delete layouts. Deletion offers Undo. Editing supports Undo/Redo, pointer/touch dragging that commits once on release, optional 5 cm grid snapping (hold Shift to bypass), arrow-key nudges (Shift for larger steps), and R to rotate. Rotation, duplicate, and remove controls stay beside the floor plan, including on phones. Escape clears selection. Ctrl/Command Z undoes and Shift Z redoes. Selected pieces also have finish choices, numeric positions, rotation, duplicate, and remove controls. Finish changes participate in layout Undo. Room dimensions can be changed after creation for manually measured rooms. Scanned layouts preserve their measured outline.

A room supports up to 30 pieces. Floor-plan units are meters. The editor keeps rotated footprints within room bounds when the item fits. Enter dimensions manually. Existing scanned layouts keep their walls, openings, and obstacles. Real AR alignment is performed on the phone.

Products are saved only as part of a layout. Single-product previews are temporary. Adding a product to a layout keeps its selected finish; duplicated pieces and layouts retain their choices and can then be changed independently. Persistence is **local to the current browser/device**, with no cross-device or account sync. Existing v1 favorites remain untouched in their original storage key; the new workspace uses `furniture-ar:workspace:v2`. Previously saved Little Tree placeholders still reopen with their approximate finish palette.

## Scan your room

Use the native [Furniture AR Scan companion](./ios/FurnitureARScan/README.md) on a LiDAR iPhone or iPad (including iPhone 16 Pro). It uses Apple RoomPlan, then opens the website or shares a room JSON file. **New layout → Scan your room** now shows a coming-soon placeholder with a shortcut to manual dimensions; there is no scanner-install detour in the web layout flow. The existing companion and scan handoff are retained for future integration.

Existing objects appear as fixed, hatched footprints. Select one to correct its measurements, position, or rotation; add missed objects or remove false detections. New furniture remains movable. Overlaps with other pieces or existing furniture, oversized footprints, wall crossings, and doorway access warnings appear in the editor. Corrections and scans persist with the layout and participate in Undo and duplication. Incomplete wall geometry requires rescanning. All measurements and overlap warnings are estimates.

The companion is an Xcode development project, not an App Store release. See [setup instructions](./public/room-scanner.html) or the companion README for signing and installing it. Camera images remain on the phone; the export contains only measurements and labels. The optional web handoff uses a URL fragment, with a file-sharing fallback for larger scans. The website does not directly access LiDAR, sync layouts, or automatically anchor later AR previews to the scan.

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
- AR scale is locked. The app checks GLB bounds against product dimensions before enabling AR. For layouts it validates each constituent model too.
- Material changes and GLB/USDZ export are covered by automated tests. Live WebXR placement and iPhone Quick Look remain **untested on a physical device**. A compatible phone is required to verify camera tracking. AR is a visual guide; confirm purchase-critical measurements with a tape measure.

## Supplied models

The [30-model catalog](public/models/catalog/README.md) organizes the supplied 10-model and 20-model bundles into seating, tables/desks, storage, and beds. Its [JSON inventory](public/models/catalog/catalog.json) preserves the embedded product metadata, original filenames, archive provenance, dimensions, and SHA-256 checksums. GLB contents are unchanged. These additional assets are inventoried for integration; they are not yet registered with the live Amazon importer.

`public/models/little-tree-oak-table.glb` is the user-supplied file, preserved without rescaling or changing its textures. Its embedded metadata specifies a 1.199896 m diameter and 0.750062 m height (displayed as 120 × 120 × 75 cm). Geometry is centered on X/Z with its base at Y=0. The model describes itself as a photo-based reconstruction: overall dimensions follow the listing, with some hidden construction details estimated. These measurements come from the supplied file, not a new independent product verification.

Amazon ASIN B0F2ML48Y6 and the six registered table finish ASINs listed in [INTEGRATION.md](./INTEGRATION.md) use this table geometry. ASIN B0C4DGFFCM uses the supplied Ambimall lamp. The lamp is 1.524 m tall, and its footprint includes the cord. Both models are manually created approximations, not Amazon-provided assets. Model bounds and Amazon listing measurements are displayed separately. Previously saved products retain their original models. Round furniture uses an elliptical footprint in the floor plan and in room-boundary checks.

## Amazon importer

The partner’s SerpApi implementation is integrated into `POST /api/products/import` and `POST /api/products/search`. See [INTEGRATION.md](./INTEGRATION.md) for setup, request/response details, material variants, supported links, limitations, and model provenance. The API key is a server secret; it is never bundled into the phone app.

The same-origin route runs in the Cloudflare Worker for local development and hosted deployment. SAM 3D generation remains a separate [local experiment](./experiments/README.md) and is not connected to live imports yet. Product photos and URLs alone do not provide accurate geometry. See [VALIDATION.md](./VALIDATION.md) for the tested behavior and remaining limits.

## Source map

- `src/App.tsx`: workspace overview, layouts, scan handoff and navigation.
- `src/components/NewLayout.tsx`: manual room dimensions or room scan entry.
- `src/components/LinkInput.tsx`: Amazon product-link entry and importer connection.
- `src/components/PreviewModal.tsx`: listing details and individual product/AR preview.
- `src/components/FinishPicker.tsx`: named finish choices and approximate-preview labels.
- `src/components/RoomEditor.tsx`: arrangement editing and undo.
- `src/components/FloorPlan.tsx`: dimensioned SVG plan with touch, pointer and keyboard controls.
- `src/components/LayoutViewer.tsx`: whole-layout 3D/AR preview and temporary asset lifecycle.
- `src/lib/layout-model.ts`: model loading, geometry checks and combined scene export.
- `src/lib/material-colors.ts`: exact-name material overrides, original texture restoration and isolated instance materials.
- `src/lib/workspace.ts`: workspace types, validation, persistence and layout operations.
- `src/components/Viewer.tsx`: fixed-scale AR activation, tracking, errors and capability fallback.
- `src/lib/products.ts`: product/variant schema and geometry dimension validation.
- `src/lib/amazon.ts`: live listing validation and import request.
- `src/lib/amazon-search.ts`: search result validation and keyword-search requests.
- `server/`: adapted partner transport, normalizer, importer, caching and access checks.
- `server/model-generator.js`: disabled photo-to-GLB adapter and future provider contract.
- `server/model-service.js`: exact-product model resolution, persistent files, and generation status.
- `worker/index.ts`: hosted API route and static asset serving.
- `tests/`: dimensions, importer contracts, input validation, finish persistence, material isolation/restoration and combined GLB/USDZ colors and transforms.

Original procedural furniture GLBs remain as development fixtures and can be regenerated with `npm run models`. Live imports associate registered models or completed generated models cached for the exact product. Procedural fixtures are never substituted for an unmodeled Amazon product. The supplied table and lamp are independent of those fixtures.

## Credits

The room photograph is from [Unsplash](https://images.unsplash.com/photo-1600210492486-724fe5c67fb0), downloaded as a local UI asset. It illustrates the room-planning entry point and is not a saved user layout. The original procedural fixture geometry is CC0-1.0; this does not apply to the separately supplied Little Tree table or Ambimall lamp. Package licenses apply to dependencies. AR support uses Google's [model-viewer](https://modelviewer.dev/docs/index.html).
