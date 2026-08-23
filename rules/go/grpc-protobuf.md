---
paths:
  - "**/*.go"
title: "Go gRPC & Protobuf"
---

Not a golangci pass.

- `.proto` in `proto/`. Commit `*.pb.go` / `*_grpc.pb.go` so `go build`
  works without `protoc`. `go generate` is dev-time; CI builds the
  committed files (optional: regenerate + `git diff --exit-code`).
- Never edit generated files. Never add methods on generated types —
  wrap them.
- `pb.*` is infrastructure. Map to domain types at the adapter;
  handlers take domain structs. Server lives under `internal/infra/`.
- Opaque payloads: `string` / `bytes`. `oneof` for polymorphic updates.
  Local `message Ack {}` instead of `google.protobuf.Empty`.
