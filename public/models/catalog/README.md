# Supplied furniture model catalog

Thirty GLBs extracted from the supplied 10-model and 20-model archives. Files are grouped by furniture type and use lowercase hyphenated filenames. Every GLB is byte-for-byte identical to its archive entry; geometry, materials, embedded textures, scale, and metadata are preserved.

## Inventory

- `seating/`: 14 chairs, stools, benches, sofas, and ottomans.
- `tables/`: 6 tables and desks.
- `storage/`: 9 cabinets, shelves, a dresser, a nightstand, and a bar cart.
- `beds/`: 1 bed.
- [catalog.json](catalog.json): original archive/filename mapping, SHA-256 checksums, sizes, ASINs, links, reported dimensions, and the complete embedded model metadata.

The GLBs describe themselves as photo-based approximations for AR prototyping, not manufacturer CAD. Product identity, dimension sources, and provenance in the catalog are copied from the files; they have not been independently checked against current Amazon listings. Dimensions use metres. The original `sourceMetadata` may describe Blender Z-up bounds and filenames for exports that were not supplied; the delivered GLBs use the standard glTF coordinate system.

This is an asset inventory. Adding these files does not register new products with the live Amazon importer. Existing table/lamp paths and development fixtures are unchanged. Refer to [the integration guide](../../../INTEGRATION.md#registered-models) before enabling a model for AR.

## File verification

All 30 extracted files match their archive entries and catalog SHA-256 checksums. Their GLB 2.0 headers, chunks, embedded buffers, and embedded image references were checked. Geometry loads through the app's Three.js GLTFLoader with finite vertices and valid triangle indices. World-space dimensions match the embedded dimensions within 1 mm; models are centered on X/Z and rest on Y=0 within 1 mm. Texture rendering and real-product accuracy were not evaluated as part of organizing these files.

## Models

### Beds

| Model | Amazon ASIN | Source bundle | Size |
| --- | --- | --- | --- |
| [zinus-suzanne-queen-bed](beds/zinus-suzanne-queen-bed.glb) | [B075FGY7G2](https://www.amazon.com/dp/B075FGY7G2) | 20 models | 1.61 MB |

### Seating

| Model | Amazon ASIN | Source bundle | Size |
| --- | --- | --- | --- |
| [blue-granite-hand-chair](seating/blue-granite-hand-chair.glb) | [B0DVLMS1Z2](https://www.amazon.com/dp/B0DVLMS1Z2) | 20 models | 2.48 MB |
| [chita-swivel-accent-chair](seating/chita-swivel-accent-chair.glb) | [B0B7L7QGPT](https://www.amazon.com/dp/B0B7L7QGPT) | 10 models | 0.79 MB |
| [christopher-knight-elizabeth-recliner](seating/christopher-knight-elizabeth-recliner.glb) | [B01MYMWYNA](https://www.amazon.com/dp/B01MYMWYNA) | 20 models | 1.78 MB |
| [christopher-knight-scarlett-bench](seating/christopher-knight-scarlett-bench.glb) | [B01N57GMYZ](https://www.amazon.com/dp/B01N57GMYZ) | 20 models | 1.20 MB |
| [critter-sitters-pig-ottoman](seating/critter-sitters-pig-ottoman.glb) | [B08257LCB9](https://www.amazon.com/dp/B08257LCB9) | 20 models | 1.20 MB |
| [foinfun-mushroom-stool](seating/foinfun-mushroom-stool.glb) | [B0GXV7TYVW](https://www.amazon.com/dp/B0GXV7TYVW) | 10 models | 1.24 MB |
| [homepop-round-velvet-ottoman](seating/homepop-round-velvet-ottoman.glb) | [B0CHGSLKG1](https://www.amazon.com/dp/B0CHGSLKG1) | 20 models | 0.58 MB |
| [monicanest-lips-sofa](seating/monicanest-lips-sofa.glb) | [B0G6XR1GVJ](https://www.amazon.com/dp/B0G6XR1GVJ) | 20 models | 1.16 MB |
| [nathan-james-hylie-counter-stool](seating/nathan-james-hylie-counter-stool.glb) | [B07894DDW6](https://www.amazon.com/dp/B07894DDW6) | 20 models | 0.89 MB |
| [novogratz-brittany-futon](seating/novogratz-brittany-futon.glb) | [B01LY1WBQN](https://www.amazon.com/dp/B01LY1WBQN) | 10 models | 1.17 MB |
| [poly-bark-weave-dining-chair](seating/poly-bark-weave-dining-chair.glb) | [B00PZMS78A](https://www.amazon.com/dp/B00PZMS78A) | 20 models | 0.88 MB |
| [serwall-blue-adirondack-chair](seating/serwall-blue-adirondack-chair.glb) | [B0CB63RTJR](https://www.amazon.com/dp/B0CB63RTJR) | 20 models | 1.44 MB |
| [songmics-bamboo-shoe-bench](seating/songmics-bamboo-shoe-bench.glb) | [B00NL8NB6S](https://www.amazon.com/dp/B00NL8NB6S) | 10 models | 1.11 MB |
| [yaheetech-flower-swivel-chair](seating/yaheetech-flower-swivel-chair.glb) | [B0DGFVHZ64](https://www.amazon.com/dp/B0DGFVHZ64) | 20 models | 1.56 MB |

### Storage

| Model | Amazon ASIN | Source bundle | Size |
| --- | --- | --- | --- |
| [furinno-jaya-three-tier-bookcase](storage/furinno-jaya-three-tier-bookcase.glb) | [B01BWZWEAK](https://www.amazon.com/dp/B01BWZWEAK) | 20 models | 0.50 MB |
| [furinno-tree-bookshelf](storage/furinno-tree-bookshelf.glb) | [B0CV4ZMZ1Y](https://www.amazon.com/dp/B0CV4ZMZ1Y) | 20 models | 0.32 MB |
| [homcom-colonial-pantry](storage/homcom-colonial-pantry.glb) | [B073ZJWHH3](https://www.amazon.com/dp/B073ZJWHH3) | 20 models | 4.71 MB |
| [modway-render-tv-stand](storage/modway-render-tv-stand.glb) | [B078KDCJHT](https://www.amazon.com/dp/B078KDCJHT) | 10 models | 0.60 MB |
| [nathan-james-carter-bar-cart](storage/nathan-james-carter-bar-cart.glb) | [B07CY841TW](https://www.amazon.com/dp/B07CY841TW) | 20 models | 1.48 MB |
| [nathan-james-mina-nightstand](storage/nathan-james-mina-nightstand.glb) | [B084HCTYZ7](https://www.amazon.com/dp/B084HCTYZ7) | 10 models | 0.75 MB |
| [sicotas-fluted-sideboard](storage/sicotas-fluted-sideboard.glb) | [B0DQP7JT9H](https://www.amazon.com/dp/B0DQP7JT9H) | 20 models | 1.58 MB |
| [vasagle-ladder-bookcase](storage/vasagle-ladder-bookcase.glb) | [B092KFMM9M](https://www.amazon.com/dp/B092KFMM9M) | 10 models | 0.55 MB |
| [wlive-nine-drawer-dresser](storage/wlive-nine-drawer-dresser.glb) | [B09SH31M9Z](https://www.amazon.com/dp/B09SH31M9Z) | 20 models | 2.75 MB |

### Tables and desks

| Model | Amazon ASIN | Source bundle | Size |
| --- | --- | --- | --- |
| [christopher-knight-kajsa-table](tables/christopher-knight-kajsa-table.glb) | [B07F65C22Z](https://www.amazon.com/dp/B07F65C22Z) | 10 models | 0.28 MB |
| [design-toscano-elephant-table](tables/design-toscano-elephant-table.glb) | [B003M0JV5K](https://www.amazon.com/dp/B003M0JV5K) | 10 models | 3.91 MB |
| [fezibo-standing-desk](tables/fezibo-standing-desk.glb) | [B0FJXWCSXY](https://www.amazon.com/dp/B0FJXWCSXY) | 20 models | 1.01 MB |
| [mordchil-cloud-coffee-table](tables/mordchil-cloud-coffee-table.glb) | [B0FMDZ2SQC](https://www.amazon.com/dp/B0FMDZ2SQC) | 20 models | 0.62 MB |
| [nathan-james-telos-desk](tables/nathan-james-telos-desk.glb) | [B07889LS54](https://www.amazon.com/dp/B07889LS54) | 10 models | 0.43 MB |
| [vasagle-lift-top-coffee-table](tables/vasagle-lift-top-coffee-table.glb) | [B0BTHKXWTJ](https://www.amazon.com/dp/B0BTHKXWTJ) | 20 models | 1.04 MB |
