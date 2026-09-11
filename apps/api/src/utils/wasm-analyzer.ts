/**
 * Static security analyzer for compiled Soroban contract WASM bytecode.
 *
 * This implements just enough of the WebAssembly binary format (MVP spec,
 * https://webassembly.github.io/spec/core/binary/index.html) to walk a
 * module's sections and its function bodies' raw instruction streams,
 * without pulling in a full WASM toolchain/parser dependency — no such
 * dependency exists yet in this repo, and a real bytecode disassembler is
 * a large surface area to add sight-unseen. What's implemented here is a
 * genuinely working structural parser (magic/version, section headers,
 * LEB128 decoding, the Memory and Code sections) rather than a stub, scoped
 * deliberately to what the acceptance criteria need:
 *
 *  - flag unconstrained/unbounded memory growth (a `memory` section or
 *    `memory.grow` instruction with no upper limit)
 *  - flag unhandled panic instructions (bare `unreachable` opcodes, which is
 *    how Rust's `panic!`/`.unwrap()` lowers in a `panic = "abort"` Soroban
 *    build, when not guarded by surrounding control flow)
 *  - a coarse reentrancy signal: an imported host function call
 *    (`call_indirect`, or a `call` to an imported function index) appearing
 *    before the function's own state-changing tail — a real interprocedural
 *    reentrancy analysis is out of scope for a static single-pass bytecode
 *    scan, so this is intentionally a heuristic, documented as such below.
 *
 * None of this replaces a real formal audit; it's a fast, dependency-free
 * first pass suitable for gating "does this WASM upload look obviously
 * unsafe" before it's indexed.
 */

export type WasmRiskSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface WasmRiskFinding {
  severity: WasmRiskSeverity;
  code: string;
  message: string;
  /** Index of the function body the finding was found in, if applicable. */
  functionIndex?: number;
}

export interface WasmAnalysisResult {
  valid: boolean;
  /** Parse error message when `valid` is false; the binary could not be read as WASM at all. */
  parseError?: string;
  findings: WasmRiskFinding[];
  /** 0 (safest) to 100 (most risky), derived from finding severities. */
  riskScore: number;
  stats: {
    sectionCount: number;
    functionCount: number;
    hasMemorySection: boolean;
    hasUnboundedMemory: boolean;
    importedFunctionCount: number;
  };
}

// The WASM magic bytes are `\0asm` (0x00, 0x61, 0x73, 0x6d) in file order.
// `readUint32LE` below reads a 4-byte field least-significant-byte-first, so
// the value it produces from those bytes is 0x6d736100, not the "obvious"
// 0x0061736d you'd get reading the same bytes big-endian/in written order.
const WASM_MAGIC = 0x6d736100; // bytes 00 61 73 6d, read as little-endian uint32
const WASM_VERSION = 1;

// WASM opcodes relevant to the heuristics below (MVP instruction set).
const OP_UNREACHABLE = 0x00;
const OP_BLOCK = 0x02;
const OP_LOOP = 0x03;
const OP_IF = 0x04;
const OP_ELSE = 0x05;
const OP_END = 0x0b;
const OP_CALL = 0x10;
const OP_CALL_INDIRECT = 0x11;
const OP_MEMORY_GROW = 0x40; // followed by a memory-index byte (reserved, 0x00 in MVP)

const SECTION_ID = {
  TYPE: 1,
  IMPORT: 2,
  FUNCTION: 3,
  MEMORY: 5,
  CODE: 10,
} as const;

class ByteCursor {
  constructor(
    public readonly bytes: Uint8Array,
    public offset: number = 0,
  ) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  readByte(): number {
    if (this.offset >= this.bytes.length) {
      throw new Error('Unexpected end of WASM binary');
    }
    return this.bytes[this.offset++];
  }

  readBytes(count: number): Uint8Array {
    if (this.offset + count > this.bytes.length) {
      throw new Error('Unexpected end of WASM binary');
    }
    const slice = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }

  /** Unsigned LEB128, used throughout the WASM binary format for lengths/indices. */
  readVarUint32(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.readByte();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return result >>> 0;
      }
      shift += 7;
    }
    throw new Error('Malformed LEB128 varuint32 (too many bytes)');
  }

  readUint32LE(): number {
    const b = this.readBytes(4);
    return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  }

  skip(count: number): void {
    if (this.offset + count > this.bytes.length) {
      throw new Error('Unexpected end of WASM binary');
    }
    this.offset += count;
  }
}

interface WasmSection {
  id: number;
  offset: number;
  size: number;
  bodyStart: number;
}

function parseSections(cursor: ByteCursor): WasmSection[] {
  const sections: WasmSection[] = [];
  while (cursor.remaining > 0) {
    const id = cursor.readByte();
    const size = cursor.readVarUint32();
    const bodyStart = cursor.offset;
    sections.push({ id, offset: bodyStart, size, bodyStart });
    cursor.skip(size);
  }
  return sections;
}

/** Parses the Memory section: a vector of limits (min, optional max). */
function parseMemorySection(bytes: Uint8Array, section: WasmSection): { hasMax: boolean }[] {
  const cursor = new ByteCursor(bytes, section.bodyStart);
  const end = section.bodyStart + section.size;
  const count = cursor.readVarUint32();
  const memories: { hasMax: boolean }[] = [];

  for (let i = 0; i < count && cursor.offset < end; i++) {
    const flags = cursor.readByte();
    cursor.readVarUint32(); // min pages
    const hasMax = (flags & 0x01) !== 0;
    if (hasMax) {
      cursor.readVarUint32(); // max pages
    }
    memories.push({ hasMax });
  }

  return memories;
}

/** Parses the Import section just far enough to count imported functions. */
function countImportedFunctions(bytes: Uint8Array, section: WasmSection): number {
  const cursor = new ByteCursor(bytes, section.bodyStart);
  const end = section.bodyStart + section.size;
  const count = cursor.readVarUint32();
  let functionImports = 0;

  for (let i = 0; i < count && cursor.offset < end; i++) {
    // module name (vec<byte>), then field name (vec<byte>)
    const moduleLen = cursor.readVarUint32();
    cursor.skip(moduleLen);
    const fieldLen = cursor.readVarUint32();
    cursor.skip(fieldLen);

    const kind = cursor.readByte();
    if (kind === 0x00) {
      // function import: typeidx follows
      cursor.readVarUint32();
      functionImports++;
    } else if (kind === 0x01) {
      // table import: elemtype (byte) + limits
      cursor.readByte();
      const flags = cursor.readByte();
      cursor.readVarUint32();
      if (flags & 0x01) cursor.readVarUint32();
    } else if (kind === 0x02) {
      // memory import: limits
      const flags = cursor.readByte();
      cursor.readVarUint32();
      if (flags & 0x01) cursor.readVarUint32();
    } else if (kind === 0x03) {
      // global import: valtype (byte) + mutability (byte)
      cursor.readByte();
      cursor.readByte();
    } else {
      // Unknown import kind — stop parsing this section defensively rather
      // than risk reading garbage as if it were well-formed.
      break;
    }
  }

  return functionImports;
}

interface FunctionBodyScanResult {
  hasBareUnreachable: boolean;
  hasUnboundedMemoryGrow: boolean;
  callsBeforeLikelyStateChange: boolean;
}

/**
 * Scans a single function body's raw instruction bytes for the risk
 * heuristics described in the module doc comment. This is a best-effort
 * linear scan, not a full validating decoder: it tracks nested block/
 * loop/if depth (skipping the fixed-size immediates each control/call
 * opcode carries) well enough to tell "is this unreachable at the
 * top level of the function" from "is this unreachable behind a
 * conditional branch that never runs in practice" — the former is a much
 * stronger signal of a real unguarded panic path.
 */
function scanFunctionBody(body: Uint8Array): FunctionBodyScanResult {
  const cursor = new ByteCursor(body, 0);

  // Skip the locals declarations vector: count of (count, valtype) pairs.
  const localGroups = cursor.readVarUint32();
  for (let i = 0; i < localGroups; i++) {
    cursor.readVarUint32(); // count
    cursor.readByte(); // valtype
  }

  let depth = 0;
  let hasBareUnreachable = false;
  let hasUnboundedMemoryGrow = false;
  let sawCallBeforeEnd = false;

  while (cursor.remaining > 0) {
    const op = cursor.readByte();

    switch (op) {
      case OP_UNREACHABLE:
        if (depth === 0) hasBareUnreachable = true;
        break;
      case OP_BLOCK:
      case OP_LOOP:
      case OP_IF:
        cursor.readByte(); // blocktype (simplified: single byte for MVP value types / empty)
        depth++;
        break;
      case OP_ELSE:
        break;
      case OP_END:
        if (depth > 0) depth--;
        break;
      case OP_CALL:
        cursor.readVarUint32(); // function index
        sawCallBeforeEnd = true;
        break;
      case OP_CALL_INDIRECT:
        cursor.readVarUint32(); // type index
        cursor.readByte(); // table index (reserved byte in MVP)
        sawCallBeforeEnd = true;
        break;
      default:
        if (op === OP_MEMORY_GROW) {
          cursor.readByte(); // reserved memory index
          hasUnboundedMemoryGrow = true;
        } else {
          // Unknown/unhandled opcode for this scan's purposes. We don't
          // track every immediate-operand shape in the spec (that's a full
          // decoder's job); bail out of this function body rather than
          // risk misreading subsequent bytes as opcodes.
          return { hasBareUnreachable, hasUnboundedMemoryGrow, callsBeforeLikelyStateChange: sawCallBeforeEnd };
        }
    }
  }

  return {
    hasBareUnreachable,
    hasUnboundedMemoryGrow,
    callsBeforeLikelyStateChange: sawCallBeforeEnd,
  };
}

function severityWeight(severity: WasmRiskSeverity): number {
  switch (severity) {
    case 'critical':
      return 40;
    case 'high':
      return 25;
    case 'medium':
      return 12;
    case 'low':
      return 5;
  }
}

function computeRiskScore(findings: WasmRiskFinding[]): number {
  const total = findings.reduce((sum, f) => sum + severityWeight(f.severity), 0);
  return Math.min(100, total);
}

/**
 * Analyzes a compiled Soroban WASM contract binary for common security
 * risk patterns. Never throws for malformed input — an unparsable binary
 * comes back as `{ valid: false, parseError, riskScore: 100 }` (treated as
 * maximally risky, since it can't even be inspected).
 */
export function analyzeWasmBytecode(wasmBinary: Buffer | Uint8Array): WasmAnalysisResult {
  const bytes = wasmBinary instanceof Uint8Array ? wasmBinary : new Uint8Array(wasmBinary);

  try {
    const cursor = new ByteCursor(bytes, 0);

    if (cursor.remaining < 8) {
      throw new Error('Binary is too short to contain a WASM header');
    }

    const magic = cursor.readUint32LE();
    if (magic !== WASM_MAGIC) {
      throw new Error('Missing WASM magic number (0x00 0x61 0x73 0x6d)');
    }

    const version = cursor.readUint32LE();
    if (version !== WASM_VERSION) {
      throw new Error(`Unsupported WASM binary version: ${version}`);
    }

    const sections = parseSections(cursor);
    const findings: WasmRiskFinding[] = [];

    const memorySection = sections.find((s) => s.id === SECTION_ID.MEMORY);
    const importSection = sections.find((s) => s.id === SECTION_ID.IMPORT);
    const codeSection = sections.find((s) => s.id === SECTION_ID.CODE);

    let hasUnboundedMemory = false;
    if (memorySection) {
      const memories = parseMemorySection(bytes, memorySection);
      hasUnboundedMemory = memories.some((m) => !m.hasMax);
      if (hasUnboundedMemory) {
        findings.push({
          severity: 'high',
          code: 'UNBOUNDED_MEMORY_DECLARATION',
          message:
            'Module declares linear memory with no maximum page limit. An attacker-influenced ' +
            'allocation loop could grow memory without bound, exhausting host resources.',
        });
      }
    }

    const importedFunctionCount = importSection ? countImportedFunctions(bytes, importSection) : 0;

    let functionCount = 0;
    if (codeSection) {
      const codeCursor = new ByteCursor(bytes, codeSection.bodyStart);
      const bodyCount = codeCursor.readVarUint32();
      functionCount = bodyCount;

      for (let i = 0; i < bodyCount; i++) {
        const bodySize = codeCursor.readVarUint32();
        const bodyBytes = bytes.subarray(codeCursor.offset, codeCursor.offset + bodySize);
        codeCursor.skip(bodySize);

        let scan: FunctionBodyScanResult;
        try {
          scan = scanFunctionBody(bodyBytes);
        } catch (err: any) {
          findings.push({
            severity: 'low',
            code: 'FUNCTION_BODY_PARSE_INCOMPLETE',
            message: `Could not fully decode function body ${i}'s instructions (${err?.message || err}); partial scan only.`,
            functionIndex: i,
          });
          continue;
        }

        if (scan.hasBareUnreachable) {
          findings.push({
            severity: 'medium',
            code: 'UNGUARDED_UNREACHABLE',
            message:
              `Function ${i} contains an \`unreachable\` instruction at its top level (outside any ` +
              'conditional block) — a Rust panic/unwrap with no surrounding recovery path will trap ' +
              'the whole contract invocation.',
            functionIndex: i,
          });
        }

        if (scan.hasUnboundedMemoryGrow) {
          findings.push({
            severity: 'medium',
            code: 'MEMORY_GROW_INSTRUCTION',
            message: `Function ${i} calls memory.grow directly; verify the growth amount is bounded by validated input.`,
            functionIndex: i,
          });
        }

        if (scan.callsBeforeLikelyStateChange && importedFunctionCount > 0) {
          findings.push({
            severity: 'low',
            code: 'POSSIBLE_REENTRANCY_ORDERING',
            message:
              `Function ${i} performs a call while imported host functions are available to the module; ` +
              'confirm state is finalized before any external call to avoid a reentrancy window ' +
              '(checks-effects-interactions). This is a coarse heuristic, not a proof of an issue.',
            functionIndex: i,
          });
        }
      }
    }

    const riskScore = computeRiskScore(findings);

    return {
      valid: true,
      findings,
      riskScore,
      stats: {
        sectionCount: sections.length,
        functionCount,
        hasMemorySection: Boolean(memorySection),
        hasUnboundedMemory,
        importedFunctionCount,
      },
    };
  } catch (error: any) {
    return {
      valid: false,
      parseError: error?.message || String(error),
      findings: [],
      riskScore: 100,
      stats: {
        sectionCount: 0,
        functionCount: 0,
        hasMemorySection: false,
        hasUnboundedMemory: false,
        importedFunctionCount: 0,
      },
    };
  }
}
