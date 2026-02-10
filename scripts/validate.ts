import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const { validateProject } = require('./validateProject.js');

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run validate -- <path-to-project.json | project-name>');
  process.exit(1);
}

// Resolve path: either a direct file path or a project name
let filePath: string;
if (arg.endsWith('.json') || arg.includes(path.sep) || arg.startsWith('.') || arg.startsWith('/') || arg.startsWith('~')) {
  filePath = arg.startsWith('~') ? arg.replace('~', os.homedir()) : path.resolve(arg);
} else {
  filePath = path.join(os.homedir(), '.config', 'video-editor', 'projects', arg, 'project.json');
}

console.log(`Validating: ${filePath}\n`);

// Read file
let raw: string;
try {
  raw = fs.readFileSync(filePath, 'utf8');
} catch (err: any) {
  if (err.code === 'ENOENT') {
    console.error(`File not found: ${filePath}`);
  } else {
    console.error(`Error reading file: ${err.message}`);
  }
  process.exit(1);
}

// Parse JSON
let data: any;
try {
  data = JSON.parse(raw);
} catch (err: any) {
  console.error(`Invalid JSON: ${err.message}`);
  process.exit(1);
}

const projectDir = path.dirname(filePath);
const { structureErrors, integrityErrors, warnings } = validateProject(data, projectDir);

// --- Output ---
let totalErrors = 0;

if (structureErrors.length > 0) {
  console.log(`STRUCTURE ERRORS (${structureErrors.length}):`);
  for (const e of structureErrors) console.log(`  - ${e}`);
  console.log();
  totalErrors += structureErrors.length;
}

if (integrityErrors.length > 0) {
  console.log(`INTEGRITY ERRORS (${integrityErrors.length}):`);
  for (const e of integrityErrors) console.log(`  - ${e}`);
  console.log();
  totalErrors += integrityErrors.length;
}

if (warnings.length > 0) {
  console.log(`WARNINGS (${warnings.length}):`);
  for (const w of warnings) console.log(`  - ${w}`);
  console.log();
}

if (totalErrors === 0) {
  console.log(`Result: VALID${warnings.length > 0 ? ` (${warnings.length} warning${warnings.length !== 1 ? 's' : ''})` : ''}`);
  process.exit(0);
} else {
  console.log(`Result: INVALID (${totalErrors} error${totalErrors !== 1 ? 's' : ''}, ${warnings.length} warning${warnings.length !== 1 ? 's' : ''})`);
  process.exit(1);
}
