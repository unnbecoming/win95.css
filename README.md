# win95.css

An honest experiment toward an i386-compatible CPU implemented in generated CSS.

The distant target is deliberately ridiculous: boot an unmodified Windows 95 RTM installation on an architectural i386 machine whose decode, arithmetic, registers, segmentation, paging, privilege checks, faults, interrupts, and commit logic are expressed in generated CSS.

That is **not** the current claim.

## Current milestone: the real-mode relocation spine

The repository currently contains two generated organs:

- a 32-bit operation-selected ALU for `ADD`, `SUB`, `AND`, `OR`, and `XOR`, with architectural result flags;
- a 16-bit real-mode seed core with CSS-owned `CS/DS/SS/ES`, `IP`, all eight general registers, `IR`, immediate, phase, halt, fault, arithmetic flags, `IF/TF/DF`, `IOPL/NT`, repeat state, and a one-instruction `CS` override latch;
- generated CSS reset state starts at architectural `CS=F000h`, `IP=FFF0h`, fetching physical `FFFF0h`;
- CSS decodes the full real x86 `B0..B7` `MOV r8,ib` and `B8..BF` `MOV r16,iw` families; the working word-width spine includes `MOV` (`89/8B`), `XOR` (`31/33`), register `ADD r16,r/m16` (`03`), register and memory-source `MOV Sreg,r/m16` (`8E`, valid `ES/SS/DS` only), memory `LDS` (`C5`), immediate ALU, stack, near/far branch/call/return, string, and control instructions;
- the byte-width spine includes register and memory `MOV r/m8,r8` (`88`), `MOV r8,r/m8` (`8A`), `XOR r8,r/m8` (`32`), register `OR r8,r/m8` (`0A`), `CMP r/m8,r8` (`38`), `MOV r/m8,ib` (`C6 /0`), register `SUB/CMP r/m8,ib` (`80 /5,/7`), memory `OR r/m8,ib` (`80 /1`), memory `TEST r/m8,ib` (`F6 /0`), register `DEC r/m8` (`FE /1`), register `SHL r/m8,1` (`D0 /4`), register `ROL r/m8,ib` (`C0 /0`), `MOV AL,moffs8` (`A0`), and `AND/OR AL,ib` (`24/0C`);
- conditional control now covers `JB`, `JBE`, `JZ`, `JNZ`, `JL`, and `LOOP` with modulo-16-bit `CX` decrement; `CLC` clears only `CF`; `INT imm8` performs the real-mode FLAGS/CS/post-IP stack sequence and IVT transfer; memory `FF /2` performs an indirect near call, including `CS:`-overridden function-table reads and an `SS:SP` return-IP push; `RETF imm16` (`CA`) reads return `IP:CS` from four wrapped `SS:SP` bytes, commits only after the complete frame, and applies unsigned immediate cleanup modulo 16 bits;
- CSS forms 20-bit physical addresses as `segment << 4 + offset`: instruction fetches use `CS:IP`, direct operands use `DS:moffs16`, stack traffic uses `SS:SP`, and ModR/M memory operands implement all eight 8086 base/index forms with signed `disp8`, `disp16`, direct `disp16`, BP-based `SS`, otherwise `DS`, and an explicit one-instruction `CS` override;
- `OUT DX,AL` (`EE`) emits a CSS-owned I/O-write cycle with a 16-bit port and byte data; the CSS netlist itself decodes `03F2h`, latches the IBM AT DOR's implemented select/reset/IRQ-DMA-enable/motor bits, clears controller `INT` while reset is asserted, models the first post-reset attention event on reset release, and gates that pending `INT` to an observable IRQ6 request through DOR bit 3; the opcode-blind JavaScript adapter still only records generic bus cycles;
- the public trace begins at `FFFF0h`, fetches the five-byte `EA 0000:7c00` reset stub, then lands at physical `07c00h`; this is a synthetic landing ROM, not a BIOS or boot sector;
- Intel defines logical-instruction `AF` as undefined; the core resolves it deterministically to zero, consistently across its implemented logical instructions;
- independent browser proofs cover exact register selectors, effective addresses, stack ordering and wrap, byte sibling preservation, arithmetic flags including `CLC` collateral preservation and byte-immediate subtraction, group-selector rejection, prefix lifetime, interrupt stack/IVT order, indirect-call target and return custody, far-return stack order/wrap/cleanup and atomic commit, memory-TEST immediate/operand bus order and no-write behavior, memory-OR immediate/read/write order, all-EA byte RMW, logical flags, prefix lifetime and early form rejection, LOOP decrement/taken/fallthrough/IP-wrap behavior with full flag preservation, rotate/shift count behavior, invalid group selectors, exact memory plus port-output traces, DOR implemented/reserved bits, reset polarity, pending-controller-INT clearing, IRQ-enable gating, and unrelated-port isolation;
- the ALU proof still differential-tests 1,045 mixed edge/random operation vectors in real Chromium.

The generated ALU is **376 registered one-bit nets / 59,974 CSS bytes**. The CPU-plus-current-device slice is **3,592 nets / 1,664,030 CSS bytes** and exposes `AL/CL/DL/BL/AH/CH/DH/BH` aliases plus manifest-declared memory, port-output, DOR, reset, controller-INT, and IRQ6-request contracts.

The first scalar prototype failed usefully: Chromium rounded `0xffffffff` as a typed CSS number, yielding `4294970000`. That made a scalar 32-bit custom property dishonest. The current design therefore uses one custom property per wire. The uglier architecture is also the truer one.

## Honesty boundary

CSS owns:

- operation, x86 opcode, ModR/M field/direction/mode decode, displacement capture and sign extension, and the full 8086 16-bit effective-address matrix;
- real-mode default/override segment selection, segment-register write decode, one- and two-byte memory plus stack read/write/RMW microphases, four-byte far-pointer, far-return-frame, and IVT reads, `MOVSB` source/write cycles, CSS-owned `SI/DI/CX` string updates, architectural SP ordering, `IF/TF/DF` update, interrupt entry, I/O-write issue, and 20-bit physical address formation;
- the current device slice's `03F2h` decode, implemented DOR bit latches, reset assertion/release transition, controller-INT pending bit, and IRQ6 request gate;
- generated reset defaults, fetch-phase transitions, `IP` increment, far `CS:IP` transfer, register transfer, halt, and invalid-opcode faulting;
- the shared add/sub carry networks and bitwise logic paths;
- result-bit computation and architectural flags (logical operations deliberately drive undefined `AF` to zero for now);
- every combinational next-state pin.

The runtime JavaScript owns:

- manifest-declared memory-bus and port-output serialization;
- opaque byte storage behind CSS-emitted address/read/write/data pins and recording of CSS-emitted output cycles;
- driving CSS input pins and sampling CSS output pins;
- one atomic generic state-bank latch;
- UI, bus trace, and diagnostics.

`src/chip.js` and `src/byte-bus-machine.js` contain no opcode or ModR/M decode, arithmetic, carry, parity, overflow, x86 flag, or device logic. The independent operation/x86 oracles exist only in browser tests and are not loaded by either demo.

If runtime JavaScript branches on opcode, ModR/M field, addressing mode, flag meaning, privilege level, segment type, page-table semantics, exception vector, or device meaning, the central claim has failed. Unsupported group selectors and intentionally absent register/memory forms fault before consuming hidden operands. `F3` is accepted only as `REP MOVSB`; another target faults. `CS` is the only implemented segment-override prefix. `INT` entry exists, but hardware interrupt delivery, interrupt-inhibition shadows, `IRET`, port input, PIC semantics, FDC commands/status/result queues, DMA, drive mechanics, disks, and firmware ROM are not provided. The only device behavior is the narrow CSS-owned `03F2h` DOR/reset/post-reset-INT/IRQ6-request slice above; the IRQ request is not delivered to the CPU. An `OUT` trace by itself still proves only that the CPU issued a port cycle.

## Run the proof

```bash
npm install
npx playwright install chromium
npm test
```

The tests regenerate both CSS artifacts, exercise the ALU and seed CPU in headless Chromium, compare latched state against independent oracles, and verify exact memory-bus and port-output traces.

Open `index.html` for the reset-vector and synthetic landing-ROM spine or `alu.html` for the standalone operation-selected ALU. `cpu.html` is a compatibility redirect to the homepage, preventing duplicate instrument markup from drifting.

## Shape of the project

- `rtl/` — small declarative netlist source and development-only reference evaluator
- `scripts/generate.mjs` — shared IR to generated CSS + manifest compiler
- `generated/` — auditable generated ALU and CPU artifacts
- `src/chip.js` — generic physical glue/atomic latch
- `src/byte-bus-machine.js` — generic manifest-driven byte storage bus and port-output recorder
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
