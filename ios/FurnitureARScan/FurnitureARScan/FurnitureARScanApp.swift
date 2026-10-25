import SwiftUI
import RoomPlan
import AVFoundation

@main struct FurnitureARScanApp: App {
    var body: some Scene { WindowGroup { ScanHome().tint(Color(red:0.34,green:0.42,blue:0.27)) } }
}
private struct ShareFile: Identifiable { let id = UUID(); let url: URL }
private struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
private struct ScanHome: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var tracking = RoomTrackingStore()
    @State private var planner: PlannerDestination?
    @AppStorage("plannerAddress") private var plannerAddress = PlannerReturn.currentAddress
    @State private var scanning = false
    @State private var openingCamera = false
    @State private var scanReturnURL: URL?
    @State private var room: RoomDocument? = loadRoom()
    @State private var shareFile: ShareFile?
    @State private var error: String?
    @State private var permissionDenied = false
    private var supported: Bool { RoomCaptureSession.isSupported }
    private static var savedURL: URL {
        URL.applicationSupportDirectory.appendingPathComponent("FurnitureARScan",isDirectory:true).appendingPathComponent("last-room.json")
    }
    private static func loadRoom() -> RoomDocument? {
        guard let data = try? Data(contentsOf: savedURL) else { return nil }
        return try? JSONDecoder().decode(RoomDocument.self, from: data)
    }
    private func save(_ room: RoomDocument) {
        do {
            try FileManager.default.createDirectory(at: Self.savedURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try room.data().write(to: Self.savedURL, options: [.atomic,.completeFileProtection])
        } catch { self.error = "The scan is ready but could not be saved on this device. Export the room file before closing the app." }
    }
    private func migratePlannerDestinations() {
        if let destination = try? PlannerReturn.configuredAddress(plannerAddress), plannerAddress != destination.absoluteString {
            plannerAddress = destination.absoluteString
        }
        // Older rooms without a bound destination can still use the setting.
        // Migrate already-bound retired destinations and persist the repair.
        if var current = room, current.plannerURL != nil,
           let destination = try? PlannerReturn.capturedAddress(current.plannerURL, manualAddress: plannerAddress),
           current.plannerURL != destination.absoluteString {
            current.plannerURL = destination.absoluteString
            room = current; save(current)
        }
    }
    private var canStartScan: Bool { supported && !scanning && !openingCamera && planner == nil && shareFile == nil }
    private func startScan(returningTo destination: URL? = nil) {
        guard canStartScan else { return }
        // Freeze the route before the asynchronous permission prompt. A second
        // launch cannot change this scan's destination while permission is open.
        let route: URL
        do {
            if let destination { route = try PlannerReturn.address(destination.absoluteString) }
            else { route = try PlannerReturn.configuredAddress(plannerAddress) }
        } catch { self.error = error.localizedDescription; return }
        plannerAddress = route.absoluteString
        openingCamera = true
        Task { @MainActor in
            defer { openingCamera = false }
            let granted: Bool
            if AVCaptureDevice.authorizationStatus(for: .video) == .authorized { granted = true }
            else { granted = await AVCaptureDevice.requestAccess(for: .video) }
            if granted { scanReturnURL = route; scanning = true }
            else { permissionDenied = true; error = "Allow Camera access in Settings to scan your room." }
        }
    }
    private func openScan(_ url: URL) {
        guard url.scheme?.lowercased() == "furniturear-scan" else { return }
        guard canStartScan else {
            error = "Finish or close the current scan or planner, then open the scanner from your website again."
            return
        }
        do {
            let destination = try PlannerReturn.launch(url, savedAddress: plannerAddress)
            if let destination { plannerAddress = destination.absoluteString }
            startScan(returningTo: destination)
        } catch { self.error = error.localizedDescription }
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("ROOMIFY").font(.caption.weight(.semibold)).tracking(3).foregroundStyle(.secondary)
                    Text(room == nil ? "Start with\nyour real room." : "A place for\nyour next idea.")
                        .font(.system(size:40,weight:.regular,design:.serif))
                    if let current = room {
                        TextField("Room name",text:Binding(get:{room?.name ?? ""},set:{room?.name=String($0.prefix(80))}))
                            .font(.title3.weight(.medium)).textFieldStyle(.roundedBorder)
                        ScanPlan(document:current).frame(height:300).background(.white).clipShape(RoundedRectangle(cornerRadius:14))
                        HStack {
                            metric(String(format:"%.2f × %.2f m",current.bounds.width,current.bounds.depth),"Overall bounds")
                            Spacer(); metric("\(current.obstacles.count)","Existing objects")
                        }
                        Text("Review the outline. You can correct detected objects in the layout editor. Confirm important measurements in your room.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Button {
                                guard !current.name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else { error="Give this room a name first."; return }
                                do {
                                    let url = try PlannerReturn.capturedAddress(current.plannerURL, manualAddress: plannerAddress)
                                    var updated = current
                                    updated.plannerURL = url.absoluteString
                                    room = updated; save(updated)
                                    planner=PlannerDestination(url:url,room:updated)
                                } catch { self.error = error.localizedDescription }
                        } label: { Label("Go to Roomify",systemImage:"arrow.up.right").frame(maxWidth:.infinity) }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                        Button {
                            do {
                                guard !current.name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else { error="Give this room a name first."; return }
                                save(current); shareFile=ShareFile(url:try current.file())
                            }
                            catch { self.error=error.localizedDescription }
                        } label: { Label("Save / share room file",systemImage:"square.and.arrow.up").frame(maxWidth:.infinity) }
                        .buttonStyle(.bordered).controlSize(.large)
                        Text("The planner stays inside this app so your scan and camera share room coordinates. Exported room files do not contain the private tracking map.")
                            .font(.footnote).foregroundStyle(.secondary)
                        Divider()
                    } else {
                        Image(systemName:"viewfinder").font(.system(size:64,weight:.ultraLight)).frame(maxWidth:.infinity,minHeight:160).foregroundStyle(Color(red:0.48,green:0.56,blue:0.39))
                        Text("Walk around once. Bring your walls, doorways, and existing furniture into your layout.").font(.title3).foregroundStyle(.secondary)
                        VStack(alignment:.leading,spacing:14) {
                            Label("Scan one room in good light.",systemImage:"sun.max")
                            Label("Move slowly and capture every corner.",systemImage:"figure.walk")
                            Label("Keep furniture and doorways in view.",systemImage:"sofa")
                        }.font(.subheadline)
                    }
                    Button { startScan() } label: { Label(room == nil ? "Scan my room" : "Scan another room",systemImage:"viewfinder").frame(maxWidth:.infinity) }
                        .buttonStyle(.borderedProminent).controlSize(.large).disabled(!canStartScan)
                    if !supported { Text("Scanning needs a LiDAR-equipped iPhone or iPad. Your iPhone 16 Pro is supported; the simulator cannot scan.").font(.footnote).foregroundStyle(.secondary) }
                    if let notice=tracking.mapNotice { Text(notice).font(.footnote).foregroundStyle(.secondary) }
                    DisclosureGroup("Planner address") {
                        TextField("https://…",text:$plannerAddress).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL).textFieldStyle(.roundedBorder)
                        Text("Opening the scanner from a website sets this automatically. Standalone scans use the current Roomify website unless you enter another address. Saved addresses from the retired website are updated automatically.").font(.footnote).foregroundStyle(.secondary)
                    }
                    Text("The tracking map stays on your phone. The planner receives room measurements; Design my room sends measurements and any photos you choose to Claude. Scans are estimates—confirm important dimensions.")
                        .font(.footnote).foregroundStyle(.secondary)
                }.padding(26)
            }.background(Color(red:0.96,green:0.97,blue:0.94))
                .navigationTitle("Room scanner").navigationBarTitleDisplayMode(.inline)
                .fullScreenCover(isPresented:$scanning) {
                    CaptureScreen(tracking:tracking) { result in
                        var captured = result
                        captured.plannerURL = scanReturnURL?.absoluteString
                        room=captured; save(captured)
                    }
                }
                .fullScreenCover(item:$planner) { destination in
                    NativeWorkspace(destination:destination,tracking:tracking) { result in
                        var captured = result
                        captured.plannerURL = destination.url.absoluteString
                        room=captured; save(captured)
                    }
                }
                .sheet(item:$shareFile) { ShareSheet(url:$0.url) }
                .alert("Room scanner",isPresented:Binding(get:{error != nil},set:{if !$0 {error=nil;permissionDenied=false}})) {
                    if permissionDenied { Button("Open Settings") { openURL(URL(string:UIApplication.openSettingsURLString)!) } }
                    Button("OK",role:.cancel) { error=nil;permissionDenied=false }
                } message: { Text(error ?? "") }
                .onAppear(perform:migratePlannerDestinations)
                .onOpenURL(perform:openScan)
                .onChange(of:scenePhase) { _,phase in if phase != .active { tracking.suspend() } }
        }
    }
    private func metric(_ value:String,_ label:String)->some View {
        VStack(alignment:.leading,spacing:5) { Text(value).font(.headline);Text(label).font(.caption).foregroundStyle(.secondary) }
    }
}
private struct ScanPlan: View {
    let document:RoomDocument
    var body: some View {
        Canvas { context,size in
            let bounds=document.bounds
            let scale=min((size.width-40)/CGFloat(max(bounds.width,1)),(size.height-40)/CGFloat(max(bounds.depth,1)))
            let dx=(size.width-CGFloat(bounds.width)*scale)/2, dz=(size.height-CGFloat(bounds.depth)*scale)/2
            func point(_ p:ScanPoint)->CGPoint { CGPoint(x:dx+CGFloat(p.x-bounds.minX)*scale,y:dz+CGFloat(p.z-bounds.minZ)*scale) }
            for wall in document.walls { var path=Path();path.move(to:point(wall.start));path.addLine(to:point(wall.end));context.stroke(path,with:.color(.gray),lineWidth:4) }
            for opening in document.openings { var path=Path();path.move(to:point(opening.start));path.addLine(to:point(opening.end));context.stroke(path,with:.color(opening.kind == "window" ? .cyan : .white),lineWidth:5) }
            for object in document.obstacles {
                var c=context;let center=point(ScanPoint(x:object.x,z:object.z))
                c.translateBy(x:center.x,y:center.y);c.rotate(by:.degrees(Double(object.rotation)))
                let rect=CGRect(x:-CGFloat(object.width)*scale/2,y:-CGFloat(object.depth)*scale/2,width:CGFloat(object.width)*scale,height:CGFloat(object.depth)*scale)
                c.fill(Path(roundedRect:rect,cornerRadius:3),with:.color(Color(red:0.78,green:0.82,blue:0.72)))
                c.stroke(Path(roundedRect:rect,cornerRadius:3),with:.color(.gray.opacity(0.7)),lineWidth:1)
            }
        }.accessibilityLabel("Scanned room with \(document.walls.count) walls and \(document.obstacles.count) existing objects")
    }
}
