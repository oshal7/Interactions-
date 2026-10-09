// Paper Sky · macOS screen saver
//
// A ScreenSaverView that hosts a WKWebView showing web/index.html
// (bundled in Contents/Resources/web) in "screensaver" mode:
// autopilot gestures, a clock, 30 fps, no sound.
//
// The screen saver never handles your password: when it ends, macOS
// shows its own login prompt (if "Require password after screen saver
// begins" is on in System Settings › Lock Screen).

import ScreenSaver
import WebKit

@objc(PaperSkyView)
final class PaperSkyView: ScreenSaverView {
    private var webView: WKWebView?
    private var observers: [NSObjectProtocol] = []

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        setUp()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setUp()
    }

    private func setUp() {
        // WKWebView runs its own animation loop; keep the screen saver timer idle.
        animationTimeInterval = 1.0
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedRed: 0.14, green: 0.16, blue: 0.27, alpha: 1).cgColor

        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        let web = WKWebView(frame: bounds, configuration: config)
        web.autoresizingMask = [.width, .height]
        web.setValue(false, forKey: "drawsBackground")
        addSubview(web)
        webView = web

        let bundle = Bundle(for: PaperSkyView.self)
        guard let dir = bundle.resourceURL?.appendingPathComponent("web", isDirectory: true) else { return }
        var comps = URLComponents(url: dir.appendingPathComponent("index.html"), resolvingAgainstBaseURL: false)
        // The small preview in System Settings gets a lighter version.
        comps?.queryItems = [
            URLQueryItem(name: "mode", value: "screensaver"),
            URLQueryItem(name: "fps", value: isPreview ? "20" : "30"),
            URLQueryItem(name: "dpr", value: isPreview ? "1" : "1.5"),
            URLQueryItem(name: "planes", value: isPreview ? "14" : "28"),
            URLQueryItem(name: "clock", value: isPreview ? "0" : "1"),
            URLQueryItem(name: "sound", value: "0"),
        ]
        if let url = comps?.url {
            web.loadFileURL(url, allowingReadAccessTo: dir)
        }

        // Newer macOS versions don't always call stopAnimation(); these notifications are reliable.
        let center = DistributedNotificationCenter.default()
        observers.append(center.addObserver(forName: Notification.Name("com.apple.screensaver.willstop"), object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.run("paperSky.pause()") }
        })
        observers.append(center.addObserver(forName: Notification.Name("com.apple.screensaver.didstart"), object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.run("paperSky.resume()") }
        })
    }

    deinit {
        observers.forEach { DistributedNotificationCenter.default().removeObserver($0) }
    }

    private func run(_ js: String) {
        webView?.evaluateJavaScript("window.paperSky && \(js)", completionHandler: nil)
    }

    override func startAnimation() {
        super.startAnimation()
        run("paperSky.resume()")
    }

    override func stopAnimation() {
        super.stopAnimation()
        run("paperSky.pause()")
    }

    override func animateOneFrame() {}

    override var hasConfigureSheet: Bool { false }
    override var configureSheet: NSWindow? { nil }
}
