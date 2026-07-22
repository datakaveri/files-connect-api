# Redis Sentinel (HA) — DevOps Deployment & Handoff Guide

**Audience:** DevOps / Platform team deploying `files-connect-api` and its Python workers.
**Purpose:** Everything you need to run the File Server (API) and the workers (zip + report/
"Data Transformer") against a **Redis Sentinel** cluster instead of standalone/cluster Redis.

The application code already supports Sentinel. This guide covers **only what you configure at
deploy time** — environment variables, ConfigMap/Deployment wiring, and verification.

---

## 1. Background

The target Redis is the **`redis-ha`** Helm chart, reachable in-cluster at:

```
redis-redis-ha.redis.svc.cluster.local
  ├─ 6379    Redis data nodes (master + replicas)
  └─ 26379   Sentinel
```

Sentinel clients connect to the **sentinel port (26379)**, ask which node is the current master,
talk to that master, and automatically re-discover it on failover. This is why the app must be
told to use Sentinel mode — plain `REDIS_HOST:6379` would pin to a single pod and break on failover.

**Precedence in the app:** `sentinel` → `cluster` → `standalone`. Enabling Sentinel overrides the
cluster/standalone settings.

---

## 2. Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `REDIS_SENTINEL_ENABLED` | **Yes** | `false` | Set to `"true"` to turn on Sentinel mode. |
| `REDIS_SENTINEL_MASTER_NAME` | **Yes** | `mymaster` | The Sentinel **master group name**. ⚠️ Confirm from the cluster — see §4. |
| `REDIS_HOST` | **Yes** | `localhost` | Set to `redis-redis-ha.redis.svc.cluster.local`. Used to derive the default sentinel host. |
| `REDIS_SENTINEL_HOSTS` | No | `${REDIS_HOST}:26379` | Comma-separated `host:port` list of sentinels. Leave empty to use the default (the redis-ha Service load-balances across sentinel pods). |
| `REDIS_SENTINEL_PASSWORD` | Only if sentinels require auth | — | Password for the **sentinel** nodes themselves. |
| `REDIS_PASSWORD` | Only if data nodes require auth | — | Password for the **master/replica data** nodes. |
| `REDIS_DB` | No | `0` | Logical DB index on the master. |

> **Two different passwords:** `REDIS_PASSWORD` authenticates to the Redis *data* nodes;
> `REDIS_SENTINEL_PASSWORD` authenticates to the *sentinel* nodes. The redis-ha chart may set one,
> both, or neither. Confirm in §4.

---

## 3. What to change, per component

Three workloads connect to Redis (API, zip-worker, report-worker). **All three now read their
Redis config from the `files-connect-config` ConfigMap**, so in the normal case the only file you
edit is the ConfigMap (§3d) — the Deployment manifests need no changes. The per-component notes
below explain how each one consumes the ConfigMap.

### 3a. API (`infra/manifest.yaml`) — ✅ ConfigMap only, no manifest change

The API container uses `envFrom: configMapRef: files-connect-config`, so it automatically picks up
every key in the ConfigMap. **Updating the ConfigMap (§3d) is sufficient for the API.**

### 3b. report-worker (`infra/report-worker-deployment.yaml`) — ✅ already wired

This deployment reads all Redis settings (including the new `REDIS_SENTINEL_ENABLED`,
`REDIS_SENTINEL_MASTER_NAME`, `REDIS_SENTINEL_HOSTS`) from the ConfigMap via `configMapKeyRef`.
The Sentinel keys are marked `optional: true`, so a missing `REDIS_SENTINEL_HOSTS` is harmless.
**No manifest change needed** — the ConfigMap (§3d) drives it.

### 3c. zip-worker (`infra/worker-deployment.yaml`) — ✅ already wired

Previously this deployment hardcoded `REDIS_HOST/PORT/DB` as literals. It has been converted to
read the same ConfigMap keys as the report-worker (including the Sentinel keys, `optional: true`),
so both workers are now configured identically. **No manifest change needed** — the ConfigMap
(§3d) drives it.

### 3d. ConfigMap (`infra/configmap.yaml`) — the single source of truth

The committed ConfigMap already contains:

```yaml
  REDIS_HOST: "redis-redis-ha.redis.svc.cluster.local"
  REDIS_PORT: "6379"
  REDIS_DB: "0"
  REDIS_SENTINEL_ENABLED: "true"
  REDIS_SENTINEL_MASTER_NAME: "mymaster"          # ⚠️ confirm — see §4
  # REDIS_SENTINEL_HOSTS: "redis-redis-ha.redis.svc.cluster.local:26379"
```

Adjust `REDIS_SENTINEL_MASTER_NAME` (and add auth keys) after the checks in §4.
If auth is required, add `REDIS_PASSWORD` / `REDIS_SENTINEL_PASSWORD` to `infra/secret.yaml`
and reference them via `secretKeyRef` in each workload.

---

## 4. ⚠️ Pre-deploy checks (run these against the live cluster first)

These values **cannot be guessed** — verify them before rolling out.

**1. Master group name** (goes into `REDIS_SENTINEL_MASTER_NAME`):

```bash
kubectl exec -n redis redis-redis-ha-server-0 -c sentinel -- \
  redis-cli -p 26379 sentinel masters
```

Use the `name` field from the output. If it is not `mymaster`, update
`REDIS_SENTINEL_MASTER_NAME` in the ConfigMap accordingly.

**2. Do the data nodes require a password?**

```bash
kubectl exec -n redis redis-redis-ha-server-0 -c redis -- \
  redis-cli -p 6379 config get requirepass
```

Non-empty → set `REDIS_PASSWORD`.

**3. Do the sentinels require a password?** Check the chart values / sentinel config for
`sentinel auth-pass` or `requirepass` on port 26379. If set → provide `REDIS_SENTINEL_PASSWORD`.

**4. Confirm the Service exposes the sentinel port (26379):**

```bash
kubectl get svc -n redis redis-redis-ha -o jsonpath='{.spec.ports[*].port}{"\n"}'
```

Should include `26379`. If the sentinel port is on a differently-named Service, set
`REDIS_SENTINEL_HOSTS` explicitly to that host:port.

---

## 5. Deploy

```bash
kubectl apply -f infra/configmap.yaml
kubectl apply -f infra/manifest.yaml                 # API
kubectl apply -f infra/worker-deployment.yaml        # zip-worker
kubectl apply -f infra/report-worker-deployment.yaml # report-worker

# Restart so pods pick up the new ConfigMap/env
kubectl rollout restart deployment/files-connect-api        # adjust names/namespace as needed
kubectl rollout restart deployment/files-connect-zip-worker
kubectl rollout restart deployment/files-connect-report-worker
```

---

## 6. Verify after deploy

**Logs** — each workload should log Sentinel mode on startup:

```bash
kubectl logs deploy/files-connect-api | grep -i sentinel
# expect: "Creating Redis Sentinel client" and "Redis client ready {mode: sentinel}"

kubectl logs deploy/files-connect-zip-worker | grep -i sentinel
kubectl logs deploy/files-connect-report-worker | grep -i sentinel
# expect: "Connecting to Redis Sentinel ..." / "Successfully connected to Redis Sentinel master"
```

**Functional** — enqueue a job through the API and confirm a worker picks it up (job status
moves `pending → processing → completed`). This proves both the producer (API) and consumer
(workers) share the same master via Sentinel.

**Failover (optional but recommended)** — trigger a failover and confirm the app keeps working
without a restart:

```bash
kubectl exec -n redis redis-redis-ha-server-0 -c sentinel -- \
  redis-cli -p 26379 sentinel failover mymaster
# wait ~5-10s, then enqueue another job — it should still succeed
```

---

## 7. Rollback

Sentinel is gated entirely behind `REDIS_SENTINEL_ENABLED`. To revert to the previous behaviour,
set `REDIS_SENTINEL_ENABLED: "false"` (and restore the old `REDIS_HOST`) in the ConfigMap, then
`kubectl rollout restart` the API and both workers. No image rollback required.

---

## 8. Notes for the record

- **Node dependency:** the API's `redis` (node-redis) client was upgraded **v4 → v5** because
  Sentinel support (`createSentinel`) only exists in v5. This is already in the built image; DevOps
  needs a build/deploy of the new image tag, no runtime action.
- **Python workers:** `redis-py >= 5.0.8` (already pinned in `requirements.txt`) supports Sentinel
  natively — no dependency change.
- **Failover behaviour:** on master promotion the clients transparently reconnect to the new master
  (verified locally: ~2s reconnect, in-flight singleton follows the new master, replicated data
  preserved). Brief command errors during the promotion window are expected and retried.
- **Local reproduction:** `docker compose -f docker-compose.sentinel.yml up -d` stands up an
  equivalent 1-master/1-replica/3-sentinel topology for testing.
