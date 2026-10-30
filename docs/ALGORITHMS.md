# Every algorithm and technique, and why

This is the technical companion to the code: what each algorithm is, why it was
chosen, what the alternative would have cost, and the measurements that decided
between them. Nothing here is aspirational — every number came from a script in
`tools/diag` or a test in `packages/core/test`.

---

## 1. The channel, and what it does to a protocol

An optical link between a screen and a camera is not a slow network. It has a
different failure profile, and the protocol has to be built around it:

| Property | Consequence for the protocol |
| --- | --- |
| Frames are dropped **whole**. A symbol photographed mid-transition, out of focus, or motion-blurred decodes as nothing at all. | Never rely on a sequence. Every frame must stand alone. |
| There is **no return channel**. The receiver cannot request a retransmission. | The sender must be able to keep producing useful frames forever, and the receiver must tolerate arbitrary gaps. |
| The receiver's frame rate is **independent** of the sender's. | Frames must be self-describing and order-independent. |
| Loss is **bursty**, not uniform: an autofocus hunt loses hundreds of consecutive frames. | Error correction across time is useless; the redundancy must be *across frames*, not inside them. |
| The channel is **public**: any camera can read the screen. | Confidentiality must be optional and explicit, never implied. |
| Throughput is ~10⁴ times lower than Wi-Fi. | Per-frame overhead must be tiny (13 bytes), and the symbol must carry as much as the camera can resolve. |

The design that falls out of this table is a **fountain code**: an endless stream
of independent, self-describing frames, where the receiver needs only *slightly
more frames than there are source blocks*, regardless of which ones it missed.

---

## 2. Fountain coding: Luby Transform codes

### 2.1 The idea

Split the file into `k` source blocks, S₀…S_{k−1}. Each frame carries the XOR of a
randomly chosen subset of them, together with enough information (a 32-bit seed) for
the receiver to recompute *which* subset — from the seed alone, with no history.

```
frame 42  = S₃ ⊕ S₁₇ ⊕ S₂₀₁          seed 42  (degree 3)
frame 43  = S₉                        seed 43  (degree 1)
frame 44  = S₀ ⊕ S₅ ⊕ S₉ ⊕ … (17 of them)   seed 44  (degree 17)
```

The receiver collects frames and **peels**: a degree-1 frame immediately reveals its
block; once a block is known, it can be XORed out of every frame that contains it,
possibly turning a degree-2 frame into a degree-1 frame, and so on. This is
Belief-Propagation over GF(2), and for LT codes it recovers all `k` blocks in
`k + O(√k · ln²(k/δ))` frames.

The reason this is the right tool here, rather than Reed–Solomon or a
rateless scheme with feedback: the decoder needs **no idea what it is missing**. A
frame that arrives twice is free to discard; a frame that never arrives costs one
extra frame later. There is no sequence number, no window, no state machine.

### 2.2 The degree distribution is what makes peeling work

If every frame had degree 1, the receiver would wait for each specific block to
appear — with 30% frame loss, some blocks would take many times longer, and the
transfer would tail off badly. If every frame had a large degree, no frame would
ever have exactly one unknown, and peeling would never start.

The **robust soliton** distribution solves both ends at once:

- most frames have degree 2–4, so peeling frequently finds a solvable equation;
- a "spike" at degree ≈ k/R guarantees that the *last* few unknowns are covered, so
  the process terminates rather than stalling with a handful of orphan blocks.

Formally, with the ideal soliton

```
ρ(1) = 1/k,    ρ(i) = 1 / (i(i−1))   for i = 2 … k
```

and the spike, for R = c · ln(k/δ) · √k,

```
τ(i) = R/(i·k)              for i = 1 … k/R − 1
τ(k/R) = R·ln(R/δ)/k
```

the robust soliton is `μ(i) = (ρ(i) + τ(i)) / β` with β = Σ(ρ+τ) as the normaliser.

LightBeam ships **c = 0.03, δ = 0.5**.

### 2.3 The measurement that chose c

`tools/diag/degree-experiment.ts`, k = 1024, clean channel, 5 trials, reporting the
frames the sender displays per source block. Every distribution is measured twice: as
a pure LT stream (`lt`, no systematic prefix at all) and with the shipped 0.10K prefix
in front of it (`sys+lt`):

| distribution | `lt` | `sys+lt` | verdict |
| --- | --- | --- | --- |
| **robust soliton c = 0.03** | **1.096** | **1.102** | shipped |
| robust soliton c = 0.10 | 1.164 | 1.174 | a heavier spike costs more than it saves |
| robust soliton c = 0.00 (pure ideal soliton) | 2.059 | 1.309 | **trap** |
| ideal soliton + dense fallback (limit 512) | 2.059 | 1.309 | the fallback cannot rescue a bad distribution |

Mean degree is 8.23 at k = 256 and 10.57 at k = 1024.

The ideal-soliton result is the most instructive number in this project. Ideal
soliton is *asymptotically optimal* — and needs 1.9× the screen time of the shipped
distribution at k = 1024 (2.059 against 1.096, both without a prefix). The mechanism
is measured, not assumed: the same run prints that at k = 1024 the ideal distribution
puts **0.10 %** of its mass on degree-1 frames against **0.77 %** for the robust one,
and degree-1 frames are the ones that finish a source block outright. With that little
mass, peeling stalls with a handful of blocks uncovered while the sender keeps
transmitting frames that cannot complete them. Textbooks present ideal soliton as *the*
distribution; the measurement says otherwise, which is why the experiment exists as a
script that anyone can rerun.

The two loss channels in the same run agree: at 30 % frame loss the shipped
distribution needs 1.554 frames per block against 1.653 for c = 0.10 and 1.854 for the
ideal soliton, and in the bursty channel 3.594 against 3.838 and 4.203. The prefix
itself costs 0.006 frames per block on a clean channel (1.096 → 1.102, half a percent)
and saves 0.034 at 30 % loss and 0.236 in the bursty channel — cheap insurance, bought
deliberately. (The prefix sweep in §2.5 measures the same schedule as a 0.00 prefix row
at 1.138 with 3 trials; different seeds, same conclusion within run-to-run noise.)

### 2.4 The stateless neighbour sampler

Both sides must be able to turn `(seed, k, sessionId)` into "which blocks does this
frame contain?" — the receiver has no other information about a frame's contents.

The obvious implementation: draw `degree` random indices, scan what you have so
far for duplicates, redraw if you find one. That is O(degree²), which is fine for
degree ≈ 10 and catastrophic otherwise — the `uniform` distribution (mean degree
k/2, used as an experimental control) hung the benchmark at k = 1024. Finding that
took a profiled run with per-configuration progress output, and it is worth
remembering as a class of bug: an algorithm that is fine for the shipped
parameters and pathological for a parameter the experiments sweep.

The shipped sampler is a **sparse Fisher–Yates**: a scratch array with an epoch
marker, touching only the `degree` entries it needs, O(degree) time and space, no
allocation per frame, and — critically — *history independent*, so the same seed
yields the same set no matter which frames arrived before it.

Two implementation notes that are easy to get wrong:

- Emitting the *source* index instead of the *displaced* one biases the selection
  toward low indices; the correct form is `atI = get(i); atJ = get(j);
  neighbours[i] = atJ; if (j !== i) set(j, atI)`. A uniformity test catches this.
- Degrees ≤ 8 use the simple duplicate scan (cheaper than setting up the scratch
  array), and degree == k returns the identity.

### 2.5 The systematic prefix

The first 10% of data frames carry **single, uncoded blocks**, in order. A receiver
that starts at the beginning therefore has 10% of the file within the first second,
rather than waiting for the fountain to produce a solvable degree-1 equation.

That is a latency optimisation, but the interesting question is how much prefix.
A fully systematic stream is optimal on a perfect channel (1.000 frames per block)
and the **worst** option under loss (2.054 at 30%, 4.028 at 50% plus bursts),
because a missed systematic frame leaves a *specific* hole that only that block can
fill, whereas an LT frame covers the whole block space uniformly. Patching holes
costs more than covering from scratch.

Measured (k = 1024, 3 trials, frames sent per block):

| prefix / k | clean | 30% loss | 50% + bursts |
| --- | --- | --- | --- |
| 0.00 | 1.138 | 1.630 | 3.849 |
| **0.10** | **1.106** | **1.619** | **3.664** |
| 0.25 | 1.191 | 1.682 | 3.714 |
| 0.50 | 1.354 | 1.840 | 3.767 |
| 0.75 | 1.360 | 1.935 | 4.025 |
| 1.00 | 1.000 | 2.054 | 4.028 |

Same ordering at k = 64, 128 and 512. So 0.10 is near-optimal in every column, and
the trade is accepted deliberately: a short prefix buys a fast cold start without
paying for it under loss.

### 2.6 The dense fallback

Peeling occasionally stalls with a handful of unknowns — an equation that cannot be
reduced because two unsolved variables appear together in one frame. When the
number of unknowns drops below a limit (default 256) *and* peeling has not
progressed for N frames, the decoder switches to **Gaussian elimination over
GF(2)**: build the bit matrix of the remaining equations, reduce it, and back-
substitute.

GF(2) elimination is cheap per row (XOR) but O(r²) in the number of unknowns, so it
must not run often. The guards are: a stall counter, a *signature* of the remaining
variable set so the elimination is not repeated for an unchanged set, and a work
budget. The earlier version re-ran full elimination every frame and looked like a
hang — a reminder that a fallback path needs the same performance scrutiny as the
main path, because it runs precisely when the system is already struggling.

---

## 3. QR symbols: the encoder, from the spec up

The app generates QR symbols itself rather than using a library, for one
configuration reason and one performance reason: the planner must size blocks from
the *exact* capacity of a chosen version and error-correction level, and at 15 fps
the encoder is on the critical path of every frame.

### 3.1 What a QR symbol physically is

Modules (the black and white squares) laid out in a `(17 + 4v) × (17 + 4v)` grid,
version `v` = 1…40, so 21×21 up to 177×177. Around it, a four-module quiet zone —
which is why every LightBeam renderer keeps a genuinely white border around the
symbol, and why a themed background breaks decoders.

### 3.2 The pipeline this repository implements

```
payload → segments → bitstream → padding → block split → Reed-Solomon
        → interleave → module placement → mask selection → format/version bits
```

**Segmentation.** A QR payload is a sequence of segments in different modes:
numeric (10 bits per 3 digits), alphanumeric (11 bits per 2 characters), byte
(8 bits per byte), and a few rarely-used ones. LightBeam implements the first three
and chooses the segmentation with a **dynamic program** over code points, because
the naive "one mode for everything" is badly wrong for the data this app produces:

| payload | naive byte mode | chosen segmentation |
| --- | --- | --- |
| `"1234567890123456"` | 128 bits | 54 bits (numeric) |
| base32 frame text | 8 bits/char | 5.5 bits/char (alphanumeric) |

That second row is the entire reason base32-on-the-wire is affordable: the wire
encoding and the QR mode were chosen together.

**Padding and termination.** A terminator, then pad bits to the codeword boundary,
then the alternating pad codewords 0xEC/0x11 — exactly as the spec prescribes, since
a decoder expects to find them.

**Error correction.** Data codewords are split into blocks per the spec's table
(version and EC level determine block count and sizes), each block gets its own
Reed-Solomon codewords, and the blocks are **interleaved**. The interleaving is
group-then-position: shorter blocks first.

> This is the bug that made the version range matter. Interleaving the long blocks
> first produces symbols that are perfectly valid up to version 9 and undecodable
> from version 10 — a spectacularly annoying failure mode, which is why the encoder
> tests sweep versions rather than testing the one version the app ships with.

**Reed–Solomon over GF(256).** With the primitive polynomial 0x11D. Multiplication
through log/antilog tables (~1 kB) turns each multiply into an add-mod-255 and two
lookups. LightBeam uses the EC level the profile requests, and can optionally boost
it to the highest level that still fits the chosen version — free robustness for a
camera channel, on by default.

**Module placement.** Finder patterns and separators in three corners, timing
patterns, alignment patterns for version ≥ 2, the dark module, then data bits in
the two-module-wide columns in the spec's zig-zag order (up, up, down, down), with
reserved modules skipped.

**Masking.** Eight mask patterns, each XORed over the data modules. The encoder
evaluates all eight with the spec's four penalty rules and picks the lowest:

| rule | penalty | intent |
| --- | --- | --- |
| N1 | 3 + (run − 5) per run of ≥ 5 same-coloured modules | avoid long runs that confuse timing recovery |
| N2 | 3 per 2×2 block of one colour | avoid large flat areas |
| N3 | 40 per 1:1:3:1:1 pattern resembling a finder | avoid false finders |
| N4 | 10 × deviation from 50% dark | keep contrast balanced |

Mask choice is not cosmetic on an optical channel: a symbol whose dark/light balance
is far from 50% thresholds badly when the camera's exposure is imperfect, and the
tests assert the ink coverage stays in a sane band.

**Format and version information.** The 15-bit format field (EC level + mask) and,
for version ≥ 7, the 18-bit version field, each encoded with its BCH code and the
mandatory XOR mask — because those bits must be readable before any error
correction can help.

### 3.3 Verification strategy

The encoder is verified by **differential testing against an independent decoder**:
every symbol is rasterised and decoded with **jsQR**, a completely separate
implementation. If the bitstream, padding, block structure, interleaving, mask or
format bits were wrong, jsQR would either fail or return different bytes. This is
the strongest correctness argument available without physical hardware, and it
covers versions 1–40 and all four EC levels.

A second, structural check pins the **capacity table**: for every version and EC
level, the encoder must be able to fit exactly the number of bytes the table claims,
and one more must fail.

---

## 4. The wire encoding: base32, and why the whole frame

### 4.1 The constraint

Browser barcode engines — the Shape Detection `BarcodeDetector` API and `jsQR` —
return the decoded QR content as a **string**. Not bytes. Any byte above 0x7F that
is not valid UTF-8 is replaced or dropped at that boundary, and there is no API on
`BarcodeDetector` to ask for the raw bytes (`rawValue` is always a `DOMString`).

A 13-byte binary header containing a session id and a seed will therefore be
corrupted by a real device. (This was not theoretical: the failure appeared as
`Invalid base32 character "\u0010" at index 1` during development.)

### 4.2 The choice

Encode the **entire frame** — header and payload — as RFC 4648 base32, unpadded
uppercase, and emit it in QR **alphanumeric** mode. The frame becomes pure ASCII
and survives any decoder's string handling exactly.

| Encoding | QR mode | bits per data byte | survives platform decoders |
| --- | --- | --- | --- |
| **base32** | alphanumeric (5.5 bits/char) | **8.80** | yes |
| base64 | byte (8 bits/char) | 10.67 | no — non-ASCII bytes |
| hex | alphanumeric | 16.5 | yes, but +88% |
| raw bytes | byte | 8.00 | no |

The insight that makes base32 affordable is that its alphabet (`A–Z` and `2–7`) is a
**subset of the QR alphanumeric character set**, whose encoding packs 2 characters
into 11 bits. So the cost is 5.5 bits per 5 source bits = 8.8 bits per byte, about
10%, not the 33% base64-in-byte-mode appears to cost and not the 100% hex costs.

### 4.3 Consequences elsewhere

- The planner computes block size as `base32DecodedLength(frameCapacity) − 13`, so
  a frame is filled to capacity rather than overflowing on the last symbol.
- Manifest fragments are sized from the plan's `blockSize`, so one fragment fills
  one frame under either encoding.
- `wireEncoding: 'raw'` remains available (browser-to-browser, ~10% faster) and is
  selected explicitly, never by default.
- The receiver's `accept()` takes a **string or bytes** and sniffs the encoding from
  the frame magic, so a platform decoder's output can be passed straight in.

---

## 5. Integrity: two checks, two jobs

**CRC-16/CCITT-FALSE** in every frame header, over the 11 header bytes. Its job is
*admission control*: a damaged frame is dropped at the door rather than fed to the
fountain decoder. This matters more than it sounds — an LT decoder poisoned by one
frame with wrong block contents produces a **complete but wrong** file, which then
fails the final SHA-256 and wastes the *entire* transfer, not one frame. The CRC
costs 2 bytes per 13-byte header and it is the cheapest insurance in the system.
Check value: CRC-16/CCITT("123456789") = 0x29B1.

**CRC-32** in every manifest fragment, over the fragment body, so a receiver can
discard a single damaged piece of metadata without discarding the whole manifest.

**SHA-256** over the original payload, carried in the manifest, verified after
reconstruction, decryption and decompression. This is the authoritative check and it
gates the release of the file: a received file that fails it is never previewed,
never written to storage and never offered for download. CRC-32("123456789") =
0xCBF43926 is pinned in the tests too.

Why both a CRC and a hash: the CRC is about *not wasting work*, the hash is about
*not lying to the user*. They have different failure budgets and a shared
implementation would compromise both.

---

## 6. Confidentiality: XChaCha20-Poly1305 with scrypt

### 6.1 Why a passphrase, and why it needs a slow KDF

The threat model is specific and modest: **the room**. Anything on the sending
screen is legible to any camera, and the transfer may be happening in a café. The
passphrase is the mechanism that solves it, and it is spoken aloud or typed by hand,
which means it is short and low-entropy — so the key derivation has to be expensive
to brute-force.

`scrypt` with **N = 2¹⁵, r = 8, p = 1** and a **random 16-byte salt** (carried in
the manifest) costs roughly 100 ms in a modern browser. That is deliberate: it is noticeable
enough to make a guess expensive and fast enough that a user entering a passphrase
does not resent it. A `FAST_KDF` (N = 2¹²) exists for the tests, which run hundreds
of sessions and would otherwise spend minutes in key derivation.

### 6.2 Why XChaCha20-Poly1305

- **24-byte nonces.** A random nonce has no realistic reuse risk, so there is no
  counter to persist and no "reuse the nonce and lose confidentiality" footgun.
  (The same reasoning is why this, rather than AES-GCM with its 12-byte nonce, is
  the right default for a one-shot protocol.)
- **AEAD.** The Poly1305 tag is what stops an attacker from flipping bits in the
  stream and getting a *plausible* wrong file: decryption fails rather than
  producing garbage. The receiver treats a tag failure as "wrong passphrase",
  which is the honest interpretation.
- **No padding oracle, no mode choice, no configuration surface.** One primitive,
  used once per payload.

Constructed as XChaCha20-Poly1305 with a 96-bit key (scrypt output) and the nonce in
the frame's manifest — never in the stream.

### 6.3 The associated data, and one subtlety

The AEAD authenticates not just the ciphertext but a set of **identity fields**
(session id, name, mime, lengths, block size and count, codec, encoding, SHA-256).
Both the sender and the receiver build that structure from the **same function**
(`manifestAssociatedData`), which is the only way to be sure they agree about what
was covered. Disagreement here produces the classic one-sided decryption failure.

### 6.4 The passphrase never travels

The passphrase is *never* in the QR stream, not even hashed. What the sender shows
is a **fingerprint**: the first 4 bytes of `SHA-256("lightbeam-fingerprint" ‖ salt ‖
key)`, rendered as eight hex digits. Two humans compare it, or the receiver derives
it independently. That turns "we typed different things" into a five-second check
*before* a five-minute transfer, instead of a failure at the end.

A wrong passphrase fails the authentication tag during decryption — after all blocks
have arrived, in the normal case, since the receiver has no way to know the
passphrase is wrong earlier. The web receiver therefore keeps the
collected blocks and re-attempt the finish when the user supplies a key, which means
**the transfer completes without another frame from the camera**.

---

## 7. Compression

**Deflate** (via `fflate`, level 6), applied only when it saves more than 5%, and
skipped above 64 MB to bound worst-case memory inside a browser tab.

The policy sounds trivial and is not:

- **On this channel, compression is time.** A 10× smaller payload is a 10× shorter
  transfer at a fixed frame rate. Text, JSON, CSV, source code and PDFs compress
  enormously — a 3 kB message usually goes out in a single frame.
- **But compressing incompressible data wastes time**, both the CPU to do it and the
  frame budget while the sender is holding a payload it could already be
  transmitting. Hence `MIN_GAIN` and `looksCompressible()` (a sampled entropy
  estimate below 7.5 bits/byte), which skips a JPEG or a ZIP outright.
- **The codec tag travels in the manifest** (`store` | `deflate`), and the receiver
  inflates using the *original length* recorded there — if the inflated length does
  not match, that is treated as corruption rather than delivered.

---

## 8. Symbol geometry and the frame rate: an optical budget

Frame size and frame rate are not free parameters; they trade against each other
through the camera's ability to resolve the symbol.

**Resolution.** A camera resolves a symbol reliably when each module spans about
3–4 sensor pixels. A 1280 px frame across a 30 cm field of view gives roughly
2.4 px per module for a 97-module symbol and 4 px for a 49-module one. That is the
physical reason the profiles exist:

| profile | modules | relative data per symbol | realistic use |
| --- | --- | --- | --- |
| Compact | 49×49 | 1× | 30–50 cm, smaller viewports, shaky hands, poor light |
| **Balanced** | **77×77** | **2.5×** | **the default: 15–30 cm** |
| Dense | 97×97 | 3.9× | 10–20 cm, desktop monitor or steady laptop/phone pair |

**Frame rate.** A camera's exposure is a slice of its own frame interval. If a
symbol is displayed for less time than that exposure, the captured image is a
*blend of two different symbols*, which no error correction can recover — it is not
noise, it is two valid symbols superimposed. At 15 fps a symbol is on screen for
66 ms, comfortably longer than a typical webcam or mobile-browser camera exposure. Pushing to 24 fps helps
only when both devices are steady and close, which is why 15 is the default and the
UI explains the trade instead of simply offering "faster".

**Measured throughput** at 15 fps: roughly 5 kB/s for balanced with a small
payload, up to ~130 kB/s between a crisp desktop display and a close-range browser camera with the dense
profile — consistent with the reference implementation's reported 128–130 KB/s.

**The overhead constants** in `estimateOverhead` (1.06 + 0.45·√loss) are fitted from
the loss simulations in §2, and the tests hold them within a few percent of the
simulator, so the ETA the user sees is honest rather than decorative.

---

## 9. Session identity and the planner

**Session id**: a random 32-bit value from the platform CSPRNG, carried in every
frame header, which is how a receiver filters out other transfers in the same room.
It is rendered for humans as a **7-character** code in a base-32 alphabet without
`I`, `O`, `0` and `1` — 7 characters because 6 characters carry only 30 bits and
would silently truncate the id (a round-trip test caught that bug), and the
restricted alphabet because the code is meant to be read aloud and typed.

**Manifest**: JSON, because a self-describing transfer should be inspectable by a
human with a QR scanner app — a deliberate choice for debuggability over a few
bytes of framing.

**Planner**: given a payload length and a profile, it computes the block size that
fills a frame to capacity, the block count, bytes per frame, expected duration and
warnings. The capacity comes from the QR tables *and* the wire encoding, so the
planner can never size a frame that would not fit.

**Limits** are enforced with explanations rather than silent failure: 64 MB payloads,
4 MB of text, 20 000 blocks. Above those, an optical transfer is the wrong tool and
the app says so — "a cable or a local network share is the right tool for this"
— instead of starting a two-hour transfer.

---

## 10. The techniques that are *not* used, and why

Recording these is as useful as recording the choices:

| Technique | Why not |
| --- | --- |
| Reed–Solomon across frames | Needs a fixed sequence and a known erasure pattern; the receiver knows neither. |
| Raptor / RaptorQ codes | Better overhead than LT (≈1.02×), but bounded by patents and much more complex; LT's measured 1.106× on a clean channel and 1.62× at 30% loss is well inside the noise of a hand-held camera. |
| Hamming/convolutional codes inside frames | QR already carries Reed–Solomon; a second inner code would spend bits that a fountain frame could use more productively. |
| A feedback channel over Wi-Fi | It would work, and it would destroy the point: no pairing, no shared network, no configuration. |
| Colour or multi-symbol QR (e.g. 2D barcodes, RGB channels) | Real throughput gains, but they multiply the failure modes in the optical channel: colour needs white balancing and a screen calibrated to a camera this app cannot control. Two-dimensional framing (several symbols per screen) is a promising future direction with a much better risk profile. |
| Video as the channel (an actual video codec) | A browser tab playing H.264 video of a file is the obvious "10× more bandwidth" idea; it fails on reliability, not bandwidth — a dropped frame in a temporal codec corrupts the whole prediction chain, which is exactly the failure the fountain code exists to absorb. |
| Compressing the *frame stream* | Frames are near-random by construction (XOR of random subsets); there is nothing to compress. |
| Sending the passphrase in the stream | Defeats the purpose in the only scenario where encryption matters. |

---

## 11. Where the numbers come from

Every figure in this document is reproducible:

```bash
npx tsx tools/diag/degree-experiment.ts   # degree distributions, k = 64…1024  → docs/degree-experiment-output.txt
npx tsx tools/diag/prefix-experiment.ts   # systematic prefix sweep, 3 channel models → docs/prefix-experiment-output.txt
npm run diag:core                         # one full transfer through QR modules and receiver verification
npm run test:web                          # full React UI + pixel-level jsQR optical transfer tests
npm test                                  # all 99 tests + 95-file code-reference verification
```

The two `docs/*-experiment-output.txt` files hold the raw output of the sweeps,
committed so the tables above can be re-derived rather than taken on trust.
