# Seedance MCP

[English](README.md) · [API 映射](docs/api.md) · [贡献指南](CONTRIBUTING.md)

本地 **stdio MCP 服务**，让 Codex 等客户端直接查询模型、上传参考图、提交视频生成任务、查询进度和下载成品。

这是独立开发的 **SeeDance 兼容接口适配器**，并非字节跳动、Seedance 或 OpenAI 的官方项目。默认地址 `sd2.bantakal.com` 是第三方服务，需要该服务商的 `dk_` 密钥，不能直接使用官方 Seedance 密钥。使用前请确认服务商权限、条款和实时积分价格。本仓库仅提供适配代码，不提供接口账号、积分或模型权重。

## 安装

需要 **Node.js 22+** 和 npm。macOS、Linux、Windows 均使用 Node 本地进程运行。

```sh
git clone https://github.com/xiao345/seedance-mcp.git
cd seedance-mcp
npm ci --ignore-scripts
node src/index.mjs --help
```

无需编译。依赖由锁文件固定；安装过程不生成视频，也不需要密钥。本项目通过 GitHub 源码分发，未假定已在 npm 发布。

## 填入密钥

macOS/Linux 在仓库之外创建私密配置：

```sh
mkdir -p "$HOME/.config/seedance-mcp"
chmod 700 "$HOME/.config/seedance-mcp"
cp -n .env.example "$HOME/.config/seedance-mcp/.env"
chmod 600 "$HOME/.config/seedance-mcp/.env"
```

编辑该文件，填写服务商的 `dk_` 密钥：

```dotenv
SEEDANCE_API_KEY=你的密钥
SEEDANCE_BASE_URL=https://sd2.bantakal.com
```

不要把密钥发到聊天、Issue 或提交到 Git。环境变量优先于配置文件；设置 `SEEDANCE_CONFIG_FILE` 可指定其他私密配置路径。每次工具调用都会重新读取，换密钥不用重启。仓库目录下的 `.env` 不会自动加载。

Windows 默认路径是用户主目录下的 `.config/seedance-mcp/.env`，可通过编辑器创建并限制文件访问权限，或用 `SEEDANCE_CONFIG_FILE` 指定路径。

## 接入 Codex

在克隆后的项目目录运行：

```sh
codex mcp add seedance -- "$(command -v node)" "$PWD/src/index.mjs"
```

然后在 `~/.codex/config.toml` 新生成的 `[mcp_servers.seedance]` 段中加入 `startup_timeout_sec = 20` 和 `tool_timeout_sec = 120`。也可以手动填写：

```toml
[mcp_servers.seedance]
command = "/你的/node/绝对路径"
args = ["/你的/seedance-mcp/绝对路径/src/index.mjs"]
startup_timeout_sec = 20
tool_timeout_sec = 120
```

请替换为真实路径。Windows 示例：`C:/Program Files/nodejs/node.exe`、`C:/projects/seedance-mcp/src/index.mjs`。新增服务后重启客户端，已打开的聊天可能需要重新打开。同一台 Codex 主机的 CLI 和桌面应用共用配置；参见 [Codex 官方 MCP 文档](https://developers.openai.com/codex/mcp)。

其他 MCP 客户端可以使用相同的启动命令和参数；通用 JSON 配置见英文 README。若客户端支持工具超时设置，请为下载设置至少 120 秒。生成本身是异步提交，不会在一次调用中等待几分钟。

## 六个工具

| 工具                      | 用途                                           |
| ------------------------- | ---------------------------------------------- |
| `seedance_health`         | 检查接口连接、密钥是否已配置，不验证密钥有效性 |
| `seedance_list_models`    | 查询当前可用模型及积分价格，验证鉴权           |
| `seedance_upload_image`   | 上传本地 PNG/JPEG/WEBP，单张最大 5 MB          |
| `seedance_create_video`   | 提交视频生成任务，返回任务 ID，会消耗积分      |
| `seedance_get_video`      | 查询进度、错误和结果元数据                     |
| `seedance_download_video` | 下载到指定的本地绝对路径，不覆盖已有文件       |

默认 `seedance-2.0`、10 秒、9:16、720p。文档中的 2.0 支持 10/15 秒、最多八张参考图；若启用 `seedance-2.5-30s`，须同时传 `duration: 30`。画面比例支持 9:16、16:9、1:1。模型及价格以实时模型列表为准。

可对 Codex 说：

> 用 seedance 生成一段 10 秒横屏视频：一只柯基在草地上奔跑，镜头缓慢推进。保留任务 ID，完成后下载到我指定的本地绝对路径。

图生视频需先上传图片，再按顺序传入返回的素材 ID。提示词中 `@Image2` 至少需要两个素材 ID。

## 生成与下载

1. 查询模型，按需上传参考图。
2. 只提交一次生成任务并保存 ID。
3. 每 10–20 秒查询一次，直到 `succeeded`、`failed` 或 `interrupted`。
4. 成功后及时下载。服务商提供的文档标注上游保留期约 24 小时，不能仅依赖分享链接有效期。

创建请求遇到超时不自动重试：任务可能已受理，应先检查网页生成记录，以免重复扣费。退款规则由服务商决定。

接口请求超时 30 秒；下载网络超时 90 秒、最大 512 MB。下载使用临时文件及原子操作，失败清理，不覆盖已有文件。跨域跳转不携带 API Key，拒绝从 HTTPS 降级到 HTTP。

本服务面向可信的本地 MCP 客户端，并非文件沙箱。指定的图片、提示词和鉴权信息会发往所配置的服务商，下载会写入客户端指定的本地路径。代码没有遥测或内置密钥。

## 验证与开发

```sh
npm run check
npm run format:check
npm test
npm run verify
npm pack --dry-run
```

测试使用本地模拟 API 和真实 MCP SDK 客户端，不消耗积分。默认 `npm run verify` 只离线检查 MCP 握手和六个工具，不需要安装 Codex。

可选联网只读验证：

```sh
npm run verify:live
npm run verify:codex
```

前者验证源码入口，后者验证已注册到 Codex 的启动命令；两者只检查健康接口及模型查询，不创建视频。

卸载 Codex 注册：`codex mcp remove seedance`，保留源码和私密配置文件。

## 许可证

[MIT](LICENSE)。服务商条款和生成内容权利独立于软件许可证。
