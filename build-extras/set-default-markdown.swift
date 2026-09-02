// Makes Vulsor Browser the app that opens .md / .markdown files, so
// double-clicking a note in Finder brings it up in the Vault.
//
// Why this exists: Finder's "Open With → Change All…" only offers apps that
// LaunchServices trusts, and Vulsor is ad-hoc signed — same reason the default
// *browser* has to be set from code (see set-default-browser.swift). This
// registers the built app with LaunchServices and then claims the Markdown
// content type directly.
//
// Run with:  swift build-extras/set-default-markdown.swift
//            swift build-extras/set-default-markdown.swift "/path/to/Vulsor Browser.app"
import Foundation
import CoreServices

let fm = FileManager.default
let scriptDir = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
let repoRoot  = scriptDir.deletingLastPathComponent()

// The app can live anywhere; check the usual spots unless one was passed in.
let candidates: [URL] = CommandLine.arguments.count > 1
    ? [URL(fileURLWithPath: CommandLine.arguments[1])]
    : [
        repoRoot.appendingPathComponent("Vulsor Browser-darwin-arm64/Vulsor Browser.app"),
        URL(fileURLWithPath: "/Applications/Vulsor Browser.app"),
      ]

guard let appURL = candidates.first(where: { fm.fileExists(atPath: $0.path) }) else {
    print("No Vulsor Browser.app found. Run 'npm run build' first, or pass the app path.")
    exit(1)
}
guard let bundleID = Bundle(url: appURL)?.bundleIdentifier else {
    print("Could not read a bundle identifier from \(appURL.path)")
    exit(1)
}

// Re-register so LaunchServices picks up CFBundleDocumentTypes from a fresh build.
let lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if fm.isExecutableFile(atPath: lsregister) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: lsregister)
    p.arguments = ["-f", appURL.path]
    try? p.run()
    p.waitUntilExit()
}

// Markdown has one UTI; the extra extensions in url-types.plist inherit from it.
let contentTypes = ["net.daringfireball.markdown"]
for type in contentTypes {
    _ = LSSetDefaultRoleHandlerForContentType(type as CFString, .all, bundleID as CFString)
    // LaunchServices applies this asynchronously — reading straight back still
    // reports the old handler, so poll briefly before believing the answer.
    var handler = "(none)"
    for _ in 0..<20 {
        handler = LSCopyDefaultRoleHandlerForContentType(type as CFString, .all)?.takeRetainedValue() as String? ?? "(none)"
        if handler == bundleID { break }
        Thread.sleep(forTimeInterval: 0.25)
    }
    print("\(type) → \(handler)")
}
print("App: \(appURL.path)  (\(bundleID))")
