# Files Connect API Infrastructure Guide

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

3. Deploy the application:
```bash
kubectl apply -f infra/manifest.yaml
```

4. Apply the ingress configuration:
```bash
kubectl apply -f infra/ingress.yaml
```
