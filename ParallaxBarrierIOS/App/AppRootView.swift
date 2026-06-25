import SwiftUI

struct AppRootView: View {
    @StateObject private var viewModel = ExperienceViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ExperienceView(viewModel: viewModel)
            .onChange(of: scenePhase) { _, newPhase in
                viewModel.handleScenePhase(newPhase)
            }
    }
}
