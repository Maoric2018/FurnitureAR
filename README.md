# Furniture AR

A mobile web app with two ways to plan furniture:

- **One product:** paste a link, inspect its 3D model, preview it in AR, and save it or add it to a room.
- **A whole room:** create a named layout, add multiple links, move and rotate pieces on a floor plan, then view the complete arrangement in 3D or AR.

The home screen is a workspace. There is no public sample catalog. **In demo mode, every valid HTTP/HTTPS product link loads the same Little Tree table**, preserving the original URL. The placeholder is clearly identified in the preview. With the importer configured, the local bridge accepts the seven registered Little Tree table family ASINs and rejects products without a mapped 3D model. No product page is fetched in demo mode.

## Run

Requires Node.js 22.12+ (or a supported newer version).

```sh
npm install
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

## Room layouts

Layouts save automatically in this browser, including names, room dimensions, source links, product metadata, each piece’s selected finish, positions, and rotations. Create, reopen, rename, duplicate, or delete layouts. Deletion offers Undo. Editing supports undo, pointer/touch dragging, arrow-key nudges (Shift for larger steps), and R to rotate. Selected pieces also have finish choices, position sliders, rotation, duplicate, and remove controls. Finish changes participate in layout Undo. Room dimensions can be changed after creation.

A room supports up to 30 pieces. Floor-plan units are meters. The editor keeps rotated footprints within room bounds when the item fits. The layout is a planning surface, not a scan of the physical room: enter its dimensions yourself. Real AR alignment is performed on the phone.

Saved individual products form a separate library and can be reused across layouts. Saving or adding a product keeps its selected finish; duplicated pieces and layouts retain their choices and can then be changed independently. Persistence is **local to the current browser/device**, with no cross-device or account sync. Existing v1 favorites remain untouched in their original storage key; the new workspace uses `furniture-ar:workspace:v2`. Older saved Little Tree placeholders gain the new palette while keeping Oak selected.

## Finish previews

Choose a named finish in the product preview or on a selected room piece. A variant can supply its own GLB, or apply explicit color overrides to named materials in a shared GLB. Same-model color changes keep the camera, shape, scale, and placement; returning to the original finish restores its original colors and wood texture. Normal and roughness textures remain intact. Missing target materials show an error and prevent AR activation.

The supplied table offers its original textured Oak plus Black, Grey, Light Brown, Rustic Brown, White, and Brown **approximate solid-color previews**. These previews are not color-matched scans or verified alternate finishes. An importer can supply dedicated GLBs for more faithful material appearances. Exact variant ASINs and product links are optional metadata; when available, the product link follows the selected variant.

## AR

Open the HTTPS deployment in Safari on iPhone or Chrome on an ARCore-compatible Android phone. The site is private and requires the owner's ChatGPT login. A plain HTTP LAN development URL will not enable WebXR.

- Single products use the selected finish’s GLB and material colors at actual scale.
- Layouts load each selected variant and export one combined GLB with independent per-piece materials, preserving colors, positions, and rotations in meters. Its floor stays at y=0.
- The phone places the **whole arrangement as one group**. Edit relative positions in the floor plan, then reopen AR. Individual object movement inside the AR session and scanned-room persistence are not implemented.
- `<model-viewer>` uses WebXR and iOS Quick Look. Single-product WebXR has live finish controls for finishes that share the currently selected GLB; choose finishes with a different GLB before opening AR. On iPhone, choose the finish before opening Quick Look; native Quick Look cannot display the app’s buttons. To change it, return to the app and reopen AR.
- Runtime material overrides use automatically generated USDZ, ignoring any supplied `iosSrc`, so the exported solid colors follow the selection. Dedicated unmodified variants can use their matching prebuilt USDZ. Scene Viewer is omitted because external model fetches cannot access a private site's authenticated assets.
- AR scale is locked. The app checks GLB bounds against product dimensions before enabling AR. For layouts it validates each constituent model too.
- Material changes and GLB/USDZ export are covered by automated tests. Live WebXR placement and iPhone Quick Look remain **untested on a physical device**. A compatible phone is required to verify camera tracking. AR is a visual guide; confirm purchase-critical measurements with a tape measure.

## Current table model

`public/models/little-tree-oak-table.glb` is the user-supplied file, preserved without rescaling or changing its textures. Its embedded metadata specifies a 1.199896 m diameter and 0.750062 m height (displayed as 120 × 120 × 75 cm). Geometry is centered on X/Z with its base at Y=0. The model describes itself as a photo-based reconstruction: overall dimensions follow the listing, with some hidden construction details estimated. These measurements come from the supplied file, not a new independent product verification.

Demo-mode product links use this table. The configured local importer uses it only for the registered Little Tree table family; other products need their own registered model mapping. Previously saved products retain their original models. Round furniture uses an elliptical footprint in the floor plan and in room-boundary checks.

## Connect your friend's importer

See [INTEGRATION.md](./INTEGRATION.md). For the local Vite bridge, run the existing Amazon API separately and set these in `.env.local`, then restart Vite:

```dotenv
VITE_PRODUCT_API_URL=/api/products/import
FURNITURE_API_BASE_URL=http://127.0.0.1:8787
```

`FURNITURE_API_AUTH_TOKEN` is optional and server-only; the SerpAPI key stays in the Amazon backend. Never put credentials in public `VITE_` variables. The bridge is mounted by Vite’s `configureServer` and `configurePreviewServer` hooks; a static production build needs deployed middleware or a real import endpoint. Without `VITE_PRODUCT_API_URL`, links use the demo table without external product requests.

Product models must already be scaled to verified dimensions; a URL or photo alone does not provide accurate geometry. The bridge rejects unsupported products rather than substituting a table.

The bridge allows up to 70 seconds for the Amazon backend, and the browser allows 75 seconds for the complete import. Safe error messages from the local bridge explain unsupported models, incomplete measurements, and lookup failures. External import endpoints retain a generic failure message.

## Source map

- `src/App.tsx`: workspace overview, layouts, saved library, creation and navigation.
- `src/components/LinkInput.tsx`: universal product-link entry and importer connection.
- `src/components/PreviewModal.tsx`: individual product/AR preview.
- `src/components/FinishPicker.tsx`: named finish choices and approximate-preview labels.
- `src/components/RoomEditor.tsx`: arrangement editing and undo.
- `src/components/FloorPlan.tsx`: dimensioned SVG plan with touch, pointer and keyboard controls.
- `src/components/LayoutViewer.tsx`: whole-layout 3D/AR preview and temporary asset lifecycle.
- `src/lib/layout-model.ts`: model loading, geometry checks and combined scene export.
- `src/lib/material-colors.ts`: exact-name material overrides, original texture restoration and isolated instance materials.
- `src/lib/workspace.ts`: workspace types, validation, persistence and layout operations.
- `src/components/Viewer.tsx`: fixed-scale AR activation, tracking, errors and capability fallback.
- `src/lib/products.ts`: importer schema and geometry dimension validation.
- `server/amazon-import.ts`: local bridge to the separately running Amazon API and the registered model-family adapter.
- `tests/`: model dimensions, importer contract, input validation, finish persistence, material isolation/restoration and combined GLB/USDZ colors and transforms.

Original furniture GLBs are retained as development fixtures; the UI exposes only the one placeholder model. They can be regenerated with `npm run models`.

## Credits

The room photograph is from [Unsplash](https://images.unsplash.com/photo-1600210492486-724fe5c67fb0), downloaded as a local UI asset. It illustrates the room-planning entry point and is not a saved user layout. The original procedural fixture geometry is CC0-1.0; this does not apply to the separately supplied Little Tree table. Package licenses apply to dependencies. AR support uses Google's [model-viewer](https://modelviewer.dev/docs/index.html).
