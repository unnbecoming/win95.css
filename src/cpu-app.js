import { CssChip } from './chip.js';
import { ByteBusMachine } from './byte-bus-machine.js';

const manifest = await fetch('./generated/cpu16.manifest.json').then((response) => response.json());
const resetStub = Uint8Array.from([0xea, 0x00, 0x7c, 0x00, 0x00]);
const landingAddress = 0x7c00;
const rom = Uint8Array.from([
  0xe9, 0x03, 0x00, 0x90, 0x90, 0x90,
  0xb8, 0x03, 0x00, 0x2d, 0x01, 0x00, 0x75, 0xfb,
  0xfa, 0x31, 0xc0, 0x8e, 0xd8, 0x8e, 0xc0, 0x8e, 0xd0, 0xfb,
  0xb8, 0x34, 0x12, 0xa3, 0x00, 0x20, 0x05, 0x02, 0x00, 0x35, 0xff, 0x00, 0x2d, 0x01, 0x00,
  0xb9, 0x22, 0x22, 0xba, 0x33, 0x33, 0xbb, 0x44, 0x44, 0xbc, 0x55, 0x55,
  0xbd, 0x66, 0x66, 0xbe, 0x77, 0x77, 0xbf, 0x88, 0x88,
  0x89, 0x1c, 0x31, 0x1c,
  0x89, 0xc0, 0x8b, 0xc9, 0x31, 0xd2, 0x33, 0xdb, 0xba, 0x33, 0x33, 0xbb, 0x44, 0x44,
  0xe8, 0x01, 0x00, 0xf4, 0x35, 0x00, 0x00, 0xc3,
]);
const hex = (value, width) => value.toString(16).padStart(width, '0');
document.querySelector('#rom').textContent = `ffff0: ${[...resetStub].map((byte) => hex(byte, 2)).join(' ')}  →  07c00: ${[...rom].map((byte) => hex(byte, 2)).join(' ')}`;

function run() {
  const cpu = document.createElement('div');
  cpu.id = 'cpu';
  cpu.className = 'css386-cpu';
  document.querySelector('#cpu').replaceWith(cpu);
  const memory = new Uint8Array(0x100000);
  memory.set(resetStub, 0xffff0);
  memory.set(rom, landingAddress);
  const machine = new ByteBusMachine(new CssChip(cpu, manifest), memory);
  const started = performance.now();
  const result = machine.run(256);
  const elapsed = performance.now() - started;
  for (const [name, value] of Object.entries(result.state)) {
    const output = document.querySelector(`[data-state="${name}"]`);
    if (output) output.textContent = ['ip', 'ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es'].includes(name) ? hex(value, 4) : name === 'ir' ? hex(value, 2) : String(value);
  }
  document.querySelector('#cycles').textContent = String(result.trace.length);
  document.querySelector('#elapsed').textContent = elapsed.toFixed(3);
  document.querySelector('#wtf-hz').textContent = (result.trace.length * 1000 / elapsed).toFixed(3);
  document.querySelector('#trace').textContent = result.trace.map(({ cycle, kind, address, data }) => `${String(cycle).padStart(2, '0')}  ${kind.padEnd(5)} [${hex(address, 5)}] ${kind === 'read' ? '→' : '←'} ${hex(data, 2)}`).join('\n');
  return { ...result, elapsed };
}

document.querySelector('#run').addEventListener('click', run);
window.css386cpu = { run, manifest, resetStub: [...resetStub], landingAddress, rom: [...rom] };
run();
