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

function subtractFlags(destination, source) {
  const result = (destination - source) & 0xff;
  return {
    cf: Number(destination < source),
    pf: parity(result),
    af: Number(((destination ^ source ^ result) & 0x10) !== 0),
    zf: Number(result === 0),
    sf: result >>> 7,
    of: Number(((destination ^ source) & (destination ^ result) & 0x80) !== 0),
  };
}

const flags = ['cf', 'pf', 'af', 'zf', 'sf', 'of'];
const preserved = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es', 'tf', 'if', 'df', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'];

function pick(state, keys) {
  return Object.fromEntries(keys.map((key) => [key, state[key]]));
}

test('80 /7 CMP r/m8,imm8 reads every supported EA, updates flags, and never writes', async () => {
  const server = await serve();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/test/cpu16.html`);
    const results = await page.evaluate(async () => {
      const [{ CssChip }, { ByteBusMachine }] = await Promise.all([import('/src/chip.js'), import('/src/byte-bus-machine.js')]);
      const manifest = await fetch('/generated/cpu16.manifest.json').then((response) => response.json());
      const initial = { ax: 0xff00, cx: 0x1001, dx: 0x0f7f, bx: 0x0100, sp: 0x5555, bp: 0x0200, si: 0x0010, di: 0x0020, cs: 0, ds: 0x1000, ss: 0x2000, es: 0x3333, tf: 1, if: 1, df: 1, iopl: 3, nt: 1, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, of: 1, fdcDor: 0x0c, fdcInterrupt: 1 };
      const execute = (bytes, state, placements = []) => {
        const chip = new CssChip(document.querySelector('#cpu'), manifest);
        chip.seedState({ cs: 0, ip: 0, ...initial, ...state });
        chip.drive({ busData: 0 });
        const memory = new Uint8Array(0x100000);
        memory.set(bytes, 0);
        for (const placement of placements) memory.set(placement.bytes, placement.address);
        const result = new ByteBusMachine(chip, memory).run(64);
        return { ...result, outputs: chip.outputs(), writes: result.trace.filter(({ kind }) => kind === 'write'), placementValues: placements.map(({ address }) => memory[address]) };
      };
      const cases = [
        ['BX+SI', 0x00, [], 0x10110, 0x00, 0x00], ['BX+DI', 0x01, [], 0x10120, 0x01, 0x02],
        ['BP+SI', 0x02, [], 0x20210, 0x7f, 0x80], ['BP+DI', 0x03, [], 0x20220, 0x80, 0x7f],
        ['SI', 0x04, [], 0x10010, 0xff, 0xff], ['DI', 0x05, [], 0x10020, 0x10, 0x01],
        ['disp16', 0x06, [0x30, 0x00], 0x10030, 0x0f, 0x10], ['BX', 0x07, [], 0x10100, 0x55, 0xaa],
        ['BX+SI+disp8', 0x40, [0xf0], 0x10100, 0x80, 0x01], ['BX+SI+disp16', 0x80, [0x34, 0x12], 0x11344, 0x7f, 0xff],
      ];
      const accepted = cases.map(([name, modrm, displacement, physical, destination, immediate]) => ({
        name, modrm, displacement, physical, destination, immediate,
        run: execute([0x80, modrm | 0x38, ...displacement, immediate, 0xf4], {}, [{ address: physical, bytes: [destination] }]),
      }));
      const direct = execute([0x80, 0x3e, 0x49, 0x04, 0x07, 0xf4], { ds: 0 }, [{ address: 0x0449, bytes: [0x07] }]);
      const csOverride = execute([0x2e, 0x80, 0x3e, 0x30, 0x00, 0x20, 0xf4], { cs: 0, ds: 0x1000 }, [{ address: 0x0030, bytes: [0x20] }, { address: 0x10030, bytes: [0x21] }]);
      const rejectedSelectors = [0, 2, 3, 5, 6].map((selector) => ({ selector, run: execute([0x80, (selector << 3) | 0x06, 0x30, 0x00, 0x20], {}) }));
      const lock = execute([0xf0, 0x80, 0x3e, 0x30, 0x00, 0x20], {});
      return { initial, accepted, direct, csOverride, rejectedSelectors, lock };
    });

    for (const entry of results.accepted) {
      const { run, name, displacement, physical, destination, immediate } = entry;
      assert.deepEqual(run.trace.map(({ kind, address }) => ({ kind, address })), [
        { kind: 'read', address: 0 }, { kind: 'read', address: 1 },
        ...displacement.map((_, index) => ({ kind: 'read', address: 2 + index })),
        { kind: 'read', address: 2 + displacement.length }, { kind: 'read', address: physical }, { kind: 'read', address: 3 + displacement.length },
      ], name);
      assert.deepEqual(pick(run.state, preserved), pick(results.initial, preserved), `${name} collateral`);
      assert.deepEqual(pick(run.state, flags), subtractFlags(destination, immediate), `${name} flags`);
      assert.deepEqual(run.writes, [], `${name} writes`);
      assert.deepEqual(run.placementValues, [destination], `${name} memory`);
      assert.equal(run.outputs.irq6Request, 1, `${name} irq`);
      assert.equal(run.state.faulted, 0, `${name} fault`);
    }

    assert.deepEqual(results.direct.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 3 },
      { kind: 'read', address: 4 }, { kind: 'read', address: 0x0449 }, { kind: 'read', address: 5 },
    ]);
    assert.deepEqual(pick(results.direct.state, flags), subtractFlags(0x07, 0x07));
    assert.deepEqual(results.direct.writes, []);
    assert.equal(results.direct.placementValues[0], 0x07);
    assert.equal(results.direct.state.faulted, 0);

    assert.deepEqual(results.csOverride.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 3 },
      { kind: 'read', address: 4 }, { kind: 'read', address: 5 }, { kind: 'read', address: 0x0030 }, { kind: 'read', address: 6 },
    ]);
    assert.deepEqual(pick(results.csOverride.state, flags), subtractFlags(0x20, 0x20));
    assert.equal(results.csOverride.state.csOverride, 0);
    assert.deepEqual(results.csOverride.writes, []);
    assert.deepEqual(results.csOverride.placementValues, [0x20, 0x21]);
    assert.equal(results.csOverride.state.faulted, 0);

    for (const { selector, run } of results.rejectedSelectors) {
      assert.deepEqual(run.trace.map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }], `selector ${selector}`);
      assert.equal(run.state.faulted, 1, `selector ${selector}`);
      assert.deepEqual(run.writes, [], `selector ${selector} writes`);
    }
    assert.deepEqual(results.lock.trace.map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }]);
    assert.equal(results.lock.state.faulted, 1);
    assert.deepEqual(results.lock.writes, []);
    assert.deepEqual(pick(results.lock.state, flags), pick(results.initial, flags));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
