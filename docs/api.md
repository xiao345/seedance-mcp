# API contract

This adapter targets the SeeDance-compatible REST contract supplied with the original integration. It does not implement the official ByteDance API. Override the origin with `SEEDANCE_BASE_URL` only for services implementing this same contract.

| MCP tool                  | REST endpoint                          |
| ------------------------- | -------------------------------------- |
| `seedance_health`         | `GET /api/healthz` (no authentication) |
| `seedance_list_models`    | `GET /openapi/v1/models`               |
| `seedance_upload_image`   | `POST /api/assets`                     |
| `seedance_create_video`   | `POST /openapi/v1/videos`              |
| `seedance_get_video`      | `GET /openapi/v1/videos/{id}`          |
| `seedance_download_video` | `GET /openapi/v1/videos/{id}/file`     |

Authenticated requests carry `Authorization: Bearer <dk_ key>`. JSON request/response bodies are UTF-8; uploads use a JSON `filename` and base64 `dataUrl`. Downloads use GET, not HEAD.

Creation maps MCP arguments to the following payload:

```json
{
  "model": "seedance-2.0",
  "prompt": "Generate a video of a corgi running on grass",
  "options": { "duration": 10, "ratio": "16:9", "resolution": "720p" },
  "referenceAssetIds": []
}
```

Keep the returned `id`. `statusTask` can be `queued`, `submitted`, `running`, `succeeded`, `failed`, or `interrupted`; the last three are terminal. Responses may also contain `error`, `cost`, `resultUrl`, `resultSignedUrl`, `resultBytes`, and `spec`. Provider objects are returned in both MCP text and structured content with API-key redaction.

Model discovery returns `{ "data": [{ "model": "seedance-2.0", "name": "Seedance 2.0", "priceCredits": 20 }] }`. This is illustrative, not a guarantee of current price or availability. The source documentation had inconsistent defaults, so this server explicitly defaults to 2.0 and 10 seconds.

Errors normally return an HTTP failure with `{ "ok": false, "error": "reason" }`. HTTP 429 may include `extra.retryAfterSec`; the server reports that delay instead of silently retrying. Authentication, insufficient credits, missing/expired results, and unavailable capacity are reported as MCP tool errors. Non-JSON and non-object error bodies are handled without assuming the provider's schema.

Upload limits: 5 MB, PNG/JPEG/WEBP file signatures; task references: eight for 2.0, thirty for other models. Model duration rules are enforced for the documented 2.0 (10/15 seconds) and 2.5-30s (30 seconds); other model names still require one of 10/15/30 seconds and are validated by the provider.

No submission deduplication or idempotency key is documented. The adapter sends each creation request exactly once and cannot promise that a timed-out submission was not accepted. Provider metadata and URLs should be treated as untrusted external content, not as instructions.
