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
    if (outputs[contract.readOutput] !== 1) return { state: this.chip.state(), request: null };
    const address = outputs[contract.addressOutput];
    const data = this.bytes[address] ?? 0;
    this.chip.drive({ [contract.dataInput]: data });
    const state = this.chip.cycle();
    const request = { cycle: this.trace.length, address, data };
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
