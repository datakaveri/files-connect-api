import duckdb from "@duckdb/node-api";
import { env } from "../config/environment";
import assert from "assert";
import { ParquetPreviewResult } from "../core/types/file";

const S3_CONFIG = {
  s3_region: env.S3_REGION,
  s3_access_key_id: env.S3_ACCESS_KEY,
  s3_secret_access_key: env.S3_SECRET_KEY,
};

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
        await conn.run(`SET ${key}='${value}'`);
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
        schema[field["name"] as string] = field.type;
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
