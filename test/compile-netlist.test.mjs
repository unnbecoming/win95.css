import test from 'node:test';
import assert from 'node:assert/strict';
import { compileNetlist } from '../scripts/compile-netlist.mjs';

test('state initial values become generated CSS defaults and manifest data', () => {
  const result = compileNetlist({
    name: 'reset-fixture',
    inputs: {},
    state: { pc: { width: 4, initial: 0b1010 }, ready: { width: 1, initial: 1 } },
    signals: {},
    latches: {},
  }, 'reset-fixture');
  assert.equal(result.manifest.version, 2);
  assert.deepEqual(result.manifest.state, { pc: { width: 4, initial: 10 }, ready: { width: 1, initial: 1 } });
  assert.match(result.css, /--pc-0: 0;/);
  assert.match(result.css, /--pc-1: 1;/);
  assert.match(result.css, /--pc-2: 0;/);
  assert.match(result.css, /--pc-3: 1;/);
  assert.match(result.css, /--ready: 1;/);
});

test('declared memory and I/O bus contracts survive compilation', () => {
  const byteBus = { addressOutput: 'address', readOutput: 'read', writeOutput: 'write', writeDataOutput: 'writeData', lockOutput: 'lock', dataInput: 'data' };
  const ioBus = { portOutput: 'port', readOutput: 'ioRead', writeOutput: 'ioWrite', writeDataOutput: 'ioData', dataInput: 'data' };
  const result = compileNetlist({ name: 'bus-fixture', inputs: {}, state: {}, signals: {}, latches: {}, byteBus, ioBus }, 'bus-fixture');
  assert.deepEqual(result.manifest.byteBus, byteBus);
  assert.deepEqual(result.manifest.ioBus, ioBus);
});

test('state initial values are width-checked', () => {
  assert.throws(() => compileNetlist({
    name: 'bad-reset', inputs: {}, state: { pc: { width: 4, initial: 16 } }, signals: {}, latches: {},
  }, 'bad-reset'), /initial value outside 4-bit state pc/);
});
