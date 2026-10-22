import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function connect(t, env) {
  const client = new Client({ name: 'seedance-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('src/index.mjs')],
    env: { PATH: process.env.PATH, ...env },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (d) => {
    stderr += d;
  });
  t.after(async () => {
    await client.close();
    assert.equal(stderr, '');
  });
  await client.connect(transport);
  return client;
}
test('stdio exposes all six tools and completes the API workflow', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'seedance-mcp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/healthz') return res.end('{"ok":true}');
    assert.equal(req.headers.authorization, 'Bearer dk_test_only');
    if (req.url === '/openapi/v1/models')
      return res.end('{"data":[{"model":"seedance-2.0"}]}');
    if (req.url === '/api/assets') return res.end('{"id":"asset"}');
    if (req.url === '/openapi/v1/videos') {
      assert.equal(JSON.parse(raw).options.duration, 10);
      return res.end('{"id":"job","statusTask":"queued"}');
    }
    if (req.url === '/openapi/v1/videos/job')
      return res.end('{"id":"job","statusTask":"succeeded"}');
    if (req.url === '/openapi/v1/videos/job/file') {
      res.setHeader('Content-Type', 'video/mp4');
      return res.end('fixture-video');
    }
    res.statusCode = 404;
    res.end('{"error":"unknown"}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const client = await connect(t, {
    SEEDANCE_API_KEY: 'dk_test_only',
    SEEDANCE_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    SEEDANCE_CONFIG_FILE: join(dir, '.env'),
  });
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map((x) => x.name).sort(), [
    'seedance_create_video',
    'seedance_download_video',
    'seedance_get_video',
    'seedance_health',
    'seedance_list_models',
    'seedance_upload_image',
  ]);
  assert.equal(
    tools.find((x) => x.name === 'seedance_create_video').annotations
      .readOnlyHint,
    false,
  );
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    assert.notEqual(r.isError, true, JSON.stringify(r));
    return JSON.parse(r.content[0].text);
  };
  assert.equal((await call('seedance_health')).keyConfigured, true);
  assert.equal(
    (await call('seedance_list_models')).data[0].model,
    'seedance-2.0',
  );
  const image = join(dir, 'image.png');
  await writeFile(image, Buffer.from('89504e470d0a1a0a', 'hex'));
  assert.equal(
    (await call('seedance_upload_image', { image_path: image })).id,
    'asset',
  );
  assert.equal(
    (
      await call('seedance_create_video', {
        prompt: 'cat',
        reference_asset_ids: ['asset'],
      })
    ).id,
    'job',
  );
  assert.equal(
    (await call('seedance_get_video', { task_id: 'job' })).statusTask,
    'succeeded',
  );
  const output = join(dir, 'video.mp4');
  assert.equal(
    (
      await call('seedance_download_video', {
        task_id: 'job',
        output_path: output,
      })
    ).path,
    output,
  );
  assert.equal(await readFile(output, 'utf8'), 'fixture-video');
  const bad = await client.callTool({
    name: 'seedance_create_video',
    arguments: { prompt: 'x', ratio: '4:3' },
  });
  assert.equal(bad.isError, true);
  const unknown = await client.callTool({
    name: 'seedance_create_video',
    arguments: { prompt: 'x', api_key: 'do-not-accept' },
  });
  assert.equal(unknown.isError, true);
});
test('missing key keeps MCP connected and key added to file is loaded without restart', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'seedance-key-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, '.env');
  await writeFile(file, 'SEEDANCE_API_KEY=\n');
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer dk_loaded_later');
    res.setHeader('Content-Type', 'application/json');
    res.end('{"data":[]}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const client = await connect(t, {
    SEEDANCE_CONFIG_FILE: file,
    SEEDANCE_BASE_URL: `http://127.0.0.1:${server.address().port}`,
  });
  const missing = await client.callTool({
    name: 'seedance_list_models',
    arguments: {},
  });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /SEEDANCE_API_KEY/);
  await writeFile(file, 'SEEDANCE_API_KEY=dk_loaded_later\n');
  const result = await client.callTool({
    name: 'seedance_list_models',
    arguments: {},
  });
  assert.notEqual(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), { data: [] });
});
