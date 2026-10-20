import { randomBytes } from "crypto";
import { x25519 } from "@noble/curves/ed25519";
import { concat, getBytes, hexlify, keccak256, Mnemonic, toUtf8Bytes } from "ethers";
import { FIELD } from "./constants";
import { npkOf } from "./poseidon";

export type LacunaKeys = {
  phrase: string;
  spendingKey: bigint;
  viewingPrivate: Uint8Array;
  viewingPublic: Uint8Array;
  npk: bigint;
  address: string;
};

function u256Hex(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

export const ADDRESS_PREFIX = "0LcnZK";

export function formatAddress(npk: bigint, viewingPublic: Uint8Array): string {
  return `${ADDRESS_PREFIX}${u256Hex(npk)}${Buffer.from(viewingPublic).toString("hex")}`;
}

export function parseAddress(address: string): { npk: bigint; viewingPublic: Uint8Array } {
  if (!address.startsWith(ADDRESS_PREFIX) || address.length !== ADDRESS_PREFIX.length + 128) {
    throw new Error("Lacuna address must start with 0LcnZK and contain the note key and viewing key");
  }
  const body = address.slice(ADDRESS_PREFIX.length);
  return {
    npk: BigInt(`0x${body.slice(0, 64)}`),
    viewingPublic: getBytes(`0x${body.slice(64)}`),
  };
}

export async function keysFromPhrase(phrase: string): Promise<LacunaKeys> {
  const seed = getBytes(Mnemonic.fromPhrase(phrase.trim()).computeSeed());
  const spendingKey = BigInt(keccak256(concat([seed, toUtf8Bytes("lacuna-spend-v1")]))) % FIELD;
  if (spendingKey === 0n) throw new Error("This phrase cannot derive a spending key");
  const viewingPrivate = getBytes(keccak256(concat([seed, toUtf8Bytes("lacuna-view-v1")])));
  const viewingPublic = x25519.getPublicKey(viewingPrivate);
  const npk = await npkOf(spendingKey);
  return {
    phrase: phrase.trim(),
    spendingKey,
    viewingPrivate,
    viewingPublic,
    npk,
    address: formatAddress(npk, viewingPublic),
  };
}

export async function createWallet(wordCount: 12 | 24 = 12): Promise<LacunaKeys> {
  const phrase = Mnemonic.fromEntropy(randomBytes(wordCount === 12 ? 16 : 32)).phrase;
  return keysFromPhrase(phrase);
}

export function randomBlinding(): bigint {
  return BigInt(hexlify(randomBytes(16)));
}
