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

test('81 /4 AND r16,imm16 executes in generated CSS', async () => {
  const server = await serve();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/test/cpu16.html`);
    const results = await page.evaluate(async () => {
      const [{ CssChip }, { ByteBusMachine }] = await Promise.all([import('/src/chip.js'), import('/src/byte-bus-machine.js')]);
      const manifest = await fetch('/generated/cpu16.manifest.json').then((response) => response.json());
      const initial = { ax: 0xffff, cx: 0x8001, dx: 0x7fff, bx: 0x1234, sp: 0x00ff, bp: 0xff00, si: 0xaaaa, di: 0x5555 };
      const immediates = [0x0f0f, 0xffff, 0x8000, 0x00f0, 0xff00, 0x0ff0, 0x5555, 0x0030];
      const execute = (bytes, state) => {
        const chip = new CssChip(document.querySelector('#cpu'), manifest);
        chip.seedState({ cs: 0, ip: 0, ...state });
        chip.drive({ busData: 0 });
        const memory = new Uint8Array(0x100000);
        memory.set(bytes, 0);
        return new ByteBusMachine(chip, memory).run(32);
      };
      const accepted = Object.keys(initial).map((register, destination) => {
        const immediate = immediates[destination];
        const run = execute([0x81, 0xe0 | destination, immediate & 0xff, immediate >>> 8, 0xf4], { ...initial, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, of: 1 });
        return { register, immediate, state: run.state, addresses: run.trace.map(({ address }) => address) };
      });
      const rejectedSelectors = [0, 1, 2, 3, 5, 6, 7].map((selector) => {
        const chip = new CssChip(document.querySelector('#cpu'), manifest);
        chip.seedState({ cs: 0, ip: 0 });
        chip.drive({ busData: 0 });
        const memory = new Uint8Array(0x100000);
        memory.set([0x81, 0xc0 | (selector << 3), 0x34, 0x12], 0);
        const machine = new ByteBusMachine(chip, memory);
        machine.step(); machine.step();
        return { selector, state: chip.state(), addresses: machine.trace.map(({ address }) => address) };
      });
      const chip = new CssChip(document.querySelector('#cpu'), manifest);
      chip.seedState({ cs: 0, ip: 0 }); chip.drive({ busData: 0 });
      const memory = new Uint8Array(0x100000); memory.set([0x81, 0x26, 0x00, 0x10, 0x30, 0x00], 0);
      const machine = new ByteBusMachine(chip, memory); machine.step(); machine.step();
      return { initial, accepted, rejectedSelectors, rejectedMemory: { state: chip.state(), addresses: machine.trace.map(({ address }) => address) } };
    });
    for (const [destination, result] of results.accepted.entries()) {
      const expected = results.initial[result.register] & result.immediate;
      assert.deepEqual(result.addresses, [0, 1, 2, 3, 4], result.register);
      assert.equal(result.state[result.register], expected, result.register);
      for (const [register, value] of Object.entries(results.initial)) if (register !== result.register) assert.equal(result.state[register], value, `${result.register}/${register}`);
      assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), {
        cf: 0, pf: Number((expected & 0xff).toString(2).split('').filter((bit) => bit === '1').length % 2 === 0), af: 0, zf: Number(expected === 0), sf: expected >>> 15, of: 0,
      }, result.register);
      assert.equal(result.state.halted, 1, result.register);
      assert.equal(result.state.faulted, 0, result.register);
    }
    for (const result of results.rejectedSelectors) {
      assert.deepEqual(result.addresses, [0, 1], String(result.selector));
      assert.equal(result.state.faulted, 1, String(result.selector));
    }
    assert.deepEqual(results.rejectedMemory.addresses, [0, 1]);
    assert.equal(results.rejectedMemory.state.faulted, 1);
  } finally {
    await browser?.close();
    server.close();
  }
});
