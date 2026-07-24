import duckdb from "@duckdb/node-api";
import { env } from "../config/environment";
import assert from "assert";
import { ParquetPreviewResult } from "../core/types/file";

const S3_CONFIG: Record<string, string | boolean> = {};

// Prefer the newer STORAGE_* variables, falling back to legacy S3_* — matching
// the resolution order used by createStorageConfig() in config/storage.ts.
const s3Region = env.STORAGE_REGION || env.S3_REGION;
const s3AccessKey = env.STORAGE_ACCESS_KEY || env.S3_ACCESS_KEY;
const s3SecretKey = env.STORAGE_SECRET_KEY || env.S3_SECRET_KEY;
const s3Endpoint = env.STORAGE_ENDPOINT || env.S3_ENDPOINT;

if (s3Region) S3_CONFIG.s3_region = s3Region;
if (s3AccessKey) S3_CONFIG.s3_access_key_id = s3AccessKey;
if (s3SecretKey) S3_CONFIG.s3_secret_access_key = s3SecretKey;

// When using an S3-compatible provider (e.g. MinIO/Cyfuture), DuckDB's httpfs
// must be pointed at the custom endpoint, otherwise it defaults to AWS
// (s3.amazonaws.com) and the signed request is rejected with HTTP 403.
if (s3Endpoint) {
  // DuckDB expects a bare host[:port], not a URL scheme.
  const stripped = s3Endpoint.replace(/^https?:\/\//, "");
  S3_CONFIG.s3_endpoint = stripped;
  S3_CONFIG.s3_use_ssl = s3Endpoint.startsWith("https://") || env.STORAGE_USE_SSL;
  // STORAGE_FORCE_PATH_STYLE=true -> path style (bucket in the path, not the host).
  S3_CONFIG.s3_url_style = env.STORAGE_FORCE_PATH_STYLE ? "path" : "vhost";
}

export class DuckDBS3 {
  private s3_config: Record<string, string | boolean>;
  private conn: duckdb.DuckDBConnection | undefined;
  private bucket_name: string;
  constructor() {
    this.s3_config = S3_CONFIG;
    this.bucket_name = env.BUCKET_NAME;
  }

  async createConnection() {
    try {
      const instance = await duckdb.DuckDBInstance.create(":memory:");

      const conn = await instance.connect();
      this.conn = conn;
      let k;

      await conn.run(`INSTALL httpfs`);
      await conn.run(`LOAD httpfs`);
      // Register S3 settings in DuckDB
      for (const [key, value] of Object.entries(S3_CONFIG)) {
        // Booleans (e.g. s3_use_ssl) must be unquoted; strings must be quoted.
        const rendered = typeof value === "boolean" ? value : `'${value}'`;
        await conn.run(`SET ${key}=${rendered}`);
      }
    } catch (err) {
      console.log(err);
    }
  }

  async getParquetPreview(
    databankId: string,
    file_key: string,
    max_lines: number,
    resolve: (value: ParquetPreviewResult) => void,
    reject: (reason?: any) => void,
  ) {
    try {
      if (this.conn === undefined) {
        await this.createConnection();
        assert(this.conn !== undefined); // mostly to fix linter, but maybe connenction creation failed
      }
      const conn = this.conn;

      const s3_parquet_path = `s3://${this.bucket_name}/${databankId}/${file_key}`;
      // get schema
      const schema_query = conn
        .run(`SELECT * FROM parquet_schema('${s3_parquet_path}')`)
        .then(async (res) => {
          return await res.getRowObjectsJson();
        })
        .catch((err) => {
          console.error("Error in getParquetPreview:", err);
          reject(err);
        });
      // get results
      const preview_query = conn
        .run(
          `SELECT * FROM read_parquet('${s3_parquet_path}') limit ${max_lines}`,
        )
        .then(async (res) => {
          return await res.getRowObjectsJson();
        })
        .catch((err) => {
          console.error("Error in getParquetPreview:", err);
          reject(err);
        });

      const schema_objects = await schema_query;
      const preview_objects = await preview_query;

      assert(preview_objects instanceof Array);
      assert(schema_objects instanceof Array);
      const schema: Record<string, string> = {};
      for (const field of schema_objects) {
        // Ensure that field name and type are strings before assignment
        if (field && typeof field.name === 'string' && typeof field.type === 'string') {
          schema[field.name] = field.type;
        }
      }
      if (schema_objects.length === 0) {
        new Error("Schema is empty");
        // return;
      }

      if (preview_objects.length === 0) {
        resolve({
          data: [],
          headers: [],
          schema,
          totalRows: 0,
        });
        return;
      }

      const column_headers = Object.keys(
        preview_objects[0] as Record<string, unknown>,
      );
      resolve({
        data: preview_objects,
        headers: column_headers,
        schema: schema,
        totalRows: preview_objects.length,
      });
    } catch (error) {
      console.error("Error in getParquetPreview:", error);
      reject(error);
    }
  }
}
