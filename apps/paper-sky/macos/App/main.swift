// Paper Sky · menu-bar app
//
//   ✈︎ menu
//   ├ Ambient mode           full screen, interactive, with sound (Esc to leave)
//   ├ Live wallpaper         planes behind your desktop icons
//   ├ Wallpaper follows cursor
//   ├ Sound in wallpaper
//   ├ Low power              20 fps, 1× pixels, fewer planes (also automatic in Low Power Mode)
//   ├ Mood ▸ Dusk / Morning / Night
//   ├ Lock now               starts the real macOS screen saver lock (macOS asks for your password)
//   ├ Screen Saver settings…
//   ├ Open at login
//   └ Quit
//
// Every view is a WKWebView showing Resources/web/index.html, the same
// code as the web version. This app never sees or stores your password.

import AppKit
import WebKit
import ServiceManagement

// Borderless windows can't become key by default; ambient mode needs keyboard (Esc) and focus.
final class KeyWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

// One sky = one WKWebView + the JS bridge.
final class Sky: NSObject, WKScriptMessageHandler {
    let webView: WKWebView
    var onClose: (() -> Void)?

    init(frame: NSRect, query: [String: String]) {
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: frame, configuration: config)
        super.init()
        config.userContentController.add(self, name: "paperSky")
        webView.setValue(false, forKey: "drawsBackground")
        webView.autoresizingMask = [.width, .height]

        guard let dir = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true) else { return }
        var comps = URLComponents(url: dir.appendingPathComponent("index.html"), resolvingAgainstBaseURL: false)
        comps?.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        if let url = comps?.url { webView.loadFileURL(url, allowingReadAccessTo: dir) }
    }

    func js(_ code: String) {
        webView.evaluateJavaScript("window.paperSky && \(code)", completionHandler: nil)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if (message.body as? String) == "close" { onClose?() }
    }

    func tearDown() {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "paperSky")
        webView.removeFromSuperview()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let defaults = UserDefaults.standard

    private var wallpapers: [(window: NSWindow, sky: Sky)] = []
    private var ambient: (window: NSWindow, sky: Sky)?
    private var keyMonitor: Any?
    private var mouseTimer: Timer?
    private var lastMouse = NSPoint(x: -1, y: -1)
    private var screenLocked = false

    // settings (persisted)
    private var wallpaperOn: Bool { get { defaults.bool(forKey: "wallpaper") } set { defaults.set(newValue, forKey: "wallpaper") } }
    private var followCursor: Bool { get { defaults.object(forKey: "follow") as? Bool ?? true } set { defaults.set(newValue, forKey: "follow") } }
    private var wallpaperSound: Bool { get { defaults.bool(forKey: "wallpaperSound") } set { defaults.set(newValue, forKey: "wallpaperSound") } }
    private var lowPowerPref: Bool { get { defaults.bool(forKey: "lowPower") } set { defaults.set(newValue, forKey: "lowPower") } }
    private var mood: String { get { defaults.string(forKey: "mood") ?? "dusk" } set { defaults.set(newValue, forKey: "mood") } }

    private var lowPower: Bool { lowPowerPref || ProcessInfo.processInfo.isLowPowerModeEnabled }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let image = NSImage(systemSymbolName: "paperplane", accessibilityDescription: "Paper Sky") {
            image.isTemplate = true
            statusItem.button?.image = image
        } else {
            statusItem.button?.title = "✈︎"
        }
        rebuildMenu()
        if wallpaperOn { startWallpaper() }
        observeSystem()
    }

    // MARK: menu

    private func rebuildMenu() {
        let menu = NSMenu()
        @discardableResult
        func item(_ title: String, _ action: Selector, on: Bool? = nil, key: String = "") -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.target = self
            if let on { i.state = on ? .on : .off }
            menu.addItem(i)
            return i
        }
        item("Ambient mode", #selector(toggleAmbient))
        menu.addItem(.separator())
        item("Live wallpaper", #selector(toggleWallpaper), on: wallpaperOn)
        item("Wallpaper follows cursor", #selector(toggleFollow), on: followCursor)
        item("Sound in wallpaper", #selector(toggleWallpaperSound), on: wallpaperSound)
        item("Low power", #selector(toggleLowPower), on: lowPower)

        let moodItem = NSMenuItem(title: "Mood", action: nil, keyEquivalent: "")
        let moodMenu = NSMenu()
        for (title, value) in [("Dusk", "dusk"), ("Morning", "day"), ("Night", "night")] {
            let m = NSMenuItem(title: title, action: #selector(setMood(_:)), keyEquivalent: "")
            m.target = self
            m.representedObject = value
            m.state = mood == value ? .on : .off
            moodMenu.addItem(m)
        }
        moodItem.submenu = moodMenu
        menu.addItem(moodItem)

        menu.addItem(.separator())
        item("Lock now", #selector(lockNow))
        item("Screen Saver settings…", #selector(openScreenSaverSettings))
        if #available(macOS 13.0, *) {
            item("Open at login", #selector(toggleLogin), on: SMAppService.mainApp.status == .enabled)
        }
        menu.addItem(.separator())
        item("Quit Paper Sky", #selector(quit), key: "q")
        statusItem.menu = menu
    }

    // MARK: query strings for the web view

    private func wallpaperQuery() -> [String: String] {
        [
            "mode": "wallpaper",
            "fps": lowPower ? "20" : "30",
            "dpr": lowPower ? "1" : "1.5",
            "planes": lowPower ? "16" : "26",
            "trails": "0",
            "mood": mood,
            "sound": wallpaperSound ? "1" : "0",
        ]
    }

    private func ambientQuery() -> [String: String] {
        [
            "mode": "interactive",
            "fps": lowPower ? "30" : "60",
            "dpr": lowPower ? "1" : "2",
            "planes": lowPower ? "18" : "30",
            "mood": mood,
            "sound": "1",
        ]
    }

    // MARK: live wallpaper

    private func startWallpaper() {
        stopWallpaper()
        for screen in NSScreen.screens {
            let window = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
            window.setFrame(screen.frame, display: false)
            // Above the desktop picture, below the desktop icons.
            window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
            window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
            window.ignoresMouseEvents = true
            window.hasShadow = false
            window.isReleasedWhenClosed = false
            window.backgroundColor = .black
            let sky = Sky(frame: NSRect(origin: .zero, size: screen.frame.size), query: wallpaperQuery())
            window.contentView = sky.webView
            window.orderFront(nil)
            wallpapers.append((window, sky))
            // Covered by full-screen apps or windows? Stop drawing.
            NotificationCenter.default.addObserver(self, selector: #selector(occlusionChanged(_:)),
                                                   name: NSWindow.didChangeOcclusionStateNotification, object: window)
        }
        startMouseFeed()
    }

    private func stopWallpaper() {
        mouseTimer?.invalidate()
        mouseTimer = nil
        for (window, sky) in wallpapers {
            NotificationCenter.default.removeObserver(self, name: NSWindow.didChangeOcclusionStateNotification, object: window)
            sky.tearDown()
            window.orderOut(nil)
            window.close()
        }
        wallpapers.removeAll()
    }

    @objc private func occlusionChanged(_ note: Notification) {
        guard let window = note.object as? NSWindow, let entry = wallpapers.first(where: { $0.window === window }) else { return }
        if window.occlusionState.contains(.visible) && !screenLocked { entry.sky.js("paperSky.resume()") }
        else { entry.sky.js("paperSky.pause()") }
    }

    // The wallpaper window ignores the mouse (so the desktop still works),
    // so the app reads the global cursor position and feeds it to the sky.
    private func startMouseFeed() {
        mouseTimer?.invalidate()
        guard followCursor, !wallpapers.isEmpty else { return }
        let interval = 1.0 / (lowPower ? 20.0 : 30.0)
        mouseTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.feedMouse() }
        }
    }

    private func feedMouse() {
        let p = NSEvent.mouseLocation
        guard p != lastMouse else { return }
        lastMouse = p
        let down = (NSEvent.pressedMouseButtons & 1) == 1
        for (window, sky) in wallpapers where window.frame.contains(p) {
            let x = p.x - window.frame.minX
            let y = window.frame.maxY - p.y      // web coordinates start at the top
            sky.js("paperSky.pointer(\(Int(x)), \(Int(y)), \(down))")
        }
    }

    // MARK: ambient mode (interactive, full screen)

    @objc private func toggleAmbient() {
        if ambient != nil { closeAmbient(); return }
        guard let screen = NSScreen.main else { return }
        let window = KeyWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.setFrame(screen.frame, display: false)
        window.level = .screenSaver               // above the menu bar and Dock
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.isReleasedWhenClosed = false
        window.backgroundColor = .black
        let sky = Sky(frame: NSRect(origin: .zero, size: screen.frame.size), query: ambientQuery())
        sky.onClose = { [weak self] in self?.closeAmbient() }
        window.contentView = sky.webView
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(sky.webView)
        ambient = (window, sky)
        wallpapers.forEach { $0.sky.js("paperSky.pause()") }   // only one sky draws at a time
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 {   // Esc
                Task { @MainActor in self?.closeAmbient() }
                return nil
            }
            return event
        }
    }

    private func closeAmbient() {
        guard let (window, sky) = ambient else { return }
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        keyMonitor = nil
        sky.tearDown()
        window.orderOut(nil)
        window.close()
        ambient = nil
        wallpapers.forEach { $0.sky.js("paperSky.resume()") }
    }

    // MARK: settings actions

    @objc private func toggleWallpaper() {
        wallpaperOn.toggle()
        wallpaperOn ? startWallpaper() : stopWallpaper()
        rebuildMenu()
    }

    @objc private func toggleFollow() {
        followCursor.toggle()
        if followCursor {
            startMouseFeed()
        } else {
            mouseTimer?.invalidate()
            mouseTimer = nil
        }
        rebuildMenu()
    }

    @objc private func toggleWallpaperSound() {
        wallpaperSound.toggle()
        wallpapers.forEach { $0.sky.js("paperSky.set({ sound: \(wallpaperSound) })") }
        rebuildMenu()
    }

    @objc private func toggleLowPower() {
        lowPowerPref.toggle()
        applyPower()
        rebuildMenu()
    }

    private func applyPower() {
        let lp = lowPower
        let patch = lp ? "{ fps: 20, dpr: 1, planes: 16 }" : "{ fps: 30, dpr: 1.5, planes: 26 }"
        wallpapers.forEach { $0.sky.js("paperSky.set(\(patch))") }
        startMouseFeed()
    }

    @objc private func setMood(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? String else { return }
        mood = value
        wallpapers.forEach { $0.sky.js("paperSky.set({ mood: '\(value)' })") }
        ambient?.sky.js("paperSky.set({ mood: '\(value)' })")
        rebuildMenu()
    }

    // The real lock: start the macOS screen saver (choose Paper Sky in Screen Saver settings).
    // With "Require password after screen saver begins: Immediately", macOS asks for your password on return.
    @objc private func lockNow() {
        closeAmbient()
        let engine = URL(fileURLWithPath: "/System/Library/CoreServices/ScreenSaverEngine.app")
        NSWorkspace.shared.openApplication(at: engine, configuration: NSWorkspace.OpenConfiguration(), completionHandler: nil)
    }

    @objc private func openScreenSaverSettings() {
        let urls = [
            "x-apple.systempreferences:com.apple.ScreenSaver-Settings.extension",     // macOS 13+
            "x-apple.systempreferences:com.apple.preference.desktopscreeneffect",     // macOS 12
        ]
        for s in urls { if let u = URL(string: s), NSWorkspace.shared.open(u) { return } }
    }

    @objc private func toggleLogin() {
        if #available(macOS 13.0, *) {
            let service = SMAppService.mainApp
            do {
                if service.status == .enabled { try service.unregister() } else { try service.register() }
            } catch {
                NSLog("Paper Sky: login item change failed: \(error)")
            }
            rebuildMenu()
        }
    }

    @objc private func quit() { NSApp.terminate(nil) }

    // MARK: system events → pause when nobody can see it

    private func observeSystem() {
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(self, selector: #selector(pauseAll), name: NSWorkspace.screensDidSleepNotification, object: nil)
        ws.addObserver(self, selector: #selector(resumeAll), name: NSWorkspace.screensDidWakeNotification, object: nil)
        ws.addObserver(self, selector: #selector(pauseAll), name: NSWorkspace.sessionDidResignActiveNotification, object: nil)
        ws.addObserver(self, selector: #selector(resumeAll), name: NSWorkspace.sessionDidBecomeActiveNotification, object: nil)

        let dist = DistributedNotificationCenter.default()
        dist.addObserver(self, selector: #selector(locked), name: Notification.Name("com.apple.screenIsLocked"), object: nil)
        dist.addObserver(self, selector: #selector(unlocked), name: Notification.Name("com.apple.screenIsUnlocked"), object: nil)

        NotificationCenter.default.addObserver(self, selector: #selector(powerChanged),
                                               name: Notification.Name.NSProcessInfoPowerStateDidChange, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }

    @objc private func pauseAll() {
        wallpapers.forEach { $0.sky.js("paperSky.pause()") }
        ambient?.sky.js("paperSky.pause()")
    }

    @objc private func resumeAll() {
        guard !screenLocked else { return }
        if ambient != nil { ambient?.sky.js("paperSky.resume()") }
        else { wallpapers.forEach { if $0.window.occlusionState.contains(.visible) { $0.sky.js("paperSky.resume()") } } }
    }

    @objc private func locked() { screenLocked = true; pauseAll() }
    @objc private func unlocked() { screenLocked = false; resumeAll() }
    // posted on a background thread: hop to the main actor
    @objc nonisolated private func powerChanged() {
        Task { @MainActor in
            self.applyPower()
            self.rebuildMenu()
        }
    }
    @objc private func screensChanged() { if wallpaperOn { startWallpaper() } }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
