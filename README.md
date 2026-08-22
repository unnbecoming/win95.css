# win95.css

An honest experiment toward an i386-compatible CPU implemented in generated CSS.

The distant target is deliberately ridiculous: boot an unmodified Windows 95 RTM installation on an architectural i386 machine whose decode, arithmetic, registers, segmentation, paging, privilege checks, faults, interrupts, and commit logic are expressed in generated CSS.

That is **not** the current claim.

## Current milestone: the real-mode relocation spine

The repository currently contains two generated organs:

- a 32-bit operation-selected ALU for `ADD`, `SUB`, `AND`, `OR`, and `XOR`, with architectural result flags;
- a 16-bit real-mode seed core with CSS-owned `CS/DS/SS/ES`, `IP`, all eight general registers, `IR`, immediate, phase, halt, fault, arithmetic flags, `IF/TF/DF`, `IOPL/NT`, repeat state, and a one-instruction `CS` override latch;
- generated CSS reset state starts at architectural `CS=F000h`, `IP=FFF0h`, fetching physical `FFFF0h`;
- CSS decodes the full real x86 `B0..B7` `MOV r8,ib` and `B8..BF` `MOV r16,iw` families; the working word-width spine includes `MOV` (`89/8B`), `XOR` (`31/33`), register and memory-source `ADD r16,r/m16` (`03`), register `SUB r16,r/m16` (`2B`), register `INC/DEC r16` (`40..4F`), `XCHG r8,r8` (`86`), and `XCHG r/m16,r16` (`87`), register `SHL/SAR r16,1` (`D1 /4,/7`, deterministic AF=0), `CMP AX,iw` (`3D`), effective-address `LEA r16,m` (`8D`), register and memory-source `MOV Sreg,r/m16` (`8E`, valid `ES/SS/DS` only), memory `LDS` (`C5`), string loads `LODSB/LODSW` (`AC/AD`) and word stores `STOSW` (`AB`), `CBW` sign extension (`98`), immediate ALU, stack, near/far branch/call/return, string, and control instructions;
- the byte-width spine includes register and memory `ADD r/m8,r8` (`00`), `MOV r/m8,r8` (`88`), `MOV r8,r/m8` (`8A`), `XOR r8,r/m8` (`32`), register `OR r8,r/m8` (`0A`), register `SUB r8,r/m8` (`2A`), `CMP r/m8,r8` (`38`) and `CMP r8,r/m8` (`3A`), `CMP AL,ib` (`3C`), `TEST r/m8,r8` (`84`), `MOV r/m8,ib` (`C6 /0`), register `SUB/CMP r/m8,ib` (`80 /5,/7`), memory `OR/AND/CMP r/m8,ib` (`80 /1,/4,/7`), register `AND r/m16,iw` (`81 /4`), register `ADD/CMP r/m16,imm8` with sign extension (`83 /0,/7`), memory `TEST r/m8,ib` (`F6 /0`), unsigned `MUL r/m8` (`F6 /4`) into `AX` with defined `CF/OF` and preserved undefined flags, register `INC/DEC r/m8` (`FE /0,/1`), register `SHL r/m8,1` (`D0 /4`), register `ROL r/m8,ib` (`C0 /0`), `MOV AL,moffs8` (`A0`), and `AND/OR AL,ib` (`24/0C`);
- conditional control now covers `JB`, `JBE`, `JZ`, `JNZ`, `JL`, `JCXZ` without `CX` mutation, and `LOOP` with modulo-16-bit `CX` decrement; `CMC` complements only `CF`, `CLC` clears only `CF`, and `STC` sets only `CF`; `PUSHF` writes the exact 16-bit FLAGS image to the decremented `SS:SP` stack slot; `POPF` reads a wrapped 16-bit stack word, ignores reserved bit positions, and commits all implemented FLAGS bits plus `SP+2` only after the high byte; `INT imm8` performs the real-mode FLAGS/CS/post-IP stack sequence and IVT transfer; `IRET` (`CF`) reads `IP:CS:FLAGS` from six wrapped `SS:SP` bytes and commits all implemented return state plus `SP+6` only after the complete frame; memory `FF /2` performs an indirect near call, including `CS:`-overridden function-table reads and an `SS:SP` return-IP push; `FF /4` performs register or memory indirect near jumps without a stack write, including `CS:`-overridden table reads; `RETF imm16` (`CA`) reads return `IP:CS` from four wrapped `SS:SP` bytes, commits only after the complete frame, and applies unsigned immediate cleanup modulo 16 bits;
- CSS forms 20-bit physical addresses as `segment << 4 + offset`: instruction fetches use `CS:IP`, direct operands use `DS:moffs16`, stack traffic uses `SS:SP`, and ModR/M memory operands implement all eight 8086 base/index forms with signed `disp8`, `disp16`, direct `disp16`, BP-based `SS`, otherwise `DS`, and an explicit one-instruction `CS` override;
- `LOCK` (`F0`) latches across the next supported memory read-modify-write instruction and asserts a CSS-owned byte-bus lock across every operand read/write cycle; invalid targets fault; `IN AL,DX` (`EC`) consumes a byte from a CSS-owned I/O-read cycle; `OUT DX,AL` (`EE`) emits a CSS-owned I/O-write cycle with a 16-bit port and byte data; the CSS netlist itself decodes `03F2h`, latches the IBM AT DOR's implemented select/reset/IRQ-DMA-enable/motor bits, clears controller `INT` while reset is asserted, models the first post-reset attention event on reset release, and gates that pending `INT` to an observable IRQ6 request through DOR bit 3; the opcode-blind JavaScript adapter still only records generic bus cycles;
- the public trace begins at `FFFF0h`, fetches the five-byte `EA 0000:7c00` reset stub, then lands at physical `07c00h`; this is a synthetic landing ROM, not a BIOS or boot sector;
- Intel defines logical-instruction `AF` as undefined; the core resolves it deterministically to zero, consistently across its implemented logical instructions;
- independent browser proofs cover exact register selectors, effective addresses, stack ordering and wrap, byte sibling preservation, all-selector register and all-EA memory-source `ADD r16,r/m16` result/flag/destination/atomicity/non-collateral proofs, all-selector register `SUB r16,r/m16` proofs, all-selector register `SUB r8,r/m8` with byte-sibling preservation, both byte `CMP` directions across all register pairs and memory EAs, all-register word and all-selector register byte `INC/DEC` boundary/flag/CF-preservation proofs with byte-sibling preservation, all-selector simultaneous byte and word register `XCHG` with byte-sibling and flag preservation, and early memory-form rejection, arithmetic flags including `CMC`/`CLC`/`STC` collateral preservation, exact `PUSHF`/`POPF` bit mapping/stack byte order/wrap/atomic commit/reserved-bit handling/non-collateral, and byte-immediate subtraction, all-register sign-extended word-immediate addition with destination-only writeback, sign-extended word-immediate comparison without writeback, group-selector rejection, prefix lifetime, interrupt stack/IVT order, interrupt-return byte order/wrap/all-FLAGS/atomic commit, indirect-call target and return custody, indirect-jump register/memory targets, atomic word-read commit and no-stack behavior, far-return stack order/wrap/cleanup and atomic commit, memory-TEST immediate/operand bus order and no-write behavior, byte-MUL register/memory products, atomic `AX` plus `CF/OF` commit and undefined-flag preservation, memory-OR/AND immediate/read/write order, all-EA byte RMW, memory-CMP immediate/read order and no-write subtraction flags across all EAs, logical flags, prefix lifetime and early form rejection, LOOP decrement/taken/fallthrough/IP-wrap behavior and `JCXZ` zero/nonzero/signed-wrap behavior with unmodified `CX`, both with full flag preservation, atomic little-endian `LODSW` reads and `STOSW` writes with offset wrap, DF-controlled ±2 stepping, atomic register commit, fixed `ES` destination for stores, `REP STOSW` zero-count skip and repeated CX/DI progression, CS override for loads, and no flag/collateral mutation, rotate/shift count behavior including all-register arithmetic-right sign fill and exact CF/PF/ZF/SF/OF, deterministic shift AF=0, invalid group selectors, exact memory plus port-output traces, DOR implemented/reserved bits, reset polarity, pending-controller-INT clearing, IRQ-enable gating, and unrelated-port isolation;
- the ALU proof still differential-tests 1,045 mixed edge/random operation vectors in real Chromium.

The generated ALU is **376 registered one-bit nets / 59,974 CSS bytes**. The CPU-plus-current-device slice is **5,053 nets / 2,660,446 CSS bytes** and exposes `AL/CL/DL/BL/AH/CH/DH/BH` aliases plus manifest-declared memory, port-output, DOR, reset, controller-INT, and IRQ6-request contracts.

The first scalar prototype failed usefully: Chromium rounded `0xffffffff` as a typed CSS number, yielding `4294970000`. That made a scalar 32-bit custom property dishonest. The current design therefore uses one custom property per wire. The uglier architecture is also the truer one.

## Honesty boundary

CSS owns:

- operation, x86 opcode, ModR/M field/direction/mode decode, displacement capture and sign extension, and the full 8086 16-bit effective-address matrix;
- real-mode default/override segment selection, segment-register write decode, one- and two-byte memory plus stack read/write/RMW microphases, four-byte far-pointer, far-return-frame, six-byte interrupt-return-frame, and IVT reads, `MOVSB` source/write cycles, `LODSB/LODSW` source/atomic accumulator commit cycles, `STOSW` little-endian `ES:DI` writes, CSS-owned `SI/DI/CX` string updates, architectural SP ordering, `IF/TF/DF` update, interrupt entry, I/O-write issue, and 20-bit physical address formation;
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

If runtime JavaScript branches on opcode, ModR/M field, addressing mode, flag meaning, privilege level, segment type, page-table semantics, exception vector, or device meaning, the central claim has failed. Unsupported group selectors and intentionally absent register/memory forms fault before consuming hidden operands. `F3` is accepted only as `REP MOVSB`; another target faults. `CS` is the only implemented segment-override prefix. `INT` entry exists, but hardware interrupt delivery, interrupt-inhibition shadows, port input, PIC semantics, FDC commands/status/result queues, DMA, drive mechanics, disks, and firmware ROM are not provided. The only device behavior is the narrow CSS-owned `03F2h` DOR/reset/post-reset-INT/IRQ6-request slice above; the IRQ request is not delivered to the CPU. An `OUT` trace by itself still proves only that the CPU issued a port cycle.

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
