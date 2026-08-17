# win95.css

An honest experiment toward an i386-compatible CPU implemented in generated CSS.

The distant target is deliberately ridiculous: boot an unmodified Windows 95 RTM installation on an architectural i386 machine whose decode, arithmetic, registers, segmentation, paging, privilege checks, faults, interrupts, and commit logic are expressed in generated CSS.

That is **not** the current claim.

## Current milestone: the real-mode bootstrap spine

The repository currently contains two generated organs:

- a 32-bit operation-selected ALU for `ADD`, `SUB`, `AND`, `OR`, and `XOR`, with architectural result flags;
- a 16-bit real-mode seed core with CSS-owned `CS/DS/SS/ES`, `IP`, all eight general registers, `IR`, immediate, phase, halt, fault, arithmetic flags, `IF`, and `DF`;
- generated CSS reset state starts at architectural `CS=F000h`, `IP=FFF0h`, fetching physical `FFFF0h`;
- CSS decodes the full real x86 `B0..B7` `MOV r8,ib` and `B8..BF` `MOV r16,iw` families; register and 16-bit memory ModR/M forms for `MOV r/m16,r16` (`89`), `MOV r16,r/m16` (`8B`), `XOR r/m16,r16` (`31`), and `XOR r16,r/m16` (`33`); register-mode `MOV Sreg,r/m16` (`8E`, valid `ES/SS/DS` destinations only); plus memory-only `LDS r16,m16:16` (`C5`), `PUSH r16`, `POP r16`, `PUSH ES/CS/SS/DS`, `POP ES/SS/DS`, `MOV [moffs16],AX`, `JMP rel8`, `JMP rel16`, `JMP ptr16:16`, `CALL rel16`, `RET`, `JZ rel8`, `JNZ rel8`, `ADD AX,iw`, `SUB AX,iw`, `XOR AX,iw`, `CLI`, `STI`, `CLD`, and `HLT`;
- CSS forms 20-bit physical addresses as `segment << 4 + offset`: instruction fetches use `CS:IP`, direct stores use `DS:moffs16`, CALL/RET/PUSH/POP traffic uses `SS:SP`, and ModR/M memory operands implement all eight 8086 base/index forms with signed `disp8`, `disp16`, direct `disp16`, BP-based `SS`, and otherwise `DS`; `LDS` reads offset+segment across four wrapped 16-bit offsets and commits the selected GPR plus `DS` atomically;
- a manifest-driven, opcode-blind JavaScript byte bus services CSS-emitted read/write/address/data pins against opaque 1 MiB storage and records the trace;
- the public trace begins at `FFFF0h`, fetches the five-byte `EA 0000:7c00` reset stub, then lands at physical `07c00h`; this is a synthetic landing ROM, not a BIOS or boot sector;
- independent browser proofs preserve ordinary zero-segment execution, verify nonzero `CS:IP`, `DS:moffs16`, and `SS:SP` addressing, execute an unrelated far jump from `1234:0010` to `3000:2000`, prove signed unconditional/conditional short branches, cover every ModR/M GPR selector in both directions, all eight `mod=00` effective-address forms, negative `disp8`, `disp16`, exact DS/SS defaults, two-byte `MOV` loads/stores, `XOR` load and read-modify-write traces/flags, nonzero `ES/SS/DS` loads without source mutation, every 16-bit GPR PUSH/POP selector, segment PUSH/POP, i386 `PUSH SP`/`POP SP` ordering, post-`POP SS` stack addressing, nonzero `LDS` through every destination selector with BP/SS defaults and 16-bit address wrap, rejection of register-form `LDS`, `MOV CS`, reserved segment selectors, and memory-form `MOV Sreg`, all eight byte-immediate register selectors with sibling-byte preservation, plus `CLI`/`STI` and `CLD` clearing a seeded `DF` without disturbing flags;
- the ALU proof still differential-tests 1,045 mixed edge/random operation vectors in real Chromium.

The generated ALU is **376 registered one-bit nets / 59,974 CSS bytes**. The byte-register-capable CPU is **2,493 nets / 722,897 CSS bytes** and exposes `AL/CL/DL/BL/AH/CH/DH/BH` aliases in its manifest.

The first scalar prototype failed usefully: Chromium rounded `0xffffffff` as a typed CSS number, yielding `4294970000`. That made a scalar 32-bit custom property dishonest. The current design therefore uses one custom property per wire. The uglier architecture is also the truer one.

## Honesty boundary

CSS owns:

- operation, x86 opcode, ModR/M field/direction/mode decode, displacement capture and sign extension, and the full 8086 16-bit effective-address matrix;
- real-mode default-segment selection, segment-register write decode, two-byte memory and stack read/write/RMW microphases plus four-byte far-pointer reads, architectural SP ordering, `IF`/`DF` update, and 20-bit physical address formation;
- generated reset defaults, fetch-phase transitions, `IP` increment, far `CS:IP` transfer, register transfer, halt, and invalid-opcode faulting;
- the shared add/sub carry networks and bitwise logic paths;
- result-bit computation and architectural flags (logical operations deliberately drive undefined `AF` to zero for now);
- every combinational next-state pin.

The runtime JavaScript owns:

- manifest-declared bus serialization and deserialization;
- opaque byte storage behind CSS-emitted address/read/write/data pins;
- driving CSS input pins and sampling CSS output pins;
- one atomic generic state-bank latch;
- UI, bus trace, and diagnostics.

`src/chip.js` and `src/byte-bus-machine.js` contain no opcode or ModR/M decode, arithmetic, carry, parity, overflow, or x86 flag logic. The independent operation/x86 oracles exist only in browser tests and are not loaded by either demo.

If runtime JavaScript eventually branches on opcode, ModR/M field, addressing mode, flag meaning, privilege level, segment type, page-table semantics, or exception vector, the central claim has failed. The 16-bit memory subset currently covers opcodes `89`, `8B`, `31`, `33`, and memory-only `C5`; register-form `LDS` and memory-form `MOV Sreg` remain deliberately unsupported and fault after their ModR/M byte. There are no byte-width ModR/M operations, string instructions, repeat prefixes, or segment-override prefixes yet. `IF` is real state controlled by `CLI`/`STI`; `DF` is real state and `CLD` clears it, but interrupt delivery does not exist, so the architectural interrupt-inhibition window after `MOV SS` has no observable mechanism and is not modeled as a separate shadow.

## Run the proof

```bash
npm install
npx playwright install chromium
npm test
```

The tests regenerate both CSS artifacts, exercise the ALU and seed CPU in headless Chromium, compare latched state against independent oracles, and verify the exact byte-bus trace.

Open `index.html` for the reset-vector and synthetic landing-ROM spine or `alu.html` for the standalone operation-selected ALU. `cpu.html` is a compatibility redirect to the homepage, preventing duplicate instrument markup from drifting.

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
