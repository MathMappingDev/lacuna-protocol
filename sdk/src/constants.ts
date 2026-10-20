export const LEVELS = 16;
export const FEE_BPS = 20n;
export const BPS = 10_000n;
export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const MAX_AMOUNT = 1n << 128n;

export function feeOf(gross: bigint, feeBps: bigint = FEE_BPS): bigint {
  return (gross * feeBps) / BPS;
}

export function splitGross(gross: bigint, feeBps: bigint = FEE_BPS): { fee: bigint; net: bigint } {
  const fee = feeOf(gross, feeBps);
  return { fee, net: gross - fee };
}
