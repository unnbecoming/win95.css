import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve() {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const target = path.resolve(root, `.${pathname}`);
    if (!target.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
    try {
      response.setHeader('content-type', types[path.extname(target)] ?? 'application/octet-stream');
      response.end(fs.readFileSync(target));
    } catch { response.writeHead(404).end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function parity(value) {
  let bits = value & 0xff;
  bits ^= bits >>> 4;
  bits ^= bits >>> 2;
  bits ^= bits >>> 1;
  return (bits & 1) ^ 1;
}

function subtractFlags(destination, immediateByte) {
  const source = immediateByte & 0x80 ? 0xff00 | immediateByte : immediateByte;
  const result = (destination - source) & 0xffff;
  return {
    cf: destination < source ? 1 : 0,
    pf: parity(result),
    af: ((destination ^ source ^ result) >>> 4) & 1,
    zf: result === 0 ? 1 : 0,
    sf: result >>> 15,
    of: ((destination ^ source) & (destination ^ result)) >>> 15,
  };
}

test('83 /7 CMP r16,imm8 sign-extends and updates flags without writeback', async () => {
  const server = await serve();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/test/cpu16.html`);
    const results = await page.evaluate(async () => {
      const [{ CssChip }, { ByteBusMachine }] = await Promise.all([import('/src/chip.js'), import('/src/byte-bus-machine.js')]);
      const manifest = await fetch('/generated/cpu16.manifest.json').then((response) => response.json());
      const initial = { ax: 0x0030, cx: 0x002f, dx: 0xffff, bx: 0xff80, sp: 0x7fff, bp: 0x8000, si: 0x0000, di: 0x1234 };
      const cases = [[0, 0x30], [1, 0x30], [2, 0xff], [3, 0x80], [4, 0xff], [5, 0x7f], [6, 0x00], [7, 0xff]];
      const execute = (bytes, state) => {
        const chip = new CssChip(document.querySelector('#cpu'), manifest);
        chip.seedState({ cs: 0, ip: 0, ...state });
        chip.drive({ busData: 0 });
        const memory = new Uint8Array(0x100000);
        memory.set(bytes, 0);
        return new ByteBusMachine(chip, memory).run(24);
      };
      const accepted = cases.map(([destination, immediate]) => {
        const run = execute([0x83, 0xf8 | destination, immediate, 0xf4], { ...initial, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, of: 1 });
        return { destination, immediate, state: run.state, addresses: run.trace.map(({ address }) => address) };
      });
      const rejectedSelectors = [0, 1, 2, 3, 4, 5, 6].map((selector) => {
        const chip = new CssChip(document.querySelector('#cpu'), manifest);
        chip.seedState({ cs: 0, ip: 0, ...initial }); chip.drive({ busData: 0 });
        const memory = new Uint8Array(0x100000); memory.set([0x83, 0xc0 | (selector << 3), 0x30], 0);
        const machine = new ByteBusMachine(chip, memory); machine.step(); machine.step();
        return { selector, state: chip.state(), addresses: machine.trace.map(({ address }) => address) };
      });
      const chip = new CssChip(document.querySelector('#cpu'), manifest);
      chip.seedState({ cs: 0, ip: 0, ...initial }); chip.drive({ busData: 0 });
      const memory = new Uint8Array(0x100000); memory.set([0x83, 0x3e, 0x00, 0x10, 0x30], 0); memory[0x1000] = 0xaa;
      const machine = new ByteBusMachine(chip, memory); machine.step(); machine.step();
      return { initial, accepted, rejectedSelectors, rejectedMemory: { state: chip.state(), addresses: machine.trace.map(({ address }) => address), memory: memory[0x1000] } };
    });
    const registers = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
    for (const entry of results.accepted) {
      const register = registers[entry.destination];
      assert.deepEqual(entry.addresses, [0, 1, 2, 3]);
      for (const name of registers) assert.equal(entry.state[name], results.initial[name], `${register} must not write ${name}`);
      const expected = subtractFlags(results.initial[register], entry.immediate);
      for (const flag of ['cf', 'pf', 'af', 'zf', 'sf', 'of']) assert.equal(entry.state[flag], expected[flag], `${register} ${entry.immediate.toString(16)} ${flag}`);
      assert.equal(entry.state.faulted, 0);
    }
    for (const entry of results.rejectedSelectors) {
      assert.equal(entry.state.faulted, 1, `selector ${entry.selector}`);
      assert.deepEqual(entry.addresses, [0, 1], `selector ${entry.selector} read past ModR/M`);
    }
    assert.equal(results.rejectedMemory.state.faulted, 1);
    assert.deepEqual(results.rejectedMemory.addresses, [0, 1]);
    assert.equal(results.rejectedMemory.memory, 0xaa);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
