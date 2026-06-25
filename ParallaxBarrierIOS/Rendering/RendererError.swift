import Foundation

enum RendererError: LocalizedError, Equatable {
    case metalUnavailable
    case missingFunction(String)
    case pipelineCreationFailed(String)
    case resourceCreationFailed(String)

    var errorDescription: String? {
        switch self {
        case .metalUnavailable:
            return "此设备不支持 Metal，无法运行 3D 渲染。"
        case .missingFunction(let name):
            return "缺少 Metal shader function：\(name)。"
        case .pipelineCreationFailed(let detail):
            return "Metal pipeline 创建失败：\(detail)"
        case .resourceCreationFailed(let detail):
            return "Metal 资源创建失败：\(detail)"
        }
    }
}
