import { add, div, floor, lit, min, mod, ref, sub } from './ir.mjs';
import { andBit, anyBits, equalConstant, notBit, orBit, muxBit, xorBit } from './bits.mjs';

const WIDTH = 16;
const bits = (prefix, width) => Array.from({ length: width }, (_, index) => `${prefix}-${index}`);
const signalBits = (prefix, width) => bits(prefix, width).map(ref);
const signal = {};
const opcodes = { mov: 0xb8, add: 0x05, sub: 0x2d, xor: 0x35, hlt: 0xf4 };

signal['phase-opcode'] = equalConstant('phase', 3, 0);
signal['phase-imm-low'] = equalConstant('phase', 3, 1);
signal['phase-imm-high'] = equalConstant('phase', 3, 2);
signal['bus-read'] = notBit(ref('halted'));
for (const [name, opcode] of Object.entries(opcodes)) {
  signal[`fetched-${name}`] = equalConstant('busData', 8, opcode);
  signal[`opcode-${name}`] = equalConstant('ir', 8, opcode);
}
signal['fetched-immediate'] = anyBits(['mov', 'add', 'sub', 'xor'].map((name) => ref(`fetched-${name}`)));
signal['fetched-supported'] = orBit(ref('fetched-immediate'), ref('fetched-hlt'));
signal['fetched-invalid'] = notBit(ref('fetched-supported'));
signal['capture-opcode'] = andBit(ref('phase-opcode'), ref('bus-read'));
signal['capture-imm-low'] = andBit(ref('phase-imm-low'), ref('bus-read'));
signal['execute'] = andBit(ref('phase-imm-high'), ref('bus-read'));

signal['ip-carry-0'] = lit(1);
for (let index = 0; index < WIDTH; index++) {
  signal[`ip-inc-${index}`] = xorBit(ref(`ip-${index}`), ref(`ip-carry-${index}`));
  signal[`ip-carry-${index + 1}`] = andBit(ref(`ip-${index}`), ref(`ip-carry-${index}`));
  signal[`next-ip-${index}`] = muxBit(ref('bus-read'), ref(`ip-${index}`), ref(`ip-inc-${index}`));
}

for (let index = 0; index < 8; index++) {
  signal[`next-ir-${index}`] = muxBit(ref('capture-opcode'), ref(`ir-${index}`), ref(`busData-${index}`));
  signal[`next-immLow-${index}`] = muxBit(ref('capture-imm-low'), ref(`immLow-${index}`), ref(`busData-${index}`));
}
signal['next-phase-0'] = andBit(ref('capture-opcode'), ref('fetched-immediate'));
signal['next-phase-1'] = ref('capture-imm-low');
signal['next-phase-2'] = lit(0);
signal['next-halted'] = orBit(ref('halted'), andBit(ref('capture-opcode'), orBit(ref('fetched-hlt'), ref('fetched-invalid'))));
signal['next-faulted'] = orBit(ref('faulted'), andBit(ref('capture-opcode'), ref('fetched-invalid')));

for (let index = 0; index < WIDTH; index++) {
  signal[`immediate-${index}`] = index < 8 ? ref(`immLow-${index}`) : ref(`busData-${index - 8}`);
}
signal['select-arithmetic'] = orBit(ref('opcode-add'), ref('opcode-sub'));
signal['alu-carry-0'] = ref('opcode-sub');
for (let index = 0; index < WIDTH; index++) {
  signal[`alu-effective-b-${index}`] = xorBit(ref(`immediate-${index}`), ref('opcode-sub'));
  signal[`alu-ab-${index}`] = add(ref(`ax-${index}`), ref(`alu-effective-b-${index}`));
  signal[`alu-arithmetic-${index}`] = mod(add(ref(`alu-ab-${index}`), ref(`alu-carry-${index}`)), lit(2));
  signal[`alu-carry-${index + 1}`] = floor(div(add(ref(`alu-ab-${index}`), ref(`alu-carry-${index}`)), lit(2)));
  signal[`alu-xor-${index}`] = xorBit(ref(`ax-${index}`), ref(`immediate-${index}`));
  signal[`alu-result-${index}`] = anyBits([
    andBit(ref('opcode-mov'), ref(`immediate-${index}`)),
    andBit(ref('select-arithmetic'), ref(`alu-arithmetic-${index}`)),
    andBit(ref('opcode-xor'), ref(`alu-xor-${index}`)),
  ]);
  signal[`next-ax-${index}`] = muxBit(ref('execute'), ref(`ax-${index}`), ref(`alu-result-${index}`));
}

signal['alu-arithmetic-cf'] = muxBit(ref('opcode-sub'), ref('alu-carry-16'), notBit(ref('alu-carry-16')));
signal['alu-arithmetic-af'] = muxBit(ref('opcode-sub'), ref('alu-carry-4'), notBit(ref('alu-carry-4')));
signal['alu-cf'] = andBit(ref('select-arithmetic'), ref('alu-arithmetic-cf'));
signal['alu-af'] = andBit(ref('select-arithmetic'), ref('alu-arithmetic-af'));
signal['alu-pf'] = sub(lit(1), mod(add(...signalBits('alu-result', 8)), lit(2)));
signal['alu-zf'] = sub(lit(1), min(lit(1), add(...signalBits('alu-result', WIDTH))));
signal['alu-sf'] = ref('alu-result-15');
signal['alu-of'] = andBit(ref('select-arithmetic'), xorBit(ref('alu-carry-15'), ref('alu-carry-16')));
signal['update-flags'] = andBit(ref('execute'), anyBits([ref('opcode-add'), ref('opcode-sub'), ref('opcode-xor')]));
for (const flag of ['cf', 'pf', 'af', 'zf', 'sf', 'of']) {
  signal[`next-${flag}`] = muxBit(ref('update-flags'), ref(flag), ref(`alu-${flag}`));
}

export const cpu16 = {
  name: 'css386-real-mode-seed',
  inputs: { busData: { width: 8 } },
  state: {
    ip: { width: 16 }, ax: { width: 16 }, ir: { width: 8 }, immLow: { width: 8 }, phase: { width: 3 },
    halted: { width: 1 }, faulted: { width: 1 },
    cf: { width: 1 }, pf: { width: 1 }, af: { width: 1 }, zf: { width: 1 }, sf: { width: 1 }, of: { width: 1 },
  },
  signals: signal,
  latches: {
    ip: bits('next-ip', 16), ax: bits('next-ax', 16), ir: bits('next-ir', 8), immLow: bits('next-immLow', 8), phase: bits('next-phase', 3),
    halted: ['next-halted'], faulted: ['next-faulted'],
    cf: ['next-cf'], pf: ['next-pf'], af: ['next-af'], zf: ['next-zf'], sf: ['next-sf'], of: ['next-of'],
  },
  outputs: { busAddress: bits('ip', 16), busRead: ['bus-read'] },
  byteBus: { addressOutput: 'busAddress', readOutput: 'busRead', dataInput: 'busData' },
};
