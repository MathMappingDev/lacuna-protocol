import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const envFile = resolve(__dirname, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
    let value = trimmed.slice(trimmed.indexOf("=") + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.19",
        settings: {
          optimizer: { enabled: true, runs: 1 },
        },
      },
    ],
    overrides: {
      "contracts/LacunaRelay.sol": {
        version: "0.8.19",
        settings: {
          viaIR: true,
          optimizer: { enabled: true, runs: 1 },
        },
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: { timeout: 600000 },
  networks: {
    hardhat: {
      blockGasLimit: 100_000_000,
      allowUnlimitedContractSize: true,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: deployerKey ? [deployerKey] : [],
    },
  },
};

export default config;
