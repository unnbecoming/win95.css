import { add, div, floor, lit, min, mod, mul, ref, sub } from './ir.mjs';
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
const byteRegisters = [
  { name: 'al', register: 'ax', high: false }, { name: 'cl', register: 'cx', high: false },
  { name: 'dl', register: 'dx', high: false }, { name: 'bl', register: 'bx', high: false },
  { name: 'ah', register: 'ax', high: true }, { name: 'ch', register: 'cx', high: true },
  { name: 'dh', register: 'dx', high: true }, { name: 'bh', register: 'bx', high: true },
];
const segments = ['cs', 'ds', 'ss', 'es'];
const pushSegments = { es: 0x06, cs: 0x0e, ss: 0x16, ds: 0x1e };
const popSegments = { es: 0x07, ss: 0x17, ds: 0x1f };
const opcodes = { addRm8Reg: 0x00, add: 0x05, addRegRm: 0x03, orRegRm8: 0x0a, orAlImm8: 0x0c, andAlImm8: 0x24, xor: 0x35, csOverride: 0x2e, subRegRm8: 0x2a, subRegRm: 0x2b, xorRmReg: 0x31, xorRegRm8: 0x32, xorRegRm: 0x33, sub: 0x2d, cmpAlImm8: 0x3c, cmpAxImm16: 0x3d, cmpRm8Reg: 0x38, cmpRegRm8: 0x3a, groupRm8Imm: 0x80, groupRm16Imm: 0x81, groupRm16Imm8: 0x83, testRm8Reg: 0x84, jb: 0x72, jbe: 0x76, xchgRm8Reg: 0x86, xchgRmReg: 0x87, movRm8Reg: 0x88, movRegRm8: 0x8a, movRmReg: 0x89, movRegRm: 0x8b, lea: 0x8d, movSreg: 0x8e, movAlMoffs8: 0xa0, store: 0xa3, movsb: 0xa4, lodsb: 0xac, lodsw: 0xad, lds: 0xc5, movRm8Imm: 0xc6, rolRm8Imm: 0xc0, shlRm8One: 0xd0, shlRm16One: 0xd1, lock: 0xf0, rep: 0xf3, jz: 0x74, jnz: 0x75, jl: 0x7c, retfImm: 0xca, intImm: 0xcd, iret: 0xcf, loop: 0xe2, jcxz: 0xe3, call: 0xe8, testRm8Imm: 0xf6, incDecRm8: 0xfe, callRm16: 0xff, inDxAl: 0xec, outDxAl: 0xee, jmpShort: 0xeb, jmp: 0xe9, far: 0xea, ret: 0xc3, cbw: 0x98, pushf: 0x9c, popf: 0x9d, cmc: 0xf5, clc: 0xf8, stc: 0xf9, cli: 0xfa, sti: 0xfb, cld: 0xfc, hlt: 0xf4 };

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
signal['opcode-mov-rm8'] = orBit(ref('opcode-movRm8Reg'), ref('opcode-movRm8Imm'));
signal['mov-rm8-immediate-read'] = andBit(ref('opcode-movRm8Imm'), ref('phase-memory-read-low'));
signal['test-rm8-immediate-read'] = andBit(ref('opcode-test-rm8-immediate'), ref('phase-memory-read-low'));
signal['group-rm8-immediate-read'] = andBit(ref('opcode-group-rm8-immediate-memory'), ref('phase-memory-read-low'));
signal['byte-immediate-memory-op'] = orBit(ref('opcode-test-rm8-immediate'), ref('opcode-group-rm8-immediate-memory'));
signal['int-vector-read'] = andBit(ref('opcode-intImm'), anyBits([ref('phase-modrm'), ref('phase-disp-low'), ref('phase-disp-high'), ref('phase-memory-read-low')]));
signal['int-stack-write'] = andBit(ref('opcode-intImm'), anyBits([ref('phase-write-low'), ref('phase-write-high'), ref('phase-ret-low'), ref('phase-ret-high'), ref('phase-far-low'), ref('phase-far-high')]));
signal['instruction-read'] = anyBits([
  ref('phase-opcode'), andBit(ref('phase-imm-low'), notBit(anyBits([ref('opcode-inDxAl'), ref('opcode-outDxAl')]))), ref('phase-imm-high'), ref('mov-rm8-immediate-read'), ref('test-rm8-immediate-read'), ref('group-rm8-immediate-read'),
  andBit(notBit(ref('opcode-intImm')), anyBits([
    andBit(notBit(anyBits([ref('opcode-retfImm'), ref('opcode-iret')])), orBit(ref('phase-far-low'), ref('phase-far-high'))),
    ref('phase-modrm'), ref('phase-disp-low'), ref('phase-disp-high'),
  ])),
]);
signal['stack-read'] = andBit(notBit(ref('opcode-intImm')), anyBits([
  ref('phase-ret-low'), ref('phase-ret-high'),
  andBit(anyBits([ref('opcode-retfImm'), ref('opcode-iret')]), orBit(ref('phase-far-low'), ref('phase-far-high'))),
  andBit(ref('opcode-iret'), orBit(ref('phase-memory-read-low'), ref('phase-memory-read-high'))),
]));
signal['memory-read'] = andBit(andBit(andBit(notBit(ref('opcode-movRm8Imm')), notBit(ref('opcode-intImm'))), notBit(ref('opcode-iret'))), anyBits([
  andBit(notBit(ref('byte-immediate-memory-op')), orBit(ref('phase-memory-read-low'), ref('phase-memory-read-high'))),
  andBit(ref('byte-immediate-memory-op'), ref('phase-memory-read-high')),
]));
signal['memory-final-pair'] = orBit(ref('phase-memory-write-low'), ref('phase-memory-write-high'));
signal['lds-extra-read'] = andBit(ref('opcode-lds'), ref('memory-final-pair'));
signal['movsb-read'] = andBit(ref('opcode-movsb'), ref('phase-memory-write-low'));
signal['movsb-write'] = andBit(ref('opcode-movsb'), ref('phase-memory-write-high'));
signal['lodsb-read'] = andBit(ref('opcode-lodsb'), ref('phase-memory-write-low'));
signal['lodsw-read-low'] = andBit(ref('opcode-lodsw'), ref('phase-memory-write-low'));
signal['lodsw-read-high'] = andBit(ref('opcode-lodsw'), ref('phase-memory-write-high'));
signal['lodsw-read'] = orBit(ref('lodsw-read-low'), ref('lodsw-read-high'));
signal['opcode-byte-memory-write'] = anyBits([ref('opcode-mov-rm8'), ref('opcode-addRm8Reg'), ref('opcode-group-rm8-immediate-memory')]);
signal['word-memory-write'] = andBit(andBit(andBit(andBit(andBit(notBit(ref('opcode-lds')), notBit(ref('opcode-movsb'))), notBit(ref('opcode-lodsb'))), notBit(ref('opcode-lodsw'))), notBit(ref('opcode-byte-memory-write'))), ref('memory-final-pair'));
signal['byte-memory-write'] = andBit(ref('opcode-byte-memory-write'), ref('phase-memory-write-low'));
signal['memory-write'] = orBit(ref('word-memory-write'), ref('byte-memory-write'));
signal['read-phase'] = anyBits([ref('instruction-read'), ref('stack-read'), ref('memory-read'), ref('lds-extra-read'), ref('movsb-read'), ref('lodsb-read'), ref('lodsw-read'), ref('int-vector-read')]);
signal['write-phase'] = anyBits([ref('phase-write-low'), ref('phase-write-high'), ref('memory-write'), ref('movsb-write'), ref('int-stack-write')]);
signal['bus-read'] = andBit(notBit(ref('halted')), ref('read-phase'));
signal['bus-write'] = andBit(notBit(ref('halted')), ref('write-phase'));
signal['io-read'] = andBit(notBit(ref('halted')), andBit(ref('phase-imm-low'), ref('opcode-inDxAl')));
signal['io-write'] = andBit(notBit(ref('halted')), andBit(ref('phase-imm-low'), ref('opcode-outDxAl')));
signal['fdc-dor-port'] = equalConstant('dx', 16, 0x03f2);
signal['fdc-dor-write'] = andBit(ref('io-write'), ref('fdc-dor-port'));
signal['fdc-reset-assert'] = andBit(ref('fdc-dor-write'), notBit(ref('ax-2')));
signal['fdc-reset-release'] = andBit(ref('fdc-dor-write'), andBit(notBit(ref('fdcDor-2')), ref('ax-2')));
for (let index = 0; index < 8; index++) {
  const implemented = [0, 2, 3, 4, 5].includes(index);
  const source = implemented ? ref(`ax-${index}`) : lit(0);
  signal[`next-fdcDor-${index}`] = muxBit(ref('fdc-dor-write'), ref(`fdcDor-${index}`), source);
}
signal['fdc-interrupt-after-reset'] = muxBit(ref('fdc-reset-assert'), ref('fdcInterrupt'), lit(0));
// The AT adapter only gates the 765 INT pin; reset release starts the controller's post-reset attention event.
signal['next-fdcInterrupt'] = muxBit(ref('fdc-reset-release'), ref('fdc-interrupt-after-reset'), lit(1));
signal['fdc-reset'] = notBit(ref('fdcDor-2'));
signal['irq6-request'] = andBit(ref('fdcInterrupt'), ref('fdcDor-3'));
for (const [name, opcode] of Object.entries(opcodes)) {
  signal[`fetched-${name}`] = equalConstant('busData', 8, opcode);
  signal[`opcode-${name}`] = equalConstant('ir', 8, opcode);
}
for (const [index, register] of registers.entries()) {
  signal[`fetched-mov-${register}`] = equalConstant('busData', 8, 0xb8 + index);
  signal[`opcode-mov-${register}`] = equalConstant('ir', 8, 0xb8 + index);
  signal[`fetched-inc-${register}`] = equalConstant('busData', 8, 0x40 + index);
  signal[`opcode-inc-${register}`] = equalConstant('ir', 8, 0x40 + index);
  signal[`fetched-dec-${register}`] = equalConstant('busData', 8, 0x48 + index);
  signal[`opcode-dec-${register}`] = equalConstant('ir', 8, 0x48 + index);
  signal[`fetched-push-${register}`] = equalConstant('busData', 8, 0x50 + index);
  signal[`opcode-push-${register}`] = equalConstant('ir', 8, 0x50 + index);
  signal[`fetched-pop-${register}`] = equalConstant('busData', 8, 0x58 + index);
  signal[`opcode-pop-${register}`] = equalConstant('ir', 8, 0x58 + index);
}
for (const [index, { name }] of byteRegisters.entries()) {
  signal[`fetched-mov8-${name}`] = equalConstant('busData', 8, 0xb0 + index);
  signal[`opcode-mov8-${name}`] = equalConstant('ir', 8, 0xb0 + index);
}
signal['fetched-mov8'] = anyBits(byteRegisters.map(({ name }) => ref(`fetched-mov8-${name}`)));
signal['opcode-mov8'] = anyBits(byteRegisters.map(({ name }) => ref(`opcode-mov8-${name}`)));
for (const [segment, opcode] of Object.entries(pushSegments)) {
  signal[`fetched-push-${segment}`] = equalConstant('busData', 8, opcode);
  signal[`opcode-push-${segment}`] = equalConstant('ir', 8, opcode);
}
for (const [segment, opcode] of Object.entries(popSegments)) {
  signal[`fetched-pop-${segment}`] = equalConstant('busData', 8, opcode);
  signal[`opcode-pop-${segment}`] = equalConstant('ir', 8, opcode);
}
signal['fetched-mov'] = anyBits(registers.map((register) => ref(`fetched-mov-${register}`)));
signal['opcode-mov'] = anyBits(registers.map((register) => ref(`opcode-mov-${register}`)));
signal['fetched-inc'] = anyBits(registers.map((register) => ref(`fetched-inc-${register}`)));
signal['opcode-inc'] = anyBits(registers.map((register) => ref(`opcode-inc-${register}`)));
signal['fetched-dec'] = anyBits(registers.map((register) => ref(`fetched-dec-${register}`)));
signal['opcode-dec'] = anyBits(registers.map((register) => ref(`opcode-dec-${register}`)));
signal['fetched-push'] = anyBits([...registers, ...Object.keys(pushSegments)].map((name) => ref(`fetched-push-${name}`)).concat(ref('fetched-pushf')));
signal['opcode-push'] = anyBits([...registers, ...Object.keys(pushSegments)].map((name) => ref(`opcode-push-${name}`)).concat(ref('opcode-pushf')));
signal['fetched-pop'] = anyBits([...registers, ...Object.keys(popSegments)].map((name) => ref(`fetched-pop-${name}`)).concat(ref('fetched-popf')));
signal['opcode-pop'] = anyBits([...registers, ...Object.keys(popSegments)].map((name) => ref(`opcode-pop-${name}`)).concat(ref('opcode-popf')));
signal['fetched-immediate'] = anyBits([...['mov', 'add', 'sub', 'cmpAlImm8', 'cmpAxImm16', 'xor', 'andAlImm8', 'orAlImm8', 'movAlMoffs8', 'store', 'call', 'jmp', 'far', 'retfImm'].map((name) => ref(`fetched-${name}`)), ref('fetched-mov8')]);
signal['opcode-al-logical-immediate'] = orBit(ref('opcode-andAlImm8'), ref('opcode-orAlImm8'));
signal['fetched-short'] = anyBits([ref('fetched-jb'), ref('fetched-jz'), ref('fetched-jnz'), ref('fetched-jbe'), ref('fetched-jl'), ref('fetched-jmpShort'), ref('fetched-loop'), ref('fetched-jcxz')]);
signal['opcode-short'] = anyBits([ref('opcode-jb'), ref('opcode-jz'), ref('opcode-jnz'), ref('opcode-jbe'), ref('opcode-jl'), ref('opcode-jmpShort'), ref('opcode-loop'), ref('opcode-jcxz')]);
signal['fetched-modrm'] = anyBits([ref('fetched-addRm8Reg'), ref('fetched-addRegRm'), ref('fetched-subRegRm8'), ref('fetched-subRegRm'), ref('fetched-movRm8Reg'), ref('fetched-movRmReg'), ref('fetched-movRegRm'), ref('fetched-xorRmReg'), ref('fetched-orRegRm8'), ref('fetched-xorRegRm8'), ref('fetched-xorRegRm'), ref('fetched-cmpRm8Reg'), ref('fetched-cmpRegRm8'), ref('fetched-groupRm8Imm'), ref('fetched-groupRm16Imm'), ref('fetched-groupRm16Imm8'), ref('fetched-testRm8Reg'), ref('fetched-xchgRm8Reg'), ref('fetched-xchgRmReg'), ref('fetched-movRegRm8'), ref('fetched-lea'), ref('fetched-movSreg'), ref('fetched-lds'), ref('fetched-movRm8Imm'), ref('fetched-shlRm8One'), ref('fetched-shlRm16One'), ref('fetched-rolRm8Imm'), ref('fetched-incDecRm8'), ref('fetched-callRm16'), ref('fetched-testRm8Imm')]);
signal['opcode-modrm'] = anyBits([ref('opcode-lea'), ref('opcode-addRm8Reg'), ref('opcode-addRegRm'), ref('opcode-subRegRm8'), ref('opcode-subRegRm'), ref('opcode-movRm8Reg'), ref('opcode-movRmReg'), ref('opcode-movRegRm'), ref('opcode-xorRmReg'), ref('opcode-orRegRm8'), ref('opcode-xorRegRm8'), ref('opcode-xorRegRm'), ref('opcode-cmpRm8Reg'), ref('opcode-cmpRegRm8'), ref('opcode-groupRm8Imm'), ref('opcode-groupRm16Imm'), ref('opcode-groupRm16Imm8'), ref('opcode-testRm8Reg'), ref('opcode-xchgRm8Reg'), ref('opcode-xchgRmReg'), ref('opcode-movRegRm8'), ref('opcode-movSreg'), ref('opcode-lds'), ref('opcode-movRm8Imm'), ref('opcode-shlRm8One'), ref('opcode-shlRm16One'), ref('opcode-rolRm8Imm'), ref('opcode-incDecRm8'), ref('opcode-callRm16'), ref('opcode-testRm8Imm')]);
signal['opcode-modrm-to-reg'] = anyBits([ref('opcode-addRegRm'), ref('opcode-subRegRm'), ref('opcode-movRegRm'), ref('opcode-xorRegRm')]);
signal['opcode-modrm-xor'] = orBit(ref('opcode-xorRmReg'), ref('opcode-xorRegRm'));
signal['fetched-if-control'] = orBit(ref('fetched-cli'), ref('fetched-sti'));
signal['fetched-simple'] = anyBits([ref('fetched-inc'), ref('fetched-dec'), ref('fetched-if-control'), ref('fetched-cbw'), ref('fetched-cmc'), ref('fetched-clc'), ref('fetched-stc'), ref('fetched-cld')]);
signal['fetched-io'] = orBit(ref('fetched-inDxAl'), ref('fetched-outDxAl'));
signal['fetched-prefix'] = anyBits([ref('fetched-lock'), ref('fetched-rep'), ref('fetched-csOverride')]);
signal['fetched-string'] = anyBits([ref('fetched-movsb'), ref('fetched-lodsb'), ref('fetched-lodsw')]);
signal['fetched-supported'] = anyBits([ref('fetched-immediate'), ref('fetched-short'), ref('fetched-intImm'), ref('fetched-modrm'), ref('fetched-simple'), ref('fetched-io'), ref('fetched-prefix'), ref('fetched-string'), ref('fetched-push'), ref('fetched-pop'), ref('fetched-ret'), ref('fetched-iret'), ref('fetched-hlt')]);
signal['rep-target-invalid'] = andBit(ref('rep'), notBit(anyBits([ref('fetched-rep'), ref('fetched-csOverride'), ref('fetched-movsb')])));
signal['cs-override-target-invalid'] = andBit(ref('csOverride'), notBit(anyBits([ref('fetched-prefix'), ref('fetched-modrm'), ref('fetched-lodsb'), ref('fetched-lodsw')])));
signal['fetched-lockable'] = anyBits([ref('fetched-addRm8Reg'), ref('fetched-xorRmReg'), ref('fetched-groupRm8Imm')]);
signal['lock-target-invalid'] = andBit(ref('lock'), notBit(anyBits([ref('fetched-lock'), ref('fetched-csOverride'), ref('fetched-lockable')])));
signal['fetched-invalid'] = anyBits([notBit(ref('fetched-supported')), ref('rep-target-invalid'), ref('cs-override-target-invalid'), ref('lock-target-invalid')]);
signal['capture-opcode'] = andBit(ref('phase-opcode'), ref('bus-read'));
signal['capture-imm-low'] = andBit(ref('phase-imm-low'), ref('bus-read'));
signal['capture-imm-high'] = andBit(ref('phase-imm-high'), ref('bus-read'));
signal['capture-far-low'] = andBit(ref('phase-far-low'), ref('bus-read'));
signal['capture-far-high'] = andBit(ref('phase-far-high'), ref('bus-read'));
signal['capture-stack-high'] = andBit(ref('phase-ret-high'), andBit(ref('opcode-retfImm'), ref('bus-read')));
signal['capture-modrm'] = andBit(andBit(ref('phase-modrm'), notBit(ref('opcode-intImm'))), ref('bus-read'));
signal['capture-disp-low'] = andBit(andBit(ref('phase-disp-low'), notBit(ref('opcode-intImm'))), ref('bus-read'));
signal['capture-disp-high'] = andBit(andBit(ref('phase-disp-high'), notBit(ref('opcode-intImm'))), ref('bus-read'));
signal['capture-memory-low'] = andBit(ref('phase-memory-read-low'), andBit(ref('memory-read'), ref('bus-read')));
signal['capture-memory-high'] = andBit(ref('phase-memory-read-high'), andBit(ref('memory-read'), ref('bus-read')));
signal['capture-mov-rm8-immediate'] = andBit(ref('mov-rm8-immediate-read'), ref('bus-read'));
signal['capture-test-rm8-immediate'] = andBit(ref('test-rm8-immediate-read'), ref('bus-read'));
signal['capture-group-rm8-immediate'] = andBit(ref('group-rm8-immediate-read'), ref('bus-read'));
signal['capture-int-offset-low'] = andBit(ref('phase-modrm'), andBit(ref('opcode-intImm'), ref('bus-read')));
signal['capture-int-offset-high'] = andBit(ref('phase-disp-low'), andBit(ref('opcode-intImm'), ref('bus-read')));
signal['capture-int-segment-low'] = andBit(ref('phase-disp-high'), andBit(ref('opcode-intImm'), ref('bus-read')));
signal['finish-int'] = andBit(ref('phase-memory-read-low'), andBit(ref('opcode-intImm'), ref('bus-read')));
signal['finish-int-flags'] = andBit(ref('phase-write-high'), andBit(ref('opcode-intImm'), ref('bus-write')));
signal['finish-int-cs'] = andBit(ref('phase-ret-high'), andBit(ref('opcode-intImm'), ref('bus-write')));
signal['capture-iret-ip'] = andBit(ref('phase-ret-high'), andBit(ref('opcode-iret'), ref('bus-read')));
signal['capture-iret-cs'] = andBit(ref('phase-far-high'), andBit(ref('opcode-iret'), ref('bus-read')));
signal['capture-iret-flags-low'] = andBit(ref('phase-memory-read-low'), andBit(ref('opcode-iret'), ref('bus-read')));
signal['finish-iret'] = andBit(ref('phase-memory-read-high'), andBit(ref('opcode-iret'), ref('bus-read')));
signal['capture-lds-segment-low'] = andBit(ref('phase-memory-write-low'), andBit(ref('opcode-lds'), ref('bus-read')));
signal['finish-lds'] = andBit(ref('phase-memory-write-high'), andBit(ref('opcode-lds'), ref('bus-read')));
signal['capture-string-byte'] = andBit(orBit(ref('movsb-read'), ref('lodsw-read-low')), ref('bus-read'));
signal['finish-movsb'] = andBit(ref('movsb-write'), ref('bus-write'));
signal['finish-lodsb'] = andBit(ref('lodsb-read'), ref('bus-read'));
signal['finish-lodsw'] = andBit(ref('lodsw-read-high'), ref('bus-read'));
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
signal['mov-rm8-selector-valid'] = equalBusField(3, 0);
signal['sub-rm8-immediate-selector-valid'] = equalBusField(3, 5);
signal['cmp-rm8-immediate-selector-valid'] = equalBusField(3, 7);
signal['test-rm8-immediate-selector-valid'] = equalBusField(3, 0);
signal['mul-rm8-selector-valid'] = equalBusField(3, 4);
signal['f6-rm8-selector-valid'] = orBit(ref('test-rm8-immediate-selector-valid'), ref('mul-rm8-selector-valid'));
signal['saved-test-rm8-immediate-selector-valid'] = equalStateField('modrm', 3, 3, 0);
signal['saved-mul-rm8-selector-valid'] = equalStateField('modrm', 3, 3, 4);
signal['opcode-test-rm8-immediate'] = andBit(ref('opcode-testRm8Imm'), ref('saved-test-rm8-immediate-selector-valid'));
signal['opcode-mul-rm8'] = andBit(ref('opcode-testRm8Imm'), ref('saved-mul-rm8-selector-valid'));
signal['or-rm8-immediate-selector-valid'] = equalBusField(3, 1);
signal['and-rm8-immediate-selector-valid'] = equalBusField(3, 4);
signal['and-rm16-immediate-selector-valid'] = equalBusField(3, 4);
signal['add-rm16-immediate-selector-valid'] = equalBusField(3, 0);
signal['cmp-rm16-immediate-selector-valid'] = equalBusField(3, 7);
signal['group-rm16-immediate8-selector-valid'] = orBit(ref('add-rm16-immediate-selector-valid'), ref('cmp-rm16-immediate-selector-valid'));
signal['saved-add-rm16-immediate-selector-valid'] = equalStateField('modrm', 3, 3, 0);
signal['saved-cmp-rm16-immediate-selector-valid'] = equalStateField('modrm', 3, 3, 7);
signal['group-rm8-immediate-memory-selector-valid'] = orBit(ref('or-rm8-immediate-selector-valid'), ref('and-rm8-immediate-selector-valid'));
signal['group-rm8-immediate-register-selector-valid'] = orBit(ref('sub-rm8-immediate-selector-valid'), ref('cmp-rm8-immediate-selector-valid'));
signal['group-rm8-immediate-selector-valid'] = muxBit(ref('modrm-register'), ref('group-rm8-immediate-memory-selector-valid'), ref('group-rm8-immediate-register-selector-valid'));
signal['saved-or-rm8-immediate-selector-valid'] = equalStateField('modrm', 3, 3, 1);
signal['saved-and-rm8-immediate-selector-valid'] = equalStateField('modrm', 3, 3, 4);
signal['saved-group-rm8-immediate-memory-selector-valid'] = orBit(ref('saved-or-rm8-immediate-selector-valid'), ref('saved-and-rm8-immediate-selector-valid'));
signal['opcode-or-rm8-immediate-memory'] = andBit(ref('opcode-groupRm8Imm'), ref('saved-or-rm8-immediate-selector-valid'));
signal['opcode-and-rm8-immediate-memory'] = andBit(ref('opcode-groupRm8Imm'), ref('saved-and-rm8-immediate-selector-valid'));
signal['opcode-group-rm8-immediate-memory'] = orBit(ref('opcode-or-rm8-immediate-memory'), ref('opcode-and-rm8-immediate-memory'));
signal['saved-sub-rm8-immediate-selector-valid'] = equalStateField('modrm', 3, 3, 5);
signal['saved-cmp-rm8-immediate-selector-valid'] = equalStateField('modrm', 3, 3, 7);
signal['shl-rm8-one-selector-valid'] = equalBusField(3, 4);
signal['shl-rm16-one-selector-valid'] = equalBusField(3, 4);
signal['sar-rm16-one-selector-valid'] = equalBusField(3, 7);
signal['shift-rm16-one-selector-valid'] = orBit(ref('shl-rm16-one-selector-valid'), ref('sar-rm16-one-selector-valid'));
signal['call-rm16-selector-valid'] = equalBusField(3, 2);
signal['jump-rm16-selector-valid'] = equalBusField(3, 4);
signal['ff-rm16-selector-valid'] = orBit(ref('call-rm16-selector-valid'), ref('jump-rm16-selector-valid'));
signal['saved-call-rm16-selector-valid'] = equalStateField('modrm', 3, 3, 2);
signal['saved-jump-rm16-selector-valid'] = equalStateField('modrm', 3, 3, 4);
signal['rol-rm8-immediate-selector-valid'] = equalBusField(3, 0);
signal['inc-rm8-selector-valid'] = equalBusField(3, 0);
signal['dec-rm8-selector-valid'] = equalBusField(3, 1);
signal['inc-dec-rm8-selector-valid'] = orBit(ref('inc-rm8-selector-valid'), ref('dec-rm8-selector-valid'));
signal['opcode-memory-supported'] = anyBits([ref('opcode-lea'), ref('opcode-addRm8Reg'), ref('opcode-addRegRm'), ref('opcode-movRm8Reg'), ref('opcode-movRegRm8'), ref('opcode-movRmReg'), ref('opcode-movRegRm'), ref('opcode-xorRmReg'), ref('opcode-xorRegRm8'), ref('opcode-xorRegRm'), ref('opcode-cmpRm8Reg'), ref('opcode-cmpRegRm8'), ref('opcode-testRm8Reg'), ref('opcode-movSreg'), ref('opcode-lds'), ref('opcode-movRm8Imm'), ref('opcode-callRm16'), ref('opcode-testRm8Imm'), ref('opcode-groupRm8Imm')]);
signal['opcode-memory-to-reg'] = anyBits([ref('opcode-movRegRm'), ref('opcode-xorRegRm'), ref('opcode-addRegRm')]);
signal['opcode-memory-needs-read'] = anyBits([ref('opcode-memory-to-reg'), ref('opcode-addRm8Reg'), ref('opcode-xorRmReg'), ref('opcode-xorRegRm8'), ref('opcode-cmpRm8Reg'), ref('opcode-cmpRegRm8'), ref('opcode-testRm8Reg'), ref('opcode-movRegRm8'), ref('opcode-movSreg'), ref('opcode-lds'), ref('opcode-callRm16')]);
signal['modrm-register-capture'] = andBit(ref('capture-modrm'), ref('modrm-register'));
signal['modrm-commit'] = andBit(ref('modrm-register-capture'), notBit(ref('lock')));
signal['modrm-gpr-commit'] = andBit(ref('modrm-commit'), andBit(andBit(andBit(notBit(ref('opcode-movSreg')), notBit(ref('opcode-lds'))), notBit(ref('opcode-mov-rm8'))), notBit(anyBits([ref('opcode-lea'), ref('opcode-addRm8Reg'), ref('opcode-cmpRm8Reg'), ref('opcode-cmpRegRm8'), ref('opcode-groupRm8Imm'), ref('opcode-groupRm16Imm'), ref('opcode-groupRm16Imm8'), ref('opcode-testRm8Reg'), ref('opcode-movRegRm8'), ref('opcode-orRegRm8'), ref('opcode-xorRegRm8'), ref('opcode-shlRm8One'), ref('opcode-shlRm16One'), ref('opcode-rolRm8Imm'), ref('opcode-incDecRm8'), ref('opcode-callRm16'), ref('opcode-testRm8Imm'), ref('opcode-xchgRm8Reg'), ref('opcode-xchgRmReg'), ref('opcode-subRegRm8')]))));
signal['mov-sreg-commit'] = andBit(ref('modrm-commit'), andBit(ref('opcode-movSreg'), ref('mov-sreg-selector-valid')));
signal['mov-rm8-form-valid'] = orBit(notBit(ref('opcode-movRm8Imm')), ref('mov-rm8-selector-valid'));
signal['test-rm8-form-valid'] = orBit(notBit(ref('opcode-testRm8Imm')), ref('f6-rm8-selector-valid'));
signal['group-rm8-immediate-form-valid'] = orBit(notBit(ref('opcode-groupRm8Imm')), ref('group-rm8-immediate-selector-valid'));
signal['modrm-memory-begin'] = andBit(ref('capture-modrm'), andBit(andBit(andBit(andBit(notBit(ref('modrm-register')), ref('opcode-memory-supported')), ref('mov-rm8-form-valid')), ref('test-rm8-form-valid')), ref('group-rm8-immediate-form-valid')));
signal['modrm-address-invalid'] = andBit(ref('capture-modrm'), andBit(notBit(ref('modrm-register')), notBit(ref('opcode-memory-supported'))));
signal['mov-sreg-selector-invalid'] = andBit(ref('capture-modrm'), andBit(ref('opcode-movSreg'), notBit(ref('mov-sreg-selector-valid'))));
signal['lds-register-invalid'] = andBit(ref('modrm-commit'), ref('opcode-lds'));
signal['lea-register-invalid'] = andBit(ref('modrm-commit'), ref('opcode-lea'));
signal['lock-register-invalid'] = andBit(ref('modrm-register-capture'), ref('lock'));
signal['mov-rm8-selector-invalid'] = andBit(ref('capture-modrm'), andBit(ref('opcode-movRm8Imm'), notBit(ref('mov-rm8-selector-valid'))));
signal['group-rm8-immediate-selector-invalid'] = andBit(ref('capture-modrm'), andBit(ref('opcode-groupRm8Imm'), notBit(ref('group-rm8-immediate-selector-valid'))));
signal['group-rm16-immediate-invalid'] = andBit(ref('capture-modrm'), andBit(ref('opcode-groupRm16Imm'), notBit(andBit(ref('modrm-register'), ref('and-rm16-immediate-selector-valid')))));
signal['group-rm16-immediate8-invalid'] = andBit(ref('capture-modrm'), andBit(ref('opcode-groupRm16Imm8'), notBit(andBit(ref('modrm-register'), ref('group-rm16-immediate8-selector-valid')))));
signal['shl-rm8-one-selector-invalid'] = andBit(ref('capture-modrm'), andBit(ref('opcode-shlRm8One'), notBit(ref('shl-rm8-one-selector-valid'))));
signal['shl-rm16-one-selector-invalid'] = andBit(ref('capture-modrm'), andBit(ref('opcode-shlRm16One'), notBit(ref('shift-rm16-one-selector-valid'))));
signal['call-rm16-selector-invalid'] = andBit(ref('capture-modrm'), andBit(ref('opcode-callRm16'), notBit(ref('ff-rm16-selector-valid'))));
signal['call-rm16-register-invalid'] = andBit(ref('modrm-commit'), andBit(ref('opcode-callRm16'), ref('call-rm16-selector-valid')));
signal['rol-rm8-immediate-selector-invalid'] = andBit(ref('capture-modrm'), andBit(ref('opcode-rolRm8Imm'), notBit(ref('rol-rm8-immediate-selector-valid'))));
signal['inc-dec-rm8-selector-invalid'] = andBit(ref('capture-modrm'), andBit(ref('opcode-incDecRm8'), notBit(ref('inc-dec-rm8-selector-valid'))));
signal['test-rm8-immediate-selector-invalid'] = andBit(ref('capture-modrm'), andBit(ref('opcode-testRm8Imm'), notBit(ref('f6-rm8-selector-valid'))));
signal['test-rm8-immediate-register-invalid'] = andBit(ref('modrm-commit'), andBit(ref('opcode-testRm8Imm'), ref('test-rm8-immediate-selector-valid')));
signal['modrm-invalid'] = anyBits([ref('modrm-address-invalid'), ref('mov-sreg-selector-invalid'), ref('lds-register-invalid'), ref('lea-register-invalid'), ref('lock-register-invalid'), ref('mov-rm8-selector-invalid'), ref('group-rm8-immediate-selector-invalid'), ref('group-rm16-immediate-invalid'), ref('group-rm16-immediate8-invalid'), ref('shl-rm8-one-selector-invalid'), ref('shl-rm16-one-selector-invalid'), ref('call-rm16-selector-invalid'), ref('call-rm16-register-invalid'), ref('rol-rm8-immediate-selector-invalid'), ref('inc-dec-rm8-selector-invalid'), ref('test-rm8-immediate-selector-invalid'), ref('test-rm8-immediate-register-invalid')]);
signal['finish-lea'] = andBit(ref('capture-opcode'), ref('opcode-lea'));
signal['execute'] = andBit(ref('capture-imm-high'), notBit(ref('opcode-store')));
signal['execute-byte-immediate'] = andBit(ref('capture-imm-low'), ref('opcode-mov8'));
signal['execute-al-logical-immediate'] = andBit(ref('capture-imm-low'), ref('opcode-al-logical-immediate'));
signal['execute-cmp-al-immediate'] = andBit(ref('capture-imm-low'), ref('opcode-cmpAlImm8'));
signal['execute-mov-al-moffs8'] = andBit(ref('capture-memory-low'), ref('opcode-movAlMoffs8'));
signal['begin-mov-rm8-register'] = andBit(ref('modrm-commit'), andBit(ref('opcode-movRm8Imm'), ref('mov-rm8-selector-valid')));
signal['begin-sub-rm8-immediate-register'] = andBit(ref('modrm-commit'), andBit(ref('opcode-groupRm8Imm'), ref('sub-rm8-immediate-selector-valid')));
signal['begin-cmp-rm8-immediate-register'] = andBit(ref('modrm-commit'), andBit(ref('opcode-groupRm8Imm'), ref('cmp-rm8-immediate-selector-valid')));
signal['begin-and-rm16-immediate-register'] = andBit(ref('modrm-commit'), andBit(ref('opcode-groupRm16Imm'), ref('and-rm16-immediate-selector-valid')));
signal['execute-and-rm16-immediate-register'] = andBit(ref('capture-imm-high'), ref('opcode-groupRm16Imm'));
signal['begin-group-rm16-immediate8-register'] = andBit(ref('modrm-commit'), andBit(ref('opcode-groupRm16Imm8'), ref('group-rm16-immediate8-selector-valid')));
signal['execute-add-rm16-immediate-register'] = andBit(ref('capture-imm-low'), andBit(ref('opcode-groupRm16Imm8'), ref('saved-add-rm16-immediate-selector-valid')));
signal['execute-cmp-rm16-immediate-register'] = andBit(ref('capture-imm-low'), andBit(ref('opcode-groupRm16Imm8'), ref('saved-cmp-rm16-immediate-selector-valid')));
signal['execute-mov-rm8-register'] = andBit(ref('capture-imm-low'), ref('opcode-movRm8Imm'));
signal['execute-sub-rm8-immediate-register'] = andBit(ref('capture-imm-low'), andBit(ref('opcode-groupRm8Imm'), ref('saved-sub-rm8-immediate-selector-valid')));
signal['execute-cmp-rm8-immediate-register'] = andBit(ref('capture-imm-low'), andBit(ref('opcode-groupRm8Imm'), ref('saved-cmp-rm8-immediate-selector-valid')));
signal['execute-test-rm8-immediate-memory'] = andBit(ref('capture-memory-high'), ref('opcode-test-rm8-immediate'));
signal['execute-mul-rm8-register'] = andBit(ref('modrm-commit'), andBit(ref('opcode-testRm8Imm'), ref('mul-rm8-selector-valid')));
signal['execute-mul-rm8-memory'] = andBit(ref('capture-memory-low'), ref('opcode-mul-rm8'));
signal['execute-mul-rm8'] = orBit(ref('execute-mul-rm8-register'), ref('execute-mul-rm8-memory'));

signal['execute-group-rm8-immediate-memory'] = andBit(ref('capture-memory-high'), ref('opcode-group-rm8-immediate-memory'));
signal['execute-add-rm8-reg-register'] = andBit(ref('modrm-commit'), ref('opcode-addRm8Reg'));
signal['execute-add-rm8-reg-memory'] = andBit(ref('capture-memory-low'), ref('opcode-addRm8Reg'));
signal['execute-add-rm8-reg'] = orBit(ref('execute-add-rm8-reg-register'), ref('execute-add-rm8-reg-memory'));
signal['execute-mov-rm8-reg-register'] = andBit(ref('modrm-commit'), ref('opcode-movRm8Reg'));
signal['execute-mov-reg-rm8-register'] = andBit(ref('modrm-commit'), ref('opcode-movRegRm8'));
signal['execute-or-reg-rm8-register'] = andBit(ref('modrm-commit'), ref('opcode-orRegRm8'));
signal['execute-sub-reg-rm8-register'] = andBit(ref('modrm-commit'), ref('opcode-subRegRm8'));
signal['execute-xor-reg-rm8-register'] = andBit(ref('modrm-commit'), ref('opcode-xorRegRm8'));
signal['execute-xor-reg-rm8-memory'] = andBit(ref('capture-memory-low'), ref('opcode-xorRegRm8'));
signal['execute-xor-reg-rm8'] = orBit(ref('execute-xor-reg-rm8-register'), ref('execute-xor-reg-rm8-memory'));
signal['execute-byte-logical-rm8'] = orBit(ref('execute-or-reg-rm8-register'), ref('execute-xor-reg-rm8'));
signal['execute-shl-rm8-one-register'] = andBit(ref('modrm-commit'), andBit(ref('opcode-shlRm8One'), ref('shl-rm8-one-selector-valid')));
signal['execute-shl-rm16-one-register'] = andBit(ref('modrm-commit'), andBit(ref('opcode-shlRm16One'), ref('shl-rm16-one-selector-valid')));
signal['execute-sar-rm16-one-register'] = andBit(ref('modrm-commit'), andBit(ref('opcode-shlRm16One'), ref('sar-rm16-one-selector-valid')));
signal['execute-shift-rm16-one-register'] = orBit(ref('execute-shl-rm16-one-register'), ref('execute-sar-rm16-one-register'));

signal['execute-inc-rm8-register'] = andBit(ref('modrm-commit'), andBit(ref('opcode-incDecRm8'), ref('inc-rm8-selector-valid')));
signal['execute-dec-rm8-register'] = andBit(ref('modrm-commit'), andBit(ref('opcode-incDecRm8'), ref('dec-rm8-selector-valid')));

signal['begin-rol-rm8-immediate-register'] = andBit(ref('modrm-commit'), andBit(ref('opcode-rolRm8Imm'), ref('rol-rm8-immediate-selector-valid')));
signal['execute-rol-rm8-immediate-register'] = andBit(ref('capture-imm-low'), ref('opcode-rolRm8Imm'));
signal['rol-rm8-count-nonzero'] = andBit(ref('execute-rol-rm8-immediate-register'), anyBits(signalBits('busData', 3)));
signal['rol-rm8-count-one'] = andBit(ref('execute-rol-rm8-immediate-register'), equalBusField(0, 1));
signal['update-if'] = andBit(ref('capture-opcode'), ref('fetched-if-control'));
signal['execute-inc'] = andBit(ref('capture-opcode'), ref('fetched-inc'));
signal['execute-dec'] = andBit(ref('capture-opcode'), ref('fetched-dec'));

signal['execute-cbw'] = andBit(ref('capture-opcode'), ref('fetched-cbw'));

signal['update-cmc'] = andBit(ref('capture-opcode'), ref('fetched-cmc'));
signal['update-clc'] = andBit(ref('capture-opcode'), ref('fetched-clc'));
signal['update-stc'] = andBit(ref('capture-opcode'), ref('fetched-stc'));
signal['update-carry-control'] = anyBits([ref('update-cmc'), ref('update-clc'), ref('update-stc')]);
signal['controlled-if'] = muxBit(ref('update-if'), ref('if'), ref('fetched-sti'));
signal['interrupt-if'] = muxBit(ref('finish-int-flags'), ref('controlled-if'), lit(0));
signal['finish-flags-load'] = orBit(ref('finish-popf'), ref('finish-iret'));
signal['next-if'] = muxBit(ref('finish-flags-load'), ref('interrupt-if'), ref('busData-1'));
signal['interrupt-tf'] = muxBit(ref('finish-int-flags'), ref('tf'), lit(0));
signal['next-tf'] = muxBit(ref('finish-flags-load'), ref('interrupt-tf'), ref('busData-0'));
signal['next-nt'] = muxBit(ref('finish-flags-load'), ref('nt'), ref('busData-6'));
for (let index = 0; index < 2; index++) signal[`next-iopl-${index}`] = muxBit(ref('finish-flags-load'), ref(`iopl-${index}`), ref(`busData-${index + 4}`));
signal['update-df'] = andBit(ref('capture-opcode'), ref('fetched-cld'));
signal['controlled-df'] = muxBit(ref('update-df'), ref('df'), lit(0));
signal['next-df'] = muxBit(ref('finish-flags-load'), ref('controlled-df'), ref('busData-2'));
signal['cx-nonzero'] = anyBits(signalBits('cx', WIDTH));
signal['capture-lock'] = andBit(ref('capture-opcode'), ref('fetched-lock'));
signal['capture-rep'] = andBit(ref('capture-opcode'), ref('fetched-rep'));
signal['capture-cs-override'] = andBit(ref('capture-opcode'), ref('fetched-csOverride'));
signal['clear-cs-override'] = anyBits([
  ref('modrm-commit'),
  andBit(ref('capture-memory-low'), anyBits([ref('opcode-cmpRm8Reg'), ref('opcode-cmpRegRm8'), ref('opcode-testRm8Reg'), ref('opcode-movRegRm8'), ref('opcode-xorRegRm8'), ref('opcode-mul-rm8')])),
  andBit(ref('capture-memory-high'), anyBits([ref('opcode-movRegRm'), ref('opcode-xorRegRm'), ref('opcode-addRegRm'), ref('opcode-movSreg'), ref('opcode-callRm16'), ref('opcode-test-rm8-immediate')])),
  andBit(andBit(ref('phase-memory-write-low'), ref('bus-write')), ref('opcode-byte-memory-write')),
  andBit(andBit(ref('phase-memory-write-high'), ref('bus-write')), notBit(ref('opcode-byte-memory-write'))),
  ref('finish-lds'),
  ref('finish-lea'),
  ref('finish-lodsb'),
  ref('finish-lodsw'),
]);
signal['cs-override-after-clear'] = muxBit(ref('clear-cs-override'), ref('csOverride'), lit(0));
signal['next-csOverride'] = muxBit(ref('capture-cs-override'), ref('cs-override-after-clear'), lit(1));
signal['begin-lodsb'] = andBit(ref('capture-opcode'), ref('fetched-lodsb'));
signal['begin-lodsw'] = andBit(ref('capture-opcode'), ref('fetched-lodsw'));
signal['begin-movsb'] = andBit(andBit(ref('capture-opcode'), ref('fetched-movsb')), orBit(notBit(ref('rep')), ref('cx-nonzero')));
signal['skip-rep-movsb'] = andBit(andBit(ref('capture-opcode'), ref('fetched-movsb')), andBit(ref('rep'), notBit(ref('cx-nonzero'))));
signal['repeat-movsb'] = andBit(andBit(ref('finish-movsb'), ref('rep')), ref('cx-dec-nonzero'));
signal['clear-rep'] = orBit(ref('skip-rep-movsb'), andBit(ref('finish-movsb'), notBit(ref('repeat-movsb'))));
signal['rep-after-clear'] = muxBit(ref('clear-rep'), ref('rep'), lit(0));
signal['next-rep'] = muxBit(ref('capture-rep'), ref('rep-after-clear'), lit(1));
signal['finish-locked-byte-write'] = andBit(andBit(ref('lock'), ref('phase-memory-write-low')), andBit(ref('bus-write'), ref('opcode-byte-memory-write')));
signal['finish-locked-word-write'] = andBit(andBit(ref('lock'), ref('phase-memory-write-high')), ref('bus-write'));
signal['clear-lock'] = anyBits([andBit(ref('capture-opcode'), ref('fetched-invalid')), ref('modrm-invalid'), ref('finish-locked-byte-write'), ref('finish-locked-word-write')]);
signal['lock-after-capture'] = muxBit(ref('capture-lock'), ref('lock'), lit(1));
signal['next-lock'] = muxBit(ref('clear-lock'), ref('lock-after-capture'), lit(0));
signal['bus-lock'] = andBit(ref('lock'), orBit(ref('memory-read'), ref('bus-write')));

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
  signal[`next-stackHigh-${index}`] = muxBit(ref('capture-stack-high'), ref(`stackHigh-${index}`), ref(`busData-${index}`));
  signal[`next-modrm-${index}`] = muxBit(ref('capture-modrm'), ref(`modrm-${index}`), ref(`busData-${index}`));
  signal[`next-dispLow-${index}`] = muxBit(ref('capture-disp-low'), ref(`dispLow-${index}`), ref(`busData-${index}`));
  signal[`next-dispHigh-${index}`] = muxBit(ref('capture-disp-high'), ref(`dispHigh-${index}`), ref(`busData-${index}`));
  signal[`next-memLow-${index}`] = muxBit(ref('capture-memory-low'), ref(`memLow-${index}`), ref(`busData-${index}`));
  signal[`next-memHigh-${index}`] = muxBit(ref('capture-memory-high'), ref(`memHigh-${index}`), ref(`busData-${index}`));
  signal[`next-ldsSegLow-${index}`] = muxBit(ref('capture-lds-segment-low'), ref(`ldsSegLow-${index}`), ref(`busData-${index}`));
  signal[`next-stringByte-${index}`] = muxBit(ref('capture-string-byte'), ref(`stringByte-${index}`), ref(`busData-${index}`));
  signal[`next-byteImmediate-${index}`] = muxBit(anyBits([ref('capture-mov-rm8-immediate'), ref('capture-test-rm8-immediate'), ref('capture-group-rm8-immediate')]), ref(`byteImmediate-${index}`), ref(`busData-${index}`));
  signal[`next-intOffsetLow-${index}`] = muxBit(ref('capture-int-offset-low'), ref(`intOffsetLow-${index}`), ref(`busData-${index}`));
  signal[`next-intOffsetHigh-${index}`] = muxBit(ref('capture-int-offset-high'), ref(`intOffsetHigh-${index}`), ref(`busData-${index}`));
  signal[`next-intSegmentLow-${index}`] = muxBit(ref('capture-int-segment-low'), ref(`intSegmentLow-${index}`), ref(`busData-${index}`));
  signal[`next-iretFlagsLow-${index}`] = muxBit(ref('capture-iret-flags-low'), ref(`iretFlagsLow-${index}`), ref(`busData-${index}`));
}
signal['begin-immediate'] = andBit(ref('capture-opcode'), anyBits([ref('fetched-immediate'), ref('fetched-short'), ref('fetched-intImm')]));
signal['begin-io'] = andBit(ref('capture-opcode'), ref('fetched-io'));
signal['begin-int'] = andBit(ref('capture-imm-low'), ref('opcode-intImm'));
signal['continue-immediate'] = andBit(ref('capture-imm-low'), andBit(notBit(anyBits([ref('opcode-short'), ref('opcode-mov8'), ref('opcode-movRm8Imm'), ref('opcode-groupRm8Imm'), ref('opcode-groupRm16Imm8'), ref('opcode-al-logical-immediate'), ref('opcode-cmpAlImm8'), ref('opcode-rolRm8Imm')])), notBit(ref('opcode-intImm'))));
signal['begin-store'] = andBit(ref('capture-imm-high'), ref('opcode-store'));
signal['begin-mov-al-moffs8'] = andBit(ref('capture-imm-high'), ref('opcode-movAlMoffs8'));
signal['begin-call'] = andBit(ref('capture-imm-high'), ref('opcode-call'));
signal['begin-indirect-call'] = andBit(ref('capture-memory-high'), andBit(ref('opcode-callRm16'), ref('saved-call-rm16-selector-valid')));
signal['execute-indirect-jump-register'] = andBit(ref('modrm-commit'), andBit(ref('opcode-callRm16'), ref('jump-rm16-selector-valid')));
signal['finish-indirect-jump-memory'] = andBit(ref('capture-memory-high'), andBit(ref('opcode-callRm16'), ref('saved-jump-rm16-selector-valid')));
signal['finish-indirect-jump'] = orBit(ref('execute-indirect-jump-register'), ref('finish-indirect-jump-memory'));

signal['begin-push'] = andBit(ref('capture-opcode'), ref('fetched-push'));
signal['begin-write'] = anyBits([ref('begin-store'), ref('begin-call'), ref('begin-indirect-call'), ref('begin-push')]);
signal['begin-ret'] = andBit(ref('capture-opcode'), ref('fetched-ret'));
signal['begin-iret'] = andBit(ref('capture-opcode'), ref('fetched-iret'));
signal['begin-pop'] = andBit(ref('capture-opcode'), ref('fetched-pop'));
signal['begin-retf'] = andBit(ref('capture-imm-high'), ref('opcode-retfImm'));
signal['begin-stack-read'] = orBit(ref('begin-ret'), ref('begin-pop'));
signal['finish-stack-read'] = andBit(ref('phase-ret-high'), ref('bus-read'));
signal['finish-ret'] = andBit(ref('finish-stack-read'), ref('opcode-ret'));
signal['finish-pop'] = andBit(ref('finish-stack-read'), ref('opcode-pop'));
signal['finish-popf'] = andBit(ref('finish-stack-read'), ref('opcode-popf'));
signal['begin-far'] = andBit(ref('capture-imm-high'), ref('opcode-far'));
signal['finish-far-jump'] = andBit(ref('capture-far-high'), ref('opcode-far'));
signal['finish-retf'] = andBit(ref('capture-far-high'), ref('opcode-retfImm'));
signal['finish-far'] = orBit(ref('finish-far-jump'), ref('finish-retf'));
signal['begin-modrm'] = andBit(ref('capture-opcode'), ref('fetched-modrm'));
signal['memory-begin-displacement'] = andBit(ref('modrm-memory-begin'), ref('modrm-needs-displacement'));
signal['memory-ready-after-modrm'] = andBit(ref('modrm-memory-begin'), notBit(ref('modrm-needs-displacement')));
signal['saved-modrm-wide-displacement'] = orBit(ref('saved-modrm-mod10'), ref('saved-modrm-direct'));
signal['memory-ready-after-displacement'] = orBit(andBit(ref('capture-disp-low'), ref('saved-modrm-mod01')), ref('capture-disp-high'));
signal['memory-operand-ready'] = orBit(ref('memory-ready-after-modrm'), ref('memory-ready-after-displacement'));
signal['memory-start-read'] = andBit(ref('memory-operand-ready'), ref('opcode-memory-needs-read'));
signal['memory-start-write'] = andBit(ref('memory-operand-ready'), orBit(ref('opcode-movRmReg'), ref('opcode-movRm8Reg')));
signal['mov-rm8-immediate-start'] = andBit(ref('memory-operand-ready'), ref('opcode-movRm8Imm'));
signal['mov-rm8-write-start'] = ref('capture-mov-rm8-immediate');
signal['test-rm8-immediate-start'] = andBit(ref('opcode-testRm8Imm'), anyBits([
  andBit(ref('memory-ready-after-modrm'), ref('test-rm8-immediate-selector-valid')),
  andBit(ref('memory-ready-after-displacement'), ref('saved-test-rm8-immediate-selector-valid')),
]));
signal['mul-rm8-memory-start'] = andBit(ref('opcode-testRm8Imm'), anyBits([
  andBit(ref('memory-ready-after-modrm'), ref('mul-rm8-selector-valid')),
  andBit(ref('memory-ready-after-displacement'), ref('saved-mul-rm8-selector-valid')),
]));

signal['test-rm8-operand-start'] = ref('capture-test-rm8-immediate');
signal['group-rm8-immediate-start'] = andBit(ref('opcode-groupRm8Imm'), anyBits([
  andBit(ref('memory-ready-after-modrm'), ref('group-rm8-immediate-memory-selector-valid')),
  andBit(ref('memory-ready-after-displacement'), ref('saved-group-rm8-immediate-memory-selector-valid')),
]));
signal['group-rm8-operand-start'] = ref('capture-group-rm8-immediate');
signal['memory-rmw-start-write'] = andBit(ref('capture-memory-high'), ref('opcode-xorRmReg'));
signal['byte-rmw-start-write'] = orBit(andBit(ref('capture-memory-high'), ref('opcode-group-rm8-immediate-memory')), ref('execute-add-rm8-reg-memory'));
signal['lds-continue-read'] = andBit(ref('capture-memory-high'), ref('opcode-lds'));
const phaseRoutes = [
  [1, anyBits([ref('begin-immediate'), ref('begin-io'), ref('begin-mov-rm8-register'), ref('begin-sub-rm8-immediate-register'), ref('begin-cmp-rm8-immediate-register'), ref('begin-and-rm16-immediate-register'), ref('begin-group-rm16-immediate8-register'), ref('begin-rol-rm8-immediate-register')])], [2, ref('continue-immediate')], [3, orBit(ref('begin-write'), ref('begin-int'))], [4, ref('phase-write-low')],
  [5, anyBits([ref('begin-stack-read'), ref('begin-retf'), ref('begin-iret'), andBit(ref('opcode-intImm'), ref('phase-write-high'))])], [6, ref('phase-ret-low')], [7, anyBits([ref('begin-far'), andBit(anyBits([ref('opcode-retfImm'), ref('opcode-iret')]), ref('phase-ret-high')), andBit(ref('opcode-intImm'), ref('phase-ret-high'))])], [8, ref('phase-far-low')], [9, orBit(ref('begin-modrm'), andBit(ref('opcode-intImm'), ref('phase-far-high')))],
  [10, orBit(ref('memory-begin-displacement'), andBit(ref('opcode-intImm'), ref('phase-modrm')))], [11, orBit(andBit(ref('capture-disp-low'), ref('saved-modrm-wide-displacement')), andBit(ref('opcode-intImm'), ref('phase-disp-low')))],
  [12, anyBits([ref('memory-start-read'), ref('mov-rm8-immediate-start'), ref('test-rm8-immediate-start'), ref('mul-rm8-memory-start'), ref('group-rm8-immediate-start'), ref('begin-mov-al-moffs8'), andBit(ref('opcode-intImm'), ref('phase-disp-high')), andBit(ref('opcode-iret'), ref('phase-far-high'))])], [13, anyBits([ref('test-rm8-operand-start'), ref('group-rm8-operand-start'), ref('capture-iret-flags-low'), andBit(ref('capture-memory-low'), notBit(anyBits([ref('opcode-addRm8Reg'), ref('opcode-cmpRm8Reg'), ref('opcode-cmpRegRm8'), ref('opcode-testRm8Reg'), ref('opcode-movRegRm8'), ref('opcode-xorRegRm8'), ref('opcode-movAlMoffs8'), ref('opcode-mul-rm8')])) )])],
  [14, anyBits([ref('memory-start-write'), ref('memory-rmw-start-write'), ref('byte-rmw-start-write'), ref('lds-continue-read'), ref('begin-movsb'), ref('begin-lodsb'), ref('begin-lodsw'), ref('repeat-movsb'), ref('mov-rm8-write-start')])], [15, andBit(ref('phase-memory-write-low'), notBit(anyBits([ref('opcode-byte-memory-write'), ref('opcode-lodsb')])) )],
];
for (let bit = 0; bit < 4; bit++) {
  signal[`next-phase-${bit}`] = anyBits(phaseRoutes.filter(([phase]) => ((phase >>> bit) & 1) === 1).map(([, condition]) => condition));
}
signal['next-halted'] = anyBits([ref('halted'), andBit(ref('capture-opcode'), orBit(ref('fetched-hlt'), ref('fetched-invalid'))), ref('modrm-invalid')]);
signal['next-faulted'] = anyBits([ref('faulted'), andBit(ref('capture-opcode'), ref('fetched-invalid')), ref('modrm-invalid')]);

signal['address-carry-0'] = lit(1);
signal['stack-carry-0'] = lit(1);
signal['stack-plus-three-carry-0'] = lit(0);
signal['iret-stack-carry-0'] = lit(0);
signal['int-vector-carry-0'] = lit(0);
signal['si-inc-carry-0'] = lit(1);
signal['si-dec-borrow-0'] = lit(1);
signal['si-word-inc-carry-0'] = lit(0);
signal['si-word-dec-carry-0'] = lit(0);
signal['di-inc-carry-0'] = lit(1);
signal['di-dec-borrow-0'] = lit(1);
signal['cx-dec-borrow-0'] = lit(1);
signal['data-write'] = andBit(ref('write-phase'), ref('opcode-store'));
signal['stack-write'] = orBit(andBit(ref('write-phase'), anyBits([ref('opcode-call'), ref('opcode-callRm16'), ref('opcode-push')])), ref('int-stack-write'));
signal['stack-access'] = orBit(ref('stack-read'), ref('stack-write'));
signal['memory-access'] = anyBits([ref('memory-read'), ref('memory-write'), ref('lds-extra-read')]);
signal['memory-high-byte'] = orBit(andBit(ref('phase-memory-read-high'), notBit(ref('byte-immediate-memory-op'))), ref('phase-memory-write-high'));
for (let index = 0; index < WIDTH; index++) {
  signal[`store-address-${index}`] = index < 8 ? ref(`immLow-${index}`) : ref(`immHigh-${index - 8}`);
  signal[`store-address-next-${index}`] = xorBit(ref(`store-address-${index}`), ref(`address-carry-${index}`));
  signal[`stack-address-next-${index}`] = xorBit(ref(`sp-${index}`), ref(`stack-carry-${index}`));
  const stackPlusThreeAddend = lit(index < 2 ? 1 : 0);
  signal[`stack-plus-three-sum-${index}`] = add(ref(`sp-${index}`), stackPlusThreeAddend);
  signal[`stack-address-plus-three-${index}`] = mod(add(ref(`stack-plus-three-sum-${index}`), ref(`stack-plus-three-carry-${index}`)), lit(2));
  signal[`address-carry-${index + 1}`] = andBit(ref(`store-address-${index}`), ref(`address-carry-${index}`));
  signal[`stack-carry-${index + 1}`] = andBit(ref(`sp-${index}`), ref(`stack-carry-${index}`));
  signal[`stack-plus-three-carry-${index + 1}`] = floor(div(add(ref(`stack-plus-three-sum-${index}`), ref(`stack-plus-three-carry-${index}`)), lit(2)));
  const iretStackAddend = index === 2 ? lit(1) : index === 0 ? ref('phase-memory-read-high') : lit(0);
  signal[`iret-stack-sum-${index}`] = add(ref(`sp-${index}`), iretStackAddend);
  signal[`iret-stack-address-${index}`] = mod(add(ref(`iret-stack-sum-${index}`), ref(`iret-stack-carry-${index}`)), lit(2));
  signal[`iret-stack-carry-${index + 1}`] = floor(div(add(ref(`iret-stack-sum-${index}`), ref(`iret-stack-carry-${index}`)), lit(2)));
  const intVectorBase = index >= 2 && index < 10 ? ref(`immLow-${index - 2}`) : lit(0);
  const intVectorAddend = index === 0 ? orBit(ref('phase-disp-low'), ref('phase-memory-read-low')) : index === 1 ? orBit(ref('phase-disp-high'), ref('phase-memory-read-low')) : lit(0);
  signal[`int-vector-sum-${index}`] = add(intVectorBase, intVectorAddend);
  signal[`int-vector-address-${index}`] = mod(add(ref(`int-vector-sum-${index}`), ref(`int-vector-carry-${index}`)), lit(2));
  signal[`int-vector-carry-${index + 1}`] = floor(div(add(ref(`int-vector-sum-${index}`), ref(`int-vector-carry-${index}`)), lit(2)));
  signal[`si-inc-${index}`] = xorBit(ref(`si-${index}`), ref(`si-inc-carry-${index}`));
  signal[`si-inc-carry-${index + 1}`] = andBit(ref(`si-${index}`), ref(`si-inc-carry-${index}`));
  signal[`si-dec-${index}`] = xorBit(ref(`si-${index}`), ref(`si-dec-borrow-${index}`));
  signal[`si-dec-borrow-${index + 1}`] = andBit(notBit(ref(`si-${index}`)), ref(`si-dec-borrow-${index}`));
  const siWordIncAddend = lit(index === 1 ? 1 : 0);
  signal[`si-word-inc-sum-${index}`] = add(ref(`si-${index}`), siWordIncAddend);
  signal[`si-word-inc-${index}`] = mod(add(ref(`si-word-inc-sum-${index}`), ref(`si-word-inc-carry-${index}`)), lit(2));
  signal[`si-word-inc-carry-${index + 1}`] = floor(div(add(ref(`si-word-inc-sum-${index}`), ref(`si-word-inc-carry-${index}`)), lit(2)));
  const siWordDecAddend = lit(index === 0 ? 0 : 1);
  signal[`si-word-dec-sum-${index}`] = add(ref(`si-${index}`), siWordDecAddend);
  signal[`si-word-dec-${index}`] = mod(add(ref(`si-word-dec-sum-${index}`), ref(`si-word-dec-carry-${index}`)), lit(2));
  signal[`si-word-dec-carry-${index + 1}`] = floor(div(add(ref(`si-word-dec-sum-${index}`), ref(`si-word-dec-carry-${index}`)), lit(2)));
  signal[`di-inc-${index}`] = xorBit(ref(`di-${index}`), ref(`di-inc-carry-${index}`));
  signal[`di-inc-carry-${index + 1}`] = andBit(ref(`di-${index}`), ref(`di-inc-carry-${index}`));
  signal[`di-dec-${index}`] = xorBit(ref(`di-${index}`), ref(`di-dec-borrow-${index}`));
  signal[`di-dec-borrow-${index + 1}`] = andBit(notBit(ref(`di-${index}`)), ref(`di-dec-borrow-${index}`));
  signal[`cx-dec-${index}`] = xorBit(ref(`cx-${index}`), ref(`cx-dec-borrow-${index}`));
  signal[`cx-dec-borrow-${index + 1}`] = andBit(notBit(ref(`cx-${index}`)), ref(`cx-dec-borrow-${index}`));
  signal[`bus-offset-${index}`] = anyBits([
    andBit(ref('instruction-read'), ref(`ip-${index}`)),
    andBit(ref('phase-write-low'), muxBit(ref('stack-write'), ref(`store-address-${index}`), ref(`sp-${index}`))),
    andBit(ref('phase-write-high'), muxBit(ref('stack-write'), ref(`store-address-next-${index}`), ref(`stack-address-next-${index}`))),
    andBit(ref('phase-ret-low'), ref(`sp-${index}`)),
    andBit(ref('phase-ret-high'), ref(`stack-address-next-${index}`)),
    andBit(andBit(ref('opcode-retfImm'), ref('phase-far-low')), ref(`sp-inc-${index}`)),
    andBit(andBit(ref('opcode-retfImm'), ref('phase-far-high')), ref(`stack-address-plus-three-${index}`)),
    andBit(andBit(ref('opcode-iret'), ref('phase-far-low')), ref(`sp-inc-${index}`)),
    andBit(andBit(ref('opcode-iret'), ref('phase-far-high')), ref(`stack-address-plus-three-${index}`)),
    andBit(andBit(ref('opcode-iret'), orBit(ref('phase-memory-read-low'), ref('phase-memory-read-high'))), ref(`iret-stack-address-${index}`)),
    andBit(andBit(ref('opcode-intImm'), ref('phase-far-low')), ref(`sp-${index}`)),
    andBit(andBit(ref('opcode-intImm'), ref('phase-far-high')), ref(`stack-address-next-${index}`)),
    andBit(ref('int-vector-read'), ref(`int-vector-address-${index}`)),
    andBit(ref('memory-access'), muxBit(ref('opcode-movAlMoffs8'), ref(`memory-bus-offset-${index}`), ref(`store-address-${index}`))),
    andBit(anyBits([ref('movsb-read'), ref('lodsb-read'), ref('lodsw-read')]), muxBit(ref('lodsw-read-high'), ref(`si-${index}`), ref(`si-inc-${index}`))),
    andBit(ref('movsb-write'), ref(`di-${index}`)),
  ]);
  signal[`bus-segment-${index}`] = anyBits([
    andBit(ref('instruction-read'), ref(`cs-${index}`)),
    andBit(ref('data-write'), ref(`ds-${index}`)),
    andBit(ref('stack-access'), ref(`ss-${index}`)),
    andBit(ref('memory-access'), muxBit(ref('opcode-movAlMoffs8'), ref(`memory-segment-${index}`), ref(`ds-${index}`))),
    andBit(ref('movsb-read'), ref(`ds-${index}`)),
    andBit(orBit(ref('lodsb-read'), ref('lodsw-read')), muxBit(ref('csOverride'), ref(`ds-${index}`), ref(`cs-${index}`))),
    andBit(ref('movsb-write'), ref(`es-${index}`)),
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
const flagsImage = [ref('cf'), lit(1), ref('pf'), lit(0), ref('af'), lit(0), ref('zf'), ref('sf'), ref('tf'), ref('if'), ref('df'), ref('of'), ref('iopl-0'), ref('iopl-1'), ref('nt'), lit(0)];
for (let index = 0; index < WIDTH; index++) {
  signal[`push-gpr-word-${index}`] = anyBits(registers.map((register) => andBit(ref(`opcode-push-${register}`), ref(register === 'sp' ? `sp-inc-${index}` : `${register}-${index}`))));
  signal[`push-segment-word-${index}`] = anyBits(Object.keys(pushSegments).map((segment) => andBit(ref(`opcode-push-${segment}`), ref(`${segment}-${index}`))));
  const ordinaryPushWord = orBit(ref(`push-gpr-word-${index}`), ref(`push-segment-word-${index}`));
  signal[`push-word-${index}`] = muxBit(ref('opcode-pushf'), ordinaryPushWord, flagsImage[index]);
}
for (let index = 0; index < 8; index++) {
  const storeData = muxBit(ref('phase-write-high'), ref(`ax-${index}`), ref(`ax-${index + 8}`));
  const callData = muxBit(ref('phase-write-high'), ref(`returnIp-${index}`), ref(`returnIp-${index + 8}`));
  const pushData = muxBit(ref('phase-write-high'), ref(`push-word-${index}`), ref(`push-word-${index + 8}`));
  const stackWriteData = muxBit(orBit(ref('opcode-call'), ref('opcode-callRm16')), pushData, callData);
  const legacyWriteData = muxBit(ref('stack-write'), storeData, stackWriteData);
  const intFlagsData = muxBit(ref('phase-write-high'), flagsImage[index], flagsImage[index + 8]);
  const intCsData = muxBit(ref('phase-ret-high'), ref(`cs-${index}`), ref(`cs-${index + 8}`));
  const intIpData = muxBit(ref('phase-far-high'), ref(`ip-${index}`), ref(`ip-${index + 8}`));
  const intStackData = anyBits([andBit(orBit(ref('phase-write-low'), ref('phase-write-high')), intFlagsData), andBit(orBit(ref('phase-ret-low'), ref('phase-ret-high')), intCsData), andBit(orBit(ref('phase-far-low'), ref('phase-far-high')), intIpData)]);
  const memoryWriteWord = muxBit(ref('opcode-xorRmReg'), ref(`memory-register-value-${index}`), ref(`memory-rmw-result-${index}`));
  const memoryWriteHighWord = muxBit(ref('opcode-xorRmReg'), ref(`memory-register-value-${index + 8}`), ref(`memory-rmw-result-${index + 8}`));
  const memoryWriteData = muxBit(ref('phase-memory-write-high'), memoryWriteWord, memoryWriteHighWord);
  const byteRegisterWriteData = muxBit(ref('opcode-movRm8Reg'), ref(`byteImmediate-${index}`), ref(`saved-modrm-byte-register-value-${index}`));
  const byteAddWriteData = muxBit(ref('opcode-addRm8Reg'), byteRegisterWriteData, ref(`add-rm8-reg-memory-stored-result-${index}`));
  const byteMemoryWriteData = muxBit(ref('opcode-group-rm8-immediate-memory'), byteAddWriteData, ref(`group-rm8-immediate-result-${index}`));
  const selectedMemoryWriteData = muxBit(ref('opcode-byte-memory-write'), memoryWriteData, byteMemoryWriteData);
  const ordinaryWriteData = muxBit(ref('memory-write'), legacyWriteData, selectedMemoryWriteData);
  const ordinaryBusWriteData = muxBit(ref('movsb-write'), ordinaryWriteData, ref(`stringByte-${index}`));
  signal[`bus-write-data-${index}`] = muxBit(ref('int-stack-write'), ordinaryBusWriteData, intStackData);
  signal[`next-stackLow-${index}`] = muxBit(andBit(ref('phase-ret-low'), ref('bus-read')), ref(`stackLow-${index}`), ref(`busData-${index}`));
}

for (let index = 0; index < WIDTH; index++) {
  signal[`immediate-${index}`] = index < 8 ? ref(`immLow-${index}`) : ref(`busData-${index - 8}`);
}
signal['take-near-branch'] = andBit(ref('capture-imm-high'), orBit(ref('opcode-jmp'), ref('opcode-call')));
signal['execute-short'] = andBit(ref('capture-imm-low'), ref('opcode-short'));
signal['execute-loop'] = andBit(ref('capture-imm-low'), ref('opcode-loop'));
signal['cx-zero'] = notBit(anyBits(signalBits('cx', WIDTH)));
signal['short-condition'] = anyBits([ref('opcode-jmpShort'), andBit(ref('opcode-jb'), ref('cf')), andBit(ref('opcode-jz'), ref('zf')), andBit(ref('opcode-jbe'), orBit(ref('cf'), ref('zf'))), andBit(ref('opcode-jnz'), notBit(ref('zf'))), andBit(ref('opcode-jl'), xorBit(ref('sf'), ref('of'))), andBit(ref('opcode-loop'), ref('cx-dec-nonzero')), andBit(ref('opcode-jcxz'), ref('cx-zero'))]);
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
  signal[`retf-target-${index}`] = index < 8 ? ref(`stackLow-${index}`) : ref(`stackHigh-${index - 8}`);
  signal[`near-ip-${index}`] = muxBit(ref('take-near-branch'), ref(`ip-base-${index}`), ref(`branch-result-${index}`));
  signal[`branch-ip-${index}`] = muxBit(ref('take-short-branch'), ref(`near-ip-${index}`), ref(`short-result-${index}`));
  signal[`indirect-call-target-${index}`] = index < 8 ? ref(`memLow-${index}`) : ref(`busData-${index - 8}`);
  signal[`indirect-call-ip-${index}`] = muxBit(ref('begin-indirect-call'), ref(`branch-ip-${index}`), ref(`indirect-call-target-${index}`));
  signal[`indirect-jump-target-${index}`] = muxBit(ref('execute-indirect-jump-register'), ref(`indirect-call-target-${index}`), ref(`modrm-rm-value-${index}`));
  signal[`indirect-jump-ip-${index}`] = muxBit(ref('finish-indirect-jump'), ref(`indirect-call-ip-${index}`), ref(`indirect-jump-target-${index}`));
  signal[`return-ip-${index}`] = muxBit(ref('finish-ret'), ref(`indirect-jump-ip-${index}`), ref(`ret-target-${index}`));
  signal[`far-offset-${index}`] = index < 8 ? ref(`immLow-${index}`) : ref(`immHigh-${index - 8}`);
  signal[`far-jump-ip-${index}`] = muxBit(ref('finish-far-jump'), ref(`return-ip-${index}`), ref(`far-offset-${index}`));
  signal[`far-ip-${index}`] = muxBit(ref('finish-retf'), ref(`far-jump-ip-${index}`), ref(`retf-target-${index}`));
  signal[`int-offset-${index}`] = index < 8 ? ref(`intOffsetLow-${index}`) : ref(`intOffsetHigh-${index - 8}`);
  signal[`iret-ip-${index}`] = muxBit(ref('finish-iret'), ref(`far-ip-${index}`), ref(`returnIp-${index}`));
  signal[`next-ip-${index}`] = muxBit(ref('finish-int'), ref(`iret-ip-${index}`), ref(`int-offset-${index}`));
  const directCallReturnIp = muxBit(ref('begin-call'), ref(`returnIp-${index}`), ref(`ip-inc-${index}`));
  const capturedReturnIp = muxBit(ref('capture-iret-ip'), directCallReturnIp, ref(`ret-target-${index}`));
  signal[`next-returnIp-${index}`] = muxBit(ref('begin-indirect-call'), capturedReturnIp, ref(`ip-${index}`));
  signal[`far-segment-${index}`] = index < 8 ? ref(`farSegLow-${index}`) : ref(`busData-${index - 8}`);
  signal[`next-iretCs-${index}`] = muxBit(ref('capture-iret-cs'), ref(`iretCs-${index}`), ref(`far-segment-${index}`));
  signal[`far-cs-${index}`] = muxBit(ref('finish-far'), ref(`cs-${index}`), ref(`far-segment-${index}`));
  signal[`iret-cs-${index}`] = muxBit(ref('finish-iret'), ref(`far-cs-${index}`), ref(`iretCs-${index}`));
  signal[`int-segment-${index}`] = index < 8 ? ref(`intSegmentLow-${index}`) : ref(`busData-${index - 8}`);
  signal[`next-cs-${index}`] = muxBit(ref('finish-int'), ref(`iret-cs-${index}`), ref(`int-segment-${index}`));
}
signal['opcode-word-subtract'] = orBit(ref('opcode-sub'), ref('opcode-cmpAxImm16'));
signal['select-arithmetic'] = orBit(ref('opcode-add'), ref('opcode-word-subtract'));
signal['alu-carry-0'] = ref('opcode-word-subtract');
signal['cmp-al-immediate-carry-0'] = lit(1);
for (let index = 0; index < 8; index++) {
  const andResult = andBit(ref(`ax-${index}`), ref(`busData-${index}`));
  const orResult = orBit(ref(`ax-${index}`), ref(`busData-${index}`));
  signal[`al-logical-result-${index}`] = muxBit(ref('opcode-orAlImm8'), andResult, orResult);
  signal[`cmp-al-immediate-effective-source-${index}`] = notBit(ref(`busData-${index}`));
  signal[`cmp-al-immediate-sum-${index}`] = add(ref(`ax-${index}`), ref(`cmp-al-immediate-effective-source-${index}`));
  signal[`cmp-al-immediate-result-${index}`] = mod(add(ref(`cmp-al-immediate-sum-${index}`), ref(`cmp-al-immediate-carry-${index}`)), lit(2));
  signal[`cmp-al-immediate-carry-${index + 1}`] = floor(div(add(ref(`cmp-al-immediate-sum-${index}`), ref(`cmp-al-immediate-carry-${index}`)), lit(2)));
}
for (let index = 0; index < WIDTH; index++) {
  signal[`alu-effective-b-${index}`] = xorBit(ref(`immediate-${index}`), ref('opcode-word-subtract'));
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
signal['retf-sp-carry-0'] = lit(0);
signal['iret-sp-carry-0'] = lit(0);
for (let index = 0; index < WIDTH; index++) {
  const decAddend = lit(index === 0 ? 0 : 1);
  const incAddend = lit(index === 1 ? 1 : 0);
  const retfCleanupBit = index < 8 ? ref(`immLow-${index}`) : ref(`immHigh-${index - 8}`);
  const retfFrameBit = lit(index === 2 ? 1 : 0);
  signal[`sp-dec-sum-${index}`] = add(ref(`sp-${index}`), decAddend);
  signal[`sp-dec-${index}`] = mod(add(ref(`sp-dec-sum-${index}`), ref(`sp-dec-carry-${index}`)), lit(2));
  signal[`sp-dec-carry-${index + 1}`] = floor(div(add(ref(`sp-dec-sum-${index}`), ref(`sp-dec-carry-${index}`)), lit(2)));
  signal[`sp-inc-sum-${index}`] = add(ref(`sp-${index}`), incAddend);
  signal[`sp-inc-${index}`] = mod(add(ref(`sp-inc-sum-${index}`), ref(`sp-inc-carry-${index}`)), lit(2));
  signal[`sp-inc-carry-${index + 1}`] = floor(div(add(ref(`sp-inc-sum-${index}`), ref(`sp-inc-carry-${index}`)), lit(2)));
  signal[`retf-sp-sum-${index}`] = add(ref(`sp-${index}`), retfCleanupBit, retfFrameBit);
  signal[`retf-sp-result-${index}`] = mod(add(ref(`retf-sp-sum-${index}`), ref(`retf-sp-carry-${index}`)), lit(2));
  signal[`retf-sp-carry-${index + 1}`] = floor(div(add(ref(`retf-sp-sum-${index}`), ref(`retf-sp-carry-${index}`)), lit(2)));
  const iretFrameBit = lit(index === 1 || index === 2 ? 1 : 0);
  signal[`iret-sp-sum-${index}`] = add(ref(`sp-${index}`), iretFrameBit);
  signal[`iret-sp-result-${index}`] = mod(add(ref(`iret-sp-sum-${index}`), ref(`iret-sp-carry-${index}`)), lit(2));
  signal[`iret-sp-carry-${index + 1}`] = floor(div(add(ref(`iret-sp-sum-${index}`), ref(`iret-sp-carry-${index}`)), lit(2)));
}
for (const [registerIndex, register] of registers.entries()) {
  signal[`modrm-reg-${register}`] = equalBusField(3, registerIndex);
  signal[`modrm-rm-${register}`] = equalBusField(0, registerIndex);
  signal[`saved-modrm-reg-${register}`] = equalStateField('modrm', 3, 3, registerIndex);
  signal[`saved-modrm-rm-register-${register}`] = equalStateField('modrm', 0, 3, registerIndex);
}
for (const [registerIndex, { name }] of byteRegisters.entries()) {
  signal[`modrm-reg8-${name}`] = equalBusField(3, registerIndex);
  signal[`modrm-rm8-${name}`] = equalBusField(0, registerIndex);
  signal[`saved-modrm-reg8-${name}`] = equalStateField('modrm', 3, 3, registerIndex);
}
const mulAlValue = add(...Array.from({ length: 8 }, (_, index) => mul(ref(`ax-${index}`), lit(2 ** index))));
for (let index = 0; index < 8; index++) signal[`mul-rm8-operand-${index}`] = muxBit(ref('execute-mul-rm8-memory'), ref(`modrm-rm-byte-register-value-${index}`), ref(`busData-${index}`));
const mulOperandValue = add(...Array.from({ length: 8 }, (_, index) => mul(ref(`mul-rm8-operand-${index}`), lit(2 ** index))));
const mulProduct = mul(mulAlValue, mulOperandValue);
for (let index = 0; index < WIDTH; index++) signal[`mul-rm8-result-${index}`] = mod(floor(div(mulProduct, lit(2 ** index))), lit(2));
signal['mul-rm8-high-nonzero'] = anyBits(signalBits('mul-rm8-result', 16).slice(8));
signal['cmp-rm8-reg-register-commit'] = andBit(ref('modrm-commit'), ref('opcode-cmpRm8Reg'));
signal['cmp-reg-rm8-register-commit'] = andBit(ref('modrm-commit'), ref('opcode-cmpRegRm8'));
signal['cmp-register-commit'] = orBit(ref('cmp-rm8-reg-register-commit'), ref('cmp-reg-rm8-register-commit'));
signal['sub-reg-rm8-register-commit'] = andBit(ref('modrm-commit'), ref('opcode-subRegRm8'));
signal['reg-rm8-subtract-direction'] = orBit(ref('sub-reg-rm8-register-commit'), ref('cmp-reg-rm8-register-commit'));
signal['group-rm8-immediate-register-commit'] = anyBits([ref('execute-sub-rm8-immediate-register'), ref('execute-cmp-rm8-immediate-register')]);
signal['cmp-rm8-reg-memory-commit'] = andBit(ref('capture-memory-low'), ref('opcode-cmpRm8Reg'));
signal['cmp-reg-rm8-memory-commit'] = andBit(ref('capture-memory-low'), ref('opcode-cmpRegRm8'));
signal['cmp-memory-commit'] = orBit(ref('cmp-rm8-reg-memory-commit'), ref('cmp-reg-rm8-memory-commit'));
signal['cmp-commit'] = anyBits([ref('cmp-register-commit'), ref('sub-reg-rm8-register-commit'), ref('group-rm8-immediate-register-commit'), ref('cmp-memory-commit')]);
signal['test-rm8-reg-register-commit'] = andBit(ref('modrm-commit'), ref('opcode-testRm8Reg'));
signal['test-rm8-reg-memory-commit'] = andBit(ref('capture-memory-low'), ref('opcode-testRm8Reg'));
signal['test-rm8-reg-commit'] = orBit(ref('test-rm8-reg-register-commit'), ref('test-rm8-reg-memory-commit'));
signal['add-rm8-reg-carry-0'] = lit(0);
signal['add-rm8-reg-memory-stored-carry-0'] = lit(0);
signal['cmp-carry-0'] = lit(1);
signal['inc-rm8-carry-0'] = lit(1);
signal['dec-rm8-carry-0'] = lit(1);

for (let index = 0; index < 8; index++) {
  signal[`modrm-byte-register-value-${index}`] = anyBits(byteRegisters.map(({ name, register, high }) => andBit(ref(`modrm-reg8-${name}`), ref(`${register}-${index + (high ? 8 : 0)}`))));
  signal[`modrm-rm-byte-register-value-${index}`] = anyBits(byteRegisters.map(({ name, register, high }) => andBit(ref(`modrm-rm8-${name}`), ref(`${register}-${index + (high ? 8 : 0)}`))));
  signal[`saved-modrm-byte-register-value-${index}`] = anyBits(byteRegisters.map(({ name, register, high }) => andBit(ref(`saved-modrm-reg8-${name}`), ref(`${register}-${index + (high ? 8 : 0)}`))));
  signal[`saved-modrm-rm-byte-register-value-${index}`] = anyBits(byteRegisters.map(({ register, high }, selector) => andBit(equalStateField('modrm', 0, 3, selector), ref(`${register}-${index + (high ? 8 : 0)}`))));
  signal[`add-rm8-reg-destination-${index}`] = muxBit(ref('execute-add-rm8-reg-memory'), ref(`modrm-rm-byte-register-value-${index}`), ref(`busData-${index}`));
  signal[`add-rm8-reg-source-${index}`] = muxBit(ref('execute-add-rm8-reg-memory'), ref(`modrm-byte-register-value-${index}`), ref(`saved-modrm-byte-register-value-${index}`));
  signal[`add-rm8-reg-sum-${index}`] = add(ref(`add-rm8-reg-destination-${index}`), ref(`add-rm8-reg-source-${index}`));
  signal[`add-rm8-reg-result-${index}`] = mod(add(ref(`add-rm8-reg-sum-${index}`), ref(`add-rm8-reg-carry-${index}`)), lit(2));
  signal[`add-rm8-reg-carry-${index + 1}`] = floor(div(add(ref(`add-rm8-reg-sum-${index}`), ref(`add-rm8-reg-carry-${index}`)), lit(2)));
  signal[`add-rm8-reg-memory-stored-sum-${index}`] = add(ref(`memLow-${index}`), ref(`saved-modrm-byte-register-value-${index}`));
  signal[`add-rm8-reg-memory-stored-result-${index}`] = mod(add(ref(`add-rm8-reg-memory-stored-sum-${index}`), ref(`add-rm8-reg-memory-stored-carry-${index}`)), lit(2));
  signal[`add-rm8-reg-memory-stored-carry-${index + 1}`] = floor(div(add(ref(`add-rm8-reg-memory-stored-sum-${index}`), ref(`add-rm8-reg-memory-stored-carry-${index}`)), lit(2)));
  signal[`modrm-byte-subtract-destination-${index}`] = muxBit(ref('reg-rm8-subtract-direction'), ref(`modrm-rm-byte-register-value-${index}`), ref(`modrm-byte-register-value-${index}`));
  signal[`modrm-byte-subtract-source-${index}`] = muxBit(ref('reg-rm8-subtract-direction'), ref(`modrm-byte-register-value-${index}`), ref(`modrm-rm-byte-register-value-${index}`));
  signal[`cmp-register-destination-${index}`] = muxBit(ref('group-rm8-immediate-register-commit'), ref(`modrm-byte-subtract-destination-${index}`), ref(`saved-modrm-rm-byte-register-value-${index}`));
  signal[`cmp-register-source-${index}`] = muxBit(ref('group-rm8-immediate-register-commit'), ref(`modrm-byte-subtract-source-${index}`), ref(`busData-${index}`));
  signal[`cmp-memory-destination-${index}`] = muxBit(ref('cmp-reg-rm8-memory-commit'), ref(`busData-${index}`), ref(`saved-modrm-byte-register-value-${index}`));
  signal[`cmp-memory-source-${index}`] = muxBit(ref('cmp-reg-rm8-memory-commit'), ref(`saved-modrm-byte-register-value-${index}`), ref(`busData-${index}`));
  signal[`cmp-destination-${index}`] = muxBit(ref('cmp-memory-commit'), ref(`cmp-register-destination-${index}`), ref(`cmp-memory-destination-${index}`));
  signal[`cmp-source-${index}`] = muxBit(ref('cmp-memory-commit'), ref(`cmp-register-source-${index}`), ref(`cmp-memory-source-${index}`));
  signal[`cmp-effective-source-${index}`] = notBit(ref(`cmp-source-${index}`));
  signal[`cmp-sum-${index}`] = add(ref(`cmp-destination-${index}`), ref(`cmp-effective-source-${index}`));
  signal[`cmp-result-${index}`] = mod(add(ref(`cmp-sum-${index}`), ref(`cmp-carry-${index}`)), lit(2));
  signal[`cmp-carry-${index + 1}`] = floor(div(add(ref(`cmp-sum-${index}`), ref(`cmp-carry-${index}`)), lit(2)));
  signal[`xor-rm8-destination-${index}`] = muxBit(ref('execute-xor-reg-rm8-memory'), ref(`modrm-byte-register-value-${index}`), ref(`saved-modrm-byte-register-value-${index}`));
  signal[`xor-rm8-source-${index}`] = muxBit(ref('execute-xor-reg-rm8-memory'), ref(`modrm-rm-byte-register-value-${index}`), ref(`busData-${index}`));
  signal[`xor-rm8-result-${index}`] = xorBit(ref(`xor-rm8-destination-${index}`), ref(`xor-rm8-source-${index}`));
  signal[`or-rm8-result-${index}`] = orBit(ref(`modrm-byte-register-value-${index}`), ref(`modrm-rm-byte-register-value-${index}`));
  signal[`byte-logical-rm8-result-${index}`] = muxBit(ref('execute-or-reg-rm8-register'), ref(`xor-rm8-result-${index}`), ref(`or-rm8-result-${index}`));
  signal[`test-rm8-immediate-result-${index}`] = andBit(ref(`busData-${index}`), ref(`byteImmediate-${index}`));
  const testRm8RegRegisterResult = andBit(ref(`modrm-rm-byte-register-value-${index}`), ref(`modrm-byte-register-value-${index}`));
  const testRm8RegMemoryResult = andBit(ref(`busData-${index}`), ref(`saved-modrm-byte-register-value-${index}`));
  signal[`test-rm8-reg-result-${index}`] = muxBit(ref('test-rm8-reg-memory-commit'), testRm8RegRegisterResult, testRm8RegMemoryResult);
  signal[`or-rm8-immediate-result-${index}`] = orBit(ref(`memHigh-${index}`), ref(`byteImmediate-${index}`));
  signal[`and-rm8-immediate-result-${index}`] = andBit(ref(`memHigh-${index}`), ref(`byteImmediate-${index}`));
  signal[`group-rm8-immediate-result-${index}`] = muxBit(ref('opcode-and-rm8-immediate-memory'), ref(`or-rm8-immediate-result-${index}`), ref(`and-rm8-immediate-result-${index}`));
  signal[`inc-rm8-result-${index}`] = xorBit(ref(`modrm-rm-byte-register-value-${index}`), ref(`inc-rm8-carry-${index}`));
  signal[`inc-rm8-carry-${index + 1}`] = andBit(ref(`modrm-rm-byte-register-value-${index}`), ref(`inc-rm8-carry-${index}`));
  signal[`dec-rm8-effective-source-${index}`] = lit(index === 0 ? 0 : 1);
  signal[`dec-rm8-sum-${index}`] = add(ref(`modrm-rm-byte-register-value-${index}`), ref(`dec-rm8-effective-source-${index}`));
  signal[`dec-rm8-result-${index}`] = mod(add(ref(`dec-rm8-sum-${index}`), ref(`dec-rm8-carry-${index}`)), lit(2));
  signal[`dec-rm8-carry-${index + 1}`] = floor(div(add(ref(`dec-rm8-sum-${index}`), ref(`dec-rm8-carry-${index}`)), lit(2)));
  signal[`shl-rm8-destination-${index}`] = ref(`modrm-rm-byte-register-value-${index}`);
  signal[`shl-rm8-result-${index}`] = index === 0 ? lit(0) : ref(`shl-rm8-destination-${index - 1}`);
  signal[`rol-rm8-result-${index}`] = anyBits(Array.from({ length: 8 }, (_, count) => andBit(equalBusField(0, count), ref(`saved-modrm-rm-byte-register-value-${(index - count + 8) % 8}`))));
}
signal['add-rm16-immediate-carry-0'] = lit(0);
signal['cmp-rm16-immediate-carry-0'] = lit(1);
for (let index = 0; index < WIDTH; index++) {
  const immediateBit = index < 8 ? ref(`immLow-${index}`) : ref(`busData-${index - 8}`);
  signal[`saved-modrm-rm-value-${index}`] = anyBits(registers.map((register) => andBit(ref(`saved-modrm-rm-register-${register}`), ref(`${register}-${index}`))));
  signal[`and-rm16-immediate-result-${index}`] = andBit(ref(`saved-modrm-rm-value-${index}`), immediateBit);
  signal[`rm16-immediate8-source-${index}`] = index < 8 ? ref(`busData-${index}`) : ref('busData-7');
  signal[`add-rm16-immediate-sum-${index}`] = add(ref(`saved-modrm-rm-value-${index}`), ref(`rm16-immediate8-source-${index}`));
  signal[`add-rm16-immediate-result-${index}`] = mod(add(ref(`add-rm16-immediate-sum-${index}`), ref(`add-rm16-immediate-carry-${index}`)), lit(2));
  signal[`add-rm16-immediate-carry-${index + 1}`] = floor(div(add(ref(`add-rm16-immediate-sum-${index}`), ref(`add-rm16-immediate-carry-${index}`)), lit(2)));
  signal[`cmp-rm16-immediate-effective-source-${index}`] = notBit(ref(`rm16-immediate8-source-${index}`));
  signal[`cmp-rm16-immediate-sum-${index}`] = add(ref(`saved-modrm-rm-value-${index}`), ref(`cmp-rm16-immediate-effective-source-${index}`));
  signal[`cmp-rm16-immediate-result-${index}`] = mod(add(ref(`cmp-rm16-immediate-sum-${index}`), ref(`cmp-rm16-immediate-carry-${index}`)), lit(2));
  signal[`cmp-rm16-immediate-carry-${index + 1}`] = floor(div(add(ref(`cmp-rm16-immediate-sum-${index}`), ref(`cmp-rm16-immediate-carry-${index}`)), lit(2)));
  signal[`shl-rm16-destination-${index}`] = ref(`modrm-rm-value-${index}`);
  signal[`shl-rm16-result-${index}`] = index === 0 ? lit(0) : ref(`shl-rm16-destination-${index - 1}`);
  signal[`sar-rm16-result-${index}`] = index === 15 ? ref('shl-rm16-destination-15') : ref(`shl-rm16-destination-${index + 1}`);
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
signal['effective-address-plus-two-carry-0'] = lit(0);
signal['effective-address-plus-three-carry-0'] = lit(0);
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
  const plusTwoAddend = lit(index === 1 ? 1 : 0);
  const plusThreeAddend = lit(index < 2 ? 1 : 0);
  signal[`effective-address-plus-two-sum-${index}`] = add(ref(`effective-address-${index}`), plusTwoAddend);
  signal[`effective-address-plus-two-${index}`] = mod(add(ref(`effective-address-plus-two-sum-${index}`), ref(`effective-address-plus-two-carry-${index}`)), lit(2));
  signal[`effective-address-plus-two-carry-${index + 1}`] = floor(div(add(ref(`effective-address-plus-two-sum-${index}`), ref(`effective-address-plus-two-carry-${index}`)), lit(2)));
  signal[`effective-address-plus-three-sum-${index}`] = add(ref(`effective-address-${index}`), plusThreeAddend);
  signal[`effective-address-plus-three-${index}`] = mod(add(ref(`effective-address-plus-three-sum-${index}`), ref(`effective-address-plus-three-carry-${index}`)), lit(2));
  signal[`effective-address-plus-three-carry-${index + 1}`] = floor(div(add(ref(`effective-address-plus-three-sum-${index}`), ref(`effective-address-plus-three-carry-${index}`)), lit(2)));
  signal[`memory-standard-offset-${index}`] = muxBit(ref('memory-high-byte'), ref(`effective-address-${index}`), ref(`effective-address-next-${index}`));
  signal[`lds-extra-offset-${index}`] = muxBit(ref('phase-memory-write-high'), ref(`effective-address-plus-two-${index}`), ref(`effective-address-plus-three-${index}`));
  signal[`memory-bus-offset-${index}`] = muxBit(ref('lds-extra-read'), ref(`memory-standard-offset-${index}`), ref(`lds-extra-offset-${index}`));
  const defaultMemorySegment = muxBit(ref('saved-modrm-bp-based'), ref(`ds-${index}`), ref(`ss-${index}`));
  signal[`memory-segment-${index}`] = muxBit(ref('csOverride'), defaultMemorySegment, ref(`cs-${index}`));
}
signal['modrm-add-commit'] = andBit(ref('modrm-gpr-commit'), ref('opcode-addRegRm'));
signal['modrm-sub-commit'] = andBit(ref('modrm-gpr-commit'), ref('opcode-subRegRm'));
signal['xchg-byte-register-commit'] = andBit(ref('modrm-commit'), ref('opcode-xchgRm8Reg'));
signal['xchg-register-commit'] = andBit(ref('modrm-commit'), ref('opcode-xchgRmReg'));

signal['memory-load-commit'] = orBit(andBit(ref('capture-memory-high'), ref('opcode-memory-to-reg')), ref('finish-lds'));
signal['mov-sreg-memory-commit'] = andBit(ref('capture-memory-high'), ref('opcode-movSreg'));
for (const [selector, segment] of [['es', 0], ['ss', 2], ['ds', 3]]) signal[`saved-mov-sreg-${selector}`] = equalStateField('modrm', 3, 3, segment);
signal['memory-load-add-commit'] = andBit(ref('capture-memory-high'), ref('opcode-addRegRm'));
signal['memory-load-flag-commit'] = andBit(ref('capture-memory-high'), orBit(ref('opcode-xorRegRm'), ref('opcode-addRegRm')));
signal['memory-rmw-flag-commit'] = andBit(andBit(ref('phase-memory-write-high'), ref('bus-write')), ref('opcode-xorRmReg'));
signal['group-rm8-immediate-memory-commit'] = andBit(andBit(ref('phase-memory-write-low'), ref('bus-write')), ref('opcode-group-rm8-immediate-memory'));
signal['memory-flag-commit'] = orBit(ref('memory-load-flag-commit'), ref('memory-rmw-flag-commit'));
signal['inc-carry-0'] = lit(1);
signal['dec-carry-0'] = lit(1);

signal['modrm-add-carry-0'] = lit(0);

signal['memory-add-carry-0'] = lit(0);
signal['modrm-sub-carry-0'] = lit(1);
for (let index = 0; index < WIDTH; index++) {
  signal[`inc-destination-${index}`] = anyBits(registers.map((register) => andBit(ref(`fetched-inc-${register}`), ref(`${register}-${index}`))));
  signal[`inc-result-${index}`] = xorBit(ref(`inc-destination-${index}`), ref(`inc-carry-${index}`));
  signal[`inc-carry-${index + 1}`] = andBit(ref(`inc-destination-${index}`), ref(`inc-carry-${index}`));
  signal[`dec-destination-${index}`] = anyBits(registers.map((register) => andBit(ref(`fetched-dec-${register}`), ref(`${register}-${index}`))));
  signal[`dec-effective-source-${index}`] = lit(index === 0 ? 0 : 1);
  signal[`dec-sum-${index}`] = add(ref(`dec-destination-${index}`), ref(`dec-effective-source-${index}`));
  signal[`dec-result-${index}`] = mod(add(ref(`dec-sum-${index}`), ref(`dec-carry-${index}`)), lit(2));
  signal[`dec-carry-${index + 1}`] = floor(div(add(ref(`dec-sum-${index}`), ref(`dec-carry-${index}`)), lit(2)));
  signal[`modrm-reg-value-${index}`] = anyBits(registers.map((register) => andBit(ref(`modrm-reg-${register}`), ref(`${register}-${index}`))));
  signal[`modrm-rm-value-${index}`] = anyBits(registers.map((register) => andBit(ref(`modrm-rm-${register}`), ref(`${register}-${index}`))));
  signal[`modrm-source-${index}`] = muxBit(ref('opcode-modrm-to-reg'), ref(`modrm-reg-value-${index}`), ref(`modrm-rm-value-${index}`));
  signal[`modrm-destination-${index}`] = muxBit(ref('opcode-modrm-to-reg'), ref(`modrm-rm-value-${index}`), ref(`modrm-reg-value-${index}`));
  signal[`modrm-xor-result-${index}`] = xorBit(ref(`modrm-destination-${index}`), ref(`modrm-source-${index}`));
  signal[`modrm-add-sum-${index}`] = add(ref(`modrm-destination-${index}`), ref(`modrm-source-${index}`));
  signal[`modrm-add-result-${index}`] = mod(add(ref(`modrm-add-sum-${index}`), ref(`modrm-add-carry-${index}`)), lit(2));
  signal[`modrm-add-carry-${index + 1}`] = floor(div(add(ref(`modrm-add-sum-${index}`), ref(`modrm-add-carry-${index}`)), lit(2)));
  signal[`modrm-sub-effective-source-${index}`] = notBit(ref(`modrm-source-${index}`));
  signal[`modrm-sub-sum-${index}`] = add(ref(`modrm-destination-${index}`), ref(`modrm-sub-effective-source-${index}`));
  signal[`modrm-sub-result-${index}`] = mod(add(ref(`modrm-sub-sum-${index}`), ref(`modrm-sub-carry-${index}`)), lit(2));
  signal[`modrm-sub-carry-${index + 1}`] = floor(div(add(ref(`modrm-sub-sum-${index}`), ref(`modrm-sub-carry-${index}`)), lit(2)));
  const logicalOrMoveResult = muxBit(ref('opcode-modrm-xor'), ref(`modrm-source-${index}`), ref(`modrm-xor-result-${index}`));
  const addOrLogicalResult = muxBit(ref('opcode-addRegRm'), logicalOrMoveResult, ref(`modrm-add-result-${index}`));
  signal[`modrm-result-${index}`] = muxBit(ref('opcode-subRegRm'), addOrLogicalResult, ref(`modrm-sub-result-${index}`));
  signal[`memory-register-value-${index}`] = anyBits(registers.map((register) => andBit(ref(`saved-modrm-reg-${register}`), ref(`${register}-${index}`))));
  signal[`memory-live-word-${index}`] = index < 8 ? ref(`memLow-${index}`) : ref(`busData-${index - 8}`);
  signal[`memory-stored-word-${index}`] = index < 8 ? ref(`memLow-${index}`) : ref(`memHigh-${index - 8}`);
  signal[`memory-load-xor-result-${index}`] = xorBit(ref(`memory-live-word-${index}`), ref(`memory-register-value-${index}`));
  signal[`memory-add-sum-${index}`] = add(ref(`memory-register-value-${index}`), ref(`memory-live-word-${index}`));
  signal[`memory-add-result-${index}`] = mod(add(ref(`memory-add-sum-${index}`), ref(`memory-add-carry-${index}`)), lit(2));
  signal[`memory-add-carry-${index + 1}`] = floor(div(add(ref(`memory-add-sum-${index}`), ref(`memory-add-carry-${index}`)), lit(2)));
  signal[`memory-load-logical-result-${index}`] = muxBit(ref('opcode-xorRegRm'), ref(`memory-live-word-${index}`), ref(`memory-load-xor-result-${index}`));
  signal[`memory-load-normal-result-${index}`] = muxBit(ref('opcode-addRegRm'), ref(`memory-load-logical-result-${index}`), ref(`memory-add-result-${index}`));
  signal[`memory-load-result-${index}`] = muxBit(ref('opcode-lds'), ref(`memory-load-normal-result-${index}`), ref(`memory-stored-word-${index}`));
  signal[`memory-rmw-result-${index}`] = xorBit(ref(`memory-stored-word-${index}`), ref(`memory-register-value-${index}`));
  signal[`memory-load-flag-result-${index}`] = muxBit(ref('opcode-addRegRm'), ref(`memory-load-xor-result-${index}`), ref(`memory-add-result-${index}`));
  signal[`memory-flag-result-${index}`] = muxBit(ref('opcode-xorRmReg'), ref(`memory-load-flag-result-${index}`), ref(`memory-rmw-result-${index}`));
  signal[`lds-segment-word-${index}`] = index < 8 ? ref(`ldsSegLow-${index}`) : ref(`busData-${index - 8}`);
  for (const segment of ['es', 'ss', 'ds']) {
    const registerMove = andBit(ref('mov-sreg-commit'), ref(`mov-sreg-${segment}`));
    const memoryMove = andBit(ref('mov-sreg-memory-commit'), ref(`saved-mov-sreg-${segment}`));
    const movedRegisterSegment = muxBit(registerMove, ref(`${segment}-${index}`), ref(`modrm-rm-value-${index}`));
    const movedSegment = muxBit(memoryMove, movedRegisterSegment, ref(`memory-live-word-${index}`));
    const poppedSegment = muxBit(andBit(ref('finish-pop'), ref(`opcode-pop-${segment}`)), movedSegment, ref(`ret-target-${index}`));
    signal[`next-${segment}-${index}`] = segment === 'ds' ? muxBit(ref('finish-lds'), poppedSegment, ref(`lds-segment-word-${index}`)) : poppedSegment;
  }
}
signal['update-ax'] = andBit(ref('execute'), anyBits([ref('opcode-mov-ax'), ref('opcode-add'), ref('opcode-sub'), ref('opcode-xor')]));
for (const register of registers) {
  signal[`write-immediate-${register}`] = register === 'ax' ? ref('update-ax') : andBit(ref('execute'), ref(`opcode-mov-${register}`));
  signal[`write-inc-${register}`] = andBit(ref('execute-inc'), ref(`fetched-inc-${register}`));
  signal[`write-dec-${register}`] = andBit(ref('execute-dec'), ref(`fetched-dec-${register}`));
  const destinationSelector = muxBit(ref('opcode-modrm-to-reg'), ref(`modrm-rm-${register}`), ref(`modrm-reg-${register}`));
  signal[`write-modrm-${register}`] = andBit(ref('modrm-gpr-commit'), destinationSelector);
  signal[`write-memory-${register}`] = andBit(ref('memory-load-commit'), ref(`saved-modrm-reg-${register}`));
  signal[`write-lea-${register}`] = andBit(ref('finish-lea'), ref(`saved-modrm-reg-${register}`));
  signal[`write-pop-${register}`] = andBit(ref('finish-pop'), ref(`opcode-pop-${register}`));
  signal[`write-and-rm16-${register}`] = andBit(ref('execute-and-rm16-immediate-register'), ref(`saved-modrm-rm-register-${register}`));
  signal[`write-add-rm16-immediate-${register}`] = andBit(ref('execute-add-rm16-immediate-register'), ref(`saved-modrm-rm-register-${register}`));
  signal[`write-shl-rm16-${register}`] = andBit(ref('execute-shift-rm16-one-register'), ref(`modrm-rm-${register}`));
  signal[`write-mul-${register}`] = andBit(ref('execute-mul-rm8'), lit(register === 'ax' ? 1 : 0));
  const writeXchgAsReg = andBit(ref('xchg-register-commit'), ref(`modrm-reg-${register}`));
  const writeXchgAsRm = andBit(ref('xchg-register-commit'), ref(`modrm-rm-${register}`));
  signal[`write-xchg-${register}`] = orBit(writeXchgAsReg, writeXchgAsRm);
  signal[`write-${register}`] = anyBits([ref(`write-immediate-${register}`), ref(`write-inc-${register}`), ref(`write-dec-${register}`), ref(`write-modrm-${register}`), ref(`write-memory-${register}`), ref(`write-lea-${register}`), ref(`write-pop-${register}`), ref(`write-and-rm16-${register}`), ref(`write-add-rm16-immediate-${register}`), ref(`write-shl-rm16-${register}`), ref(`write-mul-${register}`), ref(`write-xchg-${register}`)]);
  for (let index = 0; index < WIDTH; index++) {
    const immediateSource = register === 'ax' ? ref(`alu-result-${index}`) : ref(`immediate-${index}`);
    const incrementedSource = muxBit(ref(`write-inc-${register}`), immediateSource, ref(`inc-result-${index}`));
    const incrementedOrDecrementedSource = muxBit(ref(`write-dec-${register}`), incrementedSource, ref(`dec-result-${index}`));
    const xchgSource = muxBit(writeXchgAsReg, ref(`modrm-reg-value-${index}`), ref(`modrm-rm-value-${index}`));
    const xchgOrImmediateSource = muxBit(ref(`write-xchg-${register}`), incrementedOrDecrementedSource, xchgSource);
    const registerSource = muxBit(ref(`write-modrm-${register}`), xchgOrImmediateSource, ref(`modrm-result-${index}`));
    const memorySource = muxBit(ref(`write-memory-${register}`), registerSource, ref(`memory-load-result-${index}`));
    const leaSource = muxBit(ref(`write-lea-${register}`), memorySource, ref(`effective-address-${index}`));
    const popSource = muxBit(ref(`write-pop-${register}`), leaSource, ref(`ret-target-${index}`));
    const andSource = muxBit(ref(`write-and-rm16-${register}`), popSource, ref(`and-rm16-immediate-result-${index}`));
    const addImmediateSource = muxBit(ref(`write-add-rm16-immediate-${register}`), andSource, ref(`add-rm16-immediate-result-${index}`));
    const selectedShiftSource = muxBit(ref('execute-sar-rm16-one-register'), ref(`shl-rm16-result-${index}`), ref(`sar-rm16-result-${index}`));
    const shiftSource = muxBit(ref(`write-shl-rm16-${register}`), addImmediateSource, selectedShiftSource);
    signal[`write-source-${register}-${index}`] = muxBit(ref(`write-mul-${register}`), shiftSource, ref(`mul-rm8-result-${index}`));

    signal[`next-base-${register}-${index}`] = muxBit(ref(`write-${register}`), ref(`${register}-${index}`), ref(`write-source-${register}-${index}`));
    const byteRegister = byteRegisters.find(({ register: parent, high }) => parent === register && high === (index >= 8));
    if (byteRegister) {
      const writeImmediateByte = andBit(ref('execute-byte-immediate'), ref(`opcode-mov8-${byteRegister.name}`));
      const writeAlLogical = andBit(ref('execute-al-logical-immediate'), lit(byteRegister.name === 'al' ? 1 : 0));
      const writeAlMoffs = andBit(ref('execute-mov-al-moffs8'), lit(byteRegister.name === 'al' ? 1 : 0));
      const writeLodsb = andBit(ref('finish-lodsb'), lit(byteRegister.name === 'al' ? 1 : 0));
      const writeLodsw = andBit(ref('finish-lodsw'), lit(register === 'ax' ? 1 : 0));
      const writeCbw = andBit(ref('execute-cbw'), lit(byteRegister.name === 'ah' ? 1 : 0));
      const writeInDxAl = andBit(ref('io-read'), lit(byteRegister.name === 'al' ? 1 : 0));
      const selectedBySavedModrm = equalStateField('modrm', 0, 3, byteRegisters.indexOf(byteRegister));
      const writeImmediateModrmByte = andBit(ref('execute-mov-rm8-register'), selectedBySavedModrm);
      const writeAddRm8Reg = andBit(ref('execute-add-rm8-reg-register'), ref(`modrm-rm8-${byteRegister.name}`));
      const writeSubRm8Immediate = andBit(ref('execute-sub-rm8-immediate-register'), selectedBySavedModrm);
      const writeSubRegRm8 = andBit(ref('execute-sub-reg-rm8-register'), ref(`modrm-reg8-${byteRegister.name}`));
      const writeRegisterModrmByte = andBit(ref('execute-mov-rm8-reg-register'), ref(`modrm-rm8-${byteRegister.name}`));
      const writeRegisterFromRmByte = andBit(ref('execute-mov-reg-rm8-register'), ref(`modrm-reg8-${byteRegister.name}`));
      const writeMemoryToRegisterByte = andBit(andBit(ref('capture-memory-low'), ref('opcode-movRegRm8')), ref(`saved-modrm-reg8-${byteRegister.name}`));
      const writeXorRm8Register = andBit(ref('execute-xor-reg-rm8-register'), ref(`modrm-reg8-${byteRegister.name}`));
      const writeXorRm8Memory = andBit(ref('execute-xor-reg-rm8-memory'), ref(`saved-modrm-reg8-${byteRegister.name}`));
      const writeXorRm8 = orBit(writeXorRm8Register, writeXorRm8Memory);
      const writeOrRm8 = andBit(ref('execute-or-reg-rm8-register'), ref(`modrm-reg8-${byteRegister.name}`));
      const writeByteLogicalRm8 = orBit(writeXorRm8, writeOrRm8);
            const writeIncRm8 = andBit(ref('execute-inc-rm8-register'), ref(`modrm-rm8-${byteRegister.name}`));
      const writeDecRm8 = andBit(ref('execute-dec-rm8-register'), ref(`modrm-rm8-${byteRegister.name}`));

      const writeShlRm8 = andBit(ref('execute-shl-rm8-one-register'), ref(`modrm-rm8-${byteRegister.name}`));
      const writeRolRm8 = andBit(ref('execute-rol-rm8-immediate-register'), selectedBySavedModrm);
      const writeXchgByteAsReg = andBit(ref('xchg-byte-register-commit'), ref(`modrm-reg8-${byteRegister.name}`));
      const writeXchgByteAsRm = andBit(ref('xchg-byte-register-commit'), ref(`modrm-rm8-${byteRegister.name}`));
      const writeXchgByte = orBit(writeXchgByteAsReg, writeXchgByteAsRm);
      const writeModrmByte = anyBits([writeImmediateModrmByte, writeAddRm8Reg, writeSubRm8Immediate, writeSubRegRm8, writeRegisterModrmByte, writeRegisterFromRmByte, writeMemoryToRegisterByte, writeByteLogicalRm8, writeIncRm8, writeDecRm8, writeShlRm8, writeRolRm8]);
      const immediateOrMemorySource = ref(`busData-${index % 8}`);
      const registerStoreSource = muxBit(writeRegisterModrmByte, immediateOrMemorySource, ref(`modrm-byte-register-value-${index % 8}`));
      const registerLoadSource = muxBit(writeRegisterFromRmByte, registerStoreSource, ref(`modrm-rm-byte-register-value-${index % 8}`));
      const byteLogicalSource = muxBit(writeByteLogicalRm8, registerLoadSource, ref(`byte-logical-rm8-result-${index % 8}`));
      const shiftSource = muxBit(writeShlRm8, byteLogicalSource, ref(`shl-rm8-result-${index % 8}`));
      const rotateSource = muxBit(writeRolRm8, shiftSource, ref(`rol-rm8-result-${index % 8}`));
      const subtractSource = muxBit(orBit(writeSubRm8Immediate, writeSubRegRm8), rotateSource, ref(`cmp-result-${index % 8}`));
      const decrementSource = muxBit(writeDecRm8, subtractSource, ref(`dec-rm8-result-${index % 8}`));
      const incrementSource = muxBit(writeIncRm8, decrementSource, ref(`inc-rm8-result-${index % 8}`));
      const addSource = muxBit(writeAddRm8Reg, incrementSource, ref(`add-rm8-reg-result-${index % 8}`));
      const byteSource = muxBit(writeAlLogical, addSource, ref(`al-logical-result-${index % 8}`));
      const lodsbSource = muxBit(writeLodsb, byteSource, ref(`busData-${index % 8}`));
      const lodswByteSource = index < 8 ? ref(`stringByte-${index}`) : ref(`busData-${index % 8}`);
      const lodsSource = muxBit(writeLodsw, lodsbSource, lodswByteSource);
      const cbwSource = muxBit(writeCbw, lodsSource, ref('ax-7'));
      const inputSource = muxBit(writeInDxAl, cbwSource, ref(`busData-${index % 8}`));
      const xchgByteSource = muxBit(writeXchgByteAsReg, ref(`modrm-byte-register-value-${index % 8}`), ref(`modrm-rm-byte-register-value-${index % 8}`));
      const finalByteSource = muxBit(writeXchgByte, inputSource, xchgByteSource);
      const writeByte = anyBits([writeImmediateByte, writeModrmByte, writeAlLogical, writeAlMoffs, writeLodsb, writeLodsw, writeCbw, writeInDxAl, writeXchgByte]);
      signal[`next-${register}-${index}`] = muxBit(writeByte, ref(`next-base-${register}-${index}`), finalByteSource);
    } else if (register !== 'sp') {
      signal[`next-${register}-${index}`] = ref(`next-base-${register}-${index}`);
    }
  }
}
signal['cx-dec-nonzero'] = anyBits(signalBits('cx-dec', WIDTH));
for (let index = 0; index < WIDTH; index++) {
  const intSpDecrement = anyBits([ref('begin-int'), ref('finish-int-flags'), ref('finish-int-cs')]);
  const pushedSp = muxBit(anyBits([ref('begin-call'), ref('begin-indirect-call'), ref('begin-push'), intSpDecrement]), ref(`next-base-sp-${index}`), ref(`sp-dec-${index}`));
  const poppedSp = muxBit(orBit(ref('finish-ret'), ref('finish-pop')), pushedSp, ref(`sp-inc-${index}`));
  const returnedFarSp = muxBit(ref('finish-retf'), poppedSp, ref(`retf-sp-result-${index}`));
  const returnedIretSp = muxBit(ref('finish-iret'), returnedFarSp, ref(`iret-sp-result-${index}`));
  signal[`next-sp-${index}`] = muxBit(ref('write-pop-sp'), returnedIretSp, ref(`next-base-sp-${index}`));
  const nextSi = signal[`next-si-${index}`];
  const nextDi = signal[`next-di-${index}`];
  const nextCx = signal[`next-cx-${index}`];
  const steppedSi = muxBit(ref('df'), ref(`si-inc-${index}`), ref(`si-dec-${index}`));
  const wordSteppedSi = muxBit(ref('df'), ref(`si-word-inc-${index}`), ref(`si-word-dec-${index}`));
  const selectedSiStep = muxBit(ref('finish-lodsw'), steppedSi, wordSteppedSi);
  const steppedDi = muxBit(ref('df'), ref(`di-inc-${index}`), ref(`di-dec-${index}`));
  const repeatedCx = muxBit(ref('rep'), nextCx, ref(`cx-dec-${index}`));
  const movedCx = muxBit(ref('finish-movsb'), nextCx, repeatedCx);
  signal[`next-si-${index}`] = muxBit(anyBits([ref('finish-movsb'), ref('finish-lodsb'), ref('finish-lodsw')]), nextSi, selectedSiStep);
  signal[`next-di-${index}`] = muxBit(ref('finish-movsb'), nextDi, steppedDi);
  signal[`next-cx-${index}`] = muxBit(ref('execute-loop'), movedCx, ref(`cx-dec-${index}`));
  const registerFlagResult = muxBit(andBit(ref('modrm-gpr-commit'), anyBits([ref('opcode-modrm-xor'), ref('opcode-addRegRm'), ref('opcode-subRegRm')])), ref(`alu-result-${index}`), ref(`modrm-result-${index}`));
  const memoryFlagResult = muxBit(ref('memory-flag-commit'), registerFlagResult, ref(`memory-flag-result-${index}`));
  signal[`flag-result-${index}`] = index < 8 ? muxBit(ref('execute-byte-logical-rm8'), memoryFlagResult, ref(`byte-logical-rm8-result-${index}`)) : memoryFlagResult;
}

signal['alu-arithmetic-cf'] = muxBit(ref('opcode-word-subtract'), ref('alu-carry-16'), notBit(ref('alu-carry-16')));
signal['alu-arithmetic-af'] = muxBit(ref('opcode-word-subtract'), ref('alu-carry-4'), notBit(ref('alu-carry-4')));
signal['alu-cf'] = andBit(ref('select-arithmetic'), ref('alu-arithmetic-cf'));
signal['alu-af'] = andBit(ref('select-arithmetic'), ref('alu-arithmetic-af'));
signal['alu-pf'] = sub(lit(1), mod(add(...signalBits('flag-result', 8)), lit(2)));
signal['alu-zf'] = sub(lit(1), min(lit(1), add(...signalBits('flag-result', WIDTH))));
signal['alu-sf'] = ref('flag-result-15');
signal['alu-of'] = andBit(ref('select-arithmetic'), xorBit(ref('alu-carry-15'), ref('alu-carry-16')));
signal['cmp-cf'] = notBit(ref('cmp-carry-8'));
signal['cmp-pf'] = sub(lit(1), mod(add(...signalBits('cmp-result', 8)), lit(2)));
signal['cmp-af'] = notBit(ref('cmp-carry-4'));
signal['cmp-zf'] = sub(lit(1), min(lit(1), add(...signalBits('cmp-result', 8))));
signal['cmp-sf'] = ref('cmp-result-7');
signal['cmp-of'] = xorBit(ref('cmp-carry-7'), ref('cmp-carry-8'));
signal['cmp-al-immediate-cf'] = notBit(ref('cmp-al-immediate-carry-8'));
signal['cmp-al-immediate-pf'] = sub(lit(1), mod(add(...signalBits('cmp-al-immediate-result', 8)), lit(2)));
signal['cmp-al-immediate-af'] = notBit(ref('cmp-al-immediate-carry-4'));
signal['cmp-al-immediate-zf'] = sub(lit(1), min(lit(1), add(...signalBits('cmp-al-immediate-result', 8))));
signal['cmp-al-immediate-sf'] = ref('cmp-al-immediate-result-7');
signal['cmp-al-immediate-of'] = xorBit(ref('cmp-al-immediate-carry-7'), ref('cmp-al-immediate-carry-8'));
signal['byte-logical-rm8-cf'] = lit(0);
signal['byte-logical-rm8-pf'] = sub(lit(1), mod(add(...signalBits('byte-logical-rm8-result', 8)), lit(2)));
signal['byte-logical-rm8-af'] = lit(0);
signal['byte-logical-rm8-zf'] = sub(lit(1), min(lit(1), add(...signalBits('byte-logical-rm8-result', 8))));
signal['byte-logical-rm8-sf'] = ref('byte-logical-rm8-result-7');
signal['byte-logical-rm8-of'] = lit(0);
signal['test-rm8-immediate-cf'] = lit(0);
signal['test-rm8-immediate-pf'] = sub(lit(1), mod(add(...signalBits('test-rm8-immediate-result', 8)), lit(2)));
signal['test-rm8-immediate-af'] = lit(0);
signal['test-rm8-immediate-zf'] = sub(lit(1), min(lit(1), add(...signalBits('test-rm8-immediate-result', 8))));
signal['test-rm8-immediate-sf'] = ref('test-rm8-immediate-result-7');
signal['test-rm8-immediate-of'] = lit(0);
signal['test-rm8-reg-cf'] = lit(0);
signal['test-rm8-reg-pf'] = sub(lit(1), mod(add(...signalBits('test-rm8-reg-result', 8)), lit(2)));
signal['test-rm8-reg-af'] = lit(0);
signal['test-rm8-reg-zf'] = sub(lit(1), min(lit(1), add(...signalBits('test-rm8-reg-result', 8))));
signal['test-rm8-reg-sf'] = ref('test-rm8-reg-result-7');
signal['test-rm8-reg-of'] = lit(0);
signal['add-rm8-reg-cf'] = ref('add-rm8-reg-carry-8');
signal['add-rm8-reg-pf'] = sub(lit(1), mod(add(...signalBits('add-rm8-reg-result', 8)), lit(2)));
signal['add-rm8-reg-af'] = ref('add-rm8-reg-carry-4');
signal['add-rm8-reg-zf'] = sub(lit(1), min(lit(1), add(...signalBits('add-rm8-reg-result', 8))));
signal['add-rm8-reg-sf'] = ref('add-rm8-reg-result-7');
signal['add-rm8-reg-of'] = xorBit(ref('add-rm8-reg-carry-7'), ref('add-rm8-reg-carry-8'));
signal['group-rm8-immediate-cf'] = lit(0);
signal['group-rm8-immediate-pf'] = sub(lit(1), mod(add(...signalBits('group-rm8-immediate-result', 8)), lit(2)));
signal['group-rm8-immediate-af'] = lit(0);
signal['group-rm8-immediate-zf'] = sub(lit(1), min(lit(1), add(...signalBits('group-rm8-immediate-result', 8))));
signal['group-rm8-immediate-sf'] = ref('group-rm8-immediate-result-7');
signal['group-rm8-immediate-of'] = lit(0);
signal['inc-rm8-cf'] = ref('cf');
signal['inc-rm8-pf'] = sub(lit(1), mod(add(...signalBits('inc-rm8-result', 8)), lit(2)));
signal['inc-rm8-af'] = ref('inc-rm8-carry-4');
signal['inc-rm8-zf'] = sub(lit(1), min(lit(1), add(...signalBits('inc-rm8-result', 8))));
signal['inc-rm8-sf'] = ref('inc-rm8-result-7');
signal['inc-rm8-of'] = xorBit(ref('inc-rm8-carry-7'), ref('inc-rm8-carry-8'));
signal['dec-rm8-cf'] = ref('cf');
signal['dec-rm8-pf'] = sub(lit(1), mod(add(...signalBits('dec-rm8-result', 8)), lit(2)));
signal['dec-rm8-af'] = notBit(ref('dec-rm8-carry-4'));
signal['dec-rm8-zf'] = sub(lit(1), min(lit(1), add(...signalBits('dec-rm8-result', 8))));
signal['dec-rm8-sf'] = ref('dec-rm8-result-7');
signal['dec-rm8-of'] = xorBit(ref('dec-rm8-carry-7'), ref('dec-rm8-carry-8'));
signal['shl-rm8-cf'] = ref('shl-rm8-destination-7');
signal['shl-rm8-pf'] = sub(lit(1), mod(add(...signalBits('shl-rm8-result', 8)), lit(2)));
signal['shl-rm8-af'] = lit(0);
signal['shl-rm8-zf'] = sub(lit(1), min(lit(1), add(...signalBits('shl-rm8-result', 8))));
signal['shl-rm8-sf'] = ref('shl-rm8-result-7');
signal['shl-rm8-of'] = xorBit(ref('shl-rm8-result-7'), ref('shl-rm8-cf'));
signal['and-rm16-immediate-cf'] = lit(0);
signal['and-rm16-immediate-pf'] = sub(lit(1), mod(add(...signalBits('and-rm16-immediate-result', 8)), lit(2)));
signal['and-rm16-immediate-af'] = lit(0);
signal['and-rm16-immediate-zf'] = sub(lit(1), min(lit(1), add(...signalBits('and-rm16-immediate-result', WIDTH))));
signal['and-rm16-immediate-sf'] = ref('and-rm16-immediate-result-15');
signal['and-rm16-immediate-of'] = lit(0);
signal['add-rm16-immediate-cf'] = ref('add-rm16-immediate-carry-16');
signal['add-rm16-immediate-pf'] = sub(lit(1), mod(add(...signalBits('add-rm16-immediate-result', 8)), lit(2)));
signal['add-rm16-immediate-af'] = ref('add-rm16-immediate-carry-4');
signal['add-rm16-immediate-zf'] = sub(lit(1), min(lit(1), add(...signalBits('add-rm16-immediate-result', WIDTH))));
signal['add-rm16-immediate-sf'] = ref('add-rm16-immediate-result-15');
signal['add-rm16-immediate-of'] = xorBit(ref('add-rm16-immediate-carry-15'), ref('add-rm16-immediate-carry-16'));
signal['cmp-rm16-immediate-cf'] = notBit(ref('cmp-rm16-immediate-carry-16'));
signal['cmp-rm16-immediate-pf'] = sub(lit(1), mod(add(...signalBits('cmp-rm16-immediate-result', 8)), lit(2)));
signal['cmp-rm16-immediate-af'] = notBit(ref('cmp-rm16-immediate-carry-4'));
signal['cmp-rm16-immediate-zf'] = sub(lit(1), min(lit(1), add(...signalBits('cmp-rm16-immediate-result', WIDTH))));
signal['cmp-rm16-immediate-sf'] = ref('cmp-rm16-immediate-result-15');
signal['cmp-rm16-immediate-of'] = xorBit(ref('cmp-rm16-immediate-carry-15'), ref('cmp-rm16-immediate-carry-16'));
signal['shl-rm16-cf'] = ref('shl-rm16-destination-15');
signal['shl-rm16-pf'] = sub(lit(1), mod(add(...signalBits('shl-rm16-result', 8)), lit(2)));
signal['shl-rm16-af'] = lit(0);
signal['shl-rm16-zf'] = sub(lit(1), min(lit(1), add(...signalBits('shl-rm16-result', WIDTH))));
signal['shl-rm16-sf'] = ref('shl-rm16-result-15');
signal['shl-rm16-of'] = xorBit(ref('shl-rm16-result-15'), ref('shl-rm16-cf'));
signal['sar-rm16-cf'] = ref('shl-rm16-destination-0');
signal['sar-rm16-pf'] = sub(lit(1), mod(add(...signalBits('sar-rm16-result', 8)), lit(2)));
signal['sar-rm16-af'] = lit(0);
signal['sar-rm16-zf'] = sub(lit(1), min(lit(1), add(...signalBits('sar-rm16-result', WIDTH))));
signal['sar-rm16-sf'] = ref('sar-rm16-result-15');
signal['sar-rm16-of'] = lit(0);
signal['modrm-add-cf'] = ref('modrm-add-carry-16');
signal['modrm-add-pf'] = sub(lit(1), mod(add(...signalBits('modrm-add-result', 8)), lit(2)));
signal['modrm-add-af'] = ref('modrm-add-carry-4');
signal['modrm-add-zf'] = sub(lit(1), min(lit(1), add(...signalBits('modrm-add-result', WIDTH))));
signal['modrm-add-sf'] = ref('modrm-add-result-15');
signal['modrm-add-of'] = xorBit(ref('modrm-add-carry-15'), ref('modrm-add-carry-16'));
signal['memory-add-cf'] = ref('memory-add-carry-16');
signal['memory-add-pf'] = sub(lit(1), mod(add(...signalBits('memory-add-result', 8)), lit(2)));
signal['memory-add-af'] = ref('memory-add-carry-4');
signal['memory-add-zf'] = sub(lit(1), min(lit(1), add(...signalBits('memory-add-result', WIDTH))));
signal['memory-add-sf'] = ref('memory-add-result-15');
signal['memory-add-of'] = xorBit(ref('memory-add-carry-15'), ref('memory-add-carry-16'));
signal['modrm-sub-cf'] = notBit(ref('modrm-sub-carry-16'));
signal['modrm-sub-pf'] = sub(lit(1), mod(add(...signalBits('modrm-sub-result', 8)), lit(2)));
signal['modrm-sub-af'] = notBit(ref('modrm-sub-carry-4'));
signal['modrm-sub-zf'] = sub(lit(1), min(lit(1), add(...signalBits('modrm-sub-result', WIDTH))));
signal['modrm-sub-sf'] = ref('modrm-sub-result-15');
signal['modrm-sub-of'] = xorBit(ref('modrm-sub-carry-15'), ref('modrm-sub-carry-16'));
signal['inc-cf'] = ref('cf');
signal['inc-pf'] = sub(lit(1), mod(add(...signalBits('inc-result', 8)), lit(2)));
signal['inc-af'] = ref('inc-carry-4');
signal['inc-zf'] = sub(lit(1), min(lit(1), add(...signalBits('inc-result', WIDTH))));
signal['inc-sf'] = ref('inc-result-15');
signal['inc-of'] = xorBit(ref('inc-carry-15'), ref('inc-carry-16'));
signal['dec-cf'] = ref('cf');
signal['dec-pf'] = sub(lit(1), mod(add(...signalBits('dec-result', 8)), lit(2)));
signal['dec-af'] = notBit(ref('dec-carry-4'));
signal['dec-zf'] = sub(lit(1), min(lit(1), add(...signalBits('dec-result', WIDTH))));
signal['dec-sf'] = ref('dec-result-15');
signal['dec-of'] = xorBit(ref('dec-carry-15'), ref('dec-carry-16'));
signal['al-logical-cf'] = lit(0);
signal['al-logical-pf'] = sub(lit(1), mod(add(...signalBits('al-logical-result', 8)), lit(2)));
signal['al-logical-af'] = lit(0);
signal['al-logical-zf'] = sub(lit(1), min(lit(1), add(...signalBits('al-logical-result', 8))));
signal['al-logical-sf'] = ref('al-logical-result-7');
signal['al-logical-of'] = lit(0);
signal['update-flags'] = anyBits([andBit(ref('execute'), anyBits([ref('opcode-add'), ref('opcode-sub'), ref('opcode-cmpAxImm16'), ref('opcode-xor')])), andBit(ref('modrm-gpr-commit'), ref('opcode-modrm-xor')), ref('modrm-add-commit'), ref('modrm-sub-commit'), ref('memory-flag-commit'), ref('execute-add-rm8-reg'), ref('cmp-commit'), ref('execute-byte-logical-rm8'), ref('execute-inc-rm8-register'), ref('execute-dec-rm8-register'), ref('execute-shl-rm8-one-register'), ref('execute-and-rm16-immediate-register'), ref('execute-add-rm16-immediate-register'), ref('execute-cmp-rm16-immediate-register'), ref('execute-shl-rm16-one-register'), ref('execute-sar-rm16-one-register'), ref('execute-al-logical-immediate'), ref('execute-cmp-al-immediate'), ref('execute-test-rm8-immediate-memory'), ref('test-rm8-reg-commit'), ref('group-rm8-immediate-memory-commit'), ref('execute-inc'), ref('execute-dec')]);
for (const flag of ['cf', 'pf', 'af', 'zf', 'sf', 'of']) {
  const logicalFlag = muxBit(ref('execute-byte-logical-rm8'), ref(`alu-${flag}`), ref(`byte-logical-rm8-${flag}`));
  const memoryAddFlag = muxBit(ref('memory-load-add-commit'), logicalFlag, ref(`memory-add-${flag}`));
  const shiftedByteFlag = muxBit(ref('execute-shl-rm8-one-register'), memoryAddFlag, ref(`shl-rm8-${flag}`));
  const andImmediateFlag = muxBit(ref('execute-and-rm16-immediate-register'), shiftedByteFlag, ref(`and-rm16-immediate-${flag}`));
  const shiftedFlag = muxBit(ref('execute-shl-rm16-one-register'), andImmediateFlag, ref(`shl-rm16-${flag}`));
  const arithmeticShiftedFlag = muxBit(ref('execute-sar-rm16-one-register'), shiftedFlag, ref(`sar-rm16-${flag}`));
  const arithmeticFlag = muxBit(ref('modrm-add-commit'), arithmeticShiftedFlag, ref(`modrm-add-${flag}`));
  const subtractFlag = muxBit(ref('modrm-sub-commit'), arithmeticFlag, ref(`modrm-sub-${flag}`));
  const alLogicalFlag = muxBit(ref('execute-al-logical-immediate'), subtractFlag, ref(`al-logical-${flag}`));
  const decFlag = muxBit(ref('execute-dec-rm8-register'), alLogicalFlag, ref(`dec-rm8-${flag}`));
  const incRm8Flag = muxBit(ref('execute-inc-rm8-register'), decFlag, ref(`inc-rm8-${flag}`));
  const testRm8RegFlag = muxBit(ref('test-rm8-reg-commit'), incRm8Flag, ref(`test-rm8-reg-${flag}`));
  const testFlag = muxBit(ref('execute-test-rm8-immediate-memory'), testRm8RegFlag, ref(`test-rm8-immediate-${flag}`));
  const groupImmediateFlag = muxBit(ref('group-rm8-immediate-memory-commit'), testFlag, ref(`group-rm8-immediate-${flag}`));
  const cmpAlImmediateFlag = muxBit(ref('execute-cmp-al-immediate'), groupImmediateFlag, ref(`cmp-al-immediate-${flag}`));
  const addRm8RegFlag = muxBit(ref('execute-add-rm8-reg'), cmpAlImmediateFlag, ref(`add-rm8-reg-${flag}`));
  const incrementFlag = muxBit(ref('execute-inc'), addRm8RegFlag, ref(`inc-${flag}`));
  const decrementFlag = muxBit(ref('execute-dec'), incrementFlag, ref(`dec-${flag}`));
  signal[`selected-before-cmp-rm16-${flag}`] = muxBit(ref('cmp-commit'), decrementFlag, ref(`cmp-${flag}`));
  signal[`selected-before-group-rm16-immediate8-${flag}`] = muxBit(ref('execute-add-rm16-immediate-register'), ref(`selected-before-cmp-rm16-${flag}`), ref(`add-rm16-immediate-${flag}`));
  signal[`selected-${flag}`] = muxBit(ref('execute-cmp-rm16-immediate-register'), ref(`selected-before-group-rm16-immediate8-${flag}`), ref(`cmp-rm16-immediate-${flag}`));
  signal[`next-base-${flag}`] = muxBit(ref('update-flags'), ref(flag), ref(`selected-${flag}`));
  const lowFlagIndex = { cf: 0, pf: 2, af: 4, zf: 6, sf: 7 }[flag];
  const popfSource = lowFlagIndex === undefined ? ref('busData-3') : ref(`stackLow-${lowFlagIndex}`);
  const iretSource = lowFlagIndex === undefined ? ref('busData-3') : ref(`iretFlagsLow-${lowFlagIndex}`);
  const frameSource = muxBit(ref('finish-iret'), popfSource, iretSource);
  signal[`next-${flag}`] = muxBit(ref('finish-flags-load'), ref(`next-base-${flag}`), frameSource);
}
signal['next-mul-cf'] = muxBit(ref('execute-mul-rm8'), ref('next-base-cf'), ref('mul-rm8-high-nonzero'));
signal['next-rol-cf'] = muxBit(ref('rol-rm8-count-nonzero'), ref('next-mul-cf'), ref('rol-rm8-result-0'));

signal['carry-control-value'] = muxBit(ref('update-cmc'), ref('update-stc'), notBit(ref('cf')));
signal['controlled-cf'] = muxBit(ref('update-carry-control'), ref('next-rol-cf'), ref('carry-control-value'));
signal['loaded-cf'] = muxBit(ref('finish-iret'), ref('stackLow-0'), ref('iretFlagsLow-0'));
signal['next-cf'] = muxBit(ref('finish-flags-load'), ref('controlled-cf'), ref('loaded-cf'));
signal['next-mul-of'] = muxBit(ref('execute-mul-rm8'), ref('next-base-of'), ref('mul-rm8-high-nonzero'));
signal['rotated-of'] = muxBit(ref('rol-rm8-count-one'), ref('next-mul-of'), xorBit(ref('rol-rm8-result-7'), ref('rol-rm8-result-0')));

signal['next-of'] = muxBit(ref('finish-flags-load'), ref('rotated-of'), ref('busData-3'));

export const cpu16 = {
  name: 'css386-real-mode-seed',
  inputs: { busData: { width: 8 } },
  state: {
    ip: { width: 16, initial: 0xfff0 },
    ...Object.fromEntries(registers.map((register) => [register, { width: 16 }])),
    cs: { width: 16, initial: 0xf000 }, ds: { width: 16, initial: 0 }, ss: { width: 16, initial: 0 }, es: { width: 16, initial: 0 },
    ir: { width: 8 }, immLow: { width: 8 }, immHigh: { width: 8 }, farSegLow: { width: 8 }, stackLow: { width: 8 }, stackHigh: { width: 8 }, modrm: { width: 8 }, dispLow: { width: 8 }, dispHigh: { width: 8 }, memLow: { width: 8 }, memHigh: { width: 8 }, ldsSegLow: { width: 8 }, stringByte: { width: 8 }, byteImmediate: { width: 8 }, intOffsetLow: { width: 8 }, intOffsetHigh: { width: 8 }, intSegmentLow: { width: 8 }, iretFlagsLow: { width: 8 }, returnIp: { width: 16 }, iretCs: { width: 16 }, phase: { width: 4 },
    halted: { width: 1 }, faulted: { width: 1 }, if: { width: 1 }, tf: { width: 1 }, df: { width: 1 }, iopl: { width: 2 }, nt: { width: 1 }, lock: { width: 1 }, rep: { width: 1 }, csOverride: { width: 1 },
    cf: { width: 1 }, pf: { width: 1 }, af: { width: 1 }, zf: { width: 1 }, sf: { width: 1 }, of: { width: 1 },
    fdcDor: { width: 8 }, fdcInterrupt: { width: 1 },
  },
  signals: signal,
  latches: {
    ip: bits('next-ip', 16),
    ...Object.fromEntries(registers.map((register) => [register, bits(`next-${register}`, 16)])),
    cs: bits('next-cs', 16), ds: bits('next-ds', 16), ss: bits('next-ss', 16), es: bits('next-es', 16),
    ir: bits('next-ir', 8), immLow: bits('next-immLow', 8), immHigh: bits('next-immHigh', 8), farSegLow: bits('next-farSegLow', 8), stackLow: bits('next-stackLow', 8), stackHigh: bits('next-stackHigh', 8), modrm: bits('next-modrm', 8), dispLow: bits('next-dispLow', 8), dispHigh: bits('next-dispHigh', 8), memLow: bits('next-memLow', 8), memHigh: bits('next-memHigh', 8), ldsSegLow: bits('next-ldsSegLow', 8), stringByte: bits('next-stringByte', 8), byteImmediate: bits('next-byteImmediate', 8), intOffsetLow: bits('next-intOffsetLow', 8), intOffsetHigh: bits('next-intOffsetHigh', 8), intSegmentLow: bits('next-intSegmentLow', 8), iretFlagsLow: bits('next-iretFlagsLow', 8), returnIp: bits('next-returnIp', 16), iretCs: bits('next-iretCs', 16), phase: bits('next-phase', 4),
    halted: ['next-halted'], faulted: ['next-faulted'], if: ['next-if'], tf: ['next-tf'], df: ['next-df'], iopl: bits('next-iopl', 2), nt: ['next-nt'], lock: ['next-lock'], rep: ['next-rep'], csOverride: ['next-csOverride'],
    cf: ['next-cf'], pf: ['next-pf'], af: ['next-af'], zf: ['next-zf'], sf: ['next-sf'], of: ['next-of'],
    fdcDor: bits('next-fdcDor', 8), fdcInterrupt: ['next-fdcInterrupt'],
  },
  outputs: {
    busAddress: bits('bus-address', 20), busRead: ['bus-read'], busWrite: ['bus-write'], busWriteData: bits('bus-write-data', 8), busLock: ['bus-lock'],
    ioPort: bits('dx', 16), ioRead: ['io-read'], ioWrite: ['io-write'], ioWriteData: bits('ax', 8),
    fdcDor: bits('fdcDor', 8), fdcReset: ['fdc-reset'], fdcInterrupt: ['fdcInterrupt'], irq6Request: ['irq6-request'],
  },
  aliases: Object.fromEntries([
    ...['al', 'cl', 'dl', 'bl'].map((name, index) => [name, bits(registers[index], 8)]),
    ...['ah', 'ch', 'dh', 'bh'].map((name, index) => [name, bits(registers[index], 16).slice(8)]),
  ]),
  byteBus: { addressOutput: 'busAddress', readOutput: 'busRead', writeOutput: 'busWrite', writeDataOutput: 'busWriteData', lockOutput: 'busLock', dataInput: 'busData' },
  ioBus: { portOutput: 'ioPort', readOutput: 'ioRead', writeOutput: 'ioWrite', writeDataOutput: 'ioWriteData', dataInput: 'busData' },
};
