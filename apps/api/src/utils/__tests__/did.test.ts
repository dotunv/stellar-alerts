import { describe, it, expect } from 'vitest';
import * as StellarSdk from 'stellar-sdk';
import { parseDID, generateDIDChallenge, verifyDIDSignature } from '../did';

describe('W3C Decentralized Identity (DID) Auth Utility (#141)', () => {
  const validStellarPubKey = 'GCM3T6QMBDNTPGL55F4ISPBBXOTND35BEYXIQ3WDMM73VGTRF6U766MA';
  const validStellarDID = `did:pkh:stellar:${validStellarPubKey}`;

  it('should correctly parse did:pkh identity strings', () => {
    const parsed = parseDID(validStellarDID);
    expect(parsed.method).toBe('did:pkh');
    expect(parsed.network).toBe('stellar');
    expect(parsed.address).toBe(validStellarPubKey);
  });

  it('should correctly parse did:key identity strings', () => {
    const keyDID = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWxs5S47';
    const parsed = parseDID(keyDID);
    expect(parsed.method).toBe('did:key');
    expect(parsed.address).toBe('z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWxs5S47');
  });

  it('should throw error for invalid DID strings', () => {
    expect(() => parseDID('not-a-did')).toThrow('Invalid DID format');
    expect(() => parseDID('did:short')).toThrow('Malformed DID string');
  });

  it('should generate a valid auth challenge for DID', () => {
    const challengeObj = generateDIDChallenge(validStellarDID);
    expect(challengeObj.did).toBe(validStellarDID);
    expect(challengeObj.challenge).toContain('StellarAlerts-Auth-Challenge');
    expect(challengeObj.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('should verify signed Stellar DID challenge using Stellar keypair Ed25519 signature', () => {
    const keypair = StellarSdk.Keypair.random();
    const stellarDID = `did:pkh:stellar:${keypair.publicKey()}`;
    const challengeObj = generateDIDChallenge(stellarDID);

    const messageBuffer = Buffer.from(challengeObj.challenge, 'utf-8');
    const signatureBuffer = keypair.sign(messageBuffer);
    const signatureBase64 = signatureBuffer.toString('base64');

    const isValid = verifyDIDSignature(stellarDID, challengeObj.challenge, signatureBase64);
    expect(isValid).toBe(true);
  });

  it('should reject invalid or tampered DID challenge signatures', () => {
    const keypair = StellarSdk.Keypair.random();
    const stellarDID = `did:pkh:stellar:${keypair.publicKey()}`;
    const challengeObj = generateDIDChallenge(stellarDID);

    const tamperedChallenge = `${challengeObj.challenge}-tampered`;
    const messageBuffer = Buffer.from(challengeObj.challenge, 'utf-8');
    const signatureBuffer = keypair.sign(messageBuffer);
    const signatureBase64 = signatureBuffer.toString('base64');

    const isValid = verifyDIDSignature(stellarDID, tamperedChallenge, signatureBase64);
    expect(isValid).toBe(false);
  });
});
