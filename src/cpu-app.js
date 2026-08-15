import { CssChip } from './chip.js';
import { ByteBusMachine } from './byte-bus-machine.js';

const manifest = await fetch('./generated/cpu16.manifest.json').then((response) => response.json());
const rom = Uint8Array.from([0xb8, 0x34, 0x12, 0x05, 0x02, 0x00, 0x35, 0xff, 0x00, 0x2d, 0x01, 0x00, 0xf4]);
const hex = (value, width) => value.toString(16).padStart(width, '0');
document.querySelector('#rom').textContent = [...rom].map((byte) => hex(byte, 2)).join(' ');

function run() {
  const cpu = document.createElement('div');
  cpu.id = 'cpu';
  cpu.className = 'css386-cpu';
  document.querySelector('#cpu').replaceWith(cpu);
  const machine = new ByteBusMachine(new CssChip(cpu, manifest), rom);
  const started = performance.now();
  const result = machine.run(256);
  const elapsed = performance.now() - started;
  for (const [name, value] of Object.entries(result.state)) {
    const output = document.querySelector(`[data-state="${name}"]`);
    if (output) output.textContent = ['ip', 'ax'].includes(name) ? hex(value, 4) : name === 'ir' ? hex(value, 2) : String(value);
  }
  document.querySelector('#cycles').textContent = String(result.trace.length);
  document.querySelector('#elapsed').textContent = elapsed.toFixed(3);
  document.querySelector('#wtf-hz').textContent = (result.trace.length * 1000 / elapsed).toFixed(3);
  document.querySelector('#trace').textContent = result.trace.map(({ cycle, address, data }) => `${String(cycle).padStart(2, '0')}  read  [${hex(address, 4)}] → ${hex(data, 2)}`).join('\n');
  return { ...result, elapsed };
}

document.querySelector('#run').addEventListener('click', run);
window.css386cpu = { run, manifest, rom: [...rom] };
run();
