import { readFile, stat, open, mkdir, link, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const CONFIG_FILE =
  process.env.SEEDANCE_CONFIG_FILE ||
  join(homedir(), '.config/seedance-mcp/.env');
export async function loadConfig() {
  let file = {};
  try {
    file = parseEnv(await readFile(CONFIG_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT')
      throw new Error(
        'Cannot read Seedance configuration file. Check local file permissions.',
      );
  }
  return {
    key: (process.env.SEEDANCE_API_KEY || file.SEEDANCE_API_KEY || '').trim(),
    baseUrl:
      process.env.SEEDANCE_BASE_URL ||
      file.SEEDANCE_BASE_URL ||
      'https://sd2.bantakal.com',
  };
}

export class SeedanceApi {
  constructor({ key = '', baseUrl = 'https://sd2.bantakal.com' } = {}) {
    this.key = key;
    const url = new URL(baseUrl);
    if (
      url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      )
    )
      throw new Error(
        'API base URL must use HTTPS (loopback HTTP is allowed for tests).',
      );
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error(
        'API base URL must be an origin, without credentials, path or query.',
      );
    this.baseUrl = url.origin;
  }
  redact(value) {
    let text = String(value);
    if (this.key) text = text.replaceAll(this.key, '[REDACTED]');
    return text.replace(/dk_[A-Za-z0-9_-]+/g, '[REDACTED]');
  }
  async response(path, { body, auth = true, download = false } = {}) {
    if (auth && !/^dk_\S+$/.test(this.key))
      throw new Error(
        `Set SEEDANCE_API_KEY to your dk_ API key in ${CONFIG_FILE}.`,
      );
    let url = new URL(path, this.baseUrl);
    let headers = {
      Accept: download
        ? 'video/mp4, application/octet-stream'
        : 'application/json',
    };
    if (auth) headers.Authorization = `Bearer ${this.key}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const signal = AbortSignal.timeout(download ? 90000 : 30000);
    for (let n = 0; n <= 5; n++) {
      let response;
      try {
        response = await fetch(url, {
          method: body === undefined ? 'GET' : 'POST',
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
          redirect: 'manual',
        });
      } catch {
        throw new Error(
          body === undefined
            ? 'API connection failed or timed out. Check network and query again.'
            : 'Submission connection failed or timed out; outcome is unknown. Do not automatically resubmit: check the website generation history to avoid duplicate charges.',
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!download || !location || n === 5)
          throw new Error(
            'Unexpected API redirect. Check API service address.',
          );
        const next = new URL(location, url);
        if (
          next.username ||
          next.password ||
          (next.protocol !== 'https:' &&
            !(
              next.protocol === 'http:' &&
              ['127.0.0.1', 'localhost', '[::1]'].includes(next.hostname) &&
              url.protocol === 'http:'
            ))
        )
          throw new Error('Unsafe download redirect refused.');
        if (next.origin !== url.origin) {
          headers = { ...headers };
          delete headers.Authorization;
        }
        url = next;
        continue;
      }
      if (!response.ok) {
        let data = {};
        try {
          const parsed = await response.json();
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            data = parsed;
        } catch {}
        const advice =
          {
            401: 'Check your API key.',
            403: 'Check the dk_ key and task ownership.',
            404: 'Check the model/task ID or result retention period.',
            409: 'Check account credits or whether the task has completed.',
            429: `Wait ${Number(data.extra?.retryAfterSec) || 60} seconds before retrying.`,
            503: 'Provider capacity unavailable; try later.',
          }[response.status] || '';
        throw new Error(
          this.redact(
            `HTTP ${response.status}: ${data.error || 'API request failed'}. ${advice}`,
          ),
        );
      }
      return response;
    }
  }
  async json(path, options) {
    const response = await this.response(path, options);
    try {
      const result = await response.json();
      if (!result || typeof result !== 'object') throw new Error();
      return result;
    } catch {
      throw new Error('API returned an invalid JSON response.');
    }
  }
  async health() {
    return {
      api: await this.json('/api/healthz', { auth: false }),
      keyConfigured: /^dk_\S+$/.test(this.key),
      configFile: CONFIG_FILE,
    };
  }
  async models() {
    return this.json('/openapi/v1/models');
  }
  async get(id) {
    if (typeof id !== 'string' || !id.trim() || ['.', '..'].includes(id.trim()))
      throw new Error('task_id must be a nonempty task ID, not a dot segment.');
    return this.json(`/openapi/v1/videos/${encodeURIComponent(id)}`);
  }
  async create({
    prompt,
    model = 'seedance-2.0',
    duration = 10,
    ratio = '9:16',
    referenceAssetIds = [],
  }) {
    if (typeof prompt !== 'string' || !prompt.trim())
      throw new Error('prompt must not be empty.');
    if (!['9:16', '16:9', '1:1'].includes(ratio))
      throw new Error('ratio must be 9:16, 16:9 or 1:1.');
    const durations =
      model === 'seedance-2.0'
        ? [10, 15]
        : model === 'seedance-2.5-30s'
          ? [30]
          : [10, 15, 30];
    if (!durations.includes(duration))
      throw new Error(
        `Unsupported duration for ${model}: use ${durations.join(', ')} seconds.`,
      );
    const limit = model === 'seedance-2.0' ? 8 : 30;
    if (
      !Array.isArray(referenceAssetIds) ||
      referenceAssetIds.length > limit ||
      referenceAssetIds.some((x) => typeof x !== 'string' || !x.trim())
    )
      throw new Error(`Use at most ${limit} valid reference asset IDs.`);
    const largest = Array.from(prompt.matchAll(/@Image(\d+)/gi), (m) =>
      Number(m[1]),
    ).reduce((max, index) => Math.max(max, index), 0);
    if (largest > referenceAssetIds.length)
      throw new Error(
        `@Image${largest} requires at least ${largest} reference asset IDs.`,
      );
    return this.json('/openapi/v1/videos', {
      body: {
        model,
        prompt,
        options: { duration, ratio, resolution: '720p' },
        referenceAssetIds,
      },
    });
  }
  async upload(file) {
    if (!isAbsolute(file))
      throw new Error('image_path must be an absolute local path.');
    const info = await stat(file);
    if (!info.isFile() || info.size > 5 * 1024 * 1024)
      throw new Error('Reference image must be a file at most 5 MB.');
    const bytes = await readFile(file);
    if (bytes.length > 5 * 1024 * 1024)
      throw new Error('Reference image must be at most 5 MB.');
    let mime;
    if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
      mime = 'image/png';
    else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      mime = 'image/jpeg';
    else if (
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP'
    )
      mime = 'image/webp';
    else
      throw new Error('Only PNG, JPEG and WEBP image contents are supported.');
    return this.json('/api/assets', {
      body: {
        filename: basename(file),
        dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
      },
    });
  }
  async download(id, output) {
    if (typeof id !== 'string' || !id.trim() || ['.', '..'].includes(id.trim()))
      throw new Error('task_id must be a nonempty task ID, not a dot segment.');
    if (!isAbsolute(output))
      throw new Error('output_path must be an absolute local path.');
    try {
      await stat(output);
      throw new Error(
        'Output file already exists; choose another output_path.',
      );
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const response = await this.response(
      `/openapi/v1/videos/${encodeURIComponent(id)}/file`,
      { download: true },
    );
    const type = response.headers.get('content-type') || '';
    if (!/^(video\/|application\/octet-stream)/i.test(type)) {
      await response.body?.cancel();
      throw new Error(
        'Download did not return a video file. Query task status first.',
      );
    }
    const max = 512 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > max) {
      await response.body?.cancel();
      throw new Error('Video exceeds 512 MB download limit.');
    }
    await mkdir(dirname(output), { recursive: true });
    const partial = join(dirname(output), `.seedance-${randomUUID()}.part`);
    let handle,
      bytes = 0;
    try {
      handle = await open(partial, 'wx', 0o600);
      const bound = new Transform({
        transform(chunk, encoding, cb) {
          bytes += chunk.length;
          cb(
            bytes > max
              ? new Error('Video exceeds 512 MB download limit.')
              : null,
            chunk,
          );
        },
      });
      await pipeline(
        Readable.fromWeb(response.body),
        bound,
        handle.createWriteStream(),
      );
      if (!bytes) throw new Error('Provider returned an empty video file.');
      await link(partial, output);
      return { path: output, bytes, mime: type };
    } finally {
      await handle?.close().catch(() => {});
      await unlink(partial).catch(() => {});
    }
  }
}
