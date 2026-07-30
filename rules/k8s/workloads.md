---
paths:
  - "**/k8s/**/*.yaml"
  - "**/k8s/**/*.yml"
  - "**/manifests/**/*.yaml"
  - "**/charts/**/*.yaml"
  - "**/deploy/**/*.yaml"
  - "**/*.k8s.yaml"
title: "Kubernetes — Workloads"
---

Kubernetes is where the agnostic rules become configuration. Nothing here restates
them: probes are defined in `backend/health.md`, rollout and migration order in
`ops/delivery.md`, what to emit in `ops/observability.md`. This is how a manifest
makes them true — and where the defaults are actively wrong.

## The image

- **Pinned by digest** (`@sha256:…`) for anything that matters, a version tag at
  minimum. `:latest` means "whatever the registry had when that node pulled" — two
  replicas of the same Deployment can run different code.
- `imagePullPolicy: IfNotPresent` with an immutable tag; never `Always` with a mutable
  one, which turns a pod restart into an unplanned deploy.

## Resources

- **Requests always set**, on every container. A pod with no request is scheduled
  anywhere and evicted first — and it makes the cluster's capacity unknowable.
- **Memory limit = memory request.** Memory is not compressible: over the limit the
  kernel kills the process, so the only safe limit is the one you sized for.
- **A CPU limit is usually wrong.** CPU is compressible: throttling a latency-
  sensitive service at the limit produces exactly the tail latency the SLO is about.
  Set the request, let it burst, and if you must cap, say why in a comment.
- Derive the numbers from measured usage, not from a round guess, and revisit them
  when the SLI moves.

## Probes and shutdown — the part everyone gets wrong

The graceful path in `backend/health.md` only works if the manifest cooperates:

- `readinessProbe` → the readiness endpoint; `livenessProbe` → the liveness one.
  **Never point liveness at a dependency check** — a slow database then restarts every
  replica at once, which is how a degradation becomes an outage.
- **`startupProbe` for anything slow to boot**, instead of a generous liveness
  `initialDelaySeconds`. That is what it exists for.
- **`terminationGracePeriodSeconds` > the app's drain timeout.** If the app drains for
  30 s and the grace period is 30 s, every deploy kills in-flight requests.
- **A `preStop` sleep of a few seconds.** Endpoint removal is eventually consistent:
  the pod stops before every proxy has been told, and the requests in that gap are
  the 503s users see on a "zero-downtime" rollout.
- Liveness failure means *restart me*, and nothing else. If a failure mode is not
  fixed by a restart, it does not belong in a liveness probe.

## Rollout and availability

- `maxUnavailable: 0` for a request-serving Deployment, with a `maxSurge` that fits the
  budget — the rollout adds capacity before removing any.
- **`replicas: 1` is a maintenance window**, not a deployment. Two minimum for anything
  a user waits on, and a `PodDisruptionBudget` so a node drain cannot take them all.
- **Topology spread across nodes** (and zones, where they exist) — three replicas on one
  node is one replica with extra cost.
- **Migrations are their own step, before the rollout** (`ops/delivery.md`): a `Job` (or
  a Helm pre-upgrade hook), never an init container on every pod and never at app boot.
- HPA scales on the signal that actually saturates — usually a queue depth or a
  concurrency metric, rarely CPU. And **HPA on CPU with a CPU limit** is a feedback
  loop, not a policy.

## Configuration and secrets

- Config in a `ConfigMap`, secrets in a `Secret` — and the app validates both at
  startup (`backend/config.md`). No secret baked into an image, ever.
- **Roll pods on config change**: a checksum annotation of the ConfigMap/Secret on the
  pod template. Otherwise the change lands only on pods that happen to restart, and the
  fleet silently runs two configurations.
- Prefer projected files over env vars for anything sensitive — env is visible in a pod
  spec dump and inherited by every child process.
- **One namespace per environment**, and never a shared "prod-ish" namespace. Resource
  quotas per namespace, so one workload cannot starve the others.

## Jobs and CronJobs

- `backoffLimit`, `activeDeadlineSeconds` and a history limit on every one. A default
  CronJob keeps failed pods forever and retries a broken job indefinitely.
- `concurrencyPolicy: Forbid` unless the job is genuinely re-entrant — the default lets
  a slow run overlap itself.
- A CronJob that fails silently is the failure mode: expose the **last-success**
  timestamp (`ops/observability.md`) and alert on staleness, not on the pod.

## Checklist

- [ ] Image pinned (digest preferred); no `:latest`
- [ ] Requests set on every container; memory limit = request; CPU limit justified or absent
- [ ] Readiness/liveness point at the right endpoints; liveness independent of dependencies
- [ ] `terminationGracePeriodSeconds` exceeds the drain timeout; `preStop` sleep present
- [ ] `maxUnavailable: 0`, ≥ 2 replicas, PDB, topology spread
- [ ] Migrations run as a Job before the rollout, not at boot
- [ ] Config/secrets external, validated at startup, pod template checksummed
- [ ] One namespace per environment, with quotas
- [ ] Jobs bounded (backoff, deadline, history) and monitored on last success
