export class ByteBusMachine {
  constructor(chip, bytes) {
    if (!chip.manifest.byteBus) throw new Error('manifest has no byte bus contract');
    this.chip = chip;
    this.bytes = bytes;
    this.trace = [];
  }

  step() {
    const contract = this.chip.manifest.byteBus;
    const outputs = this.chip.outputs();
    const reading = outputs[contract.readOutput] === 1;
    const writing = outputs[contract.writeOutput] === 1;
    if (reading && writing) throw new Error('byte bus cannot read and write in one cycle');
    if (!reading && !writing) return { state: this.chip.state(), request: null };
    const address = outputs[contract.addressOutput];
    if (address < 0 || address >= this.bytes.length) throw new Error(`byte bus address outside storage: ${address}`);
    const data = reading ? this.bytes[address] : outputs[contract.writeDataOutput];
    if (writing) this.bytes[address] = data;
    this.chip.drive({ [contract.dataInput]: reading ? data : 0 });
    const state = this.chip.cycle();
    const request = { cycle: this.trace.length, kind: reading ? 'read' : 'write', address, data };
    this.trace.push(request);
    return { state, request };
  }

  run(maxCycles = 1000) {
    for (let cycle = 0; cycle < maxCycles; cycle++) {
      const result = this.step();
      if (result.state.halted === 1) return { state: result.state, trace: [...this.trace] };
    }
    throw new Error(`CPU did not halt within ${maxCycles} bus cycles`);
  }
}
