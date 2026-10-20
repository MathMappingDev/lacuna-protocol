import { mkdirSync, writeFileSync } from "fs";
import { ethers, network } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("Set DEPLOYER_PRIVATE_KEY in lacuna-protocol/.env before deploying");
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  if (!ethers.isAddress(treasury)) throw new Error("TREASURY_ADDRESS is not an address");
  if (balance === 0n) {
    throw new Error(`Deployer ${deployer.address} has no Sepolia ETH`);
  }

  console.log("Deployer", deployer.address);
  console.log("Balance", ethers.formatEther(balance), "ETH");
  console.log("Treasury", treasury);

  const poseidon = await ethers.deployContract("PoseidonT3");
  await poseidon.waitForDeployment();
  const hasher = await ethers.deployContract("LacunaHasher", [], {
    libraries: { PoseidonT3: await poseidon.getAddress() },
  });
  await hasher.waitForDeployment();
  const verifier = await ethers.deployContract("LacunaVerifier");
  await verifier.waitForDeployment();
  const pool = await ethers.deployContract("LacunaPool", [
    await hasher.getAddress(),
    await verifier.getAddress(),
    treasury,
  ]);
  await pool.waitForDeployment();
  const relay = await ethers.deployContract("LacunaRelay", [await pool.getAddress()]);
  await relay.waitForDeployment();
  const setRelay = await pool.setRelay(await relay.getAddress());
  await setRelay.wait();

  const deployed = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    treasury,
    poseidon: await poseidon.getAddress(),
    hasher: await hasher.getAddress(),
    verifier: await verifier.getAddress(),
    pool: await pool.getAddress(),
    relay: await relay.getAddress(),
    setRelayTx: setRelay.hash,
  };

  mkdirSync("deployments", { recursive: true });
  writeFileSync("deployments/sepolia.json", JSON.stringify(deployed, null, 2));
  console.log(JSON.stringify(deployed, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
