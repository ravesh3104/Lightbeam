# `tools/diag` — the measurement scripts

These are not part of the app. Nothing in `packages/core`, `apps/web` or
`apps/server` imports them, and no test runs them. They exist because several
decisions in this project were made by *measuring* rather than guessing, and the
numbers are only trustworthy if the thing that produced them is still in the
repository.

Two of them are wired to npm scripts and referenced by number in
[../docs/ALGORITHMS.md](../docs/ALGORITHMS.md):

| Script | Run it with | It answers |
| --- | --- | --- |
| `degree-experiment.ts` | `npm run diag:degree` | Which degree distribution should the fountain code use? Sweeps ideal / robust / uniform soliton and a range of `c`, over clean, lossy and bursty channels. Output archived in `docs/degree-experiment-output.txt`. |
| `prefix-experiment.ts` | `npm run diag:prefix` | How long should the systematic prefix be? Sweeps the fraction of `k` sent in order. Output archived in `docs/prefix-experiment-output.txt`. |
| `path-length.ts` | `npx tsx tools/diag/path-length.ts` | How big is the SVG path string the native renderer rebuilds for every animation frame? Used to choose `QrView`'s symbol-size ceilings; the ceiling is justified with these numbers. |

The rest are **historical**: they were written to isolate one specific bug or
verify one specific fix, and they are kept for the same reason a lab notebook is
kept — so the claim can be re-run if it is ever doubted. They print to stdout and
are not maintained as tools.

| Script | What it was for | What it found |
| --- | --- | --- |
| `verify-roundtrip.ts` | Isolates the receiver bug where `isComplete === true` returned *different bytes* than were encoded | Reproduced the self-XOR aliasing in `drainReady` (a solved block was used to solve an equation that was still listening to it) — see the note in `fountain/lt.ts` and the regression test in `fountain.test.ts` |
| `debug-frame.ts` | Frame-by-frame trace of one failing session | Located which frame first corrupted the block table |
| `profile-lt.ts` | Where does the time go for a given `k`? | Led to the stall-hysteresis and dense-solve budget in the decoder; the naive uniform sampler was the actual hang |
| `lt-diag.ts` | Systematic-prefix behaviour on a clean channel | Confirms the prefix is a *latency* optimisation, never a correctness requirement |
| `diag.mjs` | First-day prototype: does the QR encoder produce symbols `jsQR` can read, at every size and scale? | Yes — and it fixed the minimum usable `scale` that the tests and the web app now use |

Two conventions worth keeping if you add one:

- Import the engine as `@lightbeam/core` where possible (it resolves through the
  workspace). Scripts that poke at internals — the ones above that need
  `LTEncoder`, the sampler or `toSvgPath` before they were exported — import
  `packages/core/src/...` directly, which is why some of them still say `.js` in
  the specifier even though the file is `.ts`: that is how the compiled output
  resolves, and `tsx` handles it.
- Print a line you can diff. Every script here prints plain `key=value` or JSON
  so an output file can be compared between runs.
