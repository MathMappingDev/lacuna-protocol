import { AbiCoder, Contract, ZeroAddress, keccak256, type Provider, type Signer, type TransactionReceipt } from "ethers";
import { FIELD, splitGross } from "./constants";
import type { LacunaKeys } from "./keys";
import { decryptNote, encryptNote, type NoteBody } from "./note";
import { commitmentOf, getHasher, nullifierOf } from "./poseidon";
import {
  emptySpend,
  proveTransact,
  type OutputNote,
  type ProofCall,
  type SpendNote,
} from "./prover";
import { NoteForest } from "./tree";

export const poolAbi = [
  "function shieldETH(uint256 npk, uint256 blinding, bytes ciphertext) payable",
  "function shieldERC20(address token, uint256 amount, uint256 npk, uint256 blinding, bytes ciphertext)",
  "function shieldERC721(address collection, uint256 id, uint256 npk, uint256 blinding, bytes ciphertext)",
  "function nftId(address collection, uint256 id) pure returns (uint256)",
  "function transact(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[16] pubSignals, bytes ciphertext0, bytes ciphertext1, tuple(address collection, uint256 id) nft0, tuple(address collection, uint256 id) nft1)",
  "function currentRoot() view returns (uint256)",
  "function nextIndex() view returns (uint256)",
  "function poolBalance(uint256 token) view returns (uint256)",
  "function nullified(uint256 nullifier) view returns (bool)",
  "function shieldFeeBps() view returns (uint256)",
  "function unshieldFeeBps() view returns (uint256)",
  "event Note(uint256 indexed treeNumber, uint256 indexed leafIndex, uint256 commitment, bytes ciphertext)",
  "event Nullified(uint256 indexed nullifier)",
  "event Shielded(address indexed from, address indexed token, uint256 gross, uint256 fee)",
  "event PublicExit(address indexed token, address indexed to, uint256 amount, uint256 protocolFee, uint256 relayFee)",
];

export function poolContract(address: string, signerOrProvider: Signer | Provider): Contract {
  return new Contract(address, poolAbi, signerOrProvider);
}

export type ContractCall = { target: string; value: bigint; data: string };

export type ShieldPlan = {
  token: string;
  tokenId?: bigint;
  nft?: boolean;
  npk: bigint;
  blinding: bigint;
  ciphertext: string;
};

export type NftLeg = { collection: string; id: bigint };

export const emptyNft: NftLeg = { collection: ZeroAddress, id: 0n };

/// Token field of an ERC-721 note. Matches LacunaPool.nftId.
export function nftId(collection: string, id: bigint): bigint {
  const encoded = AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [collection, id]);
  return BigInt(keccak256(encoded)) % FIELD;
}

/// Hash of the call list and the tokens to shield afterwards. Matches LacunaPool.callCommitment.
export function callCommitment(calls: ContractCall[], shields: ShieldPlan[]): bigint {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(address target, uint256 value, bytes data)[]",
      "tuple(address token, uint256 tokenId, bool nft, uint256 npk, uint256 blinding, bytes ciphertext)[]",
    ],
    [
      calls.map((call) => [call.target, call.value, call.data]),
      shields.map((shield) => [
        shield.token,
        shield.tokenId ?? 0n,
        shield.nft ?? false,
        shield.npk,
        shield.blinding,
        shield.ciphertext,
      ]),
    ],
  );
  return BigInt(keccak256(encoded)) % FIELD;
}

export async function loadTree(provider: Provider, pool: string): Promise<NoteForest> {
  const hash2 = await getHasher();
  const forest = new NoteForest(hash2);
  const contract = poolContract(pool, provider);
  const logs = await contract.queryFilter(contract.filters.Note());
  const ordered = logs
    .map((log) => {
      const decoded = contract.interface.decodeEventLog("Note", log.data, log.topics);
      return {
        treeNumber: Number(decoded.treeNumber),
        index: Number(decoded.leafIndex),
        commitment: BigInt(decoded.commitment),
      };
    })
    .sort((left, right) => left.treeNumber - right.treeNumber || left.index - right.index);
  for (const leaf of ordered) {
    if (forest.ensure(leaf.treeNumber).insert(leaf.commitment) !== leaf.index) {
      throw new Error("Note events are not a continuous tree");
    }
  }
  return forest;
}

export type ScannedNote = NoteBody & {
  treeNumber: number;
  index: number;
  commitment: bigint;
  spent: boolean;
};

export async function scan(provider: Provider, pool: string, keys: LacunaKeys): Promise<ScannedNote[]> {
  const contract = poolContract(pool, provider);
  const notes = await contract.queryFilter(contract.filters.Note());
  const spentLogs = await contract.queryFilter(contract.filters.Nullified());
  const spent = new Set<string>();
  for (const log of spentLogs) {
    const decoded = contract.interface.decodeEventLog("Nullified", log.data, log.topics);
    spent.add(BigInt(decoded.nullifier).toString());
  }

  const found: ScannedNote[] = [];
  for (const log of notes) {
    const decoded = contract.interface.decodeEventLog("Note", log.data, log.topics);
    const ciphertext = String(decoded.ciphertext);
    if (ciphertext === "0x") continue;
    const body = decryptNote(ciphertext, keys.viewingPrivate);
    if (!body) continue;
    const commitment = await commitmentOf(body.value, keys.npk, body.blinding, body.token);
    if (commitment !== BigInt(decoded.commitment)) continue;
    const nullifier = await nullifierOf(keys.spendingKey, commitment);
    found.push({
      ...body,
      treeNumber: Number(decoded.treeNumber),
      index: Number(decoded.leafIndex),
      commitment,
      spent: spent.has(nullifier.toString()),
    });
  }
  return found.sort((left, right) => left.treeNumber - right.treeNumber || left.index - right.index);
}

export async function spendable(keys: LacunaKeys, note: ScannedNote, forest: NoteForest): Promise<SpendNote> {
  const proof = forest.tree(note.treeNumber).path(note.index);
  return {
    enabled: true,
    value: note.value,
    npk: keys.npk,
    blinding: note.blinding,
    spendingKey: keys.spendingKey,
    siblings: proof.siblings,
    indices: proof.indices,
    token: note.token,
  };
}

export function outputOf(value: bigint, npk: bigint, blinding: bigint, token?: bigint): OutputNote {
  return { enabled: value > 0n, value, npk, blinding, token };
}

export async function shieldEth(input: {
  signer: Signer;
  pool: string;
  gross: bigint;
  npk: bigint;
  blinding: bigint;
  viewingPublic: Uint8Array;
}): Promise<TransactionReceipt> {
  const contract = poolContract(input.pool, input.signer);
  const { net } = splitGross(input.gross, BigInt(await contract.shieldFeeBps()));
  const ciphertext = encryptNote({ value: net, blinding: input.blinding, token: 0n }, input.viewingPublic);
  const tx = await contract.shieldETH(input.npk, input.blinding, ciphertext, {
    value: input.gross,
  });
  return tx.wait();
}

export async function shieldToken(input: {
  signer: Signer;
  pool: string;
  token: string;
  gross: bigint;
  npk: bigint;
  blinding: bigint;
  viewingPublic: Uint8Array;
}): Promise<TransactionReceipt> {
  const contract = poolContract(input.pool, input.signer);
  const tokenId = BigInt(input.token);
  const { net } = splitGross(input.gross, BigInt(await contract.shieldFeeBps()));
  const ciphertext = encryptNote(
    { value: net, blinding: input.blinding, token: tokenId },
    input.viewingPublic,
  );
  const tx = await contract.shieldERC20(
    input.token,
    input.gross,
    input.npk,
    input.blinding,
    ciphertext,
  );
  return tx.wait();
}

export type Submitted = { receipt: TransactionReceipt; proof: ProofCall };

export async function submitTransact(input: {
  signer: Signer;
  pool: string;
  root: bigint;
  token: bigint;
  inputs: [SpendNote, SpendNote];
  outputs: [OutputNote, OutputNote];
  ciphertexts: [string, string];
  publicAmount?: bigint;
  publicAmount1?: bigint;
  protocolFee?: bigint;
  protocolFee1?: bigint;
  token1?: bigint;
  twoTokens?: boolean;
  relayFee?: bigint;
  relayRecipient?: string;
  recipient?: string;
  externalHash?: bigint;
  nft0?: NftLeg;
  nft1?: NftLeg;
}): Promise<Submitted> {
  const contract = poolContract(input.pool, input.signer);
  const feeBps = BigInt(await contract.unshieldFeeBps());
  const first = splitExit(input.publicAmount ?? 0n, input.protocolFee, feeBps);
  const second = splitExit(input.publicAmount1 ?? 0n, input.protocolFee1, feeBps);
  const twoTokens = input.twoTokens ?? (input.token1 != null || second.publicAmount > 0n || input.nft1 != null);
  const relayFee = input.relayFee ?? 0n;
  const relayRecipient = input.relayRecipient ? BigInt(input.relayRecipient) : 0n;
  if ((relayFee === 0n) !== (relayRecipient === 0n)) {
    throw new Error("A submission tip needs the wallet that receives it");
  }
  const proof = await proveTransact({
    root: input.root,
    token: input.token,
    token1: input.token1,
    twoTokens,
    publicAmount: first.publicAmount,
    publicAmount1: second.publicAmount,
    recipient: input.recipient ? BigInt(input.recipient) : 0n,
    relayFee,
    protocolFee: first.protocolFee,
    protocolFee1: second.protocolFee,
    relayRecipient,
    externalHash: input.externalHash ?? 0n,
    inputs: input.inputs,
    outputs: input.outputs,
  });
  const tx = await contract.transact(
    proof.pA,
    proof.pB,
    proof.pC,
    proof.pubSignals,
    input.ciphertexts[0],
    input.ciphertexts[1],
    input.nft0 ?? emptyNft,
    input.nft1 ?? emptyNft,
  );
  return { receipt: await tx.wait(), proof };
}

function splitExit(
  requested: bigint,
  protocolFee: bigint | undefined,
  feeBps: bigint,
): { publicAmount: bigint; protocolFee: bigint } {
  if (protocolFee == null && requested > 0n) {
    const split = splitGross(requested, feeBps);
    return { publicAmount: split.net, protocolFee: split.fee };
  }
  return { publicAmount: requested, protocolFee: protocolFee ?? 0n };
}
