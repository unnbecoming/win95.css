import { add, div, floor, lit, min, mod, ref, sub } from './ir.mjs';
import { allBits, andBit, anyBits, equalConstant, notBit, orBit, muxBit, xorBit } from './bits.mjs';

const WIDTH = 16;
const bits = (prefix, width) => Array.from({ length: width }, (_, index) => `${prefix}-${index}`);
const signalBits = (prefix, width) => bits(prefix, width).map(ref);
const signal = {};
const equalBusField = (offset, constant) => allBits(Array.from({ length: 3 }, (_, index) => {
  const bit = ref(`busData-${offset + index}`);
  return ((constant >>> index) & 1) === 1 ? bit : notBit(bit);
}));
const equalStateField = (name, offset, width, constant) => allBits(Array.from({ length: width }, (_, index) => {
  const bit = ref(`${name}-${offset + index}`);
  return ((constant >>> index) & 1) === 1 ? bit : notBit(bit);
}));
const registers = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
const segments = ['cs', 'ds', 'ss', 'es'];
const opcodes = { add: 0x05, xor: 0x35, xorRmReg: 0x31, xorRegRm: 0x33, sub: 0x2d, movRmReg: 0x89, movRegRm: 0x8b, movSreg: 0x8e, store: 0xa3, jz: 0x74, jnz: 0x75, call: 0xe8, jmpShort: 0xeb, jmp: 0xe9, far: 0xea, ret: 0xc3, cli: 0xfa, sti: 0xfb, hlt: 0xf4 };

signal['phase-opcode'] = equalConstant('phase', 4, 0);
signal['phase-imm-low'] = equalConstant('phase', 4, 1);
signal['phase-imm-high'] = equalConstant('phase', 4, 2);
signal['phase-write-low'] = equalConstant('phase', 4, 3);
signal['phase-write-high'] = equalConstant('phase', 4, 4);
signal['phase-ret-low'] = equalConstant('phase', 4, 5);
signal['phase-ret-high'] = equalConstant('phase', 4, 6);
signal['phase-far-low'] = equalConstant('phase', 4, 7);
signal['phase-far-high'] = equalConstant('phase', 4, 8);
signal['phase-modrm'] = equalConstant('phase', 4, 9);
signal['phase-disp-low'] = equalConstant('phase', 4, 10);
signal['phase-disp-high'] = equalConstant('phase', 4, 11);
signal['phase-memory-read-low'] = equalConstant('phase', 4, 12);
signal['phase-memory-read-high'] = equalConstant('phase', 4, 13);
signal['phase-memory-write-low'] = equalConstant('phase', 4, 14);
signal['phase-memory-write-high'] = equalConstant('phase', 4, 15);
signal['instruction-read'] = anyBits([ref('phase-opcode'), ref('phase-imm-low'), ref('phase-imm-high'), ref('phase-far-low'), ref('phase-far-high'), ref('phase-modrm'), ref('phase-disp-low'), ref('phase-disp-high')]);
signal['stack-read'] = orBit(ref('phase-ret-low'), ref('phase-ret-high'));
signal['memory-read'] = orBit(ref('phase-memory-read-low'), ref('phase-memory-read-high'));
signal['memory-write'] = orBit(ref('phase-memory-write-low'), ref('phase-memory-write-high'));
signal['read-phase'] = anyBits([ref('instruction-read'), ref('stack-read'), ref('memory-read')]);
signal['write-phase'] = anyBits([ref('phase-write-low'), ref('phase-write-high'), ref('memory-write')]);
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
signal['fetched-immediate'] = anyBits(['mov', 'add', 'sub', 'xor', 'store', 'call', 'jmp', 'far'].map((name) => ref(`fetched-${name}`)));
signal['fetched-short'] = anyBits([ref('fetched-jz'), ref('fetched-jnz'), ref('fetched-jmpShort')]);
signal['opcode-short'] = anyBits([ref('opcode-jz'), ref('opcode-jnz'), ref('opcode-jmpShort')]);
signal['fetched-modrm'] = anyBits([ref('fetched-movRmReg'), ref('fetched-movRegRm'), ref('fetched-xorRmReg'), ref('fetched-xorRegRm'), ref('fetched-movSreg')]);
signal['opcode-modrm'] = anyBits([ref('opcode-movRmReg'), ref('opcode-movRegRm'), ref('opcode-xorRmReg'), ref('opcode-xorRegRm'), ref('opcode-movSreg')]);
signal['opcode-modrm-to-reg'] = orBit(ref('opcode-movRegRm'), ref('opcode-xorRegRm'));
signal['opcode-modrm-xor'] = orBit(ref('opcode-xorRmReg'), ref('opcode-xorRegRm'));
signal['fetched-simple'] = orBit(ref('fetched-cli'), ref('fetched-sti'));
signal['fetched-supported'] = anyBits([ref('fetched-immediate'), ref('fetched-short'), ref('fetched-modrm'), ref('fetched-simple'), ref('fetched-ret'), ref('fetched-hlt')]);
signal['fetched-invalid'] = notBit(ref('fetched-supported'));
signal['capture-opcode'] = andBit(ref('phase-opcode'), ref('bus-read'));
signal['capture-imm-low'] = andBit(ref('phase-imm-low'), ref('bus-read'));
signal['capture-imm-high'] = andBit(ref('phase-imm-high'), ref('bus-read'));
signal['capture-far-low'] = andBit(ref('phase-far-low'), ref('bus-read'));
signal['capture-far-high'] = andBit(ref('phase-far-high'), ref('bus-read'));
signal['capture-modrm'] = andBit(ref('phase-modrm'), ref('bus-read'));
signal['capture-disp-low'] = andBit(ref('phase-disp-low'), ref('bus-read'));
signal['capture-disp-high'] = andBit(ref('phase-disp-high'), ref('bus-read'));
signal['capture-memory-low'] = andBit(ref('phase-memory-read-low'), ref('bus-read'));
signal['capture-memory-high'] = andBit(ref('phase-memory-read-high'), ref('bus-read'));
signal['modrm-mod00'] = andBit(notBit(ref('busData-7')), notBit(ref('busData-6')));
signal['modrm-mod01'] = andBit(notBit(ref('busData-7')), ref('busData-6'));
signal['modrm-mod10'] = andBit(ref('busData-7'), notBit(ref('busData-6')));
signal['modrm-register'] = andBit(ref('busData-7'), ref('busData-6'));
signal['modrm-direct'] = andBit(ref('modrm-mod00'), equalBusField(0, 6));
signal['modrm-needs-disp8'] = ref('modrm-mod01');
signal['modrm-needs-disp16'] = orBit(ref('modrm-mod10'), ref('modrm-direct'));
signal['modrm-needs-displacement'] = orBit(ref('modrm-needs-disp8'), ref('modrm-needs-disp16'));
signal['mov-sreg-es'] = equalBusField(3, 0);
signal['mov-sreg-ss'] = equalBusField(3, 2);
signal['mov-sreg-ds'] = equalBusField(3, 3);
signal['mov-sreg-selector-valid'] = anyBits([ref('mov-sreg-es'), ref('mov-sreg-ss'), ref('mov-sreg-ds')]);
signal['opcode-memory-supported'] = anyBits([ref('opcode-movRmReg'), ref('opcode-movRegRm'), ref('opcode-xorRmReg'), ref('opcode-xorRegRm')]);
signal['opcode-memory-to-reg'] = orBit(ref('opcode-movRegRm'), ref('opcode-xorRegRm'));
signal['opcode-memory-needs-read'] = orBit(ref('opcode-memory-to-reg'), ref('opcode-xorRmReg'));
signal['modrm-commit'] = andBit(ref('capture-modrm'), ref('modrm-register'));
signal['modrm-gpr-commit'] = andBit(ref('modrm-commit'), notBit(ref('opcode-movSreg')));
signal['mov-sreg-commit'] = andBit(ref('modrm-commit'), andBit(ref('opcode-movSreg'), ref('mov-sreg-selector-valid')));
signal['modrm-memory-begin'] = andBit(ref('capture-modrm'), andBit(notBit(ref('modrm-register')), ref('opcode-memory-supported')));
signal['modrm-address-invalid'] = andBit(ref('capture-modrm'), andBit(notBit(ref('modrm-register')), notBit(ref('opcode-memory-supported'))));
signal['mov-sreg-selector-invalid'] = andBit(ref('modrm-commit'), andBit(ref('opcode-movSreg'), notBit(ref('mov-sreg-selector-valid'))));
signal['modrm-invalid'] = orBit(ref('modrm-address-invalid'), ref('mov-sreg-selector-invalid'));
signal['execute'] = andBit(ref('capture-imm-high'), notBit(ref('opcode-store')));
signal['update-if'] = andBit(ref('capture-opcode'), ref('fetched-simple'));
signal['next-if'] = muxBit(ref('update-if'), ref('if'), ref('fetched-sti'));

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
  signal[`next-farSegLow-${index}`] = muxBit(ref('capture-far-low'), ref(`farSegLow-${index}`), ref(`busData-${index}`));
  signal[`next-modrm-${index}`] = muxBit(ref('capture-modrm'), ref(`modrm-${index}`), ref(`busData-${index}`));
  signal[`next-dispLow-${index}`] = muxBit(ref('capture-disp-low'), ref(`dispLow-${index}`), ref(`busData-${index}`));
  signal[`next-dispHigh-${index}`] = muxBit(ref('capture-disp-high'), ref(`dispHigh-${index}`), ref(`busData-${index}`));
  signal[`next-memLow-${index}`] = muxBit(ref('capture-memory-low'), ref(`memLow-${index}`), ref(`busData-${index}`));
  signal[`next-memHigh-${index}`] = muxBit(ref('capture-memory-high'), ref(`memHigh-${index}`), ref(`busData-${index}`));
}
signal['begin-immediate'] = andBit(ref('capture-opcode'), orBit(ref('fetched-immediate'), ref('fetched-short')));
signal['continue-immediate'] = andBit(ref('capture-imm-low'), notBit(ref('opcode-short')));
signal['begin-store'] = andBit(ref('capture-imm-high'), ref('opcode-store'));
signal['begin-call'] = andBit(ref('capture-imm-high'), ref('opcode-call'));
signal['begin-write'] = orBit(ref('begin-store'), ref('begin-call'));
signal['begin-ret'] = andBit(ref('capture-opcode'), ref('fetched-ret'));
signal['finish-ret'] = andBit(ref('phase-ret-high'), ref('bus-read'));
signal['begin-far'] = andBit(ref('capture-imm-high'), ref('opcode-far'));
signal['finish-far'] = ref('capture-far-high');
signal['begin-modrm'] = andBit(ref('capture-opcode'), ref('fetched-modrm'));
signal['memory-begin-displacement'] = andBit(ref('modrm-memory-begin'), ref('modrm-needs-displacement'));
signal['memory-ready-after-modrm'] = andBit(ref('modrm-memory-begin'), notBit(ref('modrm-needs-displacement')));
signal['saved-modrm-wide-displacement'] = orBit(ref('saved-modrm-mod10'), ref('saved-modrm-direct'));
signal['memory-ready-after-displacement'] = orBit(andBit(ref('capture-disp-low'), ref('saved-modrm-mod01')), ref('capture-disp-high'));
signal['memory-start-read'] = andBit(orBit(ref('memory-ready-after-modrm'), ref('memory-ready-after-displacement')), ref('opcode-memory-needs-read'));
signal['memory-start-write'] = andBit(orBit(ref('memory-ready-after-modrm'), ref('memory-ready-after-displacement')), ref('opcode-movRmReg'));
signal['memory-rmw-start-write'] = andBit(ref('capture-memory-high'), ref('opcode-xorRmReg'));
const phaseRoutes = [
  [1, ref('begin-immediate')], [2, ref('continue-immediate')], [3, ref('begin-write')], [4, ref('phase-write-low')],
  [5, ref('begin-ret')], [6, ref('phase-ret-low')], [7, ref('begin-far')], [8, ref('phase-far-low')], [9, ref('begin-modrm')],
  [10, ref('memory-begin-displacement')], [11, andBit(ref('capture-disp-low'), ref('saved-modrm-wide-displacement'))],
  [12, ref('memory-start-read')], [13, ref('capture-memory-low')],
  [14, orBit(ref('memory-start-write'), ref('memory-rmw-start-write'))], [15, ref('phase-memory-write-low')],
];
for (let bit = 0; bit < 4; bit++) {
  signal[`next-phase-${bit}`] = anyBits(phaseRoutes.filter(([phase]) => ((phase >>> bit) & 1) === 1).map(([, condition]) => condition));
}
signal['next-halted'] = anyBits([ref('halted'), andBit(ref('capture-opcode'), orBit(ref('fetched-hlt'), ref('fetched-invalid'))), ref('modrm-invalid')]);
signal['next-faulted'] = anyBits([ref('faulted'), andBit(ref('capture-opcode'), ref('fetched-invalid')), ref('modrm-invalid')]);

signal['address-carry-0'] = lit(1);
signal['stack-carry-0'] = lit(1);
signal['data-write'] = andBit(ref('write-phase'), ref('opcode-store'));
signal['call-write'] = andBit(ref('write-phase'), ref('opcode-call'));
signal['stack-access'] = orBit(ref('stack-read'), ref('call-write'));
signal['memory-access'] = orBit(ref('memory-read'), ref('memory-write'));
signal['memory-high-byte'] = orBit(ref('phase-memory-read-high'), ref('phase-memory-write-high'));
for (let index = 0; index < WIDTH; index++) {
  signal[`store-address-${index}`] = index < 8 ? ref(`immLow-${index}`) : ref(`immHigh-${index - 8}`);
  signal[`store-address-next-${index}`] = xorBit(ref(`store-address-${index}`), ref(`address-carry-${index}`));
  signal[`stack-address-next-${index}`] = xorBit(ref(`sp-${index}`), ref(`stack-carry-${index}`));
  signal[`address-carry-${index + 1}`] = andBit(ref(`store-address-${index}`), ref(`address-carry-${index}`));
  signal[`stack-carry-${index + 1}`] = andBit(ref(`sp-${index}`), ref(`stack-carry-${index}`));
  signal[`bus-offset-${index}`] = anyBits([
    andBit(ref('instruction-read'), ref(`ip-${index}`)),
    andBit(ref('phase-write-low'), muxBit(ref('opcode-call'), ref(`store-address-${index}`), ref(`sp-${index}`))),
    andBit(ref('phase-write-high'), muxBit(ref('opcode-call'), ref(`store-address-next-${index}`), ref(`stack-address-next-${index}`))),
    andBit(ref('phase-ret-low'), ref(`sp-${index}`)),
    andBit(ref('phase-ret-high'), ref(`stack-address-next-${index}`)),
    andBit(ref('memory-access'), muxBit(ref('memory-high-byte'), ref(`effective-address-${index}`), ref(`effective-address-next-${index}`))),
  ]);
  signal[`bus-segment-${index}`] = anyBits([
    andBit(ref('instruction-read'), ref(`cs-${index}`)),
    andBit(ref('data-write'), ref(`ds-${index}`)),
    andBit(ref('stack-access'), ref(`ss-${index}`)),
    andBit(ref('memory-access'), ref(`memory-segment-${index}`)),
  ]);
}
signal['physical-carry-0'] = lit(0);
for (let index = 0; index < 20; index++) {
  const segmentBit = index >= 4 ? ref(`bus-segment-${index - 4}`) : lit(0);
  const offsetBit = index < WIDTH ? ref(`bus-offset-${index}`) : lit(0);
  signal[`physical-sum-${index}`] = add(segmentBit, offsetBit);
  signal[`bus-address-${index}`] = mod(add(ref(`physical-sum-${index}`), ref(`physical-carry-${index}`)), lit(2));
  signal[`physical-carry-${index + 1}`] = floor(div(add(ref(`physical-sum-${index}`), ref(`physical-carry-${index}`)), lit(2)));
}
for (let index = 0; index < 8; index++) {
  const storeData = muxBit(ref('phase-write-high'), ref(`ax-${index}`), ref(`ax-${index + 8}`));
  const callData = muxBit(ref('phase-write-high'), ref(`returnIp-${index}`), ref(`returnIp-${index + 8}`));
  const legacyWriteData = muxBit(ref('opcode-call'), storeData, callData);
  const memoryWriteWord = muxBit(ref('opcode-xorRmReg'), ref(`memory-register-value-${index}`), ref(`memory-rmw-result-${index}`));
  const memoryWriteHighWord = muxBit(ref('opcode-xorRmReg'), ref(`memory-register-value-${index + 8}`), ref(`memory-rmw-result-${index + 8}`));
  const memoryWriteData = muxBit(ref('phase-memory-write-high'), memoryWriteWord, memoryWriteHighWord);
  signal[`bus-write-data-${index}`] = muxBit(ref('memory-write'), legacyWriteData, memoryWriteData);
  signal[`next-stackLow-${index}`] = muxBit(ref('phase-ret-low'), ref(`stackLow-${index}`), ref(`busData-${index}`));
}

for (let index = 0; index < WIDTH; index++) {
  signal[`immediate-${index}`] = index < 8 ? ref(`immLow-${index}`) : ref(`busData-${index - 8}`);
}
signal['take-near-branch'] = andBit(ref('capture-imm-high'), orBit(ref('opcode-jmp'), ref('opcode-call')));
signal['execute-short'] = andBit(ref('capture-imm-low'), ref('opcode-short'));
signal['short-condition'] = anyBits([ref('opcode-jmpShort'), andBit(ref('opcode-jz'), ref('zf')), andBit(ref('opcode-jnz'), notBit(ref('zf')))]);
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
  signal[`return-ip-${index}`] = muxBit(ref('finish-ret'), ref(`branch-ip-${index}`), ref(`ret-target-${index}`));
  signal[`far-offset-${index}`] = index < 8 ? ref(`immLow-${index}`) : ref(`immHigh-${index - 8}`);
  signal[`next-ip-${index}`] = muxBit(ref('finish-far'), ref(`return-ip-${index}`), ref(`far-offset-${index}`));
  signal[`next-returnIp-${index}`] = muxBit(ref('begin-call'), ref(`returnIp-${index}`), ref(`ip-inc-${index}`));
  signal[`far-segment-${index}`] = index < 8 ? ref(`farSegLow-${index}`) : ref(`busData-${index - 8}`);
  signal[`next-cs-${index}`] = muxBit(ref('finish-far'), ref(`cs-${index}`), ref(`far-segment-${index}`));
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
for (const [registerIndex, register] of registers.entries()) {
  signal[`modrm-reg-${register}`] = equalBusField(3, registerIndex);
  signal[`modrm-rm-${register}`] = equalBusField(0, registerIndex);
  signal[`saved-modrm-reg-${register}`] = equalStateField('modrm', 3, 3, registerIndex);
}
const eaForms = ['bx-si', 'bx-di', 'bp-si', 'bp-di', 'si', 'di', 'bp-or-direct', 'bx'];
for (const [rmIndex, form] of eaForms.entries()) signal[`saved-modrm-rm-${form}`] = equalStateField('modrm', 0, 3, rmIndex);
signal['saved-modrm-mod00'] = equalStateField('modrm', 6, 2, 0);
signal['saved-modrm-mod01'] = equalStateField('modrm', 6, 2, 1);
signal['saved-modrm-mod10'] = equalStateField('modrm', 6, 2, 2);
signal['saved-modrm-direct'] = andBit(ref('saved-modrm-mod00'), ref('saved-modrm-rm-bp-or-direct'));
signal['saved-modrm-bp-based'] = anyBits([
  ref('saved-modrm-rm-bp-si'), ref('saved-modrm-rm-bp-di'),
  andBit(ref('saved-modrm-rm-bp-or-direct'), notBit(ref('saved-modrm-direct'))),
]);
signal['effective-address-carry-0'] = lit(0);
signal['effective-address-next-carry-0'] = lit(1);
for (let index = 0; index < WIDTH; index++) {
  signal[`effective-base-a-${index}`] = anyBits([
    andBit(anyBits([ref('saved-modrm-rm-bx-si'), ref('saved-modrm-rm-bx-di'), ref('saved-modrm-rm-bx')]), ref(`bx-${index}`)),
    andBit(anyBits([ref('saved-modrm-rm-bp-si'), ref('saved-modrm-rm-bp-di'), andBit(ref('saved-modrm-rm-bp-or-direct'), notBit(ref('saved-modrm-direct')))]), ref(`bp-${index}`)),
  ]);
  signal[`effective-base-b-${index}`] = anyBits([
    andBit(anyBits([ref('saved-modrm-rm-bx-si'), ref('saved-modrm-rm-bp-si'), ref('saved-modrm-rm-si')]), ref(`si-${index}`)),
    andBit(anyBits([ref('saved-modrm-rm-bx-di'), ref('saved-modrm-rm-bp-di'), ref('saved-modrm-rm-di')]), ref(`di-${index}`)),
  ]);
  const disp8Bit = index < 8 ? ref(`dispLow-${index}`) : ref('dispLow-7');
  const disp16Bit = index < 8 ? ref(`dispLow-${index}`) : ref(`dispHigh-${index - 8}`);
  signal[`effective-displacement-${index}`] = anyBits([
    andBit(ref('saved-modrm-mod01'), disp8Bit),
    andBit(anyBits([ref('saved-modrm-mod10'), ref('saved-modrm-direct')]), disp16Bit),
  ]);
  signal[`effective-address-sum-${index}`] = add(ref(`effective-base-a-${index}`), ref(`effective-base-b-${index}`), ref(`effective-displacement-${index}`));
  signal[`effective-address-${index}`] = mod(add(ref(`effective-address-sum-${index}`), ref(`effective-address-carry-${index}`)), lit(2));
  signal[`effective-address-carry-${index + 1}`] = floor(div(add(ref(`effective-address-sum-${index}`), ref(`effective-address-carry-${index}`)), lit(2)));
  signal[`effective-address-next-${index}`] = xorBit(ref(`effective-address-${index}`), ref(`effective-address-next-carry-${index}`));
  signal[`effective-address-next-carry-${index + 1}`] = andBit(ref(`effective-address-${index}`), ref(`effective-address-next-carry-${index}`));
  signal[`memory-segment-${index}`] = muxBit(ref('saved-modrm-bp-based'), ref(`ds-${index}`), ref(`ss-${index}`));
}
signal['memory-load-commit'] = andBit(ref('capture-memory-high'), ref('opcode-memory-to-reg'));
signal['memory-load-flag-commit'] = andBit(ref('capture-memory-high'), ref('opcode-xorRegRm'));
signal['memory-rmw-flag-commit'] = andBit(andBit(ref('phase-memory-write-high'), ref('bus-write')), ref('opcode-xorRmReg'));
signal['memory-flag-commit'] = orBit(ref('memory-load-flag-commit'), ref('memory-rmw-flag-commit'));
for (let index = 0; index < WIDTH; index++) {
  signal[`modrm-reg-value-${index}`] = anyBits(registers.map((register) => andBit(ref(`modrm-reg-${register}`), ref(`${register}-${index}`))));
  signal[`modrm-rm-value-${index}`] = anyBits(registers.map((register) => andBit(ref(`modrm-rm-${register}`), ref(`${register}-${index}`))));
  signal[`modrm-source-${index}`] = muxBit(ref('opcode-modrm-to-reg'), ref(`modrm-reg-value-${index}`), ref(`modrm-rm-value-${index}`));
  signal[`modrm-destination-${index}`] = muxBit(ref('opcode-modrm-to-reg'), ref(`modrm-rm-value-${index}`), ref(`modrm-reg-value-${index}`));
  signal[`modrm-xor-result-${index}`] = xorBit(ref(`modrm-destination-${index}`), ref(`modrm-source-${index}`));
  signal[`modrm-result-${index}`] = muxBit(ref('opcode-modrm-xor'), ref(`modrm-source-${index}`), ref(`modrm-xor-result-${index}`));
  signal[`memory-register-value-${index}`] = anyBits(registers.map((register) => andBit(ref(`saved-modrm-reg-${register}`), ref(`${register}-${index}`))));
  signal[`memory-live-word-${index}`] = index < 8 ? ref(`memLow-${index}`) : ref(`busData-${index - 8}`);
  signal[`memory-stored-word-${index}`] = index < 8 ? ref(`memLow-${index}`) : ref(`memHigh-${index - 8}`);
  signal[`memory-load-xor-result-${index}`] = xorBit(ref(`memory-live-word-${index}`), ref(`memory-register-value-${index}`));
  signal[`memory-load-result-${index}`] = muxBit(ref('opcode-xorRegRm'), ref(`memory-live-word-${index}`), ref(`memory-load-xor-result-${index}`));
  signal[`memory-rmw-result-${index}`] = xorBit(ref(`memory-stored-word-${index}`), ref(`memory-register-value-${index}`));
  signal[`memory-flag-result-${index}`] = muxBit(ref('opcode-xorRmReg'), ref(`memory-load-xor-result-${index}`), ref(`memory-rmw-result-${index}`));
  for (const segment of ['es', 'ss', 'ds']) {
    signal[`next-${segment}-${index}`] = muxBit(andBit(ref('mov-sreg-commit'), ref(`mov-sreg-${segment}`)), ref(`${segment}-${index}`), ref(`modrm-rm-value-${index}`));
  }
}
signal['update-ax'] = andBit(ref('execute'), anyBits([ref('opcode-mov-ax'), ref('opcode-add'), ref('opcode-sub'), ref('opcode-xor')]));
for (const register of registers) {
  signal[`write-immediate-${register}`] = register === 'ax' ? ref('update-ax') : andBit(ref('execute'), ref(`opcode-mov-${register}`));
  const destinationSelector = muxBit(ref('opcode-modrm-to-reg'), ref(`modrm-rm-${register}`), ref(`modrm-reg-${register}`));
  signal[`write-modrm-${register}`] = andBit(ref('modrm-gpr-commit'), destinationSelector);
  signal[`write-memory-${register}`] = andBit(ref('memory-load-commit'), ref(`saved-modrm-reg-${register}`));
  signal[`write-${register}`] = anyBits([ref(`write-immediate-${register}`), ref(`write-modrm-${register}`), ref(`write-memory-${register}`)]);
  for (let index = 0; index < WIDTH; index++) {
    const immediateSource = register === 'ax' ? ref(`alu-result-${index}`) : ref(`immediate-${index}`);
    const registerSource = muxBit(ref(`write-modrm-${register}`), immediateSource, ref(`modrm-result-${index}`));
    signal[`write-source-${register}-${index}`] = muxBit(ref(`write-memory-${register}`), registerSource, ref(`memory-load-result-${index}`));
    signal[`next-base-${register}-${index}`] = muxBit(ref(`write-${register}`), ref(`${register}-${index}`), ref(`write-source-${register}-${index}`));
    if (register !== 'sp') signal[`next-${register}-${index}`] = ref(`next-base-${register}-${index}`);
  }
}
for (let index = 0; index < WIDTH; index++) {
  const calledSp = muxBit(ref('begin-call'), ref(`next-base-sp-${index}`), ref(`sp-dec-${index}`));
  signal[`next-sp-${index}`] = muxBit(ref('finish-ret'), calledSp, ref(`sp-inc-${index}`));
  const registerFlagResult = muxBit(andBit(ref('modrm-gpr-commit'), ref('opcode-modrm-xor')), ref(`alu-result-${index}`), ref(`modrm-result-${index}`));
  signal[`flag-result-${index}`] = muxBit(ref('memory-flag-commit'), registerFlagResult, ref(`memory-flag-result-${index}`));
}

signal['alu-arithmetic-cf'] = muxBit(ref('opcode-sub'), ref('alu-carry-16'), notBit(ref('alu-carry-16')));
signal['alu-arithmetic-af'] = muxBit(ref('opcode-sub'), ref('alu-carry-4'), notBit(ref('alu-carry-4')));
signal['alu-cf'] = andBit(ref('select-arithmetic'), ref('alu-arithmetic-cf'));
signal['alu-af'] = andBit(ref('select-arithmetic'), ref('alu-arithmetic-af'));
signal['alu-pf'] = sub(lit(1), mod(add(...signalBits('flag-result', 8)), lit(2)));
signal['alu-zf'] = sub(lit(1), min(lit(1), add(...signalBits('flag-result', WIDTH))));
signal['alu-sf'] = ref('flag-result-15');
signal['alu-of'] = andBit(ref('select-arithmetic'), xorBit(ref('alu-carry-15'), ref('alu-carry-16')));
signal['update-flags'] = anyBits([andBit(ref('execute'), anyBits([ref('opcode-add'), ref('opcode-sub'), ref('opcode-xor')])), andBit(ref('modrm-gpr-commit'), ref('opcode-modrm-xor')), ref('memory-flag-commit')]);
for (const flag of ['cf', 'pf', 'af', 'zf', 'sf', 'of']) {
  signal[`next-${flag}`] = muxBit(ref('update-flags'), ref(flag), ref(`alu-${flag}`));
}

export const cpu16 = {
  name: 'css386-real-mode-seed',
  inputs: { busData: { width: 8 } },
  state: {
    ip: { width: 16, initial: 0xfff0 },
    ...Object.fromEntries(registers.map((register) => [register, { width: 16 }])),
    cs: { width: 16, initial: 0xf000 }, ds: { width: 16, initial: 0 }, ss: { width: 16, initial: 0 }, es: { width: 16, initial: 0 },
    ir: { width: 8 }, immLow: { width: 8 }, immHigh: { width: 8 }, farSegLow: { width: 8 }, stackLow: { width: 8 }, modrm: { width: 8 }, dispLow: { width: 8 }, dispHigh: { width: 8 }, memLow: { width: 8 }, memHigh: { width: 8 }, returnIp: { width: 16 }, phase: { width: 4 },
    halted: { width: 1 }, faulted: { width: 1 }, if: { width: 1 },
    cf: { width: 1 }, pf: { width: 1 }, af: { width: 1 }, zf: { width: 1 }, sf: { width: 1 }, of: { width: 1 },
  },
  signals: signal,
  latches: {
    ip: bits('next-ip', 16),
    ...Object.fromEntries(registers.map((register) => [register, bits(`next-${register}`, 16)])),
    cs: bits('next-cs', 16), ds: bits('next-ds', 16), ss: bits('next-ss', 16), es: bits('next-es', 16),
    ir: bits('next-ir', 8), immLow: bits('next-immLow', 8), immHigh: bits('next-immHigh', 8), farSegLow: bits('next-farSegLow', 8), stackLow: bits('next-stackLow', 8), modrm: bits('next-modrm', 8), dispLow: bits('next-dispLow', 8), dispHigh: bits('next-dispHigh', 8), memLow: bits('next-memLow', 8), memHigh: bits('next-memHigh', 8), returnIp: bits('next-returnIp', 16), phase: bits('next-phase', 4),
    halted: ['next-halted'], faulted: ['next-faulted'], if: ['next-if'],
    cf: ['next-cf'], pf: ['next-pf'], af: ['next-af'], zf: ['next-zf'], sf: ['next-sf'], of: ['next-of'],
  },
  outputs: { busAddress: bits('bus-address', 20), busRead: ['bus-read'], busWrite: ['bus-write'], busWriteData: bits('bus-write-data', 8) },
  aliases: Object.fromEntries([
    ...['al', 'cl', 'dl', 'bl'].map((name, index) => [name, bits(registers[index], 8)]),
    ...['ah', 'ch', 'dh', 'bh'].map((name, index) => [name, bits(registers[index], 16).slice(8)]),
  ]),
  byteBus: { addressOutput: 'busAddress', readOutput: 'busRead', writeOutput: 'busWrite', writeDataOutput: 'busWriteData', dataInput: 'busData' },
};
