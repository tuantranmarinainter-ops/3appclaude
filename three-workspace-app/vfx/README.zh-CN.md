# Effekseer AI

简体中文 | [English](README.md)

Effekseer AI 是一个开源 Python CLI 与 [Model Context Protocol（MCP）](https://modelcontextprotocol.io/) 服务。它让 AI Agent 通过官方 `EffekseerCore.dll` API 创建和编辑 [Effekseer](https://effekseer.github.io/) `.efkefc` 特效，并导出运行时 `.efk` 文件。

> **兼容性说明：** 当前版本仅在 **Windows 平台的 Effekseer 1.80.6** 上完成验证。本仓库不包含 Effekseer 程序、`EffekseerCore.dll`、官方样例或特效资源。详见[版本兼容性说明](docs/compatibility.md)。

## 功能

- 新建、打开、保存 `.efkefc` 特效，并导出 `.efk`。
- 新增、重命名、移动和删除特效节点。
- 通过稳定的 `node/...` 属性路径读取和修改 Core 参数。
- 读取和更新右侧面板参数、标量曲线关键帧。
- 将图片导入特效同级的 `resources/` 目录，并写入相对路径。
- 通过 stdio 向支持 MCP 的 AI 客户端提供同一组能力。

## 边界

- 不打包、不修改、不自动化控制 Effekseer GUI。
- 不直接解析或改写 `.efkefc` 二进制格式。
- 不包含 Effekseer DLL、官方样例、模型转换器、生成特效或私有项目资源。
- 除 Effekseer 1.80.6 外的其他版本均未经过验证。

## 环境要求

- Windows 10 或更高版本
- Python 3.11 或更高版本
- [.NET 9 Runtime](https://dotnet.microsoft.com/download/dotnet/9.0)
- 官方 Effekseer **1.80.6** Windows 发行版

你选择的 Effekseer 安装目录必须包含 `Tool/bin/EffekseerCore.dll`。

## 安装

克隆仓库，在虚拟环境中安装：

```powershell
git clone https://github.com/laodeng000/effekseer-ai.git
cd effekseer-ai
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

在当前终端中指定你自己的 Effekseer 1.80.6 `Tool/bin` 目录：

```powershell
$env:EFFEKSEER_AI_BIN_DIR = '<Effekseer-install>/Tool/bin'
```

`EFFEKSEER_AI_BIN_DIR` 为必填项。项目不会扫描本机磁盘来寻找 Effekseer 安装位置。

## CLI 快速开始

创建特效、新增节点、查看设置并导出运行时文件：

```powershell
effekseer-ai new .\effects\spark.efkefc
effekseer-ai node-add .\effects\spark.efkefc --name Spark
effekseer-ai settings-list .\effects\spark.efkefc node/root/0
effekseer-ai export .\effects\spark.efkefc .\effects\spark.efk
```

写入参数前请先使用 `property-list` 或 `settings-list` 获取真实字段，避免 AI 猜测不同 Effekseer 版本的属性路径。

```powershell
effekseer-ai property-list .\effects\spark.efkefc node/root/0
effekseer-ai property-get .\effects\spark.efkefc '<property-path>'
effekseer-ai property-set .\effects\spark.efkefc '<property-path>' '0.5'
```

CLI 会将结果以 JSON 输出到标准输出，便于脚本和 Agent 调用。
`node-list` 会同时返回显示路径和稳定 `id`（`node/id/<uuid>`）；在同一会话中删除或移动节点后，优先用 ID 继续引用节点。`image-import` 按 SHA-256 保存资源，并将来源名称记录在 `resources/manifest.json`。覆盖保存已有特效时会保留一个 `.bak` 文件；`edit-undo <effect.efkefc>` 可一次性恢复到上次保存前的版本。

### CLI 命令

| 分类 | 命令 |
| --- | --- |
| 特效文档 | `new`、`open`、`save`、`export`、`edit-undo` |
| 节点 | `node-list`、`node-add`、`node-rename`、`node-remove`、`node-move` |
| 属性 | `property-list`、`property-get`、`property-set` |
| 资源 | `image-import` |
| 编辑器数据 | `settings-list`、`settings-set`、`curve-list`、`curve-set` |

使用 `effekseer-ai --help` 或 `effekseer-ai <命令> --help` 查看参数和 JSON 输入格式。

## MCP 服务

完成安装与环境变量配置后，启动 stdio MCP 服务：

```powershell
effekseer-ai-mcp
```

在 MCP 客户端中配置该命令，并传入同一个 `EFFEKSEER_AI_BIN_DIR` 环境变量。工具列表见 [docs/mcp.md](docs/mcp.md)。仓库不会提交任何客户端专属的 `.codex`、IDE 或本地配置文件。

## 开发与验证

```powershell
python -m pytest
python -m pip wheel . --no-deps --wheel-dir .\dist
```

默认测试不需要 Effekseer 安装。直接调用官方 Core 程序集的测试必须标记为 integration，并配置 `EFFEKSEER_AI_BIN_DIR`。

## 隐私与安全

Effekseer AI 在本地执行特效文档操作，不包含遥测、分析、账号系统或网络客户端。详见 [PRIVACY.md](PRIVACY.md) 与 [SECURITY.md](SECURITY.md)。

## 许可证与第三方软件

本桥接工具采用 [MIT License](LICENSE)。Effekseer 是独立项目，遵循其自身的许可证与分发条款；请从官方渠道安装，并在重新分发前阅读其许可证。

## 贡献

欢迎提交 Issue 和 Pull Request。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。
