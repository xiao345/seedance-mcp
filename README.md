# Seedance MCP

[![CI](https://github.com/xiao345/seedance-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/xiao345/seedance-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A local **stdio MCP server** that gives Codex and other MCP clients six tools for video generation: inspect models, upload reference images, submit jobs, query progress, download results, and check connectivity.

[简体中文](README.zh-CN.md) · [API mapping](docs/api.md) · [Contributing](CONTRIBUTING.md)

> This is an independent adapter for the **SeeDance-compatible API** described below. It is not an official ByteDance, Seedance, or OpenAI project. The default API host (`sd2.bantakal.com`) is a third-party service; an official Seedance API key is not interchangeable with its `dk_` keys. Check your provider's access terms and current pricing before submitting a job. This repository provides the adapter, not API access or model weights.

## Requirements

- Node.js **22 or newer** and npm.
- An account and `dk_` API key from a compatible provider, required for authenticated operations.
- A local MCP client such as Codex. Server discovery works without an API key.

## Install from source

```sh
git clone https://github.com/xiao345/seedance-mcp.git
cd seedance-mcp
npm ci --ignore-scripts
node src/index.mjs --help
```

No compilation is required. Dependencies are locked in `package-lock.json`. Installation does not require a credential and does not generate videos. The project is distributed on GitHub; no npm registry installation is assumed.

## Configure credentials

On macOS/Linux, create a private configuration file outside the repository:

```sh
mkdir -p "$HOME/.config/seedance-mcp"
chmod 700 "$HOME/.config/seedance-mcp"
cp -n .env.example "$HOME/.config/seedance-mcp/.env"
chmod 600 "$HOME/.config/seedance-mcp/.env"
```

Edit that file and set `SEEDANCE_API_KEY` to your provider's `dk_` key. Do not paste keys into a chat, issue, or commit.

| Variable               | Default                       | Purpose                                     |
| ---------------------- | ----------------------------- | ------------------------------------------- |
| `SEEDANCE_API_KEY`     | Empty                         | Provider API key                            |
| `SEEDANCE_BASE_URL`    | `https://sd2.bantakal.com`    | API origin; HTTPS required outside loopback |
| `SEEDANCE_CONFIG_FILE` | `~/.config/seedance-mcp/.env` | Override credential file location           |

Environment variables take precedence over the file. Configuration is read on **each tool call**, so rotating a key does not require restarting the server. A `.env` file in the checkout is **not** automatically loaded. On Windows, the default is `.config/seedance-mcp/.env` under your user home; create it with your editor and restrict its filesystem permissions, or set `SEEDANCE_CONFIG_FILE` to a private location.

## Connect to Codex

From the cloned directory, register absolute paths so desktop startup does not depend on your shell configuration:

```sh
codex mcp add seedance -- "$(command -v node)" "$PWD/src/index.mjs"
```

Then add `startup_timeout_sec = 20` and `tool_timeout_sec = 120` to the generated `[mcp_servers.seedance]` table in `~/.codex/config.toml`. An equivalent manual configuration is:

```toml
[mcp_servers.seedance]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/seedance-mcp/src/index.mjs"]
startup_timeout_sec = 20
tool_timeout_sec = 120
```

Replace both paths with your actual locations. On Windows, use paths such as `C:/Program Files/nodejs/node.exe` and `C:/projects/seedance-mcp/src/index.mjs`. Restart your client after adding a server. An already-open chat may need to be reopened. The CLI and desktop app share the configuration for the same Codex host; see the [official Codex MCP documentation](https://developers.openai.com/codex/mcp).

Other MCP clients can use the same `command` and `args`. For clients using `mcpServers` JSON:

```json
{
  "mcpServers": {
    "seedance": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/seedance-mcp/src/index.mjs"]
    }
  }
}
```

If your client has a per-tool timeout, set it to at least 120 seconds for downloads. Video generation itself is asynchronous and returns immediately.

## Tools

| Tool                      | Operation                                                | Inputs                                                                 |
| ------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `seedance_health`         | Connectivity and configuration status; no authentication | None                                                                   |
| `seedance_list_models`    | Enabled models and current credit prices                 | None                                                                   |
| `seedance_upload_image`   | Send a local reference image to the provider             | `image_path` (absolute)                                                |
| `seedance_create_video`   | Submit one paid asynchronous job                         | `prompt`, optional `model`, `duration`, `ratio`, `reference_asset_ids` |
| `seedance_get_video`      | Query status, error, and result metadata                 | `task_id`                                                              |
| `seedance_download_video` | Save a completed video locally                           | `task_id`, `output_path` (absolute)                                    |

Defaults: `seedance-2.0`, **10 seconds**, **9:16**, **720p**, no reference images. For the documented 2.0 model, durations are 10/15 seconds and reference images are limited to eight. `seedance-2.5-30s`, if enabled by the provider, requires `duration: 30`. Model availability and price come from `seedance_list_models`; they may change. Ratios are `9:16`, `16:9`, and `1:1`.

Example request to your MCP client:

> Use seedance to make a 10-second 16:9 video of a corgi running across grass, with a slow camera push-in. Keep the task ID, wait for completion, and download it to an absolute path I provide.

For image references, first upload local images, then pass their returned asset IDs in order. A prompt containing `@Image2` needs at least two IDs. Images must be PNG/JPEG/WEBP, at most 5 MB each.

## Job lifecycle and costs

1. Query the enabled models.
2. Optionally upload reference images.
3. Submit **once** and retain the task ID. Submission consumes provider credits.
4. Query every **10–20 seconds** until `succeeded`, `failed`, or `interrupted`.
5. Download completed results promptly. The supplied provider documentation describes an upstream retention window of approximately 24 hours; do not rely on link expiry alone.

The server does not automatically retry POST requests or poll indefinitely inside a tool call. If submission times out, its outcome is unknown: check the provider's generation history before creating another job to avoid duplicate charges. Refund policy is controlled by the provider.

## Verification and development

```sh
npm run check
npm run format:check
npm test
npm run verify
npm pack --dry-run
```

Tests use loopback HTTP fixtures and real MCP SDK clients, with no provider credentials or paid generation. `npm run verify` is **offline**: it checks the stdio handshake and tool catalog without Codex or an API call.

Optional read-only live checks:

```sh
npm run verify:live   # Local entry point: health + authenticated model list
npm run verify:codex  # Same checks using the command registered as seedance in Codex
```

These require network access and a configured provider key. They do not create videos. `verify:codex` additionally requires the Codex CLI and its existing server registration.

## Data handling and limitations

Prompts, reference images, and API credentials are sent to your configured provider over HTTPS. Downloads write to the exact local path requested by the client. This is a **local trusted-client service**, not a sandbox: only connect trusted MCP clients and approve intended file operations. There is no telemetry or embedded credential in this adapter.

API requests have a 30-second deadline; downloads have a 90-second network deadline and a 512 MB limit. Downloads use temporary files and atomic no-overwrite publishing. Redirects are limited to five, HTTPS downgrade is refused, and API keys are removed on cross-origin redirects. Failed downloads remove partial files. Existing output files are never replaced.

To unregister from Codex: `codex mcp remove seedance`. This preserves the checkout and your private configuration file.

## License

[MIT](LICENSE). Provider access terms and generated-content rights are separate from this software license.
