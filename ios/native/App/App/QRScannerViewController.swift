import UIKit
import AVFoundation

/// Full-screen QR scanner for the connect screen. Reads one QR code with the iPhone camera and hands back its text;
/// nothing leaves the phone. The caller decides what the text means (`WizardOrigin.parse`).
final class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    enum Outcome { case text(String), cancelled, unavailable }

    var onFinish: ((Outcome) -> Void)?
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "ai.wizards.os.qr")
    private var preview: AVCaptureVideoPreviewLayer?
    private var finished = false

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
            // The Simulator and devices without a usable camera.
            DispatchQueue.main.async { self.finish(.unavailable) }
            return
        }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { DispatchQueue.main.async { self.finish(.unavailable) }; return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = output.availableMetadataObjectTypes.contains(.qr) ? [.qr] : []

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(layer)
        preview = layer
        buildOverlay()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let session = session
        sessionQueue.async { if !session.isRunning { session.startRunning() } } // startRunning blocks; never on main
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        let session = session
        sessionQueue.async { if session.isRunning { session.stopRunning() } }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let code = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first(where: { $0.type == .qr }),
              let text = code.stringValue, !text.isEmpty else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        finish(.text(text))
    }

    @objc private func cancel() { finish(.cancelled) }

    private func finish(_ outcome: Outcome) {
        guard !finished else { return }
        finished = true
        let done = onFinish
        dismiss(animated: true) { done?(outcome) }
    }

    private func buildOverlay() {
        let frame = UIView()
        frame.translatesAutoresizingMaskIntoConstraints = false
        frame.layer.borderColor = UIColor.white.withAlphaComponent(0.9).cgColor
        frame.layer.borderWidth = 3
        frame.layer.cornerRadius = 22
        frame.isUserInteractionEnabled = false

        let hint = UILabel()
        hint.translatesAutoresizingMaskIntoConstraints = false
        hint.text = "Scan the Wizard QR code shown in Setup → Use Wizard on your phone"
        hint.textColor = .white
        hint.font = .systemFont(ofSize: 17, weight: .semibold)
        hint.textAlignment = .center
        hint.numberOfLines = 0

        var style = UIButton.Configuration.filled()
        style.title = "Cancel"
        style.baseForegroundColor = .white
        style.baseBackgroundColor = UIColor.black.withAlphaComponent(0.45)
        style.cornerStyle = .capsule
        let close = UIButton(configuration: style)
        close.translatesAutoresizingMaskIntoConstraints = false
        close.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        close.accessibilityLabel = "Cancel scanning"

        [frame, hint, close].forEach(view.addSubview)
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            frame.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            frame.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            frame.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.68),
            frame.heightAnchor.constraint(equalTo: frame.widthAnchor),
            hint.topAnchor.constraint(equalTo: frame.bottomAnchor, constant: 28),
            hint.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 32),
            hint.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -32),
            close.topAnchor.constraint(equalTo: guide.topAnchor, constant: 12),
            close.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
        ])
    }
}
