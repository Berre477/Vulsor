// Sets Vulsor as the system default web browser via LaunchServices.
//
// Why this exists: System Settings → Default web browser only *lists* apps with
// a proper Developer ID signature. Vulsor is ad-hoc signed, so it never appears
// in that dropdown even though it's a fully registered http/https handler. The
// LaunchServices API below sets the default directly, bypassing the picker.
//
// Run with:  swift build-extras/set-default-browser.swift
import Foundation
import CoreServices

let bundleID = "com.electron.vulsor-browser" as CFString
for scheme in ["http", "https"] {
    // Note: the https call may return -54 (permErr) yet still apply — the
    // read-back below is the source of truth.
    _ = LSSetDefaultHandlerForURLScheme(scheme as CFString, bundleID)
}
for scheme in ["http", "https"] {
    let h = LSCopyDefaultHandlerForURLScheme(scheme as CFString)?.takeRetainedValue() as String? ?? "(none)"
    print("\(scheme) default handler: \(h)")
}
