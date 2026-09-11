import { describe, it, expect } from 'vitest';
import { analyzeWasmBytecode } from '../wasm-analyzer';

// --- Minimal hand-rolled WASM module builder for test fixtures -------------
// Encodes just enough of the binary format (see
// https://webassembly.github.io/spec/core/binary/index.html) to build real,
// structurally valid sample modules exercising the analyzer's heuristics.

function uleb128(value: number): number[] {
  const bytes: number[] = [];
  let v = value;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return bytes;
}

function section(id: number, body: number[]): number[] {
  return [id, ...uleb128(body.length), ...body];
}

function vec(items: number[][]): number[] {
  return [...uleb128(items.length), ...items.flat()];
}

const WASM_HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

/** Builds a func body: locals vector (empty) + instruction bytes + end opcode. */
function funcBody(instructions: number[]): number[] {
  const body = [...uleb128(0), ...instructions, 0x0b]; // 0 local groups, then `end`
  return [...uleb128(body.length), ...body];
}

interface ModuleOptions {
  memory?: { min: number; max?: number };
  functionImports?: number; // number of dummy imported functions
  functionBodies?: number[][]; // each entry is the instruction list for one function
}

/**
 * Builds a minimal-but-structurally-real WASM module with an optional
 * memory section, optional imported functions, and given function bodies.
 * Type/Function sections are populated just enough to keep bodyCount
 * consistent; the analyzer doesn't need them to be semantically valid.
 */
function buildModule(opts: ModuleOptions): Buffer {
  const sections: number[] = [...WASM_HEADER];

  if (opts.functionImports) {
    const imports = Array.from({ length: opts.functionImports }, (_, i) => {
      const moduleName = [0x65, 0x6e, 0x76]; // "env"
      const fieldName = [0x66 + i]; // single-byte varying field name
      return [...uleb128(moduleName.length), ...moduleName, ...uleb128(1), fieldName[0], 0x00, ...uleb128(0)];
    });
    sections.push(...section(2, vec(imports)));
  }

  if (opts.memory) {
    const hasMax = opts.memory.max !== undefined;
    const limits = hasMax
      ? [0x01, ...uleb128(opts.memory.min), ...uleb128(opts.memory.max!)]
      : [0x00, ...uleb128(opts.memory.min)];
    sections.push(...section(5, vec([limits])));
  }

  if (opts.functionBodies && opts.functionBodies.length > 0) {
    // Function section: one type index (0) per function — type section itself
    // is omitted since the analyzer doesn't read it.
    const funcIndices = opts.functionBodies.map(() => uleb128(0));
    sections.push(...section(3, vec(funcIndices)));

    const bodies = opts.functionBodies.map((instrs) => funcBody(instrs));
    sections.push(...section(10, [...uleb128(bodies.length), ...bodies.flat()]));
  }

  return Buffer.from(sections);
}

const OP_UNREACHABLE = 0x00;
const OP_BLOCK = 0x02;
const OP_IF = 0x04;
const OP_END = 0x0b;
const OP_CALL = 0x10;
const OP_MEMORY_GROW = 0x40;
const BLOCKTYPE_EMPTY = 0x40;

describe('analyzeWasmBytecode', () => {
  it('rejects a binary that is too short to be WASM', () => {
    const result = analyzeWasmBytecode(Buffer.from([0x00, 0x61]));
    expect(result.valid).toBe(false);
    expect(result.riskScore).toBe(100);
    expect(result.parseError).toBeTruthy();
  });

  it('rejects a binary with the wrong magic number', () => {
    const result = analyzeWasmBytecode(Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x00, 0x00, 0x00]));
    expect(result.valid).toBe(false);
    expect(result.parseError).toMatch(/magic/i);
  });

  it('rejects a binary with an unsupported version', () => {
    const result = analyzeWasmBytecode(Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]));
    expect(result.valid).toBe(false);
    expect(result.parseError).toMatch(/version/i);
  });

  it('accepts a minimal empty module with no sections as valid and risk-free', () => {
    const result = analyzeWasmBytecode(Buffer.from(WASM_HEADER));
    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.riskScore).toBe(0);
    expect(result.stats.hasMemorySection).toBe(false);
  });

  it('flags a memory section with no maximum as unbounded (high severity)', () => {
    const wasm = buildModule({ memory: { min: 1 } });
    const result = analyzeWasmBytecode(wasm);

    expect(result.valid).toBe(true);
    expect(result.stats.hasMemorySection).toBe(true);
    expect(result.stats.hasUnboundedMemory).toBe(true);
    expect(result.findings.some((f) => f.code === 'UNBOUNDED_MEMORY_DECLARATION' && f.severity === 'high')).toBe(
      true,
    );
    expect(result.riskScore).toBeGreaterThan(0);
  });

  it('does not flag a memory section that declares a maximum', () => {
    const wasm = buildModule({ memory: { min: 1, max: 16 } });
    const result = analyzeWasmBytecode(wasm);

    expect(result.stats.hasUnboundedMemory).toBe(false);
    expect(result.findings.some((f) => f.code === 'UNBOUNDED_MEMORY_DECLARATION')).toBe(false);
  });

  it('flags a top-level unreachable instruction as an unguarded panic', () => {
    const wasm = buildModule({ functionBodies: [[OP_UNREACHABLE]] });
    const result = analyzeWasmBytecode(wasm);

    expect(result.valid).toBe(true);
    expect(result.stats.functionCount).toBe(1);
    const finding = result.findings.find((f) => f.code === 'UNGUARDED_UNREACHABLE');
    expect(finding).toBeDefined();
    expect(finding?.functionIndex).toBe(0);
    expect(finding?.severity).toBe('medium');
  });

  it('does not flag an unreachable instruction nested inside a block (guarded)', () => {
    // block { unreachable } end  -- still inside `depth > 0` when it appears
    const wasm = buildModule({
      functionBodies: [[OP_BLOCK, BLOCKTYPE_EMPTY, OP_UNREACHABLE, OP_END]],
    });
    const result = analyzeWasmBytecode(wasm);

    expect(result.findings.some((f) => f.code === 'UNGUARDED_UNREACHABLE')).toBe(false);
  });

  it('flags a memory.grow instruction inside a function body', () => {
    const wasm = buildModule({ functionBodies: [[OP_MEMORY_GROW, 0x00]] });
    const result = analyzeWasmBytecode(wasm);

    expect(result.findings.some((f) => f.code === 'MEMORY_GROW_INSTRUCTION')).toBe(true);
  });

  it('flags a possible reentrancy ordering when a function calls an imported host function', () => {
    const wasm = buildModule({
      functionImports: 1,
      functionBodies: [[OP_CALL, ...uleb128(0)]],
    });
    const result = analyzeWasmBytecode(wasm);

    expect(result.stats.importedFunctionCount).toBe(1);
    expect(result.findings.some((f) => f.code === 'POSSIBLE_REENTRANCY_ORDERING')).toBe(true);
  });

  it('does not flag reentrancy ordering when there are no imported functions', () => {
    const wasm = buildModule({ functionBodies: [[OP_CALL, ...uleb128(0)]] });
    const result = analyzeWasmBytecode(wasm);

    expect(result.findings.some((f) => f.code === 'POSSIBLE_REENTRANCY_ORDERING')).toBe(false);
  });

  it('accumulates multiple findings into a higher risk score than a single finding', () => {
    const singleFindingWasm = buildModule({ functionBodies: [[OP_UNREACHABLE]] });
    const multiFindingWasm = buildModule({
      memory: { min: 1 },
      functionImports: 1,
      functionBodies: [[OP_UNREACHABLE], [OP_MEMORY_GROW, 0x00, OP_CALL, ...uleb128(0)]],
    });

    const single = analyzeWasmBytecode(singleFindingWasm);
    const multi = analyzeWasmBytecode(multiFindingWasm);

    expect(multi.riskScore).toBeGreaterThan(single.riskScore);
    expect(multi.findings.length).toBeGreaterThan(single.findings.length);
  });

  it('caps the risk score at 100 regardless of how many findings are present', () => {
    const manyFindings = Array.from({ length: 20 }, () => [OP_UNREACHABLE]);
    const wasm = buildModule({ functionBodies: manyFindings });
    const result = analyzeWasmBytecode(wasm);

    expect(result.riskScore).toBeLessThanOrEqual(100);
  });

  it('accepts both Buffer and Uint8Array input', () => {
    const wasm = buildModule({ memory: { min: 1, max: 4 } });
    const fromBuffer = analyzeWasmBytecode(wasm);
    const fromUint8Array = analyzeWasmBytecode(new Uint8Array(wasm));

    expect(fromUint8Array.valid).toBe(true);
    expect(fromUint8Array.stats).toEqual(fromBuffer.stats);
  });

  it('marks an if/end guarded unreachable as non-top-level but still reports overall stats correctly', () => {
    const wasm = buildModule({
      functionBodies: [[OP_IF, BLOCKTYPE_EMPTY, OP_UNREACHABLE, OP_END]],
    });
    const result = analyzeWasmBytecode(wasm);

    expect(result.stats.functionCount).toBe(1);
    expect(result.findings.some((f) => f.code === 'UNGUARDED_UNREACHABLE')).toBe(false);
  });
});
