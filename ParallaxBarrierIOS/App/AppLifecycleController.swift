import SwiftUI

enum AppLifecycleController {
    static func isActive(_ phase: ScenePhase) -> Bool {
        phase == .active
    }
}
