# Endpoint-Level Authentication & Authorization

This document lists every API endpoint and the **auth-related checks** that run for each, in order.

**Base path:** `/v1` (e.g. `/v1/databanks/...`, `/v1/assets/...`).

---

## Auth Middleware Reference

| Middleware | What it does |
|------------|----------------|
| **authenticate** | Validates `Authorization: Bearer <JWT>`, verifies with Keycloak (RS256), extracts `userId`, roles (`provider` / `consumer` / `cos_admin`), sets `res.locals`. |
| **authorize(roles)** | Ensures user has at least one of the given roles; for non-asset routes runs `checkDatabankAccess` (currently allows all). |
| **checkItemAccess** | Calls Catalogue API for databank `accessPolicy`. If `OPEN` → allow. Otherwise continues (no extra deny). |
| **checkItemAccessWithDatabankAccess** | Same Catalogue check; if databank is not public, runs **databankAccess**. |
| **databankAccess** | Calls ACL/APD API `has_access` with user token; on deny/failure falls back to **checkIsOwner**. |
| **checkIsOwner** | Calls Catalogue API, compares `ownerUserId` with `res.locals.userId`; allows only if equal. |

**Roles:** `provider`, `consumer`, `cos_admin` (admin).

---

## Public Endpoints (No Auth)

| Method | Endpoint | Auth checks |
|--------|----------|-------------|
| GET | `/v1/health` | None. |
| POST | `/v1/databanks/:databankId/files/metadata` | None. |

---

## Databank Endpoints

All paths below are under `/v1/databanks/:databankId/...`. Checks are listed in **execution order**.

### File operations

| Method | Path | Auth checks (in order) |
|--------|------|-------------------------|
| POST | `.../files` | 1. **authenticate** 2. **authorize**(provider, consumer) 3. **checkItemAccess** |
| POST | `.../files/download` | 1. **authenticate** 2. **authorize**(provider, consumer) 3. **checkItemAccessWithDatabankAccess** |
| POST | `.../files/delete` | 1. **authenticate** 2. **authorize**(provider, consumer) 3. **checkIsOwner** |
| POST | `.../files/preview` | 1. **authenticate** 2. **authorize**(provider, consumer) 3. **checkItemAccess** |

### Upload operations

| Method | Path | Auth checks (in order) |
|--------|------|-------------------------|
| POST | `.../uploads` | 1. **authenticate** 2. **authorize**(provider) 3. **checkIsOwner** |
| PUT | `.../uploads/:uploadId` | 1. **authenticate** 2. **authorize**(provider) 3. **checkIsOwner** |
| POST | `.../uploads/:uploadId/cancel` | 1. **authenticate** 2. **authorize**(provider) 3. **checkIsOwner** |

### Processing

| Method | Path | Auth checks (in order) |
|--------|------|-------------------------|
| POST | `.../process` | 1. **authenticate** 2. **authorize**(provider) |
| PUT | `.../process/:jobId/status` | 1. **authenticate** 2. **authorize**(provider) |

### Temporary access & download

| Method | Path | Auth checks (in order) |
|--------|------|-------------------------|
| GET | `.../query-access` | 1. **authenticate** 2. **authorize**(provider, consumer) 3. **checkItemAccessWithDatabankAccess** |
| GET | `.../download` | 1. **authenticate** 2. **authorize**(provider, consumer) 3. **checkItemAccessWithDatabankAccess** |
| GET | `.../report/download` | 1. **authenticate** 2. **authorize**(provider, consumer) 3. **checkItemAccessWithDatabankAccess** |

---

## Asset Endpoints

Base path: `/v1/assets`. The router applies **authenticate** to all asset routes.

| Method | Path | Auth checks (in order) |
|--------|------|-------------------------|
| POST | `/v1/assets/` | 1. **authenticate** 2. **authorize**(provider, consumer, cos_admin) |
| POST | `/v1/assets/download` | 1. **authenticate** 2. **authorize**(provider, cos_admin) 3. In-handler: if not admin, `res.locals.userId` must equal first segment of asset `key` |

---

## Summary by Check Type

| Check | Endpoints using it |
|-------|---------------------|
| **None** | `GET /v1/health`, `POST .../files/metadata` |
| **authenticate + authorize only** | Create process job, update job status |
| **authenticate + authorize + checkItemAccess** | List files, file preview |
| **authenticate + authorize + checkItemAccessWithDatabankAccess** | File download, query-access, databank download, report download |
| **authenticate + authorize + checkIsOwner** | File delete, initiate/complete/cancel upload |
| **authenticate + authorize (assets)** | Asset upload, asset download (with in-handler owner check for download) |

---

## Endpoint × Roles Matrix

Legend: **Y** = role allowed, **-** = not allowed, **(owner)** = must own resource, **(self-key)** = must own asset key.

### Databank endpoints

| Endpoint (method + path, under `/v1`) | Provider | Consumer | Admin (`cos_admin`) | Notes |
|--------------------------------------|----------|----------|---------------------|-------|
| GET `/health` | Y | Y | Y | No auth enforced in code, but safe for all. |
| POST `/databanks/:databankId/files` | Y | Y | Y | Requires JWT + `authorize([provider, consumer])`; admin passes via token roles if configured. |
| POST `/databanks/:databankId/files/download` | Y | Y | Y | Same as above + `checkItemAccessWithDatabankAccess` (Catalogue + ACL/APD). |
| POST `/databanks/:databankId/files/metadata` | Y | Y | Y | Public, **no auth**; roles shown for clarity only. |
| POST `/databanks/:databankId/files/delete` | Y(owner) | Y(owner) | Y(owner) | `authorize([provider, consumer])` + `checkIsOwner` → effective rule is \"owner only\". |
| POST `/databanks/:databankId/files/preview` | Y | Y | Y | `authorize([provider, consumer])` + `checkItemAccess`. |
| POST `/databanks/:databankId/uploads` | Y(owner) | - | Y(owner) | `authorize([provider])` + `checkIsOwner` → effective rule is "owner only". |
| PUT `/databanks/:databankId/uploads/:uploadId` | Y(owner) | - | Y(owner) | `authorize([provider])` + `checkIsOwner` → effective rule is "owner only". |
| POST `/databanks/:databankId/uploads/:uploadId/cancel` | Y(owner) | - | Y(owner) | `authorize([provider])` + `checkIsOwner` → effective rule is "owner only". |
| POST `/databanks/:databankId/process` | Y | - | Y | `authorize([provider])`. |
| PUT `/databanks/:databankId/process/:jobId/status` | Y | - | Y | `authorize([provider])`. |
| GET `/databanks/:databankId/query-access` | Y | Y | Y | `authorize([provider, consumer])` + `checkItemAccessWithDatabankAccess`. |
| GET `/databanks/:databankId/download` | Y | Y | Y | `authorize([provider, consumer])` + `checkItemAccessWithDatabankAccess`. |
| GET `/databanks/:databankId/report/download` | Y | Y | Y | `authorize([provider, consumer])` + `checkItemAccessWithDatabankAccess`. |

### Asset endpoints

| Endpoint (under `/v1/assets`) | Provider | Consumer | Admin (`cos_admin`) | Notes |
|-------------------------------|----------|----------|---------------------|-------|
| POST `/` | Y | Y | Y | `authenticate` + `authorize([provider, consumer, admin])`; any of the three may upload. |
| POST `/download` | Y(self-key) | - | Y | `authenticate` + `authorize([provider, admin])`; non-admin must satisfy `(self-key)` owner check (`userId` == first segment in key). |

---

## Notes

- **Env feature flags:** Authentication and authorization can be toggled via environment variables:
  - `AUTH_ENABLED` (default: `true`): when set to `false`, JWT authentication is skipped (the `authenticate` middleware and token decoding are effectively no-ops).
  - `AUTHZ_ENABLED` (default: `true`): when set to `false`, all authorization and access-control middlewares are skipped (`authorize`, `databankAccess`, `checkItemAccess`, `checkItemAccessWithDatabankAccess`, `checkIsOwner`, and `flexibleAuthMiddleware` become no-ops).
  - If either `AUTH_ENABLED=false` or `AUTHZ_ENABLED=false`, routes that currently require auth/roles/ACL checks will effectively become public; use this only for local development or testing.
- **authorize** uses `checkDatabankAccess()` in auth-utils, which currently **always returns hasAccess: true**; real databank-level enforcement is via **databankAccess** / **checkItemAccessWithDatabankAccess** / **checkIsOwner** and external APIs (Catalogue, ACL/APD).
- **checkItemAccess** only enforces “public” (OPEN) vs non-public; it does not by itself deny non-public access—routes that need strict access use **checkItemAccessWithDatabankAccess** or **checkIsOwner**.
- Asset **download** adds an in-handler rule: non-admin users may only access assets whose key starts with their own `userId`.
