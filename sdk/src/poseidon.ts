import { buildPoseidon } from "circomlibjs";

type PoseidonFn = (inputs: bigint[]) => Uint8Array;
type PoseidonField = { toObject: (value: Uint8Array) => bigint };

let ready: Promise<(left: bigint, right: bigint) => bigint> | null = null;

export function getHasher(): Promise<(left: bigint, right: bigint) => bigint> {
  if (!ready) {
    ready = buildPoseidon().then((poseidon) => {
      const hash = poseidon as unknown as PoseidonFn;
      const field = poseidon.F as unknown as PoseidonField;
      return (left: bigint, right: bigint) => BigInt(field.toObject(hash([left, right])).toString());
    });
  }
  return ready;
}

export async function hash2(left: bigint, right: bigint): Promise<bigint> {
  return (await getHasher())(left, right);
}

export async function commitmentOf(
  value: bigint,
  npk: bigint,
  blinding: bigint,
  token: bigint,
): Promise<bigint> {
  const ownerHash = await hash2(npk, blinding);
  const left = await hash2(value, token);
  return hash2(left, ownerHash);
}

export async function npkOf(spendingKey: bigint): Promise<bigint> {
  return hash2(spendingKey, 1n);
}

export async function nullifierOf(spendingKey: bigint, commitment: bigint): Promise<bigint> {
  return hash2(spendingKey, commitment);
}
