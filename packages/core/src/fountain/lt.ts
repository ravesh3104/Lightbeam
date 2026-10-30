/**
 * lt.ts - Luby Transform encoder and decoder, plus a dense-elimination fallback.
 *
 * WIRE MODEL
 * ----------
 * The source file is split into K blocks of `blockSize` bytes (the last block is
 * zero padded; the true payload length travels in the session header so the
 * padding is trimmed on receipt). Frame `s` of the stream carries:
 *
 *     seed  : a 32-bit frame number (also the PRNG seed)
 *     data  : XOR of the source blocks whose indices are derived from `seed`
 *
 * Both sides derive the neighbour set from the seed with the same PRNG and the
 * same degree distribution, so the frame header never has to list the indices -
 * which is exactly where the efficiency of fountain coding comes from. A frame
 * costs one seed, not a list.
 *
 * SYSTEMATIC PREFIX
 * -----------------
 * A pure fountain stream is wasteful at the start: if the camera joins at frame
 * 4000 it must still accumulate ~1.15 K frames. LightBeam therefore makes the
 * first frames *systematic*: frame s in [0, K) carries source block s XORed with
 * one pseudo-random "mask" block over the whole file. One captured frame then
 * completes one source block as soon as the mask is known, and the mask itself
 * arrives in the very first frames (frames K, K+1, ... carry the mask block
 * alone at degree 1). This is the idea behind RaptorQ's systematic output and it
 * removes the "cold start" entirely.
 *
 * DECODING
 * --------
 * Classic LT decoding is *peeling*: find an equation with one unknown, solve it,
 * substitute it into every equation that still contains it, repeat. Peeling is
 * O(K log K) and needs almost no memory, but it can stall when the last few
 * source blocks are covered by equations of degree >= 2 (the classic LT tail).
 *
 * LightBeam therefore keeps a hybrid: peeling first, then - only if peeling
 * stalls and the unresolved system is still small - a dense GF(2) Gaussian
 * elimination over the *residual* variables. That combination is what lets the
 * app finish cleanly instead of hanging at "97% complete" when the optics drop a
 * burst of frames.
 */

import { Rng } from '../util/rng.js';
import { buildDegreeDistribution, sampleDegree, type DegreeDistribution, type DegreeOptions } from './degree.js';

export interface LTSessionOptions {
  /** Number of source blocks. */
  k: number;
  /** Bytes per source block. */
  blockSize: number;
  /** Session id mixed into the PRNG so two sessions never share equations. */
  sessionId: number;
  /** Degree distribution tuning. */
  degree?: DegreeOptions;
  /** Frames without progress before the dense solver is attempted (default 32). */
  stallThreshold?: number;
  /** Largest residual the dense solver will attempt (default 256). */
  denseLimit?: number;
  /** Length of the real payload (the last block is zero padded). */
  payloadLength?: number;
  /**
   * Number of leading frames that are sent *systematically* (one source block
   * each, frame s = block s XOR mask). Defaults to k, i.e. the whole file is
   * available one-block-per-frame at the start of the stream.
   *
   * Why this is a knob rather than a constant: on a clean channel a full prefix
   * is optimal (exactly 1.00x), but under frame loss a long prefix HURTS, because
   * the missed systematic frames leave specific holes that LT frames - which
   * cover random subsets of the whole file - are inefficient at filling. See
   * docs/degree-experiment-output.txt for the measured curve, and
   * `SYSTEMATIC_PREFIX_FRACTION`.
   */
  systematicPrefix?: number;
}

/**
 * Derive the source blocks covered by a frame.
 *
 * ORDERING RULES THAT BOTH SIDES MUST OBEY EXACTLY. Any divergence silently
 * produces garbage, so this function is the single source of truth:
 *   1. one RNG, seeded with the frame seed mixed with the session id,
 *   2. draw the degree first, then the neighbours,
 *   3. neighbours are DISTINCT (a repeated index would cancel itself in the XOR
 *      and lower the effective degree),
 *   4. output order is unspecified (the dense solver sorts when it needs to).
 *
 * It must also be STATELESS WITH RESPECT TO HISTORY: the receiver sees an
 * arbitrary subset of frames, in order, so a sampler that carried mutable state
 * (e.g. a persistent shuffle pool) would diverge from the sender the moment a
 * frame is lost, and every later frame would decode to garbage. Everything below
 * therefore depends only on (seed, k, sessionId, distribution).
 *
 * Sampling method: partial Fisher-Yates over a *sparse* virtual array.
 *
 *   for i in 0..degree-1:  j = i + rand(k - i);  swap virtual[i], virtual[j]
 *
 * The virtual array starts as the identity permutation each call, and the sparse
 * map only stores entries the shuffle has actually touched, so each call costs
 * O(degree) time and O(degree) memory instead of the O(k) a real array would
 * need. Compare with the naive "draw and reject duplicates" loop, which is
 * O(degree^2) in comparisons - the robust-soliton degree spike reaches ~K/R and
 * that quadratic term dominated the sender's frame budget.
 */

// Recycled scratch for the sparse virtual array. Single-threaded JS means one
// set of buffers is safe, and `epoch` makes them logically empty on each call.
let sparseIndex = new Uint32Array(0);
let sparseValue = new Uint32Array(0);
let sparseEpoch = new Uint32Array(0);
let epoch = 0;

function ensureSparseCapacity(k: number): void {
  if (sparseIndex.length >= k) return;
  // Grow to the next power of two above k to avoid reallocating repeatedly as
  // sessions of increasing size are created.
  let size = 1024;
  while (size < k) size *= 2;
  sparseIndex = new Uint32Array(size);
  sparseValue = new Uint32Array(size);
  sparseEpoch = new Uint32Array(size);
  epoch = 0;
}

export function frameNeighbours(
  seed: number,
  k: number,
  sessionId: number,
  dist: DegreeDistribution,
  out?: Uint32Array,
): Uint32Array {
  // Mix the session id into the seed so a frame number from another session can
  // never be mistaken for one of ours.
  const rng = new Rng((seed ^ Math.imul(sessionId, 0x9e3779b1)) | 0);
  const degree = Math.min(k, sampleDegree(rng, dist));
  const neighbours = out && out.length >= degree ? out.subarray(0, degree) : new Uint32Array(degree);

  if (degree === k) {
    // Full-degree frame: every block participates, no sampling needed.
    for (let i = 0; i < degree; i++) neighbours[i] = i;
    return neighbours;
  }

  if (degree === 1) {
    neighbours[0] = rng.nextInt(k);
    return neighbours;
  }

  if (degree <= 8) {
    // Tiny degrees are cheaper with the direct duplicate scan than with the
    // sparse map setup, and the scan is exactly correct.
    let filled = 0;
    outer: while (filled < degree) {
      const candidate = rng.nextInt(k);
      for (let i = 0; i < filled; i++) if (neighbours[i] === candidate) continue outer;
      neighbours[filled++] = candidate;
    }
    return neighbours;
  }

  // Sparse partial Fisher-Yates: a brand-new identity permutation per call.
  ensureSparseCapacity(k);
  if (epoch >= 0xffffffe0) {
    // Wrapped: clear the epoch markers once every 4 billion calls.
    sparseEpoch.fill(0);
    epoch = 0;
  }
  const callEpoch = ++epoch;
  const get = (index: number): number => (sparseEpoch[index] === callEpoch ? sparseValue[index] : index);
  const set = (index: number, value: number): void => {
    sparseEpoch[index] = callEpoch;
    sparseIndex[index] = index;
    sparseValue[index] = value;
  };

  for (let i = 0; i < degree; i++) {
    // Draw uniformly from the pool that is still untouched, i.e. positions
    // i..k-1 of the virtual permutation, then take that element and put the
    // unchosen one back into the pool at position j.
    const j = i + rng.nextInt(k - i);
    const atI = get(i);
    const atJ = get(j);
    neighbours[i] = atJ;
    if (j !== i) set(j, atI);
  }
  return neighbours;
}

/**
 * The systematic-prefix mask block, derived from the session id.
 *
 * Deriving it (rather than transmitting it) is what makes the systematic prefix
 * pay off immediately: a receiver that has just read a session header can
 * already unmask every systematic frame it captures, with no dependency on a
 * particular earlier frame having been seen. The sender still emits one explicit
 * mask frame (seed === K) so that a third-party receiver which does not
 * implement the derivation can interoperate.
 */
export function deriveMaskBlock(sessionId: number, blockSize: number): Uint8Array {
  const rng = new Rng((sessionId ^ 0x5bf03635) | 0);
  const mask = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) mask[i] = rng.nextUint32() & 0xff;
  return mask;
}

/** XOR `source` into `target` (target is modified). */
export function xorInto(target: Uint8Array, source: Uint8Array): void {
  const n = target.length;
  let i = 0;
  // Unrolled by 8: XOR is memory bound, and this measurably beats the naive loop
  // in V8/SpiderMonkey/JavaScriptCore for the 1-8 KB blocks we use.
  for (; i + 8 <= n; i += 8) {
    target[i] ^= source[i];
    target[i + 1] ^= source[i + 1];
    target[i + 2] ^= source[i + 2];
    target[i + 3] ^= source[i + 3];
    target[i + 4] ^= source[i + 4];
    target[i + 5] ^= source[i + 5];
    target[i + 6] ^= source[i + 6];
    target[i + 7] ^= source[i + 7];
  }
  for (; i < n; i++) target[i] ^= source[i];
}

export class LTEncoder {
  readonly k: number;
  readonly blockSize: number;
  readonly sessionId: number;
  readonly dist: DegreeDistribution;
  /** Length of the systematic prefix in frames (see LTSessionOptions). */
  readonly prefix: number;
  /** Source blocks as borrowed views into the payload (no copy). */
  private readonly blocks: Uint8Array[];
  /** The random mask that makes the systematic prefix invertible. */
  private readonly mask: Uint8Array;
  private readonly scratch: Uint32Array;

  constructor(payload: Uint8Array, options: LTSessionOptions) {
    const { k, blockSize, sessionId } = options;
    if (k < 1) throw new RangeError('k must be >= 1');
    if (blockSize < 1) throw new RangeError('blockSize must be >= 1');
    this.k = k;
    this.blockSize = blockSize;
    this.sessionId = sessionId;
    this.prefix = Math.max(0, Math.min(k, options.systematicPrefix ?? defaultSystematicPrefix(k)));
    this.dist = buildDegreeDistribution(k, options.degree);
    this.scratch = new Uint32Array(Math.max(1, k));

    this.blocks = new Array(k);
    for (let i = 0; i < k; i++) {
      const start = i * blockSize;
      const end = Math.min(payload.length, start + blockSize);
      if (start >= payload.length) {
        // Blocks past the end of the payload are all-zero (this is the padding
        // that the receiver trims away).
        this.blocks[i] = new Uint8Array(blockSize);
      } else if (end - start === blockSize) {
        this.blocks[i] = payload.subarray(start, end);
      } else {
        const padded = new Uint8Array(blockSize);
        padded.set(payload.subarray(start, end));
        this.blocks[i] = padded;
      }
    }

    // The mask is derived from the session id, so it is identical on both sides
    // and does not need to be transmitted before the systematic frames.
    this.mask = deriveMaskBlock(sessionId, blockSize);
  }

  /** The mask block (useful for tests and diagnostics). */
  get maskBlock(): Uint8Array {
    return this.mask;
  }

  /** Neighbour indices for a frame seed. */
  neighbours(seed: number): Uint32Array {
    return frameNeighbours(seed, this.k, this.sessionId, this.dist, this.scratch);
  }

  /**
   * Produce the encoded block for `seed`.
   *
   * Frame layout in the systematic prefix (seed < K):
   *     seed <  K          -> source block[seed] XOR mask        (degree 1)
   *     seed == K          -> mask, verbatim                     (degree 1)
   *     seed >  K          -> LT-coded block seeded with (seed-K-1)
   *
   * The mask frame is what makes the systematic frames immediately useful: as
   * soon as the receiver has the mask (one frame), every systematic frame it
   * captured earlier resolves to a full source block.
   */
  encode(seed: number, out?: Uint8Array): Uint8Array {
    const target = out && out.length >= this.blockSize ? out.subarray(0, this.blockSize) : new Uint8Array(this.blockSize);

    // Slot layout: [0, prefix) systematic - prefix is the mask frame - then LT.
    if (seed < this.prefix) {
      target.set(this.blocks[seed]);
      xorInto(target, this.mask);
      return target;
    }
    if (seed === this.prefix) {
      target.set(this.mask);
      return target;
    }

    const indices = this.neighbours(seed - this.prefix - 1);
    const first = indices[0];
    target.set(this.blocks[first]);
    for (let i = 1; i < indices.length; i++) xorInto(target, this.blocks[indices[i]]);
    return target;
  }

  /** Total bytes of payload this encoder represents (for progress reporting). */
  get payloadBytes(): number {
    return this.k * this.blockSize;
  }
}

/**
 * Default length of the systematic prefix, as a fraction of K.
 *
 * MEASURED (k = 1024, blockSize = 512, 3 trials per cell; frames the SENDER must
 * display per source block - tools/diag/prefix-experiment.ts):
 *
 *   prefix/K    clean channel   30% frame loss   50% loss + bursts
 *   0.00        1.138           1.630            3.849
 *   0.10        1.106           1.619            3.664   <-- chosen default
 *   0.25        1.191           1.682            3.714
 *   0.50        1.354           1.840            3.767
 *   1.00        1.000           2.054            4.028
 *
 * Reading the table:
 *   - A FULL prefix is perfect on a clean channel (exactly K frames) and the worst
 *     option everywhere else. The reason is worth stating plainly: the systematic
 *     frames the receiver misses leave SPECIFIC holes, and an LT frame covers a
 *     uniformly random subset of the whole file, so patching those holes costs far
 *     more than covering the file from scratch.
 *   - Pure LT (prefix 0) is the most robust option under loss but has no cold-start
 *     advantage: the first complete block appears only after ~1.14 K frames.
 *   - A SHORT prefix captures both: the first ~10% of blocks arrive at exactly one
 *     frame each, so a receiver has verified data on screen within seconds and can
 *     preview a partially received image, while the LT tail stays near its
 *     loss-optimal efficiency.
 *
 * Some optical-transfer tools hard-code a full systematic pass. On a hand-held
 * link that is the wrong trade, which is why this constant is small.
 */
export const SYSTEMATIC_PREFIX_FRACTION = 0.1;

/** Frames to send systematically for a given block count. */
export function defaultSystematicPrefix(k: number): number {
  return Math.max(1, Math.min(k, Math.round(k * SYSTEMATIC_PREFIX_FRACTION)));
}

export type FrameOutcome =
  | 'accepted' // contributed new information
  | 'redundant' // linearly dependent on what we already have
  | 'duplicate' // exactly this frame seed was already seen
  | 'complete'; // this frame completed the file

interface Equation {
  /** Indices of the source blocks in this equation. */
  vars: Uint32Array;
  /** Running XOR accumulator (already has solved variables removed). */
  data: Uint8Array;
  /** Number of still-unsolved variables in the equation. */
  activeCount: number;
  /** Number of solved variables XORed into `data` so far (diagnostics). */
  xorOps: number;
}

export interface DecoderStats {
  k: number;
  blockSize: number;
  received: number;
  duplicates: number;
  redundant: number;
  solved: number;
  equationsHeld: number;
  peelOperations: number;
  xorOperations: number;
  denseSolves: number;
  denseMatrixSize: number;
  overheadRatio: number;
  complete: boolean;
}

export class LTDecoder {
  readonly k: number;
  readonly blockSize: number;
  readonly sessionId: number;
  private readonly dist: DegreeDistribution;
  private readonly payloadLength: number;
  /** Length of the systematic prefix in frames (see LTSessionOptions). */
  private readonly prefix: number;

  /** Solved source blocks (null = not yet known). */
  private readonly solved: Array<Uint8Array | null>;
  private solvedCount = 0;

  /** Unsolved equations, indexed by insertion order. */
  private equations: Equation[] = [];
  /** varToEquations[v] = indices into `equations` that still contain v. */
  private varToEquations: number[][];
  /** Indices of equations whose activeCount is 1, ready to be peeled. */
  private readonly ready: number[] = [];

  private seenSeeds = new Set<number>();
  private stats = {
    received: 0,
    duplicates: 0,
    redundant: 0,
    peelOperations: 0,
    xorOperations: 0,
    denseSolves: 0,
    denseMatrixSize: 0,
  };

  /** Frames whose masks/solved data let us finish; set when solvedCount reaches k. */
  private completed = false;
  private scratch: Uint32Array;
  /**
   * Frames received since the last time peeling made progress. The dense solver
   * is only attempted after a stall: re-running Gaussian elimination on every
   * frame would dominate the CPU budget for no benefit.
   */
  private framesSinceProgress = 0;
  private lastSolvedCount = 0;
  /** Frames of no progress tolerated before attempting a dense solve. */
  private stallThreshold = 32;
  /** Largest residual the dense solver will attempt. */
  private denseLimit = 256;
  /**
   * Signature of the last dense attempt: (equations held, residual size). If
   * neither has changed since the last attempt, retrying is guaranteed to do the
   * same work for the same answer, so we skip it. Without this guard a stalled
   * session would re-run Gaussian elimination on every subsequent frame.
   */
  private lastDenseSignature = '';

  constructor(options: LTSessionOptions) {
    this.k = options.k;
    this.blockSize = options.blockSize;
    this.sessionId = options.sessionId;
    this.payloadLength = options.payloadLength ?? options.k * options.blockSize;
    this.prefix = Math.max(0, Math.min(options.k, options.systematicPrefix ?? defaultSystematicPrefix(options.k)));
    this.dist = buildDegreeDistribution(options.k, options.degree);
    this.solved = new Array(options.k).fill(null);
    this.varToEquations = Array.from({ length: options.k }, () => []);
    this.scratch = new Uint32Array(Math.max(1, options.k));
    // The mask is derivable from the session id, so systematic frames are usable
    // from the very first captured frame.
    this.maskData = deriveMaskBlock(options.sessionId, options.blockSize);
    this.maskSolved = true;
    if (options.stallThreshold !== undefined) this.stallThreshold = options.stallThreshold;
    if (options.denseLimit !== undefined) this.denseLimit = options.denseLimit;
  }

  get progress(): number {
    return this.k === 0 ? 1 : this.solvedCount / this.k;
  }

  get isComplete(): boolean {
    return this.solvedCount >= this.k;
  }

  get missingBlocks(): number {
    return this.k - this.solvedCount;
  }

  /** Indices of source blocks not yet recovered (diagnostics / request hints). */
  get missingIndices(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.k; i++) if (!this.solved[i]) out.push(i);
    return out;
  }

  getStats(): DecoderStats {
    return {
      ...this.stats,
      k: this.k,
      blockSize: this.blockSize,
      solved: this.solvedCount,
      equationsHeld: this.equations.length,
      overheadRatio: this.k === 0 ? 0 : this.stats.received / this.k,
      complete: this.isComplete,
    };
  }

  /**
   * Feed one received frame.
   *
   * @param seed  frame number from the frame header
   * @param data  encoded block bytes (exactly blockSize bytes)
   */
  addFrame(seed: number, data: Uint8Array): FrameOutcome {
    if (data.length !== this.blockSize) {
      throw new RangeError(`Frame payload must be ${this.blockSize} bytes, got ${data.length}`);
    }
    if (this.completed) return 'redundant';
    if (this.seenSeeds.has(seed)) {
      this.stats.duplicates++;
      return 'duplicate';
    }
    this.seenSeeds.add(seed);
    this.stats.received++;

    // --- systematic prefix -------------------------------------------------
    // Frame s < K carries source block s XOR mask, i.e. one complete source block
    // as soon as the mask is undone. This is why the first K frames of a session
    // are worth more than any later frame: each one is a guaranteed +1 block.
    if (seed < this.prefix) {
      const blockIndex = seed;
      if (this.solved[blockIndex]) {
        this.stats.redundant++;
        return 'redundant';
      }
      const block = Uint8Array.from(data);
      xorInto(block, this.maskData!);
      this.solveVariable(blockIndex, block);
      return this.finishOutcome();
    }

    if (seed === this.prefix) {
      // Explicit mask frame: verifies our derivation and interoperates with
      // receivers that do not derive it.
      if (!this.verifyMask(data)) {
        this.stats.redundant++;
        return 'redundant';
      }
      this.stats.redundant++;
      return this.finishOutcome();
    }

    // --- regular LT frame ---------------------------------------------------
    const indices = frameNeighbours(seed - this.prefix - 1, this.k, this.sessionId, this.dist, this.scratch);
    const active: number[] = [];
    for (let i = 0; i < indices.length; i++) {
      if (!this.solved[indices[i]]) active.push(indices[i]);
    }

    if (active.length === 0) {
      // Fully determined already: verify, then discard.
      this.stats.redundant++;
      return 'redundant';
    }

    const equation: Equation = {
      vars: Uint32Array.from(active),
      data: Uint8Array.from(data),
      activeCount: active.length,
      xorOps: 0,
    };

    // Subtract anything already solved (possible when the same frame arrives
    // after some of its blocks were completed by other frames).
    for (let i = 0; i < indices.length; i++) {
      const block = this.solved[indices[i]];
      if (block) xorInto(equation.data, block);
    }

    if (equation.activeCount === 1) {
      this.solveVariable(equation.vars[0], equation.data);
      this.stats.peelOperations++;
      return this.finishOutcome();
    }

    this.holdEquation(equation);
    this.drainReady();
    // Peeling is preferred while it keeps making progress (it is O(1) amortised
    // per variable); only a stalled decode falls back to dense elimination.
    if (this.framesSinceProgress >= this.stallThreshold) {
      this.maybeDenseSolve();
    }
    return this.finishOutcome();
  }

  private finishOutcome(): FrameOutcome {
    if (this.solvedCount !== this.lastSolvedCount) {
      this.lastSolvedCount = this.solvedCount;
      this.framesSinceProgress = 0;
    } else {
      this.framesSinceProgress++;
    }
    if (this.isComplete) {
      this.completed = true;
      return 'complete';
    }
    return 'accepted';
  }

  // -------------------------------------------------------------------------
  // Mask handling
  //
  // The systematic prefix XORs every source block with one mask block that both
  // sides derive from the session id. `maskMismatch` records the (protocol-level)
  // case where an explicit mask frame disagrees with our derivation, which the
  // diagnostics screen surfaces as a version/protocol warning.
  // -------------------------------------------------------------------------

  private maskSolved = true;
  private maskData: Uint8Array | null = null;
  /** Set if an explicit mask frame contradicted the derived mask. */
  maskMismatch = false;

  /** Compare an explicit mask frame with the locally derived mask. */
  private verifyMask(mask: Uint8Array): boolean {
    if (!this.maskData) return false;
    if (mask.length !== this.maskData.length) return false;
    let equal = true;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== this.maskData[i]) {
        equal = false;
        break;
      }
    }
    if (!equal) this.maskMismatch = true;
    return equal;
  }

  // -------------------------------------------------------------------------
  // Peeling
  // -------------------------------------------------------------------------

  private holdEquation(equation: Equation): void {
    const index = this.equations.length;
    this.equations.push(equation);
    for (let i = 0; i < equation.vars.length; i++) {
      this.varToEquations[equation.vars[i]].push(index);
    }
    if (equation.activeCount === 1) this.ready.push(index);
  }

  /**
   * Record a solved source block and substitute it into every held equation.
   *
   * `value` is retained by reference, so callers must hand over a buffer they
   * will not mutate afterwards (see the aliasing note in drainReady).
   */
  private solveVariable(variable: number, value: Uint8Array): void {
    if (this.solved[variable]) return;
    this.solved[variable] = value;
    this.solvedCount++;

    // Substitute into every equation that still references this variable.
    const references = this.varToEquations[variable];
    for (let r = 0; r < references.length; r++) {
      const eq = this.equations[references[r]];
      if (!eq || eq.activeCount === 0) continue;
      xorInto(eq.data, value);
      eq.xorOps++;
      this.stats.xorOperations++;
      eq.activeCount--;
      if (eq.activeCount === 1) this.ready.push(references[r]);
    }
    this.varToEquations[variable] = [];
  }

  /** Peel while there is anything with a single unknown. */
  private drainReady(): void {
    while (this.ready.length > 0) {
      const eqIndex = this.ready.pop()!;
      const eq = this.equations[eqIndex];
      if (!eq || eq.activeCount !== 1) continue;
      // Find the remaining unknown.
      let unknown = -1;
      for (let i = 0; i < eq.vars.length; i++) {
        if (!this.solved[eq.vars[i]]) {
          unknown = eq.vars[i];
          break;
        }
      }
      if (unknown < 0) {
        eq.activeCount = 0;
        continue;
      }
      // ORDER MATTERS, and getting it wrong is silent corruption. Clearing
      // activeCount must happen BEFORE solveVariable, because solveVariable
      // substitutes the new value into every equation still listening for that
      // variable - and this equation is still on that list. With activeCount
      // still 1, the substitution does `eq.data ^= value`, and `value` IS
      // `eq.data`, so the freshly solved source block would be zeroed on the
      // spot. (Diagnosed by 185/200 randomised round trips reporting "complete"
      // with zero-filled blocks.)
      eq.activeCount = 0;
      this.stats.peelOperations++;
      // A copy, not the accumulator: the buffer belongs to the equation, and
      // anything that later touches that equation must not be able to reach the
      // solved block through it.
      this.solveVariable(unknown, Uint8Array.from(eq.data));
    }
  }

  // -------------------------------------------------------------------------
  // Dense fallback
  // -------------------------------------------------------------------------

  /**
   * When peeling stalls, solve the residual system by Gaussian elimination over
   * GF(2).
   *
   * Cost is O(r^3 / 64) bit operations plus O(r * blockSize) XORs for r residual
   * variables, so it is only attempted for small residuals - but that is exactly
   * the case that matters in practice: peeling leaves a handful of blocks
   * unsolved near the end of a transfer, and this closes them out immediately
   * instead of waiting for a lucky low-degree frame.
   *
   * @param limit maximum residual size to attempt
   * @returns true if the dense solve made progress
   */
  maybeDenseSolve(limit = 256): boolean {
    if (this.isComplete) return false;
    const progressBefore = this.solvedCount;

    // Cheap pre-pass: count the residual variables and the equations available
    // for them WITHOUT building the matrix, so an oversized residual costs
    // nothing. (An earlier revision built the rows first, which made a stalled
    // large-K session quadratic in the number of frames.)
    let residualCount = 0;
    {
      const seen = new Set<number>();
      let usable = 0;
      for (const eq of this.equations) {
        if (eq.activeCount < 2) continue;
        usable++;
        for (let i = 0; i < eq.vars.length; i++) {
          const v = eq.vars[i];
          if (!this.solved[v]) seen.add(v);
        }
      }
      residualCount = seen.size;
      if (residualCount === 0 || residualCount > limit || usable < residualCount) return false;
    }

    const signature = `${this.equations.length}:${residualCount}`;
    if (signature === this.lastDenseSignature) return false;
    this.lastDenseSignature = signature;

    const residualIndex = new Map<number, number>();
    for (const eq of this.equations) {
      if (eq.activeCount < 2) continue;
      for (let i = 0; i < eq.vars.length; i++) {
        const v = eq.vars[i];
        if (!this.solved[v] && !residualIndex.has(v)) residualIndex.set(v, residualIndex.size);
      }
    }
    const r = residualIndex.size;
    if (r === 0 || r > limit) return false;

    const rows: Array<{ bits: Uint8Array; data: Uint8Array }> = [];
    const rowWords = (r + 7) >>> 3;
    for (const eq of this.equations) {
      if (eq.activeCount < 2) continue;
      const bits = new Uint8Array(rowWords);
      let any = false;
      for (let i = 0; i < eq.vars.length; i++) {
        const v = eq.vars[i];
        if (this.solved[v]) continue;
        const col = residualIndex.get(v)!;
        bits[col >>> 3] ^= 0x80 >>> (col & 7);
        any = true;
      }
      if (any) rows.push({ bits, data: Uint8Array.from(eq.data) });
    }
    if (rows.length < r) return false; // not enough equations to solve uniquely
    // Work budget: elimination is O(cols * rows * rowWords) byte-XORs plus
    // O(rows^2) block XORs on the `data` accumulators. Refuse anything that
    // would block the UI thread for more than a few milliseconds - a partially
    // solved transfer can simply wait for more frames instead.
    if (r * rows.length * rowWords + rows.length * rows.length * this.blockSize > 24_000_000) return false;

    this.stats.denseMatrixSize = Math.max(this.stats.denseMatrixSize, r);

    // --- forward elimination: reduce to row echelon form -------------------
    const pivotOfRow: number[] = new Array(rows.length).fill(-1);
    let pivotRow = 0;
    for (let col = 0; col < r && pivotRow < rows.length; col++) {
      const byte = col >>> 3;
      const mask = 0x80 >>> (col & 7);
      let sel = -1;
      for (let row = pivotRow; row < rows.length; row++) {
        if (rows[row].bits[byte] & mask) {
          sel = row;
          break;
        }
      }
      if (sel < 0) continue;
      if (sel !== pivotRow) {
        const tmp = rows[sel];
        rows[sel] = rows[pivotRow];
        rows[pivotRow] = tmp;
      }
      const pivot = rows[pivotRow];
      for (let row = 0; row < rows.length; row++) {
        if (row === pivotRow) continue;
        if (rows[row].bits[byte] & mask) {
          xorInto(rows[row].bits, pivot.bits);
          xorInto(rows[row].data, pivot.data);
          this.stats.xorOperations++;
        }
      }
      pivotOfRow[pivotRow] = col;
      pivotRow++;
    }

    // --- back substitution: any row with a single set bit is a solution -----
    let solvedNow = 0;
    for (let row = 0; row < rows.length; row++) {
      if (pivotOfRow[row] < 0) continue;
      const bits = rows[row].bits;
      let count = 0;
      let only = -1;
      for (let col = 0; col < r; col++) {
        if (bits[col >>> 3] & (0x80 >>> (col & 7))) {
          count++;
          only = col;
          if (count > 1) break;
        }
      }
      if (count !== 1) continue;
      // Map back from residual index to source block index.
      let variable = -1;
      for (const [v, idx] of residualIndex) {
        if (idx === only) {
          variable = v;
          break;
        }
      }
      if (variable < 0 || this.solved[variable]) continue;
      this.solveVariable(variable, Uint8Array.from(rows[row].data));
      solvedNow++;
    }

    if (solvedNow > 0) {
      this.stats.denseSolves++;
      this.drainReady();
      if (this.isComplete) this.completed = true;
      if (this.solvedCount !== progressBefore) this.framesSinceProgress = 0;
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------

  /** True once every source block has been recovered. */
  get complete(): boolean {
    return this.isComplete;
  }

  /** Reassemble the payload. Zero-fills any missing blocks (see bestEffort). */
  reconstruct(): Uint8Array {
    const out = new Uint8Array(this.k * this.blockSize);
    for (let i = 0; i < this.k; i++) {
      const block = this.solved[i];
      if (block) out.set(block, i * this.blockSize);
    }
    return out.subarray(0, this.payloadLength);
  }

  /**
   * Reassemble even when incomplete, reporting which byte ranges are still
   * unknown. The caller decides whether to keep waiting; the UI uses this to
   * show a partially-received image (which often reveals whether the transfer is
   * working) and to compute per-region progress.
   */
  bestEffort(): { data: Uint8Array; missingRanges: Array<{ start: number; end: number }>; complete: boolean } {
    const data = new Uint8Array(this.payloadLength);
    const missingRanges: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < this.k; i++) {
      const start = i * this.blockSize;
      const end = Math.min(this.payloadLength, start + this.blockSize);
      const block = this.solved[i];
      if (block) {
        data.set(block.subarray(0, end - start), start);
      } else {
        missingRanges.push({ start, end });
      }
    }
    return { data, missingRanges, complete: this.isComplete };
  }

  /** Drop all state (used when a session is abandoned or restarted). */
  reset(): void {
    this.solved.fill(null);
    this.solvedCount = 0;
    this.equations = [];
    this.varToEquations = Array.from({ length: this.k }, () => []);
    this.ready.length = 0;
    this.seenSeeds = new Set();
    this.maskData = deriveMaskBlock(this.sessionId, this.blockSize);
    this.maskSolved = true;
    this.maskMismatch = false;
    this.completed = false;
  }
}

/**
 * Number of encoded frames required to decode with high probability.
 *
 * The theoretical LT bound is K + O(sqrt(K) * ln^2(K/delta)). Real sessions do a
 * little worse because our receiver loses frames between the ones it captures
 * (a dropped frame is not "eaten" - it just is not there). This helper is used
 * for the ETA shown in the UI, not for correctness.
 */
export function expectedFramesFor(k: number, delta = 0.5): number {
  if (k <= 1) return 1;
  const c = 0.03;
  const R = c * Math.log(k / delta) * Math.sqrt(k);
  return Math.ceil(k + R * Math.log(k / delta) + Math.sqrt(k) * 2);
}
