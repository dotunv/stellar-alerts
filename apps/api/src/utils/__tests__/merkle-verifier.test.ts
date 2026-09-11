import { describe, it, expect } from 'vitest';
import {
  hashMerkleLeaf,
  hashMerkleNode,
  computeMerkleRoot,
  verifyMerkleProof,
  buildMerkleTree,
  generateMerkleProof,
} from '../merkle-verifier';

function leafBuffer(label: string): Buffer {
  return Buffer.from(label, 'utf8');
}

describe('Merkle root hash verification', () => {
  it('computes a stable, deterministic leaf hash for the same bytes', () => {
    const a = hashMerkleLeaf(leafBuffer('entry-1'));
    const b = hashMerkleLeaf(leafBuffer('entry-1'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('domain-separates leaf hashing from node hashing (no second-preimage collision)', () => {
    const data = leafBuffer('same-bytes');
    const leafHash = hashMerkleLeaf(data);
    // Hashing the identical bytes as if they were a concatenated node pair
    // (data as both "children") must never equal the leaf hash of those bytes.
    const nodeHash = hashMerkleNode(data.subarray(0, data.length / 2), data.subarray(data.length / 2));
    expect(nodeHash).not.toBe(leafHash);
  });

  it('recomputes the correct root for a hand-built 2-leaf tree', () => {
    const leftLeaf = hashMerkleLeaf(leafBuffer('left'));
    const rightLeaf = hashMerkleLeaf(leafBuffer('right'));
    const expectedRoot = hashMerkleNode(Buffer.from(leftLeaf, 'hex'), Buffer.from(rightLeaf, 'hex'));

    const computed = computeMerkleRoot(leftLeaf, [{ siblingHash: rightLeaf, direction: 'right' }]);
    expect(computed).toBe(expectedRoot);
  });

  it('builds a tree from N leaves and verifies every leaf against the root', () => {
    const leaves = Array.from({ length: 7 }, (_, i) => leafBuffer(`contract-entry-${i}`));
    const tree = buildMerkleTree(leaves);

    for (let i = 0; i < leaves.length; i++) {
      const leafHash = hashMerkleLeaf(leaves[i]);
      const path = generateMerkleProof(tree, i);
      expect(verifyMerkleProof({ leafHash, path }, tree.root)).toBe(true);
    }
  });

  it('rejects a proof against the wrong root', () => {
    const leaves = Array.from({ length: 4 }, (_, i) => leafBuffer(`entry-${i}`));
    const tree = buildMerkleTree(leaves);
    const otherTree = buildMerkleTree(
      Array.from({ length: 4 }, (_, i) => leafBuffer(`different-entry-${i}`)),
    );

    const leafHash = hashMerkleLeaf(leaves[0]);
    const path = generateMerkleProof(tree, 0);

    expect(verifyMerkleProof({ leafHash, path }, otherTree.root)).toBe(false);
  });

  it('rejects a proof whose leaf was tampered with after the proof was generated', () => {
    const leaves = Array.from({ length: 4 }, (_, i) => leafBuffer(`entry-${i}`));
    const tree = buildMerkleTree(leaves);
    const path = generateMerkleProof(tree, 1);

    const tamperedLeafHash = hashMerkleLeaf(leafBuffer('tampered-entry'));
    expect(verifyMerkleProof({ leafHash: tamperedLeafHash, path }, tree.root)).toBe(false);
  });

  it('rejects a proof with a tampered sibling hash', () => {
    const leaves = Array.from({ length: 4 }, (_, i) => leafBuffer(`entry-${i}`));
    const tree = buildMerkleTree(leaves);
    const leafHash = hashMerkleLeaf(leaves[2]);
    const path = generateMerkleProof(tree, 2);

    const forgedPath = path.map((step, i) =>
      i === 0 ? { ...step, siblingHash: hashMerkleLeaf(leafBuffer('forged-sibling')) } : step,
    );

    expect(verifyMerkleProof({ leafHash, path: forgedPath }, tree.root)).toBe(false);
  });

  it('rejects a proof with a flipped sibling direction, even with correct hashes', () => {
    const leaves = Array.from({ length: 4 }, (_, i) => leafBuffer(`entry-${i}`));
    const tree = buildMerkleTree(leaves);
    const leafHash = hashMerkleLeaf(leaves[0]);
    const path = generateMerkleProof(tree, 0);

    const flippedPath = path.map((step) => ({
      ...step,
      direction: step.direction === 'left' ? ('right' as const) : ('left' as const),
    }));

    expect(verifyMerkleProof({ leafHash, path: flippedPath }, tree.root)).toBe(false);
  });

  it('handles an odd number of leaves via the duplicated-last-node convention', () => {
    const leaves = Array.from({ length: 5 }, (_, i) => leafBuffer(`entry-${i}`));
    const tree = buildMerkleTree(leaves);

    for (let i = 0; i < leaves.length; i++) {
      const leafHash = hashMerkleLeaf(leaves[i]);
      const path = generateMerkleProof(tree, i);
      expect(verifyMerkleProof({ leafHash, path }, tree.root)).toBe(true);
    }
  });

  it('verifies a single-leaf tree (empty proof path, leaf hash equals root)', () => {
    const tree = buildMerkleTree([leafBuffer('only-entry')]);
    const leafHash = hashMerkleLeaf(leafBuffer('only-entry'));
    const path = generateMerkleProof(tree, 0);

    expect(path).toEqual([]);
    expect(tree.root).toBe(leafHash);
    expect(verifyMerkleProof({ leafHash, path }, tree.root)).toBe(true);
  });

  it('never throws on malformed proof input — returns false instead', () => {
    expect(verifyMerkleProof({ leafHash: 'not-hex', path: [] }, 'also-not-hex')).toBe(false);
    expect(verifyMerkleProof({ leafHash: '', path: [] }, '')).toBe(false);
    expect(
      verifyMerkleProof(
        { leafHash: hashMerkleLeaf(leafBuffer('x')), path: [{ siblingHash: 'zz', direction: 'left' }] },
        hashMerkleLeaf(leafBuffer('x')),
      ),
    ).toBe(false);
  });

  it('rejects an out-of-range leaf index when generating a proof', () => {
    const tree = buildMerkleTree([leafBuffer('a'), leafBuffer('b')]);
    expect(() => generateMerkleProof(tree, 5)).toThrow(/out of range/);
    expect(() => generateMerkleProof(tree, -1)).toThrow(/out of range/);
  });

  it('rejects building a tree from zero leaves', () => {
    expect(() => buildMerkleTree([])).toThrow(/zero leaves/);
  });
});
