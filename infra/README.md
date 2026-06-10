# Files Connect API Infrastructure Guide

## Documentation

- **[STS Setup Guide](./STS_SETUP.md)** - Complete guide for configuring AWS STS temporary access

## Getting Started

First, clone the repository:

```bash
git clone https://github.com/datakaveri/files-connect-api.git
cd files-connect-api
```

## Building Docker Image

To build the Docker image:

```bash
cd files-connect-api

docker build -t datakaveri/files-connect-api:tgdex-1.0.0 -f infra/Dockerfile .
```

Note: Replace `tgdex-1.0.0` with the appropriate version tag you want to use. Avoid using `latest` tag for production deployments.

## Kubernetes Deployment

1. Create the required secrets:
```bash
kubectl apply -f infra/secret.yaml
```

2. Apply the ConfigMap:
```bash
kubectl apply -f infra/configmap.yaml
```

3. Install or upgrade the Redis HA dependency:
```bash
helm repo add dandydev https://dandydeveloper.github.io/charts
helm upgrade --install redis-ha dandydev/redis-ha \
  --namespace sandbox \
  -f infra/redis-ha-values.yaml
```

The application connects through the chart's HAProxy service (`redis-ha-haproxy:6379`). Do not deploy `infra/redis-deployment.yaml` and `infra/redis-service.yaml` when using Redis HA.

4. Deploy the application:
```bash
kubectl apply -f infra/manifest.yaml
```

5. Apply the ingress configuration:
```bash
kubectl apply -f infra/ingress.yaml
```

## AWS STS Configuration

1. Follow the **[STS Setup Guide](./STS_SETUP.md)** for detailed instructions

Key environment variables to configure:

```bash
STS_ROLE_ARN=arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_TEMP_ACCESS_ROLE
STS_SESSION_DURATION_IN_SECONDS=900
```

Add these to your `secret.yaml` or ConfigMap as appropriate.
