# Furniture AR

A mobile web app with two ways to plan furniture:

- **One product:** search Amazon or paste a link, inspect its 3D model, choose a finish, preview it in AR, and save it or add it to a room.
- **A whole room:** create a named layout, find products through search or links, move and rotate pieces on a floor plan, choose each piece’s finish, then view the complete arrangement in 3D or AR.

The home screen is a workspace. **Search Amazon by keyword** or paste an **Amazon.com product link** to import real product details. Search opens a photo-card list with prices and ratings when supplied, model-availability labels, and pagination. Selecting a result loads its full listing through the existing importer. The table and lamp supplied by the project team have approximate 3D previews. Other products can be saved with their details; AR and room placement remain unavailable until a matching model exists. No unrelated placeholder is substituted.

Search is also available in Saved items and the room editor. It returns the products supplied for each Amazon search page, rather than attempting to download the entire catalog. Search results do not guarantee current stock; confirm price, availability, size, and finish on Amazon. Product search and import share the configured SerpApi account allowance; search runs only on submission or pagination, not on every keystroke.

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

## Room layouts

Layouts save automatically in this browser, including names, room dimensions, source links, product metadata, each piece’s selected finish, positions, and rotations. Create, reopen, rename, duplicate, or delete layouts. Deletion offers Undo. Editing supports undo, pointer/touch dragging, arrow-key nudges (Shift for larger steps), and R to rotate. Selected pieces also have finish choices, position sliders, rotation, duplicate, and remove controls. Finish changes participate in layout Undo. Room dimensions can be changed after creation for manually measured rooms. Scanned layouts preserve their measured outline.

A room supports up to 30 pieces. Floor-plan units are meters. The editor keeps rotated footprints within room bounds when the item fits. Enter dimensions manually, or import a LiDAR room scan with walls, openings, and existing furniture. Real AR alignment is performed on the phone.

Saved individual products form a separate library and can be reused across layouts when they have models. Saving or adding a product keeps its selected finish; duplicated pieces and layouts retain their choices and can then be changed independently. Persistence is **local to the current browser/device**, with no cross-device or account sync. Existing v1 favorites remain untouched in their original storage key; the new workspace uses `furniture-ar:workspace:v2`. Previously saved Little Tree placeholders still reopen with their approximate finish palette.

## Scan your room

Use the native [Furniture AR Scan companion](./ios/FurnitureARScan/README.md) on a LiDAR iPhone or iPad (including iPhone 16 Pro). It uses Apple RoomPlan, then opens the website or shares a room JSON file. Import it from the overview, layout list, or editor. Review the measured outline before creating the layout.

Existing objects appear as fixed, hatched footprints. Select one to correct its measurements, name, position, or rotation; add missed objects or remove false detections. New furniture remains movable. Overlaps with existing furniture, wall crossings, and doorway access warnings appear in the editor. Corrections and scans persist with the layout and participate in Undo and duplication. Incomplete wall geometry requires rescanning. All measurements and overlap warnings are estimates.

The companion is an Xcode development project, not an App Store release. See [setup instructions](./public/room-scanner.html) or the companion README for signing and installing it. Camera images remain on the phone; the export contains only measurements and labels. The optional web handoff uses a URL fragment, with a file-sharing fallback for larger scans. The website does not directly access LiDAR, sync layouts, or automatically anchor later AR previews to the scan.

## Finish previews

Choose a named finish in the product preview or on a selected room piece when its product includes multiple variants. A variant can supply its own GLB, or apply explicit color overrides to named materials in a shared GLB. Same-model color changes keep the camera, shape, scale, and placement; returning to the original finish restores its original colors and wood texture. Normal and roughness textures remain intact. Missing target materials show an error and prevent AR activation.

The retained Little Tree sample palette offers textured Oak plus Black, Grey, Light Brown, Rustic Brown, White, and Brown **approximate solid-color previews**. These are authored previews, not color-matched scans or verified live availability. Dedicated GLBs can represent alternate appearances more faithfully. Exact variant ASINs and product links are optional metadata; when available, the product link follows the selected variant.

Every Amazon import now carries the listing’s observed color options and exact variant ASINs. Product, room, and in-AR color controls offer only reported options that also have a compatible modeled finish. Explicitly unavailable choices and different size/style combinations are excluded. Missing or ambiguous color data keeps the current model appearance but offers no unverified color changes; old saved imports without this data must be imported again to obtain current options.

Color discovery also works for listings without a model, but does not create new geometry or material presets. The Little Tree table maps supported options to its authored palette; the lamp currently has only its original Beige and Black model. Options reflect the import snapshot and provider cache, not a continuous stock check. Changing color follows the exact variant’s Amazon link; the originally imported price and stock are not presented as the new variant’s price and stock.

## AR

Open the HTTPS deployment in Safari on iPhone or Chrome on an ARCore-compatible Android phone. Product import requires ChatGPT sign-in on the hosted site. The local preview uses the Sites development sign-in. A plain HTTP LAN development URL will not enable WebXR.

- Single products use the selected finish’s GLB and material colors at actual scale.
- Layouts load each selected variant and export one combined GLB with independent per-piece materials, preserving colors, positions, and rotations in meters. Its floor stays at y=0.
- The phone places the **whole arrangement as one group**. Edit relative positions in the floor plan, then reopen AR. Individual object movement inside the AR session and automatic alignment to a previously scanned room are not implemented.
- `<model-viewer>` uses WebXR and iOS Quick Look. Single-product WebXR has live finish controls for finishes that share the currently selected GLB; choose finishes with a different GLB before opening AR. On iPhone, choose the finish before opening Quick Look; native Quick Look cannot display the app’s buttons. To change it, return to the app and reopen AR.
- Runtime material overrides use automatically generated USDZ, ignoring any supplied `iosSrc`, so the exported solid colors follow the selection. Dedicated unmodified variants can use their matching prebuilt USDZ. Scene Viewer is omitted because external model fetches cannot access a private site's authenticated assets.
- AR scale is locked. The app checks GLB bounds against product dimensions before enabling AR. For layouts it validates each constituent model too.
- Material changes and GLB/USDZ export are covered by automated tests. Live WebXR placement and iPhone Quick Look remain **untested on a physical device**. A compatible phone is required to verify camera tracking. AR is a visual guide; confirm purchase-critical measurements with a tape measure.

## Supplied models

`public/models/little-tree-oak-table.glb` is the user-supplied file, preserved without rescaling or changing its textures. Its embedded metadata specifies a 1.199896 m diameter and 0.750062 m height (displayed as 120 × 120 × 75 cm). Geometry is centered on X/Z with its base at Y=0. The model describes itself as a photo-based reconstruction: overall dimensions follow the listing, with some hidden construction details estimated. These measurements come from the supplied file, not a new independent product verification.

Amazon ASIN B0F2ML48Y6 and the six registered table finish ASINs listed in [INTEGRATION.md](./INTEGRATION.md) use this table geometry. ASIN B0C4DGFFCM uses the supplied Ambimall lamp. The lamp is 1.524 m tall, and its footprint includes the cord. Both models are manually created approximations, not Amazon-provided assets. Model bounds and Amazon listing measurements are displayed separately. Previously saved products retain their original models. Round furniture uses an elliptical footprint in the floor plan and in room-boundary checks.

## Amazon importer

The partner’s SerpApi implementation is integrated into `POST /api/products/import` and `POST /api/products/search`. See [INTEGRATION.md](./INTEGRATION.md) for setup, request/response details, material variants, supported links, limitations, and model provenance. The API key is a server secret; it is never bundled into the phone app.

The same-origin route runs in the Cloudflare Worker for local development and hosted deployment. SAM 3D generation remains a separate [local experiment](./experiments/README.md) and is not connected to live imports yet. Product photos and URLs alone do not provide accurate geometry. See [VALIDATION.md](./VALIDATION.md) for the tested behavior and remaining limits.

## Source map

- `src/App.tsx`: workspace overview, layouts, saved library, creation and navigation.
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
- `worker/index.ts`: hosted API route and static asset serving.
- `tests/`: dimensions, importer contracts, input validation, finish persistence, material isolation/restoration and combined GLB/USDZ colors and transforms.

Original procedural furniture GLBs remain as development fixtures and can be regenerated with `npm run models`. Live imports only associate the explicitly registered models above. The supplied table and lamp are independent of these procedural fixtures.

## Credits

The room photograph is from [Unsplash](https://images.unsplash.com/photo-1600210492486-724fe5c67fb0), downloaded as a local UI asset. It illustrates the room-planning entry point and is not a saved user layout. The original procedural fixture geometry is CC0-1.0; this does not apply to the separately supplied Little Tree table or Ambimall lamp. Package licenses apply to dependencies. AR support uses Google's [model-viewer](https://modelviewer.dev/docs/index.html).
