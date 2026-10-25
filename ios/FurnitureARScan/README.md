# Roomify Scan

Native SwiftUI companion for the Roomify mobile website. Uses Apple's RoomPlan and LiDAR to capture wall sections, doors, windows, openings, and supported furniture categories. Your iPhone 16 Pro is supported. Requires iOS 17 or later; capture does not work in a browser or simulator.

## Install on your iPhone

1. Open `FurnitureARScan.xcodeproj` in Xcode on your Mac.
2. Select the **FurnitureARScan** target → **Signing & Capabilities**, enable automatic signing, and choose your Apple development team. A personal Apple account can be used for local development. Change the bundle identifier if Xcode requests a unique one.
3. Connect and unlock your iPhone, trust this Mac, and select the phone as the run destination. If prompted, enable Developer Mode in the phone's **Settings → Privacy & Security**, then follow the restart instructions.
4. Press **Run** in Xcode. If iOS requests developer trust, follow its Settings instructions. This is a development install, not an App Store release; Xcode will indicate any signing or renewal requirements.

## Scan → layout

1. On the planner website, choose **New layout → Scan your room → Perform a room scan**. Its launch link passes that website's HTTPS address to this app. For a standalone scan, open the app, enter your website under **Planner address**, and choose **Scan my room**.
2. Slowly capture one room, including every wall, doorway, and piece of furniture. Follow the on-screen RoomPlan guidance, then choose **Finish scan**.
3. Review the outline and name the room. **Open in Roomify** opens the website that launched this scan inside the app. The completed scan opens immediately as a new layout in the regular editor. Both the installed app and web deployment must include the native bridge. A scan retains its destination when another scan or a later settings change selects a different website. There is no hardcoded default website. The **Planner address** setting accepts an HTTPS development preview for standalone scans and older scans without a saved destination. An older site shows an explicit connection error.
4. You can also export the room JSON using **Save / share room file**. Files include measurements and a scan ID, but do not include the private tracking map. In a browser, choose **New layout → Scan your room → Upload a room scan**. The native scan option opens RoomPlan.
5. Existing objects appear as hatched outlines in the same layout list as new products. Drag, rotate, or keyboard-nudge them in the regular editor. They appear without detected category labels. Select one to correct its dimensions, position, or rotation; add missed furniture or remove a false detection. Add Amazon products and arrange around the existing objects. Collision and doorway warnings are estimates.

6. In a populated scanned layout, choose **3D & AR → View layout in your room**. The app uses the scan’s still-running ARSession, or attempts to recognize a saved room map. New furniture appears only after tracking is normal and the saved room anchor is restored. Check the green room outline against your real walls.
7. If the map is missing or recognition stalls, choose **Match a wall**. Match the highlighted A and B floor corners in that order using two camera taps. You can select another wall. The app checks wall length and floor height, applies translation and rotation, and never scales the furniture. **Room outline** hides the guide. Interrupted tracking hides the furniture; reopening or foregrounding the preview attempts recognition again.

The planner stores layouts in the app's WKWebView storage, separate from Safari/Chrome. Layouts and tracking maps do not sync between devices. Maps are stored by scan ID so older layouts can reconnect to the correct saved room; missing or mismatched geometry always falls back to manual alignment. Legacy scans without scan IDs still work through manual alignment. Normal browser AR continues to place the complete arrangement manually.

### Updating an older scanner

Rebuild and reinstall this iPhone app after updating the repository. Publishing the website alone cannot update an installed scanner that ignores the `returnUrl` parameter. Until you install the update, copy the correct website address from the browser and paste it into the scanner's **Planner address** setting before opening the completed scan. If your older scanner has no such setting, use **Save / share room file**, then upload that JSON on the correct website.

Updated launch links use `furniturear-scan://scan?returnUrl=<encoded HTTPS planner URL>`. Both the planner and scanner setup page derive the destination from their own hosting URL. Exactly one return address is accepted; credentials, query strings, fragments, and non-HTTPS addresses are rejected without falling back to an old address. A bare legacy launch uses the saved manual address. New launches are rejected while a scan, permission prompt, planner, or share sheet is open, so they cannot replace an in-progress scan's destination.

## Data and geometry

Tracking maps and room-to-world transforms stay in Application Support with iOS file protection and are never sent to the website or Claude. The planner receives measurements and an opaque scan UUID through a main-frame, exact-origin WKWebView bridge. Using the designer sends measured geometry and any separately selected photos to Claude. Export files live in the app's temporary directory. The legacy optional web handoff still supports URL fragments; new in-app imports use a structured event without putting room measurements in navigation history.

`RoomDocument.swift` defines the versioned `furniture-ar-room` JSON format. Coordinates are metres in RoomPlan's X/Z ground plane. Wall endpoints use each surface's local X axis, and furniture footprints use local X/Z dimensions plus rotation around the vertical axis. The web importer rigidly rotates the dominant wall directions to the nearest horizontal/vertical axes, then recenters all layers using the rotated wall bounds, without rescaling. Native AR validates a rigid mapping from these aligned walls back to the trusted on-device scan and composes it with the scan origin or restored ARAnchor transform; modified room geometry falls back to manual matching. The USDZ exporter disables automatic plane anchoring and preserves the scene origin. It sends only new furniture, with a 48 MiB model limit; native input and scan identity are validated before opening the camera. World anchors are created only after tracking is ready. No pinch scaling or arbitrary dragging is installed in the aligned viewer.

Imports are bounded to 512 KB, 200 entries per layer, and room bounds of 1–20 metres. Openings are cut out of matching wall sections; doorway clearance warnings use a 0.9 m deep approximation. Furniture collision uses oriented footprints, not full 3D geometry. Windows remain solid obstacles. RoomPlan can miss clutter, unusual shapes, glass, and unsupported objects. Review the scan and confirm important dimensions before relying on fit. Capture complete rooms: the UI does not edit wall geometry yet; rescan if the outline is incomplete.

## Checks

From the web repository root:

```sh
npm test
npm run build
xcrun swiftc ios/FurnitureARScan/FurnitureARScan/PlannerReturn.swift \
  ios/FurnitureARScan/Tests/PlannerReturnChecks.swift -o /tmp/furniture-ar-planner-return-checks
/tmp/furniture-ar-planner-return-checks
xcrun swiftc ios/FurnitureARScan/FurnitureARScan/RoomAlignment.swift \
  ios/FurnitureARScan/Tests/AlignmentChecks.swift -o /tmp/furniture-ar-alignment-checks
/tmp/furniture-ar-alignment-checks
xcodebuild -project ios/FurnitureARScan/FurnitureARScan.xcodeproj \
  -scheme FurnitureARScan -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/furniturear-scan-build CODE_SIGNING_ALLOWED=NO build
```

An unsigned build verifies compilation; installation and real tracking require a signed app on a physical LiDAR device. Physical same-session placement, relocalization, camera interruptions, and manual wall taps remain a device-test checklist. The web tests use `tests/fixtures/room-scan.json`, a synthetic QA room, not a captured room. The app exposes no sample scans to users. Native math tests cover origin restoration, translation/yaw, fixed scale, reversed wall direction, invalid corner taps, mismatched room geometry, and malformed bridge payloads. Foundation-only return-address checks cover multiple hosting domains, encoded paths, legacy/manual launches, saved scan destinations, and invalid or duplicated callbacks. On a device, launch a scan from two different hosted planner URLs in succession and confirm each completed scan opens its own host; also retry a launch during camera permission and during capture to check the busy guard.

`PlannerReturn.swift` owns destination validation. The optional `plannerURL` stored with a room is revalidated before navigation; older room JSON without it remains supported. The legacy `RoomDocument.webURL(destination:)` helper requires a caller-provided validated destination and never chooses a deployment itself. The WKWebView bridge remains restricted to the selected destination's exact origin.
