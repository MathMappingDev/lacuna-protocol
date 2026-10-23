# Lacuna protocol

Privacy pool contracts and a local SDK. Proofs are built on the user's machine. Submitting a proof needs an ordinary Ethereum RPC. There is no Lacuna server.

This copy is for **Sepolia**. The proving key in this repository was created on one machine. Use it with test ETH only. A public ceremony and an audit are still required before real funds.

## What gets deployed

The deploy script publishes these contracts, in order, from the wallet in `.env`:

1. `PoseidonT3`, the hash library
2. `LacunaHasher`, linked to that library
3. `LacunaVerifier`, the proof checker that matches the key shipped in this repo
4. `LacunaPool`, the note pool
5. `LacunaRelay`, the contract that runs calls and shields the results
6. One call to `setRelay`, which names the relay. That name can be set once.

The deployer wallet becomes the owner and, unless you set another address, the treasury.

The owner can set the shield fee and the unshield fee from 0% to 1%. Both start at 0.20%. The owner cannot pause the pool, withdraw the notes, or hand the owner key to someone else. Protocol fees stay in the pool until the treasury calls `withdrawFees`. That call pays only the accrued fees. It cannot take the note balances.

## Before you start

- Node.js 20 or newer
- A Sepolia RPC URL. The script uses a public endpoint if you leave this blank.
- A wallet with Sepolia ETH. That wallet pays for deployment and becomes the owner.

Get Sepolia ETH from a faucet, then check the balance in a wallet before you deploy.

## Deploy on Sepolia

From this folder:

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```bash
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
TREASURY_ADDRESS=
```

`DEPLOYER_PRIVATE_KEY` is the only required value. Leave `TREASURY_ADDRESS` empty to name the deployer as the treasury. Put a different address there if someone else should be the only account that can call `withdrawFees`.

Do not commit `.env`. It is listed in `.gitignore`.

Then:

```bash
npm run deploy:sepolia
```

When it finishes, the addresses are printed and saved to `deployments/sepolia.json`. Keep that file. The pool address and the relay address are the two the SDK needs.

## After deployment

Shield, private send, and unshield go to the pool. A call into another contract, such as a swap or a liquidity add, goes through the relay. The proof names the calls and the tokens that should be shielded afterwards. Name every token the calls should return, including leftover of the token you sold. A token that arrives and is not named stays on the relay, and a later call can take it. A shield or a relay re-shield takes `ownerHash`, which is the Poseidon hash of the note key and its blinding factor. The note key itself is not in the transaction.

Private addresses from the SDK start with `0LcnZK`, then the note key and viewing key, then an 8-character checksum. An address with a flipped character is rejected.

The SDK writes the secrets of every output note to `lacuna-output-secrets.json` before it broadcasts. That file can spend nothing by itself, but it can identify the notes. Do not commit it.

The verifier in `contracts/LacunaVerifier.sol` matches `circuits/build/transact_final.zkey`. Deploy this repository as it is. Rebuilding the circuit creates a new verifier, and that verifier has to be deployed again. Do not deploy an older commit of this repository. The first deployment has to be this version.

## Checks before a deploy

```bash
npx hardhat test
```

`npm test` rebuilds the circuit first. Skip that unless you mean to replace the verifier.
