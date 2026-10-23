import { appendFileSync } from "fs";
import { AbiCoder, Contract, ZeroAddress, keccak256, type Provider, type Signer, type TransactionReceipt } from "ethers";
import { FIELD, minProtocolFee, splitGross } from "./constants";
import type { LacunaKeys } from "./keys";
import { decryptNote, encryptNote, type NoteBody } from "./note";
import { commitmentOf, getHasher, hash2, nullifierOf } from "./poseidon";
import {
  emptySpend,
  proveTransact,
  type OutputNote,
  type ProofCall,
  type SpendNote,
} from "./prover";
import { NoteForest } from "./tree";

export const poolAbi = [
  "function shieldETH(uint256 ownerHash, bytes ciphertext) payable",
  "function shieldERC20(address token, uint256 amount, uint256 ownerHash, bytes ciphertext)",
  "function shieldERC721(address collection, uint256 id, uint256 ownerHash, bytes ciphertext)",
  "function nftId(address collection, uint256 id) pure returns (uint256)",
  "function feeBalance(uint256 token) view returns (uint256)",
  "function withdrawFees(address token)",
  "function transact(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[17] pubSignals, bytes ciphertext0, bytes ciphertext1, tuple(address collection, uint256 id) nft0, tuple(address collection, uint256 id) nft1)",
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
  ownerHash: bigint;
  ciphertext: string;
};

const LOG_SPAN = 9_000;

async function queryLogs(contract: Contract, filter: Parameters<Contract["queryFilter"]>[0], provider: Provider) {
  const latest = await provider.getBlockNumber();
  const logs = [];
  for (let from = 0; from <= latest; from += LOG_SPAN) {
    const to = Math.min(latest, from + LOG_SPAN - 1);
    logs.push(...(await contract.queryFilter(filter, from, to)));
  }
  return logs;
}

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
      "tuple(address token, uint256 tokenId, bool nft, uint256 ownerHash, bytes ciphertext)[]",
    ],
    [
      calls.map((call) => [call.target, call.value, call.data]),
      shields.map((shield) => [
        shield.token,
        shield.tokenId ?? 0n,
        shield.nft ?? false,
        shield.ownerHash,
        shield.ciphertext,
      ]),
    ],
  );
  return BigInt(keccak256(encoded)) % FIELD;
}

export function ciphertextHash(first: string, second: string): bigint {
  const encoded = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [first, second]);
  return BigInt(keccak256(encoded)) % FIELD;
}

export async function loadTree(provider: Provider, pool: string): Promise<NoteForest> {
  const hash2 = await getHasher();
  const forest = new NoteForest(hash2);
  const contract = poolContract(pool, provider);
  const logs = await queryLogs(contract, contract.filters.Note(), provider);
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
  const notes = await queryLogs(contract, contract.filters.Note(), provider);
  const spentLogs = await queryLogs(contract, contract.filters.Nullified(), provider);
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
    const decrypted = decryptNote(ciphertext, keys.viewingPrivate);
    if (!decrypted) continue;
    const eventCommitment = BigInt(decoded.commitment);
    const value = await noteValue(provider, contract, log.transactionHash, decrypted, keys.npk, eventCommitment);
    if (value == null) continue;
    const body = { ...decrypted, value };
    const commitment = await commitmentOf(body.value, keys.npk, body.blinding, body.token);
    if (commitment !== eventCommitment) continue;
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
  const ownerHash = await hash2(input.npk, input.blinding);
  const tx = await contract.shieldETH(ownerHash, ciphertext, {
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
  const ownerHash = await hash2(input.npk, input.blinding);
  const tx = await contract.shieldERC20(input.token, input.gross, ownerHash, ciphertext);
  return tx.wait();
}

export type OutputSecret = {
  value: string;
  blinding: string;
  token: string;
  npk: string;
  ciphertext: string;
};

export type Submitted = { receipt: TransactionReceipt; proof: ProofCall; outputs: OutputSecret[] };

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
  secretFile?: string;
}): Promise<Submitted> {
  const contract = poolContract(input.pool, input.signer);
  const feeBps = BigInt(await contract.unshieldFeeBps());
  const relayFee = input.relayFee ?? 0n;
  const first = splitExit(input.publicAmount ?? 0n, input.protocolFee, feeBps, relayFee);
  const second = splitExit(input.publicAmount1 ?? 0n, input.protocolFee1, feeBps, 0n);
  const twoTokens = input.twoTokens ?? (input.token1 != null || second.publicAmount > 0n || input.nft1 != null);
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
    ciphertextHash: ciphertextHash(input.ciphertexts[0], input.ciphertexts[1]),
    inputs: input.inputs,
    outputs: input.outputs,
  });
  const outputs = input.outputs.map((note, index) => ({
    value: (note.enabled ? note.value : 0n).toString(),
    blinding: note.blinding.toString(),
    token: (note.token ?? input.token).toString(),
    npk: note.npk.toString(),
    ciphertext: input.ciphertexts[index],
  }));
  appendFileSync(
    input.secretFile ?? "lacuna-output-secrets.json",
    `${JSON.stringify({ savedAt: new Date().toISOString(), outputs })}\n`,
  );
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
  return { receipt: await tx.wait(), proof, outputs };
}

async function noteValue(
  provider: Provider,
  contract: Contract,
  transactionHash: string,
  body: NoteBody,
  npk: bigint,
  eventCommitment: bigint,
): Promise<bigint | null> {
  if ((await commitmentOf(body.value, npk, body.blinding, body.token)) === eventCommitment) return body.value;
  const receipt = await provider.getTransactionReceipt(transactionHash);
  if (!receipt) return null;
  for (const entry of receipt.logs) {
    try {
      const decoded = contract.interface.decodeEventLog("Shielded", entry.data, entry.topics);
      if (BigInt(decoded.token) !== body.token) continue;
      const net = BigInt(decoded.gross) - BigInt(decoded.fee);
      if ((await commitmentOf(net, npk, body.blinding, body.token)) === eventCommitment) return net;
    } catch {
      continue;
    }
  }
  if ((await commitmentOf(1n, npk, body.blinding, body.token)) === eventCommitment) return 1n;
  return null;
}

function splitExit(
  requested: bigint,
  protocolFee: bigint | undefined,
  feeBps: bigint,
  relayFee: bigint,
): { publicAmount: bigint; protocolFee: bigint } {
  if (protocolFee != null) return { publicAmount: requested, protocolFee };
  if (requested === 0n && relayFee === 0n) return { publicAmount: 0n, protocolFee: 0n };
  if (relayFee === 0n) {
    const split = splitGross(requested, feeBps);
    return { publicAmount: split.net, protocolFee: split.fee };
  }
  const recipient = requested === 0n ? { net: 0n, fee: 0n } : splitGross(requested, feeBps);
  const combined = minProtocolFee(recipient.net + relayFee, feeBps);
  return { publicAmount: recipient.net, protocolFee: combined > recipient.fee ? combined : recipient.fee };
}
