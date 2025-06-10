import duckdb from '@duckdb/node-api';
import { env } from '../config/environment';
import assert from 'assert';
import { ParquetPreviewResult } from '../core/types/file';


const S3_CONFIG = {
  s3_region: env.S3_REGION,
  s3_access_key_id: env.S3_ACCESS_KEY,
  s3_secret_access_key: env.S3_SECRET_KEY,
  s3_endpoint: env.S3_ENDPOINT,
  s3_use_ssl: false,
  // s3_url_style: 'path'
};

export class DuckDBS3 {
  private s3_config: Record<string, string|boolean>;
  private instance: duckdb.DuckDBInstance|undefined;
  private bucket_name: string;
  constructor() {
    this.s3_config = S3_CONFIG;
    this.bucket_name = env.BUCKET_NAME;
  }

  async createInstance(){
    try {
      const instance = await duckdb.DuckDBInstance.create(':memory:');
      this.instance = instance;
      const conn = await instance.connect();

      // Register S3 settings in DuckDB
      for (const [key, value] of Object.entries(S3_CONFIG)) {
      await conn.run(`SET ${key}='${value}'`);
    }

    await conn.run(`INSTALL httpfs`);
    await conn.run(`LOAD httpfs`);

    conn.closeSync();
    }
    catch(err){
      console.log(err);
    }  
  }

  async getParquetPreview(file_key: string, max_lines: number,resolve: (value: ParquetPreviewResult) => void, reject: (reason?: any) => void) {
    try {  
      if (this.instance === undefined) {
          await this.createInstance();
          assert (this.instance !== undefined); // mostly to fix linter, but maybe instance creation failed
        }
        const conn = await this.instance.connect();
        
        const s3_parquet_path = `s3://${this.bucket_name}/${file_key}`;

        // get schema
        const schema_query =  await conn.run(`SELECT * FROM parquet_schema('${s3_parquet_path}')`);
        const schema_objects = await schema_query.getRowObjectsJson();
        
        // Create a schema representation
        const schema: Record<string, any> = {};
        for (const field of schema_objects) {
          schema.field.name = field.type;
        }
        // get results
        const preview_query = await conn.run(`SELECT * FROM read_parquet('${s3_parquet_path}') limit ${max_lines}`);
        
        const preview_objects = await preview_query.getRowObjectsJson();
        conn.closeSync();
        if (preview_objects.length === 0) {
          resolve({
            data: [],
            headers: [],
            schema,
            totalRows: 0,
          });
          return;
        }

        const column_headers = Object.keys(preview_objects[0] as Record<string, unknown>); 
        
        resolve(
          {
            data: preview_objects,
            headers: column_headers,
            schema: schema,
            totalRows: preview_objects.length}
        );
    } catch (error) {
      console.error("Error in getParquetPreview:", error);
      reject(error);
    }    
    
  }

}
