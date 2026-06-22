[English](README.md) | 中文

# 浮生泡影

浮生泡影是一个本地优先的 Three.js 回忆泡泡空间，用于在浏览器中浏览个人照片和视频。它会把用户选择的媒体文件变成漂浮泡泡，支持随机打开一段回忆，并且不会把文件上传到服务器。

## 功能

- 通过浏览器文件选择器导入本地照片和视频。
- Three.js 泡泡空间，支持悬停、聚焦和随机遇见回忆。
- 短期 Web/PWA 外壳，包含 manifest 元数据、应用图标和保守的应用外壳缓存。
- 面向触控、减少动态效果、低资源设备和 WebGL 恢复的移动端运行策略。
- 支持平面图、全景图和 cube 背景上传，并校验图片尺寸。
- 可选环境音乐，仓库内保留授权署名。
- 布局和媒体处理逻辑有 Node 测试覆盖。

## 快速开始

要求：Node.js 20 或更新版本。

```bash
npm install
npm run dev
```

打开本地 Vite 地址，点击 **添加回忆**，选择设备上的图片或视频文件。

## 使用方式

- 点击 **添加回忆** 导入照片或视频。
- 点击任意泡泡进入聚焦视图，再关闭聚焦视图回到空间。
- 添加媒体后可以点击 **随机遇见**，不用手动浏览也能打开一段回忆。
- 在设置中调整动态强度、泡泡大小、声音和背景模式。

应用只在当前浏览器会话中处理用户选择的文件；项目中没有服务器上传或远程存储路径。

## 开发

```bash
npm test
npm run build
npm run preview
npm run test:smoke
```

源码位于 `src/`，静态资源位于 `public/`，测试位于 `tests/`。`dist/` 构建产物、本地草稿和个人过程记录已在忽略规则中排除。

短期桌面/移动/PWA 支持矩阵、发布检查和已知平台限制见 [docs/platform-support.md](docs/platform-support.md)。

## 资源与署名

- `public/audio/Dreamy Flashback.mp3`：Kevin MacLeod 创作的 "Dreamy Flashback"，使用 Creative Commons Attribution 4.0 授权。详见 [public/audio/CREDITS.md](public/audio/CREDITS.md)。
- `public/textures/panorama/pond-bridge-night.jpg`：Greg Zaal / Poly Haven 创作的 "Pond Bridge Night"，使用 CC0 授权。详见 [public/textures/CREDITS.md](public/textures/CREDITS.md)。
- 用户选择的照片和视频属于用户内容，不应提交到本仓库。

## 贡献

提交 Pull Request 前请运行：

```bash
npm test
npm run build
```

如果改动影响可见界面，请在 PR 描述中附上截图或录屏。

## 许可证

本项目使用 [MIT License](LICENSE) 发布。
