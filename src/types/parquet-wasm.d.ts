/**
 * Type definitions for parquet-wasm
 */

declare module 'parquet-wasm' {
  export interface Column {
    get(index: number): any;
  }

  export interface Table {
    schema: any;
    columnNames(): string[];
    numRows(): number;
    getColumnByName(name: string): Column | null;
  }

  export function readParquet(buffer: Buffer): Table;
}
