import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const args = process.argv.slice(2);
if (args.some((x) => !['--live', '--codex'].includes(x))) {
  console.error('Usage: node scripts/verify.mjs [--live] [--codex]');
  process.exit(1);
}
const live = args.includes('--live');
let settings = {
  command: process.execPath,
  args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))],
  env: {},
};
if (args.includes('--codex')) {
  const config = JSON.parse(
    execFileSync('codex', ['mcp', 'get', 'seedance', '--json'], {
      encoding: 'utf8',
    }),
  );
  if (!config.enabled || config.transport.type !== 'stdio')
    throw new Error(
      'Seedance must be enabled as a local stdio service in Codex.',
    );
  settings = config.transport;
}
const temp = await mkdtemp(join(tmpdir(), 'seedance-verify-'));
const env = { PATH: process.env.PATH, ...(settings.env || {}) };
if (live) {
  for (const name of [
    'SEEDANCE_API_KEY',
    'SEEDANCE_BASE_URL',
    'SEEDANCE_CONFIG_FILE',
    ...(settings.env_vars || []).filter((x) => typeof x === 'string'),
  ])
    if (process.env[name] !== undefined) env[name] = process.env[name];
} else {
  Object.assign(env, {
    SEEDANCE_CONFIG_FILE: join(temp, '.env'),
    SEEDANCE_API_KEY: '',
    SEEDANCE_BASE_URL: 'https://sd2.bantakal.com',
  });
}
const client = new Client({ name: 'seedance-verification', version: '1.0.0' });
const transport = new StdioClientTransport({
  ...settings,
  env,
  stderr: 'pipe',
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const expected = [
    'seedance_health',
    'seedance_list_models',
    'seedance_upload_image',
    'seedance_create_video',
    'seedance_get_video',
    'seedance_download_video',
  ];
  if (
    tools.length !== expected.length ||
    expected.some((name) => !tools.some((tool) => tool.name === name))
  )
    throw new Error('Expected six Seedance tools.');
  console.log('MCP handshake passed; six tools available.');
  if (!live)
    console.log('Offline verification complete; no API requests were made.');
  else {
    const health = await client.callTool({
      name: 'seedance_health',
      arguments: {},
    });
    if (health.isError) throw new Error(health.content[0].text);
    const data = JSON.parse(health.content[0].text);
    if (data.api.ok !== true)
      throw new Error('API health endpoint did not report ok=true.');
    console.log('Live API health: OK.');
    if (!data.keyConfigured)
      throw new Error('Configure SEEDANCE_API_KEY before live verification.');
    const models = await client.callTool({
      name: 'seedance_list_models',
      arguments: {},
    });
    if (models.isError) throw new Error(models.content[0].text);
    console.log(
      'Authenticated model listing: OK. Models:',
      JSON.parse(models.content[0].text)
        .data?.map((x) => x.model)
        .join(', ') || '(none)',
    );
  }
} finally {
  await client.close();
  await rm(temp, { recursive: true, force: true });
}
