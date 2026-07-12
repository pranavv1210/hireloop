import crypto from 'node:crypto';
import { config } from '../config.js';

type EncryptedValue = {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
};

export function encryptionConfigured(): boolean {
  return getCredentialKey() !== null;
}

export function encryptCredential(value: string): string {
  const key = getCredentialKey();
  if (!key) {
    throw new Error('LINKEDIN_CREDENTIAL_KEY must be configured before storing credentials');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const encrypted: EncryptedValue = {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };

  return JSON.stringify(encrypted);
}

export function decryptCredential(serialized: string): string {
  const key = getCredentialKey();
  if (!key) {
    throw new Error('LINKEDIN_CREDENTIAL_KEY must be configured before reading credentials');
  }

  const encrypted = JSON.parse(serialized) as EncryptedValue;
  if (encrypted.version !== 1 || encrypted.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported encrypted credential format');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(encrypted.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function getCredentialKey(): Buffer | null {
  if (!config.linkedinCredentialKey) {
    return null;
  }

  const key = parseKey(config.linkedinCredentialKey);
  if (key.length !== 32) {
    throw new Error('LINKEDIN_CREDENTIAL_KEY must decode to exactly 32 bytes');
  }

  return key;
}

function parseKey(value: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, 'hex');
  }

  return Buffer.from(value, 'base64');
}
