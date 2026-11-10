# Control-plane gRPC contract

`appid_verification.proto` is copied unchanged from `datakaveri/dx-common`, branch `dev`,
commit `679bfa00419d8a8feeb839d3bed36b133d1e986e`.

Source: https://github.com/datakaveri/dx-common/blob/679bfa00419d8a8feeb839d3bed36b133d1e986e/src/main/proto/appid_verification.proto

The file server currently uses only `AppIdVerificationService.ResolveDelegation`.
Keeping the full upstream file preserves its package, method names and field numbers.
When updating it, review the upstream contract changes and update this commit reference.

`pnpm build` copies this directory into `build/proto`, which is also included in the
production image through the existing `COPY ... /app/build` instruction.
