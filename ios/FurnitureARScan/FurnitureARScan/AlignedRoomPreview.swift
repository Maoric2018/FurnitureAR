import SwiftUI
import RealityKit
import ARKit
import Combine

struct NativeARRequest: Identifiable {
    let id = UUID()
    let payload: LayoutARPayload
    let file: URL
}
@MainActor final class AlignedPreviewModel: ObservableObject {
    let request: NativeARRequest
    let tracking: RoomTrackingStore
    @Published var entity: Entity?
    @Published var transform: simd_float4x4?
    @Published var manual = false
    @Published var manualAligned = false
    @Published var firstPoint: SIMD3<Float>?
    @Published var wallIndex = 0
    @Published var error: String?
    @Published var showOutline = true
    private var loader: AnyCancellable?
    var walls: [PlanWall] { request.payload.walls.filter { hypot($0.end.x-$0.start.x,$0.end.z-$0.start.z) >= 0.5 } }
    var wall: PlanWall { walls[wallIndex % walls.count] }
    init(request: NativeARRequest, tracking: RoomTrackingStore) {
        self.request = request; self.tracking = tracking
        transform = tracking.prepare(request.payload.scanId,walls:request.payload.walls)
        loader = Entity.loadAsync(contentsOf:request.file).sink(receiveCompletion:{ [weak self] result in
            if case .failure = result { self?.error = "The furniture model could not load. Close this preview and try again." }
        },receiveValue:{ [weak self] entity in
            let size = entity.visualBounds(relativeTo:nil).extents
            guard [size.x,size.y,size.z].allSatisfy({$0.isFinite && $0 >= 0 && $0 < 40}) else { self?.error="The furniture model has invalid dimensions."; return }
            self?.entity = entity
        })
    }
    func resume() {
        transform=nil;manual=false;manualAligned=false;firstPoint=nil
        transform=tracking.prepare(request.payload.scanId,walls:request.payload.walls)
    }
    func beginManual() {
        tracking.startManualSession(); transform = nil; manual = true; manualAligned = false; firstPoint = nil; error = nil
    }
    func chooseNextWall() { wallIndex = (wallIndex+1) % walls.count; firstPoint = nil; error = nil }
    func tapped(_ position: SIMD3<Float>) {
        guard manual,tracking.ready else{return}
        guard let first = firstPoint else { firstPoint=position;error=nil;return }
        do {
            transform = try RoomAlignment.matching(wall:wall,first:first,second:position)
            manual = false; manualAligned = true; firstPoint = nil; error = nil
        } catch { self.error=error.localizedDescription;firstPoint=nil }
    }
}
struct AlignedRoomPreview: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var tracking: RoomTrackingStore
    @StateObject private var model: AlignedPreviewModel
    init(request: NativeARRequest, tracking: RoomTrackingStore) {
        self.tracking = tracking
        _model = StateObject(wrappedValue:AlignedPreviewModel(request:request,tracking:tracking))
    }
    var body: some View {
        ZStack(alignment:.top) {
            AlignedCamera(model:model,tracking:tracking).ignoresSafeArea()
            VStack(spacing:12) {
                HStack {
                    Button { dismiss() } label:{Label("Done",systemImage:"xmark")}.buttonStyle(.borderedProminent)
                    Spacer()
                    Text(model.request.payload.name).font(.headline).lineLimit(1).padding(10).background(.regularMaterial,in:Capsule())
                }
                Spacer()
                VStack(alignment:.leading,spacing:12) {
                    Label(model.manualAligned && tracking.ready ? "Manually aligned" : tracking.message,systemImage:tracking.ready ? "viewfinder" : "viewfinder.circle")
                        .font(.headline)
                    if model.entity == nil && model.error == nil { HStack {ProgressView();Text("Loading your furniture…")} }
                    if model.manual {
                        WallAlignmentPlan(walls:model.walls,selected:model.wallIndex).frame(height:130)
                        Text(model.firstPoint == nil ? "Tap A in the camera: the first floor corner of the highlighted wall." : "Now tap B: the other floor corner of that same wall.")
                        HStack {
                            Button("Choose another wall",action:model.chooseNextWall)
                            Spacer()
                            Button("Start points again") { model.firstPoint=nil;model.error=nil }
                        }.font(.subheadline)
                    } else {
                        Text(model.transform == nil ? "Match a wall to place the layout in the right part of your room." : "The outline should follow your real walls. Existing furniture stays real; only your new pieces are added.").font(.subheadline)
                        HStack {
                            Button("Match a wall",action:model.beginManual).buttonStyle(.bordered)
                            Spacer()
                            Toggle("Room outline",isOn:$model.showOutline).fixedSize()
                        }
                    }
                    if let error=model.error { Text(error).font(.subheadline).foregroundStyle(.red) }
                }.padding(18).background(.regularMaterial,in:RoundedRectangle(cornerRadius:20))
            }.padding()
        }.interactiveDismissDisabled().onChange(of:scenePhase){_,phase in if phase == .active{model.resume()}}
    }
}
private struct AlignedCamera: UIViewRepresentable {
    @ObservedObject var model: AlignedPreviewModel
    @ObservedObject var tracking: RoomTrackingStore
    func makeCoordinator()->Coordinator { Coordinator(model:model) }
    func makeUIView(context:Context)->ARView {
        let view=ARView(frame:.zero,cameraMode:.ar,automaticallyConfigureSession:false)
        view.session=tracking.session;tracking.session.delegate=tracking
        context.coordinator.view=view
        view.addGestureRecognizer(UITapGestureRecognizer(target:context.coordinator,action:#selector(Coordinator.tap(_:))))
        // Do not install translation/scale gestures: this preview uses room coordinates.
        return view
    }
    func updateUIView(_ view:ARView,context:Context) {
        let coordinator=context.coordinator
        if let entity=model.entity,coordinator.furniture !== entity {
            coordinator.furniture?.removeFromParent();coordinator.furniture=entity;coordinator.content.addChild(entity)
            coordinator.outline.children.removeAll()
            for wall in model.request.payload.walls {
                let dx=wall.end.x-wall.start.x,dz=wall.end.z-wall.start.z,length=hypot(dx,dz)
                let line=ModelEntity(mesh:.generateBox(size:SIMD3(length,0.012,0.018)),materials:[UnlitMaterial(color:.systemGreen.withAlphaComponent(0.8))])
                line.position=SIMD3((wall.start.x+wall.end.x)/2,0.012,(wall.start.z+wall.end.z)/2)
                line.orientation=simd_quatf(angle:-atan2(dz,dx),axis:SIMD3(0,1,0))
                coordinator.outline.addChild(line)
            }
            coordinator.content.addChild(coordinator.outline)
        }
        if let transform=model.manualAligned ? model.transform : (tracking.alignedOrigin ?? model.transform) { coordinator.content.transform=Transform(matrix:transform) }
        let visible=tracking.ready && model.transform != nil && !model.manual
        // Do not create a world anchor in a temporary, unrelocalized coordinate frame.
        if visible && coordinator.root == nil {
            let root=AnchorEntity(world:SIMD3<Float>.zero)
            root.addChild(coordinator.content);view.scene.addAnchor(root);coordinator.root=root
        } else if !visible,let root=coordinator.root {
            view.scene.removeAnchor(root);coordinator.content.removeFromParent();coordinator.root=nil
        }
        coordinator.content.isEnabled=visible
        coordinator.outline.isEnabled=model.showOutline
    }
    static func dismantleUIView(_ uiView:ARView,coordinator:Coordinator) {
        // The app owns the shared session. Leaving this view must not pause it.
        uiView.scene.anchors.removeAll()
    }
    @MainActor final class Coordinator:NSObject {
        let model:AlignedPreviewModel
        weak var view:ARView?
        let content=Entity(),outline=Entity()
        var root:AnchorEntity?
        var furniture:Entity?
        init(model:AlignedPreviewModel){self.model=model}
        @objc func tap(_ gesture:UITapGestureRecognizer) {
            guard model.manual,model.tracking.ready,let view else{return}
            let point=gesture.location(in:view)
            // Require a detected horizontal surface; estimated hits can land on a wall.
            guard let hit=view.raycast(from:point,allowing:.existingPlaneGeometry,alignment:.horizontal).first else {
                model.error="No floor detected there yet. Move slowly, then tap where the wall meets the floor.";return
            }
            let p=hit.worldTransform.columns.3
            model.tapped(SIMD3(p.x,p.y,p.z))
        }
    }
}
private struct WallAlignmentPlan:View {
    let walls:[PlanWall];let selected:Int
    var body:some View {
        Canvas { context,size in
            let points=walls.flatMap{[$0.start,$0.end]}
            let minX=points.map(\.x).min() ?? 0,maxX=points.map(\.x).max() ?? 1
            let minZ=points.map(\.z).min() ?? 0,maxZ=points.map(\.z).max() ?? 1
            let scale=min((size.width-40)/CGFloat(max(maxX-minX,1)),(size.height-30)/CGFloat(max(maxZ-minZ,1)))
            func p(_ point:PlanPoint)->CGPoint{CGPoint(x:(size.width-CGFloat(maxX-minX)*scale)/2+CGFloat(point.x-minX)*scale,y:15+CGFloat(point.z-minZ)*scale)}
            for (i,wall) in walls.enumerated(){var path=Path();path.move(to:p(wall.start));path.addLine(to:p(wall.end));context.stroke(path,with:.color(i==selected ? .orange:.secondary),lineWidth:i==selected ? 5:2)}
            if walls.indices.contains(selected){let wall=walls[selected];context.draw(Text("A").bold().foregroundStyle(.orange),at:p(wall.start),anchor:.bottom);context.draw(Text("B").bold().foregroundStyle(.orange),at:p(wall.end),anchor:.bottom)}
        }.accessibilityLabel("Match wall \(selected+1). Tap its A corner, then its B corner at floor level.")
    }
}
