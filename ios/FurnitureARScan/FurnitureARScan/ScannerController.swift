import SwiftUI
import RoomPlan
import AVFoundation

@MainActor final class ScanModel: ObservableObject {
    let tracking: RoomTrackingStore
    init(tracking: RoomTrackingStore) { self.tracking = tracking }
    @Published var processing = false
    @Published var error: String?
    @Published var result: RoomDocument?
    lazy var controller: ScannerController = {
        let controller = ScannerController(tracking: tracking)
        controller.onResult = { [weak self] room in
            guard let self else { return }
            do { let document = try RoomDocument(room: room); self.tracking.completeScan(document); self.result = document }
            catch { self.tracking.suspend(); self.error = error.localizedDescription }
            self.processing = false
        }
        controller.onError = { [weak self] error in self?.tracking.suspend(); self?.error = error; self?.processing = false }
        return controller
    }()
    func finish() { guard !processing else { return }; processing = true; controller.finish() }
    func stop() { controller.cancel() }
}

@MainActor final class ScannerController: UIViewController, RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
    private let tracking: RoomTrackingStore
    private var completed = false
    init(tracking: RoomTrackingStore) { self.tracking = tracking; super.init(nibName:nil,bundle:nil) }
    required init?(coder: NSCoder) { fatalError("Use init(tracking:)") }
    private var captureView: RoomCaptureView!
    private var started = false
    private var cancelled = false
    var onResult: ((CapturedRoom) -> Void)?
    var onError: ((String) -> Void)?
    override func viewDidLoad() {
        super.viewDidLoad()
        captureView = RoomCaptureView(frame: .zero, arSession: tracking.session)
        captureView.delegate = self
        captureView.captureSession.delegate = self
        captureView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(captureView)
        NSLayoutConstraint.activate([
            captureView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            captureView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            captureView.topAnchor.constraint(equalTo: view.topAnchor),
            captureView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }
        started = true
        tracking.beginScan()
        captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }
    func finish() { captureView?.captureSession.stop(pauseARSession:false) }
    func cancel() { guard !completed else { return }; cancelled = true; captureView?.captureSession.stop(); tracking.suspend() }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); cancel() }
    nonisolated func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        if let error { Task { @MainActor [weak self] in if self?.cancelled == false { self?.onError?(error.localizedDescription) } }; return false }
        return true
    }
    nonisolated func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        Task { @MainActor [weak self] in
            guard let self, !self.cancelled else { return }
            if let error { self.onError?(error.localizedDescription) }
            else { self.completed = true; self.onResult?(processedResult) }
        }
    }
    nonisolated func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
        guard let error else { return }
        Task { @MainActor [weak self] in if self?.cancelled == false { self?.onError?(error.localizedDescription) } }
    }
}
struct CaptureSurface: UIViewControllerRepresentable {
    let controller: ScannerController
    func makeUIViewController(context: Context) -> ScannerController { controller }
    func updateUIViewController(_ uiViewController: ScannerController, context: Context) {}
    static func dismantleUIViewController(_ uiViewController: ScannerController, coordinator: ()) { uiViewController.cancel() }
}
struct CaptureScreen: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: ScanModel
    let onComplete: (RoomDocument) -> Void
    init(tracking: RoomTrackingStore, onComplete: @escaping (RoomDocument) -> Void) {
        _model = StateObject(wrappedValue:ScanModel(tracking:tracking)); self.onComplete = onComplete
    }
    var body: some View {
        NavigationStack {
            CaptureSurface(controller: model.controller).ignoresSafeArea(edges: .bottom)
                .navigationTitle("Scan your room").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { model.stop(); dismiss() } } }
                .safeAreaInset(edge: .bottom) {
                    VStack(spacing: 12) {
                        Text(model.processing ? "Building your room…" : "Move slowly. Capture every wall, corner, and large piece of furniture.")
                            .font(.subheadline).multilineTextAlignment(.center)
                        if model.processing { ProgressView() }
                        else { Button("Finish scan", action: model.finish).buttonStyle(.borderedProminent).controlSize(.large) }
                    }.padding(20).frame(maxWidth: .infinity).background(.regularMaterial)
                }
                .onReceive(model.$result) { if let result = $0 { onComplete(result); dismiss() } }
                .alert("Scan couldn’t finish", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil; dismiss() } })) {
                    Button("Try again") { model.stop(); dismiss() }
                } message: { Text(model.error ?? "Please try another scan.") }
        }.interactiveDismissDisabled()
    }
}
