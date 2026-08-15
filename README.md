# win95.css

An honest experiment toward an i386-compatible CPU implemented in generated CSS.

The distant target is deliberately ridiculous: boot an unmodified Windows 95 RTM installation on an architectural i386 machine whose decode, arithmetic, registers, segmentation, paging, privilege checks, faults, interrupts, and commit logic are expressed in generated CSS.

That is **not** the current claim.

## Current milestone: the first organ twitches

The repository currently contains one 32-bit `ADD` datapath:

- operands are driven as 64 registered one-bit CSS custom properties;
- generated CSS performs a 32-stage ripple carry;
- generated CSS produces the latched result plus `CF`, `PF`, `AF`, `ZF`, `SF`, and `OF`;
- a manifest-driven JavaScript shim drives physical pins, samples pins, and latches the state bank;
- an independent oracle differential-tests 1,009 edge/random vectors in real Chromium.

The generated artifact is currently **205 registered one-bit nets** and about **25 KiB of CSS**.

The first scalar prototype failed usefully: Chromium rounded `0xffffffff` as a typed CSS number, yielding `4294970000`. That made a scalar 32-bit custom property dishonest. The current design therefore uses one custom property per wire. The uglier architecture is also the truer one.

## Honesty boundary

CSS owns:

- the ripple-carry network;
- result-bit computation;
- all architectural ADD flags;
- combinational next-state pins.

The runtime JavaScript owns:

- manifest-declared bus serialization and deserialization;
- driving CSS input pins;
- sampling CSS output pins;
- one generic state-bank latch;
- UI and diagnostics.

`src/chip.js` contains no addition, carry, parity, overflow, or x86 flag logic. The arithmetic oracle exists only in the browser test and is not loaded by the demo.

If runtime JavaScript eventually branches on opcode, addressing mode, flag meaning, privilege level, segment type, page-table semantics, or exception vector, the central claim has failed.

## Run the proof

```bash
npm install
npx playwright install chromium
npm test
```

The test regenerates `generated/alu32.css`, opens the demo in headless Chromium, and compares every latched state against an independent JavaScript oracle.

Open `index.html` through any static HTTP server to use the bring-up instrument interactively.

## Shape of the project

- `rtl/` — small declarative netlist source and development-only reference evaluator
- `scripts/generate.mjs` — IR to generated CSS + manifest
- `generated/` — auditable generated netlist artifact
- `src/chip.js` — generic physical glue/latch
- `src/app.js` — demo UI only
- `test/` — real-browser differential tests

The likely milestone ladder is:

1. `ADD` and architectural flags — **working**
2. broader ALU + register-transfer microsteps
3. tiny real-mode fetch/decode loop and bus traces
4. 386 protected mode, paging, privilege, faults, and differential conformance
5. BIOS and a small real-mode guest
6. Windows 95 Safe Mode
7. normal RTM desktop, mouse, and Notepad

A complete cold boot must exist before the headline claim exists. Checkpoints may make a geological demo usable, but they cannot substitute for the boot.

## Naming

**CSS/386** is the generated CPU core. **win95.css** is the eventual artwork built around it.

MIT licensed.
