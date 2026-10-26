// TypeScript compiles .ts files only. Keep the gRPC contract beside the compiled code.
const { cpSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const destination = join(__dirname, '../build/proto');
mkdirSync(destination, { recursive: true });
cpSync(join(__dirname, '../src/proto'), destination, { recursive: true });
