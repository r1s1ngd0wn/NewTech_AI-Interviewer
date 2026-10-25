const fs = require('node:fs');
const path = require('node:path');
const text = fs.readFileSync(path.join(__dirname, 'prompts/coach.v1.md'), 'utf8');
module.exports = { text, name: 'coach', version: 'duc-v1' };
