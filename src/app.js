import { CssChip } from './chip.js';

const manifest = await fetch('./generated/alu32.manifest.json').then((response) => response.json());
const element = document.querySelector('#chip');
const chip = new CssChip(element, manifest);
const hex32 = (value) => `0x${Math.trunc(value).toString(16).padStart(8, '0')}`;
const stateNames = Object.keys(manifest.state);

function run(a, b) {
  chip.drive({ a, b });
  const state = chip.cycle();
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
    run(a, b);
    status.textContent = 'CSS state latched.';
  } catch (error) {
    status.textContent = error.message;
  }
});

window.css386 = { add: run, manifest, pins: (names = manifest.signals) => chip.sample(names) };
run(0xffff_ffff, 1);
