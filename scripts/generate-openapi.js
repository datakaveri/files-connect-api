const fs = require('node:fs');
const path = require('node:path');

const { openApiDocument } = require('../build/config/openapi');

const outputPath = path.join(process.cwd(), 'openapi.json');
fs.writeFileSync(outputPath, `${JSON.stringify(openApiDocument, null, 2)}\n`);

console.log(`Generated ${outputPath}`);
