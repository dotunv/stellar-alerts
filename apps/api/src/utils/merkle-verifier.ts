import * as crypto from 'crypto';

/**
 * Generic, protocol-agnostic Merkle inclusion proof verification.
 *
 * Used to cryptographically verify a Soroban contract storage entry against
 * a Stellar ledger's state commitment (the ledger header's
 * `bucketListHash`, xdr.LedgerHeader.bucketListHash) without running a full
 * node — a "light client" proof check. See lib/soroban.ts for the
 * Soroban-specific leaf hashing wired to this verifier.
 *
 * Note on scope: Soroban RPC's public API (getLedgerEntries, getLatestLedger)
 * does not currently expose per-entry inclusion proofs or ledger header XDR,
 * so there is no standard source to fetch a live proof from yet. This module
 * implements the verification math itself — correct, tested, and ready to
 * consume a proof from whatever source (a future RPC method, a
 * captive-core export, a third-party prover service) once one exists.
 */

export type MerkleProofDirection = 'left' | 'right';

export interface MerkleProofStep {
  /** Hex-encoded sibling hash at this level of the tree. */
  siblingHash: string;
  /** Which side of the running hash the sibling sits on. */
  direction: MerkleProofDirection;
}

export interface MerkleProof {
  /** Hex-encoded hash of the leaf being proven. */
  leafHash: string;
  /** Ordered sibling hashes from the leaf up to (but not including) the root. */
  path: MerkleProofStep[];
}

export interface MerkleTree {
  /** Hex-encoded Merkle root. */
  root: string;
  /** layers[0] is the leaf hashes; each subsequent layer is its parents; the last layer is [root]. */
  layers: string[][];
}

const HEX_64 = /^[0-9a-f]{64}$/i;

function sha256(...buffers: Buffer[]): Buffer {
  const hash = crypto.createHash('sha256');
  for (const buffer of buffers) hash.update(buffer);
  return hash.digest();
}

/**
 * Hashes a leaf's raw payload. Domain-separated from internal-node hashing
 * with a leading 0x00 byte so a leaf hash can never be replayed as an
 * internal node hash for the same bytes — the classic second-preimage
 * weakness in naive (undifferentiated) Merkle trees.
 */
export function hashMerkleLeaf(data: Buffer): string {
  return sha256(Buffer.from([0x00]), data).toString('hex');
}

/** Combines two child hashes into their parent, domain-separated with a leading 0x01 byte. */
export function hashMerkleNode(left: Buffer, right: Buffer): string {
  return sha256(Buffer.from([0x01]), left, right).toString('hex');
}

function isHex64(value: string): boolean {
  return typeof value === 'string' && HEX_64.test(value);
}

/**
 * Recomputes a Merkle root by folding a leaf hash up through its proof path.
 * Throws if the leaf hash, a sibling hash, or the recomputed intermediate
 * value is not a well-formed 32-byte hex hash — callers that need a
 * never-throws boolean should use {@link verifyMerkleProof} instead.
 */
export function computeMerkleRoot(leafHash: string, path: MerkleProofStep[]): string {
  if (!isHex64(leafHash)) {
    throw new Error(`Invalid leaf hash: expected 32-byte hex, got "${leafHash}"`);
  }

  let current = Buffer.from(leafHash, 'hex');

  for (const step of path) {
    if (!isHex64(step.siblingHash)) {
      throw new Error(`Invalid sibling hash in proof path: "${step.siblingHash}"`);
    }
    const sibling = Buffer.from(step.siblingHash, 'hex');
    const parentHex =
      step.direction === 'left' ? hashMerkleNode(sibling, current) : hashMerkleNode(current, sibling);
    current = Buffer.from(parentHex, 'hex');
  }

  return current.toString('hex');
}

/**
 * Verifies that `proof` is a valid Merkle inclusion proof against
 * `expectedRoot`. Returns false — never throws — for any structurally
 * invalid input (malformed hex, wrong lengths): a proof that can't even be
 * parsed is exactly as "not verified" as one that's mathematically wrong.
 */
export function verifyMerkleProof(proof: MerkleProof, expectedRoot: string): boolean {
  if (!isHex64(expectedRoot)) return false;
  if (!proof || !isHex64(proof.leafHash) || !Array.isArray(proof.path)) return false;

  try {
    const computedRoot = computeMerkleRoot(proof.leafHash, proof.path);
    return computedRoot.toLowerCase() === expectedRoot.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Builds a full Merkle tree from raw leaf payloads (test/tooling helper —
 * a real prover would build this from the actual bucket list contents).
 * An odd node at any level is paired with itself, the standard convention
 * used by e.g. Bitcoin's transaction Merkle tree.
 */
export function buildMerkleTree(leaves: Buffer[]): MerkleTree {
  if (leaves.length === 0) {
    throw new Error('Cannot build a Merkle tree from zero leaves');
  }

  let currentLayer = leaves.map((leaf) => hashMerkleLeaf(leaf));
  const layers: string[][] = [currentLayer];

  while (currentLayer.length > 1) {
    const nextLayer: string[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i];
      const right = currentLayer[i + 1] ?? currentLayer[i];
      nextLayer.push(hashMerkleNode(Buffer.from(left, 'hex'), Buffer.from(right, 'hex')));
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  return { root: currentLayer[0], layers };
}

/** Derives the inclusion proof path for a given leaf index from a tree built by {@link buildMerkleTree}. */
export function generateMerkleProof(tree: MerkleTree, leafIndex: number): MerkleProofStep[] {
  const leafCount = tree.layers[0]?.length ?? 0;
  if (leafIndex < 0 || leafIndex >= leafCount) {
    throw new Error(`leafIndex ${leafIndex} out of range for a tree with ${leafCount} leaves`);
  }

  const path: MerkleProofStep[] = [];
  let index = leafIndex;

  for (let level = 0; level < tree.layers.length - 1; level++) {
    const layer = tree.layers[level];
    const isRightNode = index % 2 === 1;
    const siblingIndex = isRightNode ? index - 1 : index + 1;
    const siblingHash = layer[siblingIndex] ?? layer[index]; // duplicated odd node
    path.push({ siblingHash, direction: isRightNode ? 'left' : 'right' });
    index = Math.floor(index / 2);
  }

  return path;
}
