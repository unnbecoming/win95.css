export class ByteBusMachine {
  constructor(chip, bytes, { ioRead = () => 0xff } = {}) {
    if (!chip.manifest.byteBus) throw new Error('manifest has no byte bus contract');
    if (typeof ioRead !== 'function') throw new Error('I/O read handler must be a function');
    this.chip = chip;
    this.bytes = bytes;
    this.ioRead = ioRead;
    this.trace = [];
  }

  step() {
    const contract = this.chip.manifest.byteBus;
    const outputs = this.chip.outputs();
    const reading = outputs[contract.readOutput] === 1;
    const writing = outputs[contract.writeOutput] === 1;
    const ioContract = this.chip.manifest.ioBus;
    const inputting = ioContract?.readOutput && outputs[ioContract.readOutput] === 1;
    const outputting = ioContract?.writeOutput && outputs[ioContract.writeOutput] === 1;
    if (Number(reading) + Number(writing) + Number(inputting) + Number(outputting) > 1) throw new Error('CPU cannot issue overlapping memory and I/O cycles');
    if (inputting) {
      const port = outputs[ioContract.portOutput];
      const data = this.ioRead(port, this.trace.length);
      if (!Number.isInteger(data) || data < 0 || data > 0xff) throw new Error(`I/O read handler returned invalid byte: ${data}`);
      this.chip.drive({ [ioContract.dataInput ?? contract.dataInput]: data });
      const state = this.chip.cycle();
      const request = { cycle: this.trace.length, kind: 'in', port, data };
      this.trace.push(request);
      return { state, request };
    }
    if (outputting) {
      this.chip.drive({ [contract.dataInput]: 0 });
      const state = this.chip.cycle();
      const request = { cycle: this.trace.length, kind: 'out', port: outputs[ioContract.portOutput], data: outputs[ioContract.writeDataOutput] };
      this.trace.push(request);
      return { state, request };
    }
    if (!reading && !writing) return { state: this.chip.state(), request: null };
    const address = outputs[contract.addressOutput];
    if (address < 0 || address >= this.bytes.length) throw new Error(`byte bus address outside storage: ${address}`);
    const data = reading ? this.bytes[address] : outputs[contract.writeDataOutput];
    if (writing) this.bytes[address] = data;
    this.chip.drive({ [contract.dataInput]: reading ? data : 0 });
    const state = this.chip.cycle();
    const request = { cycle: this.trace.length, kind: reading ? 'read' : 'write', address, data };
    if (contract.lockOutput && outputs[contract.lockOutput] === 1) request.locked = true;
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
