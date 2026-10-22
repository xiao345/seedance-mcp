# Security

## Reporting

Do not post API keys, credentials, private paths, or exploitable vulnerability details in public issues. Use the repository's **Security → Report a vulnerability** option if private reporting is enabled. If it is unavailable, open a minimal issue asking the maintainer for a private reporting channel without disclosing the vulnerability or credentials. There is no guaranteed response-time commitment.

Security fixes target the latest version on the default branch. This project currently has no separately maintained older release lines.

## Trust boundaries

- This is a local stdio service for trusted MCP clients. It is not a multi-user HTTP server or a filesystem sandbox.
- Upload tools can read the local path requested by a client and send the image to the configured provider. Download tools can create directories/files at the requested absolute path, without replacing an existing file.
- Use a private API-key file outside the checkout or inject environment variables from a secret manager. Restrict file permissions, rotate exposed keys, and never place keys in prompts or source control.
- HTTPS is required outside loopback development origins. Download redirects are bounded, HTTPS downgrade is refused, and credentials are removed on cross-origin redirects.
- Providers and their JSON/URLs are untrusted external sources. The adapter redacts keys but does not establish the provider's reliability, retention guarantees, or content rights.
- Paid job submissions are never automatically retried. A timeout can mean an unknown outcome; query the provider's generation history before resubmitting.
- The default host is a third-party service, not an official ByteDance endpoint. Review its terms and privacy practices before transmitting data.

Do not expose the stdio process through an unauthenticated remote wrapper. This repository does not include remote transport, telemetry, stored credentials, or model weights.
