#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SeedanceApi, loadConfig } from './api.mjs';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const args = process.argv.slice(2);
if (args.length) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(`Usage: seedance-mcp [--help | --version]

Local stdio MCP server for the Seedance-compatible REST API.
Configure SEEDANCE_API_KEY (dk_ key), SEEDANCE_BASE_URL and optionally
SEEDANCE_CONFIG_FILE. Default file: ~/.config/seedance-mcp/.env.
With no arguments, starts the MCP server. Logs never use protocol stdout.`);
    process.exit(0);
  }
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
    console.log(version);
    process.exit(0);
  }
  console.error('Unknown arguments. Run seedance-mcp --help.');
  process.exit(1);
}

const server = new McpServer(
  { name: 'seedance-mcp-server', version },
  {
    instructions:
      'Seedance video workflow: list available models; optionally upload local images; create a video once and keep its task ID. Creation consumes account credits. Query the task every 10–20 seconds until succeeded, failed or interrupted. Never automatically retry a timed-out creation: inspect website generation history first. Download succeeded results within 24 hours. Keep API keys out of tool arguments and replies. Model seedance-2.0 supports 10/15 seconds, at most 8 reference images, 720p.',
  },
);
const id = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe('Task ID returned by seedance_create_video.');
function register(name, title, description, inputSchema, readOnly, run) {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: false,
        idempotentHint: readOnly,
        openWorldHint: true,
      },
    },
    async (args) => {
      let api;
      try {
        api = new SeedanceApi(await loadConfig());
        const data = await run(api, args);
        const text = api.redact(JSON.stringify(data));
        return {
          content: [{ type: 'text', text }],
          structuredContent: JSON.parse(text),
        };
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: api
                ? api.redact(e.message)
                : 'Cannot load Seedance configuration. Check SEEDANCE_BASE_URL and local configuration file permissions.',
            },
          ],
        };
      }
    },
  );
}
register(
  'seedance_health',
  '检查 Seedance 连接',
  'Read-only connectivity check; returns API health, whether a dk_ API key is configured, and the local config file path. Does not authenticate or consume credits. A configured key is not proof it is valid; use seedance_list_models to verify authentication.',
  z.strictObject({}),
  true,
  (api) => api.health(),
);
register(
  'seedance_list_models',
  '查询可用视频模型',
  'List currently enabled video models, names and credit prices. Authenticated read-only request. Call before generation; disabled models return 404. Returns the provider data array.',
  z.strictObject({}),
  true,
  (api) => api.models(),
);
register(
  'seedance_upload_image',
  '上传本地参考图',
  'Upload a local PNG/JPEG/WEBP image (maximum 5 MB) as a reference asset. Sends the image to the configured Seedance API and returns its asset id, mime and byte count. Use IDs in reference_asset_ids in the same order as @Image1, @Image2 in your prompt.',
  z.strictObject({
    image_path: z
      .string()
      .min(1)
      .describe('Absolute local path to the image file.'),
  }),
  false,
  (api, a) => api.upload(a.image_path),
);
register(
  'seedance_create_video',
  '提交视频生成任务',
  'Create ONE asynchronous video task, consuming account credits (documented Seedance 2.0 price: 20 credits; confirm current price via list_models). Returns provider task id, statusTask, cost and other metadata immediately. Explicitly defaults to seedance-2.0 / 10s / 9:16 / 720p. Never automatically retry submission on network failure: it may have succeeded. Poll with get_video every 10–20 seconds; failed/interrupted tasks are refunded by the provider.',
  z.strictObject({
    prompt: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Video description. @ImageN must have corresponding reference assets.',
      ),
    model: z
      .string()
      .trim()
      .min(1)
      .default('seedance-2.0')
      .describe(
        'Enabled model from list_models. seedance-2.0 supports 10/15s; seedance-2.5-30s supports 30s if available.',
      ),
    duration: z
      .union([z.literal(10), z.literal(15), z.literal(30)])
      .default(10)
      .describe('Seconds; explicitly set 30 for seedance-2.5-30s.'),
    ratio: z.enum(['9:16', '16:9', '1:1']).default('9:16'),
    reference_asset_ids: z
      .array(z.string().trim().min(1))
      .max(30)
      .default([])
      .describe('Uploaded image IDs in prompt order; seedance-2.0 maximum 8.'),
  }),
  false,
  (api, a) =>
    api.create({
      prompt: a.prompt,
      model: a.model,
      duration: a.duration,
      ratio: a.ratio,
      referenceAssetIds: a.reference_asset_ids,
    }),
);
register(
  'seedance_get_video',
  '查询视频生成进度',
  'Query task metadata and statusTask: queued/submitted/running/succeeded/failed/interrupted. Poll no faster than once every 10–20 seconds. Terminal states are succeeded, failed and interrupted. A signed result URL may expire; query again to refresh it. Download completed video within 24 hours for retention.',
  z.strictObject({ task_id: id }),
  true,
  (api, a) => api.get(a.task_id),
);
register(
  'seedance_download_video',
  '下载生成的视频',
  'Download a succeeded task as an MP4 to an absolute local output path. Returns path, bytes and mime. Creates parent directories; refuses to overwrite an existing file. Streams at most 512 MB with a 90-second network deadline. Partial files are removed on failure. Uses the authenticated file endpoint, with no key forwarding across redirect origins.',
  z.strictObject({
    task_id: id,
    output_path: z
      .string()
      .min(1)
      .describe(
        'Absolute destination path including .mp4 filename; must not already exist.',
      ),
  }),
  false,
  (api, a) => api.download(a.task_id, a.output_path),
);

await server.connect(new StdioServerTransport());
