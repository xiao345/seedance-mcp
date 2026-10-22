# Contributing

Issues and pull requests are welcome. For security-sensitive reports, see [SECURITY.md](SECURITY.md).

## Development

Use Node.js 22+ and run:

```sh
npm ci --ignore-scripts
npm run check
npm run format:check
npm test
npm run verify
npm pack --dry-run
```

Run `npm run format` to apply consistent formatting. Tests use loopback HTTP fixtures and real MCP SDK clients; a contributor does not need an account, API key, Codex installation, or paid generation.

## Changes

- Keep each pull request focused. Describe the user-visible behavior and how it was verified.
- Add a regression test for bug fixes and behavior changes. Avoid tests tied only to implementation details.
- Preserve stdout for the MCP protocol. Diagnostics go to stderr.
- Keep side-effect annotations accurate and do not automatically retry paid submissions.
- Never commit `.env` files, actual keys, task receipts, generated media, or personal absolute paths. `.env.example` must contain no credentials.
- Keep English and Chinese setup instructions consistent when changing configuration or tools.
- Update the Unreleased section of [CHANGELOG.md](CHANGELOG.md).

The package allowlist excludes tests, local history, credentials, and generated artifacts. Review `npm pack --dry-run` before changing packaging. Publishing to npm is a separate maintainer action; CI does not publish packages or generate videos.

By contributing, you agree your contribution is provided under the project's MIT license.
