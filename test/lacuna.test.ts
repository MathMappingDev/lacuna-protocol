import { expect } from "chai";
import { ethers } from "hardhat";
import { minProtocolFee, splitGross } from "../sdk/src/constants";
import {
  callCommitment,
  ciphertextHash,
  createWallet,
  decryptNote,
  emptyOutput,
  emptySpend,
  encryptNote,
  getHasher,
  hash2,
  keysFromPhrase,
  loadTree,
  nftId,
  outputOf,
  parseAddress,
  proveTransact,
  randomBlinding,
  scan,
  shieldEth,
  shieldToken,
  spendable,
  submitTransact,
} from "../sdk/src";
import { NoteTree } from "../sdk/src/tree";

const noNft = { collection: ethers.ZeroAddress, id: 0n };

async function deployCore(treasury: string) {
  const poseidon = await ethers.deployContract("PoseidonT3");
  const hasher = await ethers.deployContract("LacunaHasher", [], {
    libraries: { PoseidonT3: await poseidon.getAddress() },
  });
  const verifier = await ethers.deployContract("LacunaVerifier");
  const pool = await ethers.deployContract("LacunaPool", [
    await hasher.getAddress(),
    await verifier.getAddress(),
    treasury,
  ]);
  return { hasher, pool };
}

describe("Lacuna pool", function () {
  it("matches the SDK Poseidon hash and keeps both fees within 0% to 1%", async function () {
    const [owner, treasury] = await ethers.getSigners();
    const { hasher, pool } = await deployCore(treasury.address);
    expect(await hasher.hash2(1, 2)).to.equal(await hash2(1n, 2n));
    const names = pool.interface.fragments.filter((fragment) => fragment.type === "function").map((fragment) => fragment.name);
    for (const hidden of ["pause", "unpause", "queueEmergencyWithdraw", "executeEmergencyWithdraw", "transferOwnership"]) {
      expect(names).to.not.include(hidden);
    }
    expect(await pool.owner()).to.equal(owner.address);
    expect(await pool.shieldFeeBps()).to.equal(20n);
    expect(await pool.unshieldFeeBps()).to.equal(20n);
    await pool.connect(owner).setShieldFeeBps(0);
    await pool.connect(owner).setShieldFeeBps(100);
    expect(await pool.shieldFeeBps()).to.equal(100n);
    await pool.connect(owner).setUnshieldFeeBps(0);
    await pool.connect(owner).setUnshieldFeeBps(100);
    expect(await pool.unshieldFeeBps()).to.equal(100n);
    await expect(pool.connect(owner).setShieldFeeBps(101)).to.be.revertedWithCustomError(pool, "BadFee");
    await expect(pool.connect(owner).setUnshieldFeeBps(101)).to.be.revertedWithCustomError(pool, "BadFee");
    await expect(pool.connect(treasury).setShieldFeeBps(0)).to.be.revertedWithCustomError(pool, "NotOwner");
    await expect(pool.connect(treasury).setUnshieldFeeBps(0)).to.be.revertedWithCustomError(pool, "NotOwner");
    const tree = new NoteTree(await getHasher());
    expect(await pool.currentRoot()).to.equal(tree.emptyRoot());
  });

  it("shields, sends privately, pays a broadcaster, unshields, and relays a call", async function () {
    const [owner, treasury, aliceSigner, bobSigner, broadcaster] = await ethers.getSigners();
    const alice = await createWallet();
    const bob = await keysFromPhrase((await createWallet()).phrase);
    expect(parseAddress(alice.address).npk).to.equal(alice.npk);
    expect(alice.address.startsWith("0LcnZK")).to.equal(true);
    expect(alice.address).to.have.length(142);
    const flipped = `${alice.address.slice(0, -1)}${alice.address.endsWith("0") ? "1" : "0"}`;
    expect(() => parseAddress(flipped)).to.throw(/checksum/);

    const { pool } = await deployCore(treasury.address);
    const poolAddress = await pool.getAddress();
    const relay = await ethers.deployContract("LacunaRelay", [poolAddress]);
    const sink = await ethers.deployContract("TestSink");
    const relayAddress = await relay.getAddress();
    await pool.setRelay(relayAddress);

    const gross = 10n ** 18n;
    const shielded = splitGross(gross);
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    await shieldEth({
      signer: aliceSigner,
      pool: poolAddress,
      gross,
      npk: alice.npk,
      blinding: randomBlinding(),
      viewingPublic: alice.viewingPublic,
    });
    expect(await pool.poolBalance(0)).to.equal(shielded.net);
    expect(await pool.feeBalance(0)).to.equal(shielded.fee);
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore);
    await expect(pool.connect(owner).withdrawFees(ethers.ZeroAddress)).to.be.revertedWithCustomError(pool, "NotTreasury");
    await expect(pool.connect(aliceSigner).withdrawFees(ethers.ZeroAddress)).to.be.revertedWithCustomError(pool, "NotTreasury");
    const withdrawTx = await pool.connect(treasury).withdrawFees(ethers.ZeroAddress);
    const withdrawReceipt = await withdrawTx.wait();
    const withdrawGas = withdrawReceipt!.gasUsed * (withdrawReceipt!.gasPrice ?? 0n);
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore + shielded.fee - withdrawGas);
    expect(await pool.feeBalance(0)).to.equal(0n);
    expect(await pool.poolBalance(0)).to.equal(shielded.net);

    let tree = await loadTree(ethers.provider, poolAddress);
    expect(tree.tree(0).path(0).root).to.equal(await pool.currentRoot());
    let aliceNotes = await scan(ethers.provider, poolAddress, alice);
    expect(aliceNotes).to.have.length(1);
    expect(aliceNotes[0].value).to.equal(shielded.net);
    expect(aliceNotes[0].spent).to.equal(false);

    const payment = 4n * 10n ** 17n;
    const relayFee = 10n ** 16n;
    const tipFee = minProtocolFee(relayFee);
    const changeValue = shielded.net - payment - relayFee - tipFee;
    const paymentNote = outputOf(payment, bob.npk, randomBlinding());
    const changeNote = outputOf(changeValue, alice.npk, randomBlinding());
    const paymentCiphertext = encryptNote(
      { value: payment, blinding: paymentNote.blinding, token: 0n },
      bob.viewingPublic,
    );
    const changeCiphertext = encryptNote(
      { value: changeValue, blinding: changeNote.blinding, token: 0n },
      alice.viewingPublic,
    );
    const broadcasterBefore = await ethers.provider.getBalance(broadcaster.address);
    const sent = await submitTransact({
      signer: broadcaster,
      pool: poolAddress,
      root: tree.tree(aliceNotes[0].treeNumber).path(aliceNotes[0].index).root,
      token: 0n,
      inputs: [await spendable(alice, aliceNotes[0], tree), emptySpend()],
      outputs: [paymentNote, changeNote],
      ciphertexts: [paymentCiphertext, changeCiphertext],
      relayFee,
      relayRecipient: broadcaster.address,
    });
    const gas = sent.receipt.gasUsed * (sent.receipt.gasPrice ?? 0n);
    expect(await ethers.provider.getBalance(broadcaster.address)).to.equal(broadcasterBefore + relayFee - gas);
    expect(await pool.poolBalance(0)).to.equal(shielded.net - relayFee - tipFee);
    expect(await pool.feeBalance(0)).to.equal(tipFee);

    await expect(
      pool.connect(broadcaster).transact(
        sent.proof.pA,
        sent.proof.pB,
        sent.proof.pC,
        sent.proof.pubSignals,
        paymentCiphertext,
        changeCiphertext,
        noNft,
        noNft,
      ),
    ).to.be.revertedWithCustomError(pool, "DoubleSpend");
    const flippedCiphertext = `${paymentCiphertext.slice(0, -1)}${paymentCiphertext.endsWith("0") ? "1" : "0"}`;
    await expect(
      pool.connect(broadcaster).transact(
        sent.proof.pA,
        sent.proof.pB,
        sent.proof.pC,
        sent.proof.pubSignals,
        flippedCiphertext,
        changeCiphertext,
        noNft,
        noNft,
      ),
    ).to.be.revertedWithCustomError(pool, "BadProof");

    tree = await loadTree(ethers.provider, poolAddress);
    aliceNotes = await scan(ethers.provider, poolAddress, alice);
    const bobNotes = await scan(ethers.provider, poolAddress, bob);
    expect(aliceNotes.filter((note) => !note.spent).map((note) => note.value)).to.deep.equal([changeValue]);
    expect(bobNotes.filter((note) => !note.spent)).to.have.length(1);
    expect(bobNotes[0].value).to.equal(payment);

    const bobExit = splitGross(payment, await pool.unshieldFeeBps());
    const bobBefore = await ethers.provider.getBalance(bobSigner.address);
    const treasuryMid = await ethers.provider.getBalance(treasury.address);
    const unshielded = await submitTransact({
      signer: bobSigner,
      pool: poolAddress,
      root: tree.tree(bobNotes[0].treeNumber).path(bobNotes[0].index).root,
      token: 0n,
      inputs: [await spendable(bob, bobNotes[0], tree), emptySpend()],
      outputs: [emptyOutput(), emptyOutput()],
      ciphertexts: ["0x", "0x"],
      publicAmount: payment,
      recipient: bobSigner.address,
    });
    const bobGas = unshielded.receipt.gasUsed * (unshielded.receipt.gasPrice ?? 0n);
    expect(await ethers.provider.getBalance(bobSigner.address)).to.equal(bobBefore + bobExit.net - bobGas);
    expect(await pool.feeBalance(0)).to.equal(tipFee + bobExit.fee);
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryMid);

    tree = await loadTree(ethers.provider, poolAddress);
    aliceNotes = (await scan(ethers.provider, poolAddress, alice)).filter((note) => !note.spent);
    const swapGross = 2n * 10n ** 17n;
    const swapOut = splitGross(swapGross, await pool.unshieldFeeBps());
    const swapChange = aliceNotes[0].value - swapGross;
    const swapChangeNote = outputOf(swapChange, alice.npk, randomBlinding());
    const bounced = (swapOut.net * 9n) / 10n;
    const reshield = splitGross(bounced);
    const reshieldBlinding = randomBlinding();
    const sinkAddress = await sink.getAddress();
    const bounceData = sink.interface.encodeFunctionData("bounce");
    const reshieldCiphertext = encryptNote(
      { value: reshield.net, blinding: reshieldBlinding, token: 0n },
      alice.viewingPublic,
    );
    const bounceCalls = [{ target: sinkAddress, value: swapOut.net, data: bounceData }];
    const bounceShields = [
      {
        token: ethers.ZeroAddress,
        tokenId: 0n,
        nft: false,
        ownerHash: await hash2(alice.npk, reshieldBlinding),
        ciphertext: reshieldCiphertext,
      },
    ];
    expect(await pool.callCommitment(bounceCalls, bounceShields)).to.equal(callCommitment(bounceCalls, bounceShields));
    const swapChangeCiphertext = encryptNote(
      { value: swapChange, blinding: swapChangeNote.blinding, token: 0n },
      alice.viewingPublic,
    );
    const swapProof = await proveTransact({
      root: tree.tree(aliceNotes[0].treeNumber).path(aliceNotes[0].index).root,
      token: 0n,
      publicAmount: swapOut.net,
      recipient: BigInt(relayAddress),
      relayFee: 0n,
      protocolFee: swapOut.fee,
      relayRecipient: 0n,
      externalHash: callCommitment(bounceCalls, bounceShields),
      ciphertextHash: ciphertextHash(swapChangeCiphertext, "0x"),
      inputs: [await spendable(alice, aliceNotes[0], tree), emptySpend()],
      outputs: [swapChangeNote, emptyOutput()],
    });
    await expect(
      relay.transactAndCall(
        swapProof.pA,
        swapProof.pB,
        swapProof.pC,
        swapProof.pubSignals,
        swapChangeCiphertext,
        "0x",
        noNft,
        noNft,
        [{ target: broadcaster.address, value: swapOut.net, data: bounceData }],
        bounceShields,
      ),
    ).to.be.revertedWithCustomError(relay, "BadCall");
    await relay.transactAndCall(
      swapProof.pA,
      swapProof.pB,
      swapProof.pC,
      swapProof.pubSignals,
      swapChangeCiphertext,
      "0x",
      noNft,
      noNft,
      bounceCalls,
      bounceShields,
    );
    const afterRelay = (await scan(ethers.provider, poolAddress, alice)).filter((note) => !note.spent);
    expect(afterRelay.map((note) => note.value).sort()).to.deep.equal([swapChange, reshield.net].sort());

    const token = await ethers.deployContract("TestToken");
    const tokenAddress = await token.getAddress();
    const tokenGross = 1_000_000n;
    await token.mint(aliceSigner.address, tokenGross);
    await token.connect(aliceSigner).approve(poolAddress, tokenGross);
    const tokenShield = splitGross(tokenGross);
    await shieldToken({
      signer: aliceSigner,
      pool: poolAddress,
      token: tokenAddress,
      gross: tokenGross,
      npk: alice.npk,
      blinding: randomBlinding(),
      viewingPublic: alice.viewingPublic,
    });
    tree = await loadTree(ethers.provider, poolAddress);
    const tokenNotes = (await scan(ethers.provider, poolAddress, alice)).filter(
      (note) => !note.spent && note.token === BigInt(tokenAddress),
    );
    expect(tokenNotes[0].value).to.equal(tokenShield.net);
    const tokenExit = splitGross(tokenNotes[0].value, await pool.unshieldFeeBps());
    const treasuryTokensBefore = await token.balanceOf(treasury.address);
    await submitTransact({
      signer: aliceSigner,
      pool: poolAddress,
      root: tree.tree(tokenNotes[0].treeNumber).path(tokenNotes[0].index).root,
      token: BigInt(tokenAddress),
      inputs: [await spendable(alice, tokenNotes[0], tree), emptySpend()],
      outputs: [emptyOutput(), emptyOutput()],
      ciphertexts: ["0x", "0x"],
      publicAmount: tokenNotes[0].value,
      recipient: aliceSigner.address,
    });
    expect(await token.balanceOf(aliceSigner.address)).to.equal(tokenExit.net);
    expect(await token.balanceOf(treasury.address)).to.equal(treasuryTokensBefore);
    expect(await pool.feeBalance(BigInt(tokenAddress))).to.equal(tokenShield.fee + tokenExit.fee);
    await pool.connect(treasury).withdrawFees(tokenAddress);
    expect(await token.balanceOf(treasury.address)).to.equal(treasuryTokensBefore + tokenShield.fee + tokenExit.fee);
    expect(await pool.poolBalance(BigInt(tokenAddress))).to.equal(0n);
  });

  it("runs an ordered swap and shields the bought token", async function () {
    const [, treasury, aliceSigner] = await ethers.getSigners();
    const alice = await createWallet();
    const { pool } = await deployCore(treasury.address);
    const poolAddress = await pool.getAddress();
    const relay = await ethers.deployContract("LacunaRelay", [poolAddress]);
    const relayAddress = await relay.getAddress();
    await pool.setRelay(relayAddress);

    const tokenIn = await ethers.deployContract("TestToken");
    const tokenOut = await ethers.deployContract("TestToken");
    const bonus = await ethers.deployContract("TestToken");
    const exchange = await ethers.deployContract("TestExchange");
    const tokenInAddress = await tokenIn.getAddress();
    const tokenOutAddress = await tokenOut.getAddress();
    const bonusAddress = await bonus.getAddress();
    const exchangeAddress = await exchange.getAddress();

    const gross = 1_000_000n;
    await tokenIn.mint(aliceSigner.address, gross);
    await tokenIn.connect(aliceSigner).approve(poolAddress, gross);
    await shieldToken({
      signer: aliceSigner,
      pool: poolAddress,
      token: tokenInAddress,
      gross,
      npk: alice.npk,
      blinding: randomBlinding(),
      viewingPublic: alice.viewingPublic,
    });

    const amountOut = 500_000n;
    await tokenOut.mint(exchangeAddress, amountOut);
    await bonus.mint(exchangeAddress, 1n);

    const tree = await loadTree(ethers.provider, poolAddress);
    const note = (await scan(ethers.provider, poolAddress, alice)).find((item) => !item.spent);
    if (!note) throw new Error("missing note");
    const exit = splitGross(note.value, await pool.unshieldFeeBps());
    const bought = splitGross(amountOut);
    const boughtBlinding = randomBlinding();
    const leftoverBlinding = randomBlinding();
    const boughtCiphertext = encryptNote(
      { value: bought.net, blinding: boughtBlinding, token: BigInt(tokenOutAddress) },
      alice.viewingPublic,
    );
    const leftoverCiphertext = encryptNote(
      { value: 0n, blinding: leftoverBlinding, token: BigInt(tokenInAddress) },
      alice.viewingPublic,
    );
    const calls = [
      {
        target: tokenInAddress,
        value: 0n,
        data: tokenIn.interface.encodeFunctionData("approve", [exchangeAddress, exit.net]),
      },
      {
        target: exchangeAddress,
        value: 0n,
        data: exchange.interface.encodeFunctionData("swap", [
          tokenInAddress,
          tokenOutAddress,
          bonusAddress,
          exit.net,
          amountOut,
        ]),
      },
    ];
    const shields = [
      { token: tokenOutAddress, tokenId: 0n, nft: false, ownerHash: await hash2(alice.npk, boughtBlinding), ciphertext: boughtCiphertext },
      { token: tokenInAddress, tokenId: 0n, nft: false, ownerHash: await hash2(alice.npk, leftoverBlinding), ciphertext: leftoverCiphertext },
    ];
    expect(await pool.callCommitment(calls, shields)).to.equal(callCommitment(calls, shields));
    const proof = await proveTransact({
      root: tree.tree(note.treeNumber).path(note.index).root,
      token: BigInt(tokenInAddress),
      publicAmount: exit.net,
      recipient: BigInt(relayAddress),
      relayFee: 0n,
      protocolFee: exit.fee,
      relayRecipient: 0n,
      externalHash: callCommitment(calls, shields),
      ciphertextHash: ciphertextHash("0x", "0x"),
      inputs: [await spendable(alice, note, tree), emptySpend()],
      outputs: [emptyOutput(), emptyOutput()],
    });
    const altered = calls.map((call, index) =>
      index === 1 ? { ...call, target: aliceSigner.address } : call,
    );
    await expect(
      relay.transactAndCall(proof.pA, proof.pB, proof.pC, proof.pubSignals, "0x", "0x", noNft, noNft, altered, shields),
    ).to.be.revertedWithCustomError(relay, "BadCall");
    await relay.transactAndCall(proof.pA, proof.pB, proof.pC, proof.pubSignals, "0x", "0x", noNft, noNft, calls, shields);

    const notes = (await scan(ethers.provider, poolAddress, alice)).filter((item) => !item.spent);
    expect(notes.map((item) => item.value)).to.deep.equal([bought.net]);
    expect(notes[0].token).to.equal(BigInt(tokenOutAddress));
    expect(await tokenOut.balanceOf(relayAddress)).to.equal(0n);
    expect(await tokenIn.balanceOf(relayAddress)).to.equal(0n);
    expect(await bonus.balanceOf(relayAddress)).to.equal(1n);
    expect(await tokenOut.balanceOf(treasury.address)).to.equal(0n);
    expect(await pool.feeBalance(BigInt(tokenOutAddress))).to.equal(bought.fee);
  });

  it("opens the next tree and still spends a note from the finished one", async function () {
    const [, treasury, aliceSigner] = await ethers.getSigners();
    const alice = await createWallet();
    const poseidon = await ethers.deployContract("PoseidonT3");
    const hasher = await ethers.deployContract("LacunaHasher", [], {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    });
    const verifier = await ethers.deployContract("LacunaVerifier");
    const pool = await ethers.deployContract("TreePool", [
      await hasher.getAddress(),
      await verifier.getAddress(),
      treasury.address,
      2,
    ]);
    const poolAddress = await pool.getAddress();
    const gross = 10n ** 17n;
    for (let i = 0; i < 2; i++) {
      await shieldEth({
        signer: aliceSigner,
        pool: poolAddress,
        gross,
        npk: alice.npk,
        blinding: randomBlinding(),
        viewingPublic: alice.viewingPublic,
      });
    }
    expect(await pool.treeNumber()).to.equal(0n);
    const finishedRoot = await pool.currentRoot();

    await shieldEth({
      signer: aliceSigner,
      pool: poolAddress,
      gross,
      npk: alice.npk,
      blinding: randomBlinding(),
      viewingPublic: alice.viewingPublic,
    });
    expect(await pool.treeNumber()).to.equal(1n);
    expect(await pool.nextIndex()).to.equal(1n);
    expect(await pool.isKnownRoot(finishedRoot)).to.equal(true);

    const forest = await loadTree(ethers.provider, poolAddress);
    expect(forest.tree(0).path(0).root).to.equal(finishedRoot);
    const notes = await scan(ethers.provider, poolAddress, alice);
    const older = notes.find((note) => note.treeNumber === 0 && note.index === 0);
    const newer = notes.find((note) => note.treeNumber === 1 && note.index === 0);
    if (!older || !newer) throw new Error("missing note");

    await submitTransact({
      signer: aliceSigner,
      pool: poolAddress,
      root: forest.tree(older.treeNumber).path(older.index).root,
      token: 0n,
      inputs: [await spendable(alice, older, forest), emptySpend()],
      outputs: [emptyOutput(), emptyOutput()],
      ciphertexts: ["0x", "0x"],
      publicAmount: older.value,
      recipient: aliceSigner.address,
    });
    const again = await loadTree(ethers.provider, poolAddress);
    await submitTransact({
      signer: aliceSigner,
      pool: poolAddress,
      root: again.tree(newer.treeNumber).path(newer.index).root,
      token: 0n,
      inputs: [await spendable(alice, newer, again), emptySpend()],
      outputs: [emptyOutput(), emptyOutput()],
      ciphertexts: ["0x", "0x"],
      publicAmount: newer.value,
      recipient: aliceSigner.address,
    });
    const left = (await scan(ethers.provider, poolAddress, alice)).filter((note) => !note.spent);
    expect(left.map((note) => note.treeNumber)).to.deep.equal([0]);
  });

  it("adds both sides of a liquidity position and shields the LP token", async function () {
    const [, treasury, aliceSigner] = await ethers.getSigners();
    const alice = await createWallet();
    const { pool } = await deployCore(treasury.address);
    const poolAddress = await pool.getAddress();
    const relay = await ethers.deployContract("LacunaRelay", [poolAddress]);
    const relayAddress = await relay.getAddress();
    await pool.setRelay(relayAddress);

    const tokenA = await ethers.deployContract("TestToken");
    const tokenB = await ethers.deployContract("TestToken");
    const lp = await ethers.deployContract("TestToken");
    const exchange = await ethers.deployContract("TestExchange");
    const tokenAAddress = await tokenA.getAddress();
    const tokenBAddress = await tokenB.getAddress();
    const lpAddress = await lp.getAddress();
    const exchangeAddress = await exchange.getAddress();
    const gross = 1_000_000n;
    for (const token of [tokenA, tokenB]) {
      await token.mint(aliceSigner.address, gross);
      await token.connect(aliceSigner).approve(poolAddress, gross);
    }
    await shieldToken({
      signer: aliceSigner,
      pool: poolAddress,
      token: tokenAAddress,
      gross,
      npk: alice.npk,
      blinding: randomBlinding(),
      viewingPublic: alice.viewingPublic,
    });
    await shieldToken({
      signer: aliceSigner,
      pool: poolAddress,
      token: tokenBAddress,
      gross,
      npk: alice.npk,
      blinding: randomBlinding(),
      viewingPublic: alice.viewingPublic,
    });

    const tree = await loadTree(ethers.provider, poolAddress);
    const notes = (await scan(ethers.provider, poolAddress, alice)).filter((note) => !note.spent);
    const noteA = notes.find((note) => note.token === BigInt(tokenAAddress));
    const noteB = notes.find((note) => note.token === BigInt(tokenBAddress));
    if (!noteA || !noteB) throw new Error("missing note");
    const rootA = tree.tree(noteA.treeNumber).path(noteA.index).root;
    const rootB = tree.tree(noteB.treeNumber).path(noteB.index).root;
    expect(rootA).to.equal(rootB);
    const feeBps = await pool.unshieldFeeBps();
    const exitA = splitGross(noteA.value, feeBps);
    const exitB = splitGross(noteB.value, feeBps);
    const minted = 1_000n;
    const lpNote = splitGross(minted);
    const lpBlinding = randomBlinding();
    const lpCiphertext = encryptNote(
      { value: lpNote.net, blinding: lpBlinding, token: BigInt(lpAddress) },
      alice.viewingPublic,
    );
    const calls = [
      { target: tokenAAddress, value: 0n, data: tokenA.interface.encodeFunctionData("approve", [exchangeAddress, exitA.net]) },
      { target: tokenBAddress, value: 0n, data: tokenB.interface.encodeFunctionData("approve", [exchangeAddress, exitB.net]) },
      {
        target: exchangeAddress,
        value: 0n,
        data: exchange.interface.encodeFunctionData("addLiquidity", [
          tokenAAddress,
          tokenBAddress,
          lpAddress,
          exitA.net,
          exitB.net,
          minted,
        ]),
      },
    ];
    const shields = [{ token: lpAddress, tokenId: 0n, nft: false, ownerHash: await hash2(alice.npk, lpBlinding), ciphertext: lpCiphertext }];
    const proof = await proveTransact({
      root: rootA,
      token: BigInt(tokenAAddress),
      token1: BigInt(tokenBAddress),
      twoTokens: true,
      publicAmount: exitA.net,
      publicAmount1: exitB.net,
      recipient: BigInt(relayAddress),
      relayFee: 0n,
      protocolFee: exitA.fee,
      protocolFee1: exitB.fee,
      relayRecipient: 0n,
      externalHash: callCommitment(calls, shields),
      ciphertextHash: ciphertextHash("0x", "0x"),
      inputs: [await spendable(alice, noteA, tree), await spendable(alice, noteB, tree)],
      outputs: [emptyOutput(), emptyOutput()],
    });
    await relay.transactAndCall(proof.pA, proof.pB, proof.pC, proof.pubSignals, "0x", "0x", noNft, noNft, calls, shields);
    const left = (await scan(ethers.provider, poolAddress, alice)).filter((note) => !note.spent);
    expect(left.map((note) => note.value)).to.deep.equal([lpNote.net]);
    expect(left[0].token).to.equal(BigInt(lpAddress));
    expect(await lp.balanceOf(relayAddress)).to.equal(0n);
    expect(await tokenA.balanceOf(relayAddress)).to.equal(0n);
    expect(await tokenB.balanceOf(relayAddress)).to.equal(0n);
    expect(await lp.balanceOf(treasury.address)).to.equal(0n);
    expect(await pool.feeBalance(BigInt(lpAddress))).to.equal(lpNote.fee);
  });

  it("shields, sends, and unshields an NFT, and returns one from a position call", async function () {
    const [, treasury, aliceSigner, bobSigner] = await ethers.getSigners();
    const alice = await createWallet();
    const bob = await keysFromPhrase((await createWallet()).phrase);
    const { pool } = await deployCore(treasury.address);
    const poolAddress = await pool.getAddress();
    const nft = await ethers.deployContract("TestNFT");
    const nftAddress = await nft.getAddress();
    const tokenField = nftId(nftAddress, 7n);
    expect(await pool.nftId(nftAddress, 7n)).to.equal(tokenField);
    await nft.mint(aliceSigner.address, 7n);
    await nft.connect(aliceSigner).approve(poolAddress, 7n);
    const shielding = randomBlinding();
    await pool.connect(aliceSigner).shieldERC721(
      nftAddress,
      7n,
      await hash2(alice.npk, shielding),
      encryptNote({ value: 1n, blinding: shielding, token: tokenField }, alice.viewingPublic),
    );
    expect(await nft.ownerOf(7n)).to.equal(poolAddress);
    expect(await pool.poolBalance(tokenField)).to.equal(0n);

    let tree = await loadTree(ethers.provider, poolAddress);
    const aliceNote = (await scan(ethers.provider, poolAddress, alice)).find((note) => !note.spent);
    if (!aliceNote) throw new Error("missing note");
    const sendBlinding = randomBlinding();
    const memo = "position 7";
    const sendCiphertext = encryptNote(
      { value: 1n, blinding: sendBlinding, token: tokenField, memo, sender: aliceSigner.address },
      bob.viewingPublic,
    );
    expect(decryptNote(sendCiphertext, bob.viewingPrivate)?.memo).to.equal(memo);
    expect(decryptNote(sendCiphertext, bob.viewingPrivate)?.sender).to.equal(aliceSigner.address.toLowerCase());
    const privateNft = await submitTransact({
      signer: aliceSigner,
      pool: poolAddress,
      root: tree.tree(aliceNote.treeNumber).path(aliceNote.index).root,
      token: tokenField,
      inputs: [await spendable(alice, aliceNote, tree), emptySpend()],
      outputs: [outputOf(1n, bob.npk, sendBlinding, tokenField), emptyOutput()],
      ciphertexts: [sendCiphertext, "0x"],
    });
    expect(BigInt(privateNft.proof.pubSignals[8])).to.equal(0n);
    expect(await nft.ownerOf(7n)).to.equal(poolAddress);
    tree = await loadTree(ethers.provider, poolAddress);
    const bobNote = (await scan(ethers.provider, poolAddress, bob)).find((note) => !note.spent);
    if (!bobNote) throw new Error("missing note");
    expect(bobNote.value).to.equal(1n);
    expect(bobNote.token).to.equal(tokenField);
    expect(bobNote.memo).to.equal(memo);
    expect(bobNote.sender).to.equal(aliceSigner.address.toLowerCase());
    await submitTransact({
      signer: bobSigner,
      pool: poolAddress,
      root: tree.tree(bobNote.treeNumber).path(bobNote.index).root,
      token: tokenField,
      inputs: [await spendable(bob, bobNote, tree), emptySpend()],
      outputs: [emptyOutput(), emptyOutput()],
      ciphertexts: ["0x", "0x"],
      publicAmount: 1n,
      recipient: bobSigner.address,
      nft0: { collection: nftAddress, id: 7n },
    });
    expect(await nft.ownerOf(7n)).to.equal(bobSigner.address);

    const relay = await ethers.deployContract("LacunaRelay", [poolAddress]);
    const relayAddress = await relay.getAddress();
    await pool.setRelay(relayAddress);
    const payment = await ethers.deployContract("TestToken");
    const position = await ethers.deployContract("TestPosition");
    const paymentAddress = await payment.getAddress();
    const positionAddress = await position.getAddress();
    const gross = 1_000_000n;
    await payment.mint(aliceSigner.address, gross);
    await payment.connect(aliceSigner).approve(poolAddress, gross);
    await shieldToken({
      signer: aliceSigner,
      pool: poolAddress,
      token: paymentAddress,
      gross,
      npk: alice.npk,
      blinding: randomBlinding(),
      viewingPublic: alice.viewingPublic,
    });
    await nft.mint(aliceSigner.address, 8n);
    await nft.connect(aliceSigner).approve(poolAddress, 8n);
    const positionField = nftId(nftAddress, 8n);
    const positionBlinding = randomBlinding();
    await pool.connect(aliceSigner).shieldERC721(
      nftAddress,
      8n,
      await hash2(alice.npk, positionBlinding),
      encryptNote({ value: 1n, blinding: positionBlinding, token: positionField }, alice.viewingPublic),
    );

    tree = await loadTree(ethers.provider, poolAddress);
    const held = (await scan(ethers.provider, poolAddress, alice)).filter((note) => !note.spent);
    const paymentNote = held.find((note) => note.token === BigInt(paymentAddress));
    const nftNote = held.find((note) => note.token === positionField);
    if (!paymentNote || !nftNote) throw new Error("missing note");
    const root = tree.tree(paymentNote.treeNumber).path(paymentNote.index).root;
    expect(tree.tree(nftNote.treeNumber).path(nftNote.index).root).to.equal(root);
    const exit = splitGross(paymentNote.value, await pool.unshieldFeeBps());
    const returnedBlinding = randomBlinding();
    const returnedCiphertext = encryptNote(
      { value: 1n, blinding: returnedBlinding, token: positionField },
      alice.viewingPublic,
    );
    const calls = [
      {
        target: paymentAddress,
        value: 0n,
        data: payment.interface.encodeFunctionData("approve", [positionAddress, exit.net]),
      },
      {
        target: nftAddress,
        value: 0n,
        data: nft.interface.encodeFunctionData("approve", [positionAddress, 8n]),
      },
      {
        target: positionAddress,
        value: 0n,
        data: position.interface.encodeFunctionData("touch", [paymentAddress, nftAddress, 8n, exit.net]),
      },
    ];
    const shields = [
      {
        token: nftAddress,
        tokenId: 8n,
        nft: true,
        ownerHash: await hash2(alice.npk, returnedBlinding),
        ciphertext: returnedCiphertext,
      },
    ];
    const proof = await proveTransact({
      root,
      token: BigInt(paymentAddress),
      token1: positionField,
      twoTokens: true,
      publicAmount: exit.net,
      publicAmount1: 1n,
      recipient: BigInt(relayAddress),
      relayFee: 0n,
      protocolFee: exit.fee,
      protocolFee1: 0n,
      relayRecipient: 0n,
      externalHash: callCommitment(calls, shields),
      ciphertextHash: ciphertextHash("0x", "0x"),
      inputs: [await spendable(alice, paymentNote, tree), await spendable(alice, nftNote, tree)],
      outputs: [emptyOutput(), emptyOutput()],
    });
    await relay.transactAndCall(
      proof.pA,
      proof.pB,
      proof.pC,
      proof.pubSignals,
      "0x",
      "0x",
      noNft,
      { collection: nftAddress, id: 8n },
      calls,
      shields,
    );
    const returned = (await scan(ethers.provider, poolAddress, alice)).filter((note) => !note.spent);
    expect(returned.map((note) => note.token)).to.deep.equal([positionField]);
    expect(returned[0].value).to.equal(1n);
    expect(await nft.ownerOf(8n)).to.equal(poolAddress);
    expect(await payment.balanceOf(relayAddress)).to.equal(0n);
    expect(await payment.balanceOf(positionAddress)).to.equal(exit.net);
  });

  it("rejects a proof with no inputs and a fee-on-transfer token", async function () {
    const [, treasury, aliceSigner] = await ethers.getSigners();
    const alice = await createWallet();
    const { pool } = await deployCore(treasury.address);
    const poolAddress = await pool.getAddress();
    const empty = await proveTransact({
      root: await pool.currentRoot(),
      token: 0n,
      publicAmount: 0n,
      recipient: 0n,
      relayFee: 0n,
      protocolFee: 0n,
      relayRecipient: 0n,
      externalHash: 0n,
      ciphertextHash: ciphertextHash("0x", "0x"),
      inputs: [emptySpend(), emptySpend()],
      outputs: [emptyOutput(), emptyOutput()],
    });
    await expect(
      pool.transact(empty.pA, empty.pB, empty.pC, empty.pubSignals, "0x", "0x", noNft, noNft),
    ).to.be.revertedWithCustomError(pool, "BadValue");

    const tax = await ethers.deployContract("TestTaxToken");
    const amount = 1_000_000n;
    await tax.mint(aliceSigner.address, amount);
    await tax.connect(aliceSigner).approve(poolAddress, amount);
    await expect(
      pool.connect(aliceSigner).shieldERC20(
        await tax.getAddress(),
        amount,
        await hash2(alice.npk, randomBlinding()),
        "0x",
      ),
    ).to.be.revertedWithCustomError(pool, "FeeOnTransfer");
  });

  it("recovers a shield when the ciphertext still carries the gross amount", async function () {
    const [, treasury, aliceSigner] = await ethers.getSigners();
    const alice = await createWallet();
    const { pool } = await deployCore(treasury.address);
    const poolAddress = await pool.getAddress();
    const gross = 1_000_000n;
    const shielded = splitGross(gross);
    const blinding = randomBlinding();
    await pool.connect(aliceSigner).shieldETH(
      await hash2(alice.npk, blinding),
      encryptNote({ value: gross, blinding, token: 0n }, alice.viewingPublic),
      { value: gross },
    );
    const notes = await scan(ethers.provider, poolAddress, alice);
    expect(notes.map((note) => note.value)).to.deep.equal([shielded.net]);
  });

  it("pays a relay tip to the named wallet and not to the relay", async function () {
    const [, treasury, aliceSigner, tipSigner] = await ethers.getSigners();
    const alice = await createWallet();
    const { pool } = await deployCore(treasury.address);
    const poolAddress = await pool.getAddress();
    const relay = await ethers.deployContract("LacunaRelay", [poolAddress]);
    const relayAddress = await relay.getAddress();
    await pool.setRelay(relayAddress);
    const sink = await ethers.deployContract("TestSink");
    const gross = 10n ** 18n;
    await shieldEth({
      signer: aliceSigner,
      pool: poolAddress,
      gross,
      npk: alice.npk,
      blinding: randomBlinding(),
      viewingPublic: alice.viewingPublic,
    });
    const tree = await loadTree(ethers.provider, poolAddress);
    const note = (await scan(ethers.provider, poolAddress, alice))[0];
    const relayFee = 10n ** 15n;
    const protocolFee = splitGross(note.value, await pool.unshieldFeeBps()).fee;
    const publicNet = note.value - relayFee - protocolFee;
    const calls = [{ target: await sink.getAddress(), value: 0n, data: sink.interface.encodeFunctionData("bounce") }];
    const shields: [] = [];
    const bypass = await proveTransact({
      root: tree.tree(note.treeNumber).path(note.index).root,
      token: 0n,
      publicAmount: 0n,
      recipient: 0n,
      relayFee: note.value,
      protocolFee: 0n,
      relayRecipient: BigInt(tipSigner.address),
      externalHash: 0n,
      ciphertextHash: ciphertextHash("0x", "0x"),
      inputs: [await spendable(alice, note, tree), emptySpend()],
      outputs: [emptyOutput(), emptyOutput()],
    });
    await expect(
      pool.transact(bypass.pA, bypass.pB, bypass.pC, bypass.pubSignals, "0x", "0x", noNft, noNft),
    ).to.be.revertedWithCustomError(pool, "BadFee");
    const shared = {
      root: tree.tree(note.treeNumber).path(note.index).root,
      token: 0n,
      publicAmount: publicNet,
      recipient: BigInt(relayAddress),
      relayFee,
      protocolFee,
      externalHash: callCommitment(calls, shields),
      ciphertextHash: ciphertextHash("0x", "0x"),
      inputs: [await spendable(alice, note, tree), emptySpend()] as [Awaited<ReturnType<typeof spendable>>, ReturnType<typeof emptySpend>],
      outputs: [emptyOutput(), emptyOutput()] as [ReturnType<typeof emptyOutput>, ReturnType<typeof emptyOutput>],
    };
    const toRelay = await proveTransact({ ...shared, relayRecipient: BigInt(relayAddress) });
    await expect(
      relay.transactAndCall(toRelay.pA, toRelay.pB, toRelay.pC, toRelay.pubSignals, "0x", "0x", noNft, noNft, calls, shields),
    ).to.be.revertedWithCustomError(relay, "BadCall");

    const tipBefore = await ethers.provider.getBalance(tipSigner.address);
    const relayBefore = await ethers.provider.getBalance(relayAddress);
    const feesBefore = await pool.feeBalance(0);
    const toTip = await proveTransact({ ...shared, relayRecipient: BigInt(tipSigner.address) });
    await relay.transactAndCall(toTip.pA, toTip.pB, toTip.pC, toTip.pubSignals, "0x", "0x", noNft, noNft, calls, shields);
    expect(await ethers.provider.getBalance(relayAddress) - relayBefore).to.equal(publicNet);
    expect(await ethers.provider.getBalance(tipSigner.address) - tipBefore).to.equal(relayFee);
    expect(await pool.feeBalance(0)).to.equal(feesBefore + protocolFee);
    expect(await pool.poolBalance(0)).to.equal(0n);
  });
});
