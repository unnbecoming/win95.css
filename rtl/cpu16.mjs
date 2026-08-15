import { add, div, floor, lit, min, mod, ref, sub } from './ir.mjs';
import { andBit, anyBits, equalConstant, notBit, orBit, muxBit, xorBit } from './bits.mjs';

const WIDTH = 16;
const bits = (prefix, width) => Array.from({ length: width }, (_, index) => `${prefix}-${index}`);
const signalBits = (prefix, width) => bits(prefix, width).map(ref);
const signal = {};
const registers = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
const opcodes = { add: 0x05, sub: 0x2d, xor: 0x35, store: 0xa3, jz: 0x74, jnz: 0x75, call: 0xe8, jmp: 0xe9, ret: 0xc3, hlt: 0xf4 };

signal['phase-opcode'] = equalConstant('phase', 3, 0);
signal['phase-imm-low'] = equalConstant('phase', 3, 1);
signal['phase-imm-high'] = equalConstant('phase', 3, 2);
signal['phase-write-low'] = equalConstant('phase', 3, 3);
signal['phase-write-high'] = equalConstant('phase', 3, 4);
signal['phase-ret-low'] = equalConstant('phase', 3, 5);
signal['phase-ret-high'] = equalConstant('phase', 3, 6);
signal['instruction-read'] = anyBits([ref('phase-opcode'), ref('phase-imm-low'), ref('phase-imm-high')]);
signal['stack-read'] = orBit(ref('phase-ret-low'), ref('phase-ret-high'));
signal['read-phase'] = orBit(ref('instruction-read'), ref('stack-read'));
signal['write-phase'] = orBit(ref('phase-write-low'), ref('phase-write-high'));
signal['bus-read'] = andBit(notBit(ref('halted')), ref('read-phase'));
signal['bus-write'] = andBit(notBit(ref('halted')), ref('write-phase'));
for (const [name, opcode] of Object.entries(opcodes)) {
  signal[`fetched-${name}`] = equalConstant('busData', 8, opcode);
  signal[`opcode-${name}`] = equalConstant('ir', 8, opcode);
}
for (const [index, register] of registers.entries()) {
  signal[`fetched-mov-${register}`] = equalConstant('busData', 8, 0xb8 + index);
  signal[`opcode-mov-${register}`] = equalConstant('ir', 8, 0xb8 + index);
}
signal['fetched-mov'] = anyBits(registers.map((register) => ref(`fetched-mov-${register}`)));
signal['opcode-mov'] = anyBits(registers.map((register) => ref(`opcode-mov-${register}`)));
signal['fetched-immediate'] = anyBits(['mov', 'add', 'sub', 'xor', 'store', 'call', 'jmp'].map((name) => ref(`fetched-${name}`)));
signal['fetched-short'] = orBit(ref('fetched-jz'), ref('fetched-jnz'));
signal['opcode-short'] = orBit(ref('opcode-jz'), ref('opcode-jnz'));
signal['fetched-supported'] = anyBits([ref('fetched-immediate'), ref('fetched-short'), ref('fetched-ret'), ref('fetched-hlt')]);
signal['fetched-invalid'] = notBit(ref('fetched-supported'));
signal['capture-opcode'] = andBit(ref('phase-opcode'), ref('bus-read'));
signal['capture-imm-low'] = andBit(ref('phase-imm-low'), ref('bus-read'));
signal['capture-imm-high'] = andBit(ref('phase-imm-high'), ref('bus-read'));
signal['execute'] = andBit(ref('capture-imm-high'), notBit(ref('opcode-store')));

signal['ip-carry-0'] = lit(1);
for (let index = 0; index < WIDTH; index++) {
  signal[`ip-inc-${index}`] = xorBit(ref(`ip-${index}`), ref(`ip-carry-${index}`));
  signal[`ip-carry-${index + 1}`] = andBit(ref(`ip-${index}`), ref(`ip-carry-${index}`));
  signal[`ip-base-${index}`] = muxBit(ref('instruction-read'), ref(`ip-${index}`), ref(`ip-inc-${index}`));
}

for (let index = 0; index < 8; index++) {
  signal[`next-ir-${index}`] = muxBit(ref('capture-opcode'), ref(`ir-${index}`), ref(`busData-${index}`));
  signal[`next-immLow-${index}`] = muxBit(ref('capture-imm-low'), ref(`immLow-${index}`), ref(`busData-${index}`));
  signal[`next-immHigh-${index}`] = muxBit(ref('capture-imm-high'), ref(`immHigh-${index}`), ref(`busData-${index}`));
}
signal['begin-store'] = andBit(ref('capture-imm-high'), ref('opcode-store'));
signal['begin-call'] = andBit(ref('capture-imm-high'), ref('opcode-call'));
signal['begin-write'] = orBit(ref('begin-store'), ref('begin-call'));
signal['begin-ret'] = andBit(ref('capture-opcode'), ref('fetched-ret'));
signal['finish-ret'] = andBit(ref('phase-ret-high'), ref('bus-read'));
signal['next-phase-0'] = anyBits([andBit(ref('capture-opcode'), orBit(ref('fetched-immediate'), ref('fetched-short'))), ref('begin-write'), ref('begin-ret')]);
signal['next-phase-1'] = anyBits([andBit(ref('capture-imm-low'), notBit(ref('opcode-short'))), ref('begin-write'), ref('phase-ret-low')]);
signal['next-phase-2'] = anyBits([ref('phase-write-low'), ref('begin-ret'), ref('phase-ret-low')]);
signal['next-halted'] = orBit(ref('halted'), andBit(ref('capture-opcode'), orBit(ref('fetched-hlt'), ref('fetched-invalid'))));
signal['next-faulted'] = orBit(ref('faulted'), andBit(ref('capture-opcode'), ref('fetched-invalid')));

signal['address-carry-0'] = lit(1);
signal['stack-carry-0'] = lit(1);
for (let index = 0; index < WIDTH; index++) {
  signal[`store-address-${index}`] = index < 8 ? ref(`immLow-${index}`) : ref(`immHigh-${index - 8}`);
  signal[`store-address-next-${index}`] = xorBit(ref(`store-address-${index}`), ref(`address-carry-${index}`));
  signal[`stack-address-next-${index}`] = xorBit(ref(`sp-${index}`), ref(`stack-carry-${index}`));
  signal[`address-carry-${index + 1}`] = andBit(ref(`store-address-${index}`), ref(`address-carry-${index}`));
  signal[`stack-carry-${index + 1}`] = andBit(ref(`sp-${index}`), ref(`stack-carry-${index}`));
  signal[`bus-address-${index}`] = anyBits([
    andBit(ref('instruction-read'), ref(`ip-${index}`)),
    andBit(ref('phase-write-low'), muxBit(ref('opcode-call'), ref(`store-address-${index}`), ref(`sp-${index}`))),
    andBit(ref('phase-write-high'), muxBit(ref('opcode-call'), ref(`store-address-next-${index}`), ref(`stack-address-next-${index}`))),
    andBit(ref('phase-ret-low'), ref(`sp-${index}`)),
    andBit(ref('phase-ret-high'), ref(`stack-address-next-${index}`)),
  ]);
}
for (let index = 0; index < 8; index++) {
  const storeData = muxBit(ref('phase-write-high'), ref(`ax-${index}`), ref(`ax-${index + 8}`));
  const callData = muxBit(ref('phase-write-high'), ref(`returnIp-${index}`), ref(`returnIp-${index + 8}`));
  signal[`bus-write-data-${index}`] = muxBit(ref('opcode-call'), storeData, callData);
  signal[`next-stackLow-${index}`] = muxBit(ref('phase-ret-low'), ref(`stackLow-${index}`), ref(`busData-${index}`));
}

for (let index = 0; index < WIDTH; index++) {
  signal[`immediate-${index}`] = index < 8 ? ref(`immLow-${index}`) : ref(`busData-${index - 8}`);
}
signal['take-near-branch'] = andBit(ref('capture-imm-high'), orBit(ref('opcode-jmp'), ref('opcode-call')));
signal['execute-short'] = andBit(ref('capture-imm-low'), ref('opcode-short'));
signal['short-condition'] = orBit(andBit(ref('opcode-jz'), ref('zf')), andBit(ref('opcode-jnz'), notBit(ref('zf'))));
signal['take-short-branch'] = andBit(ref('execute-short'), ref('short-condition'));
signal['branch-carry-0'] = lit(0);
signal['short-carry-0'] = lit(0);
for (let index = 0; index < WIDTH; index++) {
  signal[`branch-sum-${index}`] = add(ref(`ip-inc-${index}`), ref(`immediate-${index}`));
  signal[`branch-result-${index}`] = mod(add(ref(`branch-sum-${index}`), ref(`branch-carry-${index}`)), lit(2));
  signal[`branch-carry-${index + 1}`] = floor(div(add(ref(`branch-sum-${index}`), ref(`branch-carry-${index}`)), lit(2)));
  signal[`short-displacement-${index}`] = index < 8 ? ref(`busData-${index}`) : ref('busData-7');
  signal[`short-sum-${index}`] = add(ref(`ip-inc-${index}`), ref(`short-displacement-${index}`));
  signal[`short-result-${index}`] = mod(add(ref(`short-sum-${index}`), ref(`short-carry-${index}`)), lit(2));
  signal[`short-carry-${index + 1}`] = floor(div(add(ref(`short-sum-${index}`), ref(`short-carry-${index}`)), lit(2)));
  signal[`ret-target-${index}`] = index < 8 ? ref(`stackLow-${index}`) : ref(`busData-${index - 8}`);
  signal[`near-ip-${index}`] = muxBit(ref('take-near-branch'), ref(`ip-base-${index}`), ref(`branch-result-${index}`));
  signal[`branch-ip-${index}`] = muxBit(ref('take-short-branch'), ref(`near-ip-${index}`), ref(`short-result-${index}`));
  signal[`next-ip-${index}`] = muxBit(ref('finish-ret'), ref(`branch-ip-${index}`), ref(`ret-target-${index}`));
  signal[`next-returnIp-${index}`] = muxBit(ref('begin-call'), ref(`returnIp-${index}`), ref(`ip-inc-${index}`));
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
    andBit(ref('opcode-mov-ax'), ref(`immediate-${index}`)),
    andBit(ref('select-arithmetic'), ref(`alu-arithmetic-${index}`)),
    andBit(ref('opcode-xor'), ref(`alu-xor-${index}`)),
  ]);
}
signal['sp-dec-carry-0'] = lit(0);
signal['sp-inc-carry-0'] = lit(0);
for (let index = 0; index < WIDTH; index++) {
  const decAddend = lit(index === 0 ? 0 : 1);
  const incAddend = lit(index === 1 ? 1 : 0);
  signal[`sp-dec-sum-${index}`] = add(ref(`sp-${index}`), decAddend);
  signal[`sp-dec-${index}`] = mod(add(ref(`sp-dec-sum-${index}`), ref(`sp-dec-carry-${index}`)), lit(2));
  signal[`sp-dec-carry-${index + 1}`] = floor(div(add(ref(`sp-dec-sum-${index}`), ref(`sp-dec-carry-${index}`)), lit(2)));
  signal[`sp-inc-sum-${index}`] = add(ref(`sp-${index}`), incAddend);
  signal[`sp-inc-${index}`] = mod(add(ref(`sp-inc-sum-${index}`), ref(`sp-inc-carry-${index}`)), lit(2));
  signal[`sp-inc-carry-${index + 1}`] = floor(div(add(ref(`sp-inc-sum-${index}`), ref(`sp-inc-carry-${index}`)), lit(2)));
}
signal['update-ax'] = andBit(ref('execute'), anyBits([ref('opcode-mov-ax'), ref('opcode-add'), ref('opcode-sub'), ref('opcode-xor')]));
for (const register of registers) {
  signal[`write-${register}`] = register === 'ax' ? ref('update-ax') : andBit(ref('execute'), ref(`opcode-mov-${register}`));
  for (let index = 0; index < WIDTH; index++) {
    const source = register === 'ax' ? ref(`alu-result-${index}`) : ref(`immediate-${index}`);
    signal[`next-${register}-${index}`] = muxBit(ref(`write-${register}`), ref(`${register}-${index}`), source);
  }
}
for (let index = 0; index < WIDTH; index++) {
  const movSp = muxBit(ref('write-sp'), ref(`sp-${index}`), ref(`immediate-${index}`));
  const calledSp = muxBit(ref('begin-call'), movSp, ref(`sp-dec-${index}`));
  signal[`next-sp-${index}`] = muxBit(ref('finish-ret'), calledSp, ref(`sp-inc-${index}`));
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
    ip: { width: 16 },
    ...Object.fromEntries(registers.map((register) => [register, { width: 16 }])),
    ir: { width: 8 }, immLow: { width: 8 }, immHigh: { width: 8 }, stackLow: { width: 8 }, returnIp: { width: 16 }, phase: { width: 3 },
    halted: { width: 1 }, faulted: { width: 1 },
    cf: { width: 1 }, pf: { width: 1 }, af: { width: 1 }, zf: { width: 1 }, sf: { width: 1 }, of: { width: 1 },
  },
  signals: signal,
  latches: {
    ip: bits('next-ip', 16),
    ...Object.fromEntries(registers.map((register) => [register, bits(`next-${register}`, 16)])),
    ir: bits('next-ir', 8), immLow: bits('next-immLow', 8), immHigh: bits('next-immHigh', 8), stackLow: bits('next-stackLow', 8), returnIp: bits('next-returnIp', 16), phase: bits('next-phase', 3),
    halted: ['next-halted'], faulted: ['next-faulted'],
    cf: ['next-cf'], pf: ['next-pf'], af: ['next-af'], zf: ['next-zf'], sf: ['next-sf'], of: ['next-of'],
  },
  outputs: { busAddress: bits('bus-address', 16), busRead: ['bus-read'], busWrite: ['bus-write'], busWriteData: bits('bus-write-data', 8) },
  aliases: Object.fromEntries([
    ...['al', 'cl', 'dl', 'bl'].map((name, index) => [name, bits(registers[index], 8)]),
    ...['ah', 'ch', 'dh', 'bh'].map((name, index) => [name, bits(registers[index], 16).slice(8)]),
  ]),
  byteBus: { addressOutput: 'busAddress', readOutput: 'busRead', writeOutput: 'busWrite', writeDataOutput: 'busWriteData', dataInput: 'busData' },
};
