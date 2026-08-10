/**
 * Environment variable validation and configuration
 * This module provides type-safe access to environment variables
 */
import { z } from "zod";
import dotenv from "dotenv";
import { createLogger } from "../core/utils/logger";
import { exit } from "process";

// Create a logger for this module
const logger = createLogger("Environment");

// Define the base schema for environment variables
const envSchema = z
	.object({
		// Server configuration
		PORT: z
			.string()
			.transform((val) => parseInt(val, 10))
			.default("3000"),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),

		// Storage provider configuration
		STORAGE_PROVIDER: z.enum(["s3", "minio", "gcs"]).default("s3"),
		STORAGE_ENDPOINT: z.string().optional(),
		STORAGE_REGION: z.string().optional(),
		STORAGE_ACCESS_KEY: z.string().optional(),
		STORAGE_SECRET_KEY: z.string().optional(),
		STORAGE_FORCE_PATH_STYLE: z
			.string()
			.transform((val) => val === "true")
			.default("false"),
		STORAGE_USE_SSL: z
			.string()
			.transform((val) => val === "true")
			.default("true"),
		STORAGE_PORT: z
			.string()
			.transform((val) => parseInt(val, 10))
			.optional(),

		// Legacy S3 configuration (conditionally required based on STORAGE_PROVIDER)
		S3_ENDPOINT: z.string().optional(),
		S3_REGION: z.string().optional(),
		S3_ACCESS_KEY: z.string().optional(),
		S3_SECRET_KEY: z.string().optional(),
		BUCKET_NAME: z.string(),

		// GCS configuration (native @google-cloud/storage client, used when STORAGE_PROVIDER=gcs)
		// All optional: if none are set, the client falls back to Application Default Credentials
		// (e.g. workload identity when running on GKE/Cloud Run/GCE).
		GCS_PROJECT_ID: z.string().optional(),
		GCS_KEY_FILE: z.string().optional(),
		GCS_CLIENT_EMAIL: z.string().optional(),
		GCS_PRIVATE_KEY: z
			.string()
			.optional()
			.transform((val) => val?.replace(/\\n/g, "\n")),
		MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB: z
			.string()
			.transform((val) => parseInt(val, 10)),

		// Extra file extensions (comma-separated, dot optional, e.g. "zip,py") appended to the
		// built-in allow-lists in AllowedFileTypes, on top of the strict per-upload-type checks.
		ADDITIONAL_DATABANK_FILE_TYPES: z
			.string()
			.optional()
			.default("")
			.transform((val) =>
				val
					.split(",")
					.map((ext) => ext.trim().toLowerCase().replace(/^\./, ""))
					.filter(Boolean),
			),
		ADDITIONAL_ASSET_FILE_TYPES: z
			.string()
			.optional()
			.default("")
			.transform((val) =>
				val
					.split(",")
					.map((ext) => ext.trim().toLowerCase().replace(/^\./, ""))
					.filter(Boolean),
			),

		// Master switch for the /v1/encryption routes. Default off: only TANUH
		// deployments (client-side encrypted dataset uploads) should enable this.
		ENCRYPTION_ENABLED: z
			.string()
			.transform((val) => val === "true")
			.default("false"),
		// Client-side envelope encryption (Cloud KMS asymmetric key)
		// Full resource name: projects/.../locations/.../keyRings/.../cryptoKeys/.../cryptoKeyVersions/N
		KMS_KEY_VERSION_NAME: z.string().optional(),
		// Local development fallback (no KMS emulator exists): PEM public key served
		// in place of the KMS one; keep the paired private key for decryption tests.
		DEV_ENCRYPTION_PUBLIC_KEY_PEM: z
			.string()
			.optional()
			.transform((val) => val?.replace(/\\n/g, "\n")),

		// Authentication configuration
		KEYCLOAK_AUTH_URL: z.string().url(),
		KEYCLOAK_CLIENT_ID: z.string(),
		KEYCLOAK_PUBLIC_KEY: z.string().optional(),
		KEYCLOAK_REALM: z.string().optional(),

		// Multiple IDP configuration
		ISSUER_CONFIG: z
			.string()
			.optional()
			.transform((val) => {
				if (!val) return null;
				try {
					return JSON.parse(val);
				} catch (e) {
					throw new Error(
						"ISSUER_CONFIG must be a valid JSON string",
					);
				}
			}),

		// Auth feature toggles
		AUTH_ENABLED: z
			.string()
			.transform((val) => val !== "false")
			.default("true"),
		AUTHZ_ENABLED: z
			.string()
			.transform((val) => val !== "false")
			.default("true"),

		// Logging configuration
		LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

		// CORS configuration
		CORS_ORIGIN: z
			.string()
			.trim()
			.transform((val) => {
				if (val === "*") return true;
				return typeof val === "string"
					? val.split(",").map((v) => v.trim())
					: val;
			})
			.default("*"),

		// API version
		VERSION: z.string().default("1.0.0"),

		// ACL API configuration
		ACL_APD_API_URL: z.string().url(),

		// Catalogue API configuration
		CAT_API_URL: z.string().url(),

		// RabbitMQ configuration
		RABBITMQ_HOST: z.string(),
		RABBITMQ_PORT: z.string().transform((val) => parseInt(val, 10)),
		RABBITMQ_VHOST: z.string(),
		RABBITMQ_USERNAME: z.string(),
		RABBITMQ_PASSWORD: z.string(),
		RABBITMQ_EXCHANGE: z.string(),
		RABBITMQ_ROUTING_KEY: z.string(),

		// Redis configuration (for job queue)
		REDIS_HOST: z.string().default("localhost"),
		REDIS_PORT: z
			.string()
			.transform((val) => parseInt(val, 10))
			.default("6379"),
		REDIS_PASSWORD: z.string().optional(),
		REDIS_DB: z
			.string()
			.transform((val) => parseInt(val, 10))
			.default("0"),
		REDIS_CLUSTER_MODE: z
			.string()
			.transform((val) => val === "true")
			.default("false"),
		ZIP_QUEUE_NAME: z.string().default("jobs:zip"),
		REPORT_QUEUE_NAME: z.string().optional(),
		READINESS_QUEUE_NAME: z.string().optional(),

		//Lambda Configs (optional for backward compatibility)
		ZIP_LAMBDA_URL: z.string().url().optional(),
		REPORTS_LAMBDA_URL: z.string().url().optional(),
		LAMBDA_ACCESS_KEY: z.string().optional(),
		LAMBDA_SECRET_KEY: z.string().optional(),
		LAMBDA_REGION: z.string().optional(),
		// STS (Temporary Access) Configuration
		STS_ROLE_ARN: z.string(),
		STS_SESSION_DURATION_IN_SECONDS: z
			.string()
			.transform((val) => parseInt(val, 10))
			.default("900"), // Default 15 minutes (900 seconds)
	})
	.transform((env) => ({
		...env,
		REPORT_QUEUE_NAME:
			env.REPORT_QUEUE_NAME || env.READINESS_QUEUE_NAME || "jobs:report",
	}));

// Export type definition
export type Env = z.infer<typeof envSchema>;

/**
 * Load and validate environment variables
 * @returns Validated environment variables
 */
function loadEnv(): Env {
	// Load environment variables from .env file based on NODE_ENV
	if (process.env.NODE_ENV === "production") {
		dotenv.config({ path: ".env.production" });
	} else {
		dotenv.config();
	}

	// Parse and validate environment variables
	const result = envSchema.safeParse(process.env);

	if (!result.success) {
		logger.error("Environment variable validation failed", result.error, {
			issues: result.error.issues,
		});
		exit(1);
	}

	const env = result.data;

	// Additional validation for storage configuration
	validateStorageConfiguration(env);

	return env;
}

/**
 * Validate storage configuration based on provider
 * @param env - Validated environment variables
 */
function validateStorageConfiguration(env: Env): void {
	const provider = env.STORAGE_PROVIDER;

	if (provider === "s3") {
		// For S3, require legacy S3 variables or new STORAGE variables
		const hasLegacyS3 =
			env.S3_ENDPOINT &&
			env.S3_REGION &&
			env.S3_ACCESS_KEY &&
			env.S3_SECRET_KEY;
		const hasNewStorage =
			env.STORAGE_ENDPOINT &&
			env.STORAGE_ACCESS_KEY &&
			env.STORAGE_SECRET_KEY;

		if (!hasLegacyS3 && !hasNewStorage) {
			logger.error(
				`S3 storage provider requires either legacy S3_* variables or new STORAGE_* variables. hasLegacyS3=${hasLegacyS3}, hasNewStorage=${hasNewStorage}, provider=${provider}`,
			);
			exit(1);
		}
	} else if (provider === "minio") {
		// For MinIO, prefer new STORAGE variables, fallback to legacy S3 variables
		const hasStorageVars =
			env.STORAGE_ENDPOINT &&
			env.STORAGE_ACCESS_KEY &&
			env.STORAGE_SECRET_KEY;
		const hasLegacyS3 =
			env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY;

		if (!hasStorageVars && !hasLegacyS3) {
			logger.error(
				`MinIO storage provider requires either STORAGE_* variables or legacy S3_* variables. hasStorageVars=${hasStorageVars}, hasLegacyS3=${hasLegacyS3}, provider=${provider}`,
			);
			exit(1);
		}
	} else if (provider === "gcs") {
		// GCS uses the native @google-cloud/storage client. Credentials can come from a
		// service account key file (GCS_KEY_FILE), inline credentials (GCS_CLIENT_EMAIL +
		// GCS_PRIVATE_KEY), or Application Default Credentials if none are set.
		const hasKeyFile = !!env.GCS_KEY_FILE;
		const hasInlineCredentials = !!(
			env.GCS_CLIENT_EMAIL && env.GCS_PRIVATE_KEY
		);

		if (!hasKeyFile && !hasInlineCredentials) {
			logger.warn(
				`GCS storage provider: no GCS_KEY_FILE or GCS_CLIENT_EMAIL/GCS_PRIVATE_KEY set. ` +
					`Falling back to Application Default Credentials (requires GOOGLE_APPLICATION_CREDENTIALS, ` +
					`gcloud auth application-default login, or GKE/Cloud Run workload identity).`,
			);
		}
	}
}

// Export validated environment variables
export const env = loadEnv();
