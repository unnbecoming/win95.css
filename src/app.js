import { CssChip } from './chip.js';

const manifest = await fetch('./generated/alu32.manifest.json').then((response) => response.json());
const cssText = await fetch('./generated/alu32.css').then((response) => response.text());
document.querySelector('#css-bytes').textContent = String(new TextEncoder().encode(cssText).length);
const element = document.querySelector('#chip');
const chip = new CssChip(element, manifest);
const hex32 = (value) => `0x${Math.trunc(value).toString(16).padStart(8, '0')}`;
const stateNames = Object.keys(manifest.state);

function run(a, b, op = 0) {
  const started = performance.now();
  chip.drive({ a, b, op });
  const state = chip.cycle();
  const elapsed = performance.now() - started;
  document.querySelector('#cycle-ms').textContent = elapsed.toFixed(3);
  document.querySelector('#wtf-hz').textContent = (1000 / elapsed).toFixed(3);
  document.querySelector('#result').textContent = hex32(state.r);
  for (const flag of stateNames.filter((name) => name !== 'r')) {
    document.querySelector(`[data-flag="${flag}"]`).textContent = String(state[flag]);
  }
  return state;
}

function parseInput(id) {
  const raw = document.querySelector(id).value.trim();
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error('enter an unsigned 32-bit integer');
  return value;
}

document.querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault();
  const status = document.querySelector('#status');
  try {
    const a = parseInput('#a');
    const b = parseInput('#b');
    const op = Number(document.querySelector('#op').value);
    run(a, b, op);
    status.textContent = 'CSS state latched.';
  } catch (error) {
    status.textContent = error.message;
  }
});

window.css386 = { alu: run, add: (a, b) => run(a, b, 0), manifest, pins: (names = manifest.signals) => chip.sample(names) };
run(0xffff_ffff, 1, 0);
