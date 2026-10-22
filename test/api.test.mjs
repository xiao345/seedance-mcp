import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeedanceApi } from '../src/api.mjs';

export async function fixture(t, handler) {
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    try {
      await handler(req, res, raw ? JSON.parse(raw) : null);
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}
async function dir(t) {
  const d = await mkdtemp(join(tmpdir(), 'seedance-test-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  return d;
}
function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
const key = 'dk_local_fixture_only';

test('models sends bearer key and returns provider data', async (t) => {
  const baseUrl = await fixture(t, (req, res) => {
    assert.equal(req.url, '/openapi/v1/models');
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    json(res, { data: [{ model: 'seedance-2.0' }] });
  });
  assert.deepEqual(await new SeedanceApi({ baseUrl, key }).models(), {
    data: [{ model: 'seedance-2.0' }],
  });
});
test('create explicitly selects supported 2.0 defaults and references', async (t) => {
  const baseUrl = await fixture(t, (req, res, body) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/openapi/v1/videos');
    assert.deepEqual(body, {
      model: 'seedance-2.0',
      prompt: '生成一段视频：@Image1 猫',
      options: { duration: 10, ratio: '9:16', resolution: '720p' },
      referenceAssetIds: ['asset-1'],
    });
    json(res, { id: 'task-1', statusTask: 'queued' });
  });
  assert.equal(
    (
      await new SeedanceApi({ baseUrl, key }).create({
        prompt: '生成一段视频：@Image1 猫',
        referenceAssetIds: ['asset-1'],
      })
    ).id,
    'task-1',
  );
});
test('invalid duration, ratio, image index and reference count never submit', async (t) => {
  let calls = 0;
  const baseUrl = await fixture(t, (req, res) => {
    calls++;
    json(res, {});
  });
  const api = new SeedanceApi({ baseUrl, key });
  for (const args of [
    { prompt: 'x', duration: 30 },
    { prompt: 'x', ratio: '4:3' },
    { prompt: '@Image2', referenceAssetIds: ['one'] },
    { prompt: 'x', referenceAssetIds: Array(9).fill('a') },
    { prompt: ' ' },
  ])
    await assert.rejects(() => api.create(args));
  assert.equal(calls, 0);
});
test('query encodes the task id as a single path segment', async (t) => {
  const baseUrl = await fixture(t, (req, res) => {
    assert.equal(req.url, '/openapi/v1/videos/a%2Fb');
    json(res, { id: 'a/b', statusTask: 'succeeded' });
  });
  assert.equal(
    (await new SeedanceApi({ baseUrl, key }).get('a/b')).statusTask,
    'succeeded',
  );
});
test('uploads actual PNG bytes as a data URL', async (t) => {
  const d = await dir(t),
    file = join(d, 'cat.png'),
    bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  await writeFile(file, bytes);
  const baseUrl = await fixture(t, (req, res, body) => {
    assert.equal(req.url, '/api/assets');
    assert.equal(body.filename, 'cat.png');
    assert.equal(body.dataUrl, 'data:image/png;base64,iVBORw0KGgo=');
    json(res, { id: 'asset-1' });
  });
  assert.equal(
    (await new SeedanceApi({ baseUrl, key }).upload(file)).id,
    'asset-1',
  );
});
test('upload refuses oversized files and non-image contents', async (t) => {
  const d = await dir(t),
    file = join(d, 'bad.jpg');
  const api = new SeedanceApi({ key });
  await writeFile(file, 'not a jpeg');
  await assert.rejects(() => api.upload(file), /PNG|JPEG|WEBP/);
  await writeFile(file, Buffer.alloc(5 * 1024 * 1024 + 1));
  await assert.rejects(() => api.upload(file), /5 MB/);
});
test('429 explains retry delay and POST is never retried or leaks the key', async (t) => {
  let calls = 0;
  const baseUrl = await fixture(t, (req, res) => {
    calls++;
    json(res, { error: `limit ${key}`, extra: { retryAfterSec: 17 } }, 429);
  });
  await assert.rejects(
    () => new SeedanceApi({ baseUrl, key }).create({ prompt: 'x' }),
    (e) => e.message.includes('17') && !e.message.includes(key),
  );
  assert.equal(calls, 1);
});
test('download saves MP4 and refuses overwrite', async (t) => {
  const d = await dir(t),
    file = join(d, 'out.mp4');
  const baseUrl = await fixture(t, (req, res) => {
    assert.equal(req.url, '/openapi/v1/videos/task/file');
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    res.end('fixture-mp4');
  });
  const api = new SeedanceApi({ baseUrl, key });
  assert.equal((await api.download('task', file)).bytes, 11);
  assert.equal(await readFile(file, 'utf8'), 'fixture-mp4');
  await assert.rejects(() => api.download('task', file));
  assert.equal(await readFile(file, 'utf8'), 'fixture-mp4');
});
test('failed downloads leave no output or partial files', async (t) => {
  const d = await dir(t),
    file = join(d, 'out.mp4');
  const baseUrl = await fixture(t, (req, res) =>
    json(res, { error: 'not ready' }, 409),
  );
  await assert.rejects(
    () => new SeedanceApi({ baseUrl, key }).download('task', file),
    /409/,
  );
  assert.deepEqual(await readdir(d), []);
});
test('download redirects do not forward credentials to another origin', async (t) => {
  const d = await dir(t);
  const target = await fixture(t, (req, res) => {
    assert.equal(req.headers.authorization, undefined);
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    res.end('video');
  });
  const baseUrl = await fixture(t, (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    res.writeHead(302, { location: `${target}/video` });
    res.end();
  });
  assert.equal(
    (
      await new SeedanceApi({ baseUrl, key }).download(
        'task',
        join(d, 'out.mp4'),
      )
    ).bytes,
    5,
  );
});
test('missing key fails only authenticated operations', async () => {
  await assert.rejects(
    () => new SeedanceApi({ key: '' }).models(),
    /SEEDANCE_API_KEY/,
  );
});

test('non-object provider errors preserve HTTP status without throwing a TypeError', async (t) => {
  for (const payload of [null, 'gateway failure', []]) {
    const baseUrl = await fixture(t, (req, res) => json(res, payload, 503));
    await assert.rejects(
      () => new SeedanceApi({ baseUrl, key }).models(),
      /HTTP 503/,
    );
  }
});
test('dot-segment task IDs cannot escape the video endpoint', async (t) => {
  let calls = 0;
  const baseUrl = await fixture(t, (req, res) => {
    calls++;
    json(res, {});
  });
  const api = new SeedanceApi({ baseUrl, key });
  for (const id of ['.', '..', ' .. ']) {
    await assert.rejects(() => api.get(id), /task_id/);
    await assert.rejects(
      () => api.download(id, join(tmpdir(), 'unused-seedance.mp4')),
      /task_id/,
    );
  }
  assert.equal(calls, 0);
});
test('interrupted download removes partial file and never publishes output', async (t) => {
  const d = await dir(t),
    output = join(d, 'out.mp4');
  const baseUrl = await fixture(t, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': '1000',
    });
    res.write('partial');
    setTimeout(() => res.destroy(), 20);
  });
  await assert.rejects(() =>
    new SeedanceApi({ baseUrl, key }).download('task', output),
  );
  assert.deepEqual(await readdir(d), []);
});
test('empty and non-video downloads never create the destination', async (t) => {
  const d = await dir(t);
  for (const type of ['video/mp4', 'text/html']) {
    const baseUrl = await fixture(t, (req, res) => {
      res.writeHead(200, { 'Content-Type': type });
      res.end();
    });
    await assert.rejects(() =>
      new SeedanceApi({ baseUrl, key }).download('task', join(d, 'out.mp4')),
    );
    assert.deepEqual(await readdir(d), []);
  }
});
