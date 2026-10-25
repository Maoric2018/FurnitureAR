import SwiftUI
import WebKit
import AVFoundation
import RoomPlan

struct PlannerDestination:Identifiable { let id=UUID();let url:URL;let room:RoomDocument }
@MainActor final class NativeWorkspaceModel:NSObject,ObservableObject,WKScriptMessageHandlerWithReply,WKNavigationDelegate {
    @Published var scanning=false
    @Published var preview:NativeARRequest?
    @Published var error:String?
    @Published var connected=false
    let destination:PlannerDestination
    let tracking:RoomTrackingStore
    var webView:WKWebView?
    private var pendingRoom:RoomDocument?
    private var previewFile:URL?
    private var openingCamera=false
    private var connectionCheck:Task<Void,Never>?
    init(destination:PlannerDestination,tracking:RoomTrackingStore){self.destination=destination;self.tracking=tracking;pendingRoom=destination.room}
    func makeWebView()->WKWebView {
        let config=WKWebViewConfiguration()
        config.userContentController.addScriptMessageHandler(self,contentWorld:.page,name:"furnitureAR")
        let origin=Self.origin(destination.url)
        let literal=String(data:try! JSONEncoder().encode(origin),encoding:.utf8)!
        config.userContentController.addUserScript(WKUserScript(source:"if(location.origin===\(literal)){Object.defineProperty(window,'furnitureARNativeVersion',{value:1});}",injectionTime:.atDocumentStart,forMainFrameOnly:true))
        let view=WKWebView(frame:.zero,configuration:config);view.navigationDelegate=self
        view.isOpaque=false;view.backgroundColor = .systemBackground
        webView=view;view.load(URLRequest(url:destination.url));return view
    }
    private static func origin(_ url:URL)->String {
        let standardPort=url.scheme == "https" ? 443:80
        let port=url.port.flatMap{$0 == standardPort ? nil:":\($0)"} ?? ""
        return "\(url.scheme?.lowercased() ?? "")://\(url.host?.lowercased() ?? "")\(port)"
    }
    private func trusted(_ message:WKScriptMessage)->Bool {
        let origin=message.frameInfo.securityOrigin
        let expectedPort=destination.url.port ?? (destination.url.scheme == "https" ? 443:80)
        return message.frameInfo.isMainFrame && origin.protocol == destination.url.scheme && origin.host.lowercased() == destination.url.host?.lowercased()
            && (origin.port == 0 || origin.port == expectedPort)
    }
    func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage,replyHandler:@escaping (Any?,String?)->Void) {
        guard trusted(message),let body=message.body as? [String:Any],body["version"] as? Int == 1,let kind=body["kind"] as? String else {replyHandler(nil,"Unsupported app message.");return}
        switch kind {
        case "ready": connected=true;connectionCheck?.cancel();replyHandler(["version":1],nil);deliverRoom()
        case "scan":
            guard !openingCamera,!scanning,preview == nil,RoomCaptureSession.isSupported else{replyHandler(nil,"Room scanning is unavailable right now.");return}
            openingCamera=true
            Task { @MainActor in
                defer{self.openingCamera=false}
                let granted=AVCaptureDevice.authorizationStatus(for:.video) == .authorized ? true:await AVCaptureDevice.requestAccess(for:.video)
                if granted {self.scanning=true;replyHandler(true,nil)} else {replyHandler(nil,"Allow Camera access in Settings to scan your room.")}
            }
        case "preview":
            guard !openingCamera,preview == nil,!scanning else{replyHandler(nil,"Close the current camera view first.");return}
            openingCamera=true
            do {
                guard let raw=body["payload"],JSONSerialization.isValidJSONObject(raw) else{throw AlignmentError.invalidLayout}
                let bytes=try JSONSerialization.data(withJSONObject:raw)
                guard bytes.count <= 69_000_000 else{throw AlignmentError.invalidLayout}
                let payload=try JSONDecoder().decode(LayoutARPayload.self,from:bytes)
                let model=try payload.validate()
                guard payload.walls.contains(where:{hypot($0.end.x-$0.start.x,$0.end.z-$0.start.z)>=0.5}) else{throw AlignmentError.shortWall}
                let file=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("usdz")
                try model.write(to:file,options:[.atomic,.completeFileProtection]);previewFile=file
                Task { @MainActor in
                    defer{self.openingCamera=false}
                    let granted=AVCaptureDevice.authorizationStatus(for:.video) == .authorized ? true:await AVCaptureDevice.requestAccess(for:.video)
                    if granted {self.preview=NativeARRequest(payload:payload,file:file);replyHandler(true,nil)}
                    else {self.cleanupPreview();replyHandler(nil,"Allow Camera access in Settings to preview your layout.")}
                }
            } catch { openingCamera=false;replyHandler(nil,error.localizedDescription) }
        default:replyHandler(nil,"Unsupported app action.")
        }
    }
    func receive(_ room:RoomDocument){pendingRoom=room;deliverRoom()}
    private func deliverRoom(){
        guard connected,let room=pendingRoom,let json=try? JSONSerialization.jsonObject(with:room.data()) else{return}
        webView?.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('furniture-ar:scan',{detail:room}));",arguments:["room":json],in:nil,in:.page) { [weak self] result in
            if case .success = result {self?.pendingRoom=nil} else {self?.error="The room could not reach the planner. Reload the planner to try again."}
        }
    }
    func cleanupPreview(){if let file=previewFile{try? FileManager.default.removeItem(at:file)};previewFile=nil}
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){
        connectionCheck?.cancel()
        connectionCheck=Task { [weak self] in
            try? await Task.sleep(for:.seconds(12));guard !Task.isCancelled,let self,!self.connected else{return}
            self.error="This website version does not support the room-alignment connection yet. Use the updated planner URL in the scanner’s Planner address setting."
        }
    }
    func webView(_ webView:WKWebView,didStartProvisionalNavigation navigation:WKNavigation!){connected=false}
    func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error){self.error="The planner could not load. Check your connection and Planner address."}
    func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping (WKNavigationActionPolicy)->Void){
        guard let url=navigationAction.request.url else{decisionHandler(.cancel);return}
        if Self.origin(url)==Self.origin(destination.url){decisionHandler(.allow)}
        else{decisionHandler(.cancel);if navigationAction.navigationType == .linkActivated && ["https","http"].contains(url.scheme ?? ""){UIApplication.shared.open(url)}}
    }
    func tearDown(){connectionCheck?.cancel();cleanupPreview();tracking.suspend();webView?.configuration.userContentController.removeScriptMessageHandler(forName:"furnitureAR",contentWorld:.page);webView?.navigationDelegate=nil;webView=nil}
}
struct NativeWorkspace:View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model:NativeWorkspaceModel
    let tracking:RoomTrackingStore
    let onScan:(RoomDocument)->Void
    init(destination:PlannerDestination,tracking:RoomTrackingStore,onScan:@escaping (RoomDocument)->Void){
        self.tracking=tracking;self.onScan=onScan
        _model=StateObject(wrappedValue:NativeWorkspaceModel(destination:destination,tracking:tracking))
    }
    var body:some View {
        NavigationStack {
            PlannerWebView(model:model).navigationTitle("Roomify").navigationBarTitleDisplayMode(.inline)
                .toolbar{ToolbarItem(placement:.cancellationAction){Button("Scanner"){dismiss()}};ToolbarItem(placement:.primaryAction){Button{model.webView?.reload()}label:{Image(systemName:"arrow.clockwise")}}}
                .fullScreenCover(isPresented:$model.scanning){CaptureScreen(tracking:tracking){room in onScan(room);model.receive(room)}}
                .fullScreenCover(item:$model.preview,onDismiss:model.cleanupPreview){AlignedRoomPreview(request:$0,tracking:tracking)}
                .alert("Roomify",isPresented:Binding(get:{model.error != nil},set:{if !$0{model.error=nil}})){Button("OK",role:.cancel){model.error=nil}}message:{Text(model.error ?? "")}
        }
    }
}
private struct PlannerWebView:UIViewRepresentable {
    let model:NativeWorkspaceModel
    func makeCoordinator()->NativeWorkspaceModel{model}
    func makeUIView(context:Context)->WKWebView{model.makeWebView()}
    func updateUIView(_ uiView:WKWebView,context:Context){}
    static func dismantleUIView(_ uiView:WKWebView,coordinator:NativeWorkspaceModel){coordinator.tearDown()}
}
