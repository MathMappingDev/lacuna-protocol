import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "circuits/build");
const toolsDir = path.join(root, "tools");
const circuit = path.join(root, "circuits/transact.circom");
const r1cs = path.join(buildDir, "transact.r1cs");
const wasm = path.join(buildDir, "transact_js/transact.wasm");
const finalZkey = path.join(buildDir, "transact_final.zkey");
const verifierPath = path.join(root, "contracts/LacunaVerifier.sol");

function newer(source, target) {
  if (!existsSync(target)) return true;
  return statSync(source).mtimeMs > statSync(target).mtimeMs;
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed ${response.status} ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function circomBinary() {
  const destination = path.join(toolsDir, "circom");
  if (existsSync(destination)) return destination;
  mkdirSync(toolsDir, { recursive: true });
  const release = await fetch("https://api.github.com/repos/iden3/circom/releases/latest", {
    headers: { "user-agent": "lacuna-protocol", accept: "application/vnd.github+json" },
  }).then((response) => response.json());
  const asset = release.assets.find((item) => /macos.*arm64|darwin.*arm64|macos-arm64/i.test(item.name))
    ?? release.assets.find((item) => /macos|darwin/i.test(item.name));
  if (!asset) throw new Error("No macOS circom binary in the latest iden3 release");
  console.log(`Downloading ${asset.name}`);
  await download(asset.browser_download_url, destination);
  execFileSync("chmod", ["+x", destination]);
  return destination;
}

function ptauFor(constraints) {
  let power = 8;
  while (2 ** power <= constraints) power += 1;
  return power;
}

async function buildPtau(snarkjs, power, destination) {
  const logger = {
    info: (message) => console.log(message),
    log: (message) => console.log(message),
    debug: () => {},
    error: (message) => console.error(message),
  };
  const { getCurveFromName } = await import(
    pathToFileURL(path.join(root, "node_modules/snarkjs/src/curves.js")).href
  );
  const curve = await getCurveFromName("bn128");
  const fresh = path.join(buildDir, "pot_0000.ptau");
  const contributed = path.join(buildDir, "pot_0001.ptau");
  const beaconed = path.join(buildDir, "pot_beacon.ptau");
  for (const file of [fresh, contributed, beaconed, destination]) rmSync(file, { force: true });
  console.log("Creating a local powers-of-tau file");
  await snarkjs.powersOfTau.newAccumulator(curve, power, fresh, logger);
  await snarkjs.powersOfTau.contribute(fresh, contributed, "Lacuna", randomBytes(64).toString("hex"), logger);
  await snarkjs.powersOfTau.beacon(
    contributed,
    beaconed,
    "Lacuna beacon",
    randomBytes(32).toString("hex"),
    10,
    logger,
  );
  await snarkjs.powersOfTau.preparePhase2(beaconed, destination, logger);
}

async function main() {
  mkdirSync(buildDir, { recursive: true });
  if (!newer(circuit, finalZkey) && existsSync(wasm) && existsSync(verifierPath) && readFileSync(verifierPath, "utf8").includes("vk_alpha")) {
    console.log("Circuit artifacts are up to date");
    return;
  }

  const circom = await circomBinary();
  execFileSync(circom, [circuit, "--r1cs", "--wasm", "--sym", "-o", buildDir, "-l", path.join(root, "node_modules/circomlib/circuits")], {
    stdio: "inherit",
  });

  const snarkjs = await import("snarkjs");
  const templates = {
    groth16: readFileSync(path.join(root, "node_modules/snarkjs/templates/verifier_groth16.sol.ejs"), "utf8"),
  };
  const info = await snarkjs.r1cs.info(r1cs);
  const constraints = info.nConstraints;
  const power = ptauFor(constraints);
  console.log(`Constraints ${constraints}, powers of tau ${power}`);
  const ptau = path.join(buildDir, `pot${power}.ptau`);
  if (!existsSync(ptau)) await buildPtau(snarkjs, power, ptau);

  const first = path.join(buildDir, "transact_0000.zkey");
  await snarkjs.zKey.newZKey(r1cs, ptau, first);
  await snarkjs.zKey.contribute(first, finalZkey, "Lacuna local setup", randomBytes(64).toString("hex"));
  const solidity = await snarkjs.zKey.exportSolidityVerifier(finalZkey, templates);
  const source = solidity
    .replace(/pragma solidity [^;]+;/, "pragma solidity 0.8.19;")
    .replace("contract Groth16Verifier", "contract LacunaVerifier")
    .replace(/pragma experimental ABIEncoderV2;/, "");
  if (!source.includes("function verifyProof")) throw new Error("Verifier export did not contain verifyProof");
  writeFileSync(verifierPath, source);
  console.log(`Wrote ${verifierPath}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
