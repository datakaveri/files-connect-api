# Infrastructure Guide

The Kubernetes manifests in this directory are examples for `stable/v2.3`. They are not a
production environment export. Replace example hosts, bucket/role values, image references,
namespace, TLS issuer, and resource settings before deployment.

## Build images

Run from the repository root. Set your own registry and pin a release tag or digest:

```bash
docker build -t your-registry/files-connect-api:your-version -f infra/Dockerfile .
docker build -t your-registry/files-connect-zip-worker:your-version workers/zip-worker
docker build -t your-registry/files-connect-report-worker:your-version \
  -f workers/report-worker/Dockerfile.worker workers/report-worker
```

Push only to a registry you administer and update the Deployment image references. Create the
referenced image-pull Secret in the same namespace if the registry is private; omit
`imagePullSecrets` for public images when appropriate. Do not use mutable `latest` tags for production.

## Private configuration

```bash
cp infra/secret.example.yaml infra/secret.yaml
cp infra/configmap.yaml infra/configmap.local.yaml
cp infra/ingress.yaml infra/ingress.local.yaml
cp infra/manifest.yaml infra/manifest.local.yaml
```

These populated local copies are ignored by Git and Docker. Replace **every** Secret placeholder,
and remove unused credential fields. Credentials must not go in a ConfigMap.
`stringData` is plaintext, not encryption: restrict file permissions and Kubernetes access;
prefer a secret manager and workload identity where supported. Do not print populated Secrets
in CI logs or commit them, even when base64-encoded.

Keep all consuming Deployments, ConfigMaps, Secrets, Services, and Redis in the same namespace.
The examples use `sandbox`; create it if needed. Prepare your storage bucket and external
identity provider, Catalogue, ACL-APD, RabbitMQ/exchange, and optional Elasticsearch separately.
Ensure the API and workers have the required storage privileges, matching queue names, and Redis DB.

See [the configuration reference](../docs/config/README.md) and
[deployment wiring](../docs/config/deployments.md) before filling values.

## Apply configured manifests

The commands below assume your private copies are configured and all remaining tracked
manifests have been reviewed for your namespace, images, resources, and persistence needs.
Do not apply `secret.example.yaml` or run `kubectl apply -f infra/`.

```bash
kubectl apply -f infra/secret.yaml
kubectl apply -f infra/configmap.local.yaml
kubectl apply -f infra/redis-deployment.yaml
kubectl apply -f infra/redis-service.yaml
kubectl apply -f infra/manifest.local.yaml
kubectl apply -f infra/worker-deployment.yaml
kubectl apply -f infra/report-worker-deployment.yaml
kubectl apply -f infra/ingress.local.yaml
kubectl -n sandbox get pods
```

Use an explicit HTTPS CORS origin allow-list in both your ingress and app configuration, and
keep Redis and storage administration endpoints private. Enable auth and authorization;
do not ignore JWT expiry or disable TLS verification. The supplied Redis setup is a single
instance, not a highly available production deployment.

Environment values are injected when pods start. After changing ConfigMaps or Secrets:

```bash
kubectl -n sandbox rollout restart deploy/files-connect-api deploy/zip-worker deploy/report-worker
kubectl -n sandbox rollout status deploy/files-connect-api
```

## Further reading

- [Deployment wiring, scaling, and limitations](../docs/config/deployments.md)
- [AWS STS setup](STS_SETUP.md)
- [Report worker verification and troubleshooting](../workers/report-worker/DEPLOYMENT.md)
- [Endpoint access checks](../docs/api/endpoints.md)
