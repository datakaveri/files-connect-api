# Dependency compatibility patches

`decode-uri-component@0.5.1.patch` preserves the CommonJS function export expected
by `query-string@7`, which is used by `minio@8.0.7`. The upstream decoder switched
to an ES module, so overriding the old decoder to 0.5.1 alone causes
`decodeComponent is not a function` when parsing encoded query parameters.

The patch only changes the module format and export. It leaves the upstream
0.5.1 decoding algorithm, including the fix for CVE-2026-118664, intact.
Remove the patch and decoder override when MinIO no longer needs the old
CommonJS query-string dependency. Keep `patches/` in the Docker build context
and copy it before `pnpm install --frozen-lockfile`.
