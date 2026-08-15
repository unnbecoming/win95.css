# win95.css

An honest experiment toward an i386-compatible CPU implemented in generated CSS.

The distant target is deliberately ridiculous: boot an unmodified Windows 95 RTM installation on an architectural i386 machine whose decode, arithmetic, registers, segmentation, paging, privilege checks, faults, interrupts, and commit logic are expressed in generated CSS.

That is **not** the current claim.

## Current milestone: the first executable spine

The repository currently contains two generated organs:

- a 32-bit operation-selected ALU for `ADD`, `SUB`, `AND`, `OR`, and `XOR`, with architectural result flags;
- a 16-bit real-mode seed core with CSS-owned `CS/DS/SS/ES`, `IP`, all eight general registers, `IR`, immediate, phase, halt, fault, and flags;
- CSS decodes the full real x86 `B8..BF` `MOV r16,iw` family, `MOV [moffs16],AX`, `JMP rel16`, `CALL rel16`, `RET`, `JZ rel8`, `JNZ rel8`, `ADD AX,iw`, `SUB AX,iw`, `XOR AX,iw`, and `HLT` opcodes;
- CSS forms 20-bit physical addresses as `segment << 4 + offset`: instruction fetches use `CS:IP`, direct stores use `DS:moffs16`, and CALL/RET traffic uses `SS:SP`;
- a manifest-driven, opcode-blind JavaScript byte bus services CSS-emitted read/write/address/data pins against opaque 1 MiB storage and records the trace;
- independent browser proofs preserve the complete zero-segment trace and separately verify nonzero `CS:IP` fetches at physical `12350h`, `DS:moffs16` writes at `10020h`, and `SS:SP` stack traffic at `27ffeh`;
- the ALU proof still differential-tests 1,045 mixed edge/random operation vectors in real Chromium.

The generated ALU is **376 registered one-bit nets / 59,974 CSS bytes**. The segmented CPU is **1,174 nets / 242,359 CSS bytes** and exposes `AL/CL/DL/BL/AH/CH/DH/BH` aliases in its manifest.

The first scalar prototype failed usefully: Chromium rounded `0xffffffff` as a typed CSS number, yielding `4294970000`. That made a scalar 32-bit custom property dishonest. The current design therefore uses one custom property per wire. The uglier architecture is also the truer one.

## Honesty boundary

CSS owns:

- operation and x86 opcode decode;
- real-mode segment selection and 20-bit physical address formation;
- fetch-phase transitions, `IP` increment, register transfer, halt, and invalid-opcode faulting;
- the shared add/sub carry networks and bitwise logic paths;
- result-bit computation and architectural flags (logical operations deliberately drive undefined `AF` to zero for now);
- every combinational next-state pin.

The runtime JavaScript owns:

- manifest-declared bus serialization and deserialization;
- opaque byte storage behind CSS-emitted address/read/write/data pins;
- driving CSS input pins and sampling CSS output pins;
- one atomic generic state-bank latch;
- UI, bus trace, and diagnostics.

`src/chip.js` and `src/byte-bus-machine.js` contain no opcode decode, arithmetic, carry, parity, overflow, or x86 flag logic. The independent operation/x86 oracles exist only in browser tests and are not loaded by either demo.

If runtime JavaScript eventually branches on opcode, addressing mode, flag meaning, privilege level, segment type, page-table semantics, or exception vector, the central claim has failed.

## Run the proof

```bash
npm install
npx playwright install chromium
npm test
```

The tests regenerate both CSS artifacts, exercise the ALU and seed CPU in headless Chromium, compare latched state against independent oracles, and verify the exact byte-bus trace.

Open `index.html` for the current ROM spine or `alu.html` for the standalone operation-selected ALU. `cpu.html` is a compatibility redirect to the homepage, preventing duplicate instrument markup from drifting.

## Shape of the project

- `rtl/` — small declarative netlist source and development-only reference evaluator
- `scripts/generate.mjs` — shared IR to generated CSS + manifest compiler
- `generated/` — auditable generated ALU and CPU artifacts
- `src/chip.js` — generic physical glue/atomic latch
- `src/byte-bus-machine.js` — generic manifest-driven byte storage bus
- `src/app.js` / `src/cpu-app.js` — demo UI only
- `test/` — real-browser differential tests

The likely milestone ladder is:

1. operation-selected `ADD`/`SUB`/`AND`/`OR`/`XOR` plus flags — **working**
2. atomic register-transfer microsteps — **working**
3. segmented real-mode fetch/decode loop and 20-bit byte-bus traces — **working subset**
4. 386 protected mode, paging, privilege, faults, and differential conformance
5. BIOS and a small real-mode guest
6. Windows 95 Safe Mode
7. normal RTM desktop, mouse, and Notepad

A complete cold boot must exist before the headline claim exists. Checkpoints may make a geological demo usable, but they cannot substitute for the boot.

## Naming

**CSS/386** is the generated CPU core. **win95.css** is the eventual artwork built around it.

MIT licensed.
