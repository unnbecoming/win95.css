import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const cpuCss = fs.readFileSync(new URL('../generated/cpu16.css', import.meta.url));
const cpuManifest = JSON.parse(fs.readFileSync(new URL('../generated/cpu16.manifest.json', import.meta.url), 'utf8'));
const cpuNetCount = Object.values(cpuManifest.inputs).reduce((sum, port) => sum + port.width, 0)
  + Object.values(cpuManifest.state).reduce((sum, port) => sum + port.width, 0)
  + cpuManifest.signals.length;

test('public current-claim boundary matches implemented string and interrupt support', () => {
  assert.match(index, /broad but incomplete real-mode subset entirely through generated CSS/);
  assert.match(index, /software <code>INT imm8<\/code> and <code>IRET<\/code>/);
  assert.match(index, /<code>LODSB\/LODSW<\/code>.*<code>MOVSB<\/code>.*<code>STOSB\/STOSW<\/code> with supported <code>REP<\/code> forms/);
  assert.match(index, /does not deliver hardware interrupts.*keyboard BIOS services/);
  assert.match(index, /JavaScript remains opcode-blind storage, clock, trace, and UI glue/);
  assert.doesNotMatch(index, /other string instructions.*do not exist/);
  assert.match(readme, /`F3` is accepted only as `REP MOVSB`, `REP STOSB`, or `REP STOSW`/);
  assert.doesNotMatch(readme, /`F3` is accepted only as `REP MOVSB`; another target faults/);
  assert.match(readme, new RegExp(`CPU-plus-current-device slice is \\*\\*${cpuNetCount.toLocaleString('en-US')} nets / ${cpuCss.byteLength.toLocaleString('en-US')} CSS bytes\\*\\*`));
});
