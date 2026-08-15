import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alu32 } from '../rtl/alu32.mjs';
import { cpu16 } from '../rtl/cpu16.mjs';
import { compileNetlist } from './compile-netlist.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = [
  { basename: 'alu32', className: 'css386-chip', netlist: alu32 },
  { basename: 'cpu16', className: 'css386-cpu', netlist: cpu16 },
];
fs.mkdirSync(path.join(root, 'generated'), { recursive: true });
for (const artifact of artifacts) {
  const result = compileNetlist(artifact.netlist, artifact.className);
  fs.writeFileSync(path.join(root, 'generated', `${artifact.basename}.css`), result.css);
  fs.writeFileSync(path.join(root, 'generated', `${artifact.basename}.manifest.json`), `${JSON.stringify(result.manifest, null, 2)}\n`);
  console.log(`generated ${artifact.basename}: ${result.netCount} registered one-bit nets, ${result.css.length} CSS bytes`);
}
