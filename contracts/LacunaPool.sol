// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ILacunaHasher} from "./ILacunaHasher.sol";
import {ILacunaVerifier} from "./ILacunaVerifier.sol";

/// @title LacunaPool
/// @notice Shared note pool. A shield records a commitment, not an amount.
///         Private transfers publish nullifiers, new commitments, and encrypted notes.
///         The spending secret stays off-chain. The owner can change the shield
///         fee and the unshield fee from 0% to 1% and cannot withdraw the pool.
///         Each tree holds 65,536 notes. A full tree is kept, and the next note
///         opens a new one. One proof can spend two notes of one token, or one
///         note of each of two tokens. An ERC-721 uses a token field of
///         keccak256(collection, id) and a value of 1, with no percentage fee.
contract LacunaPool is ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    uint256 public constant LEVELS = 16;
    uint256 public constant ROOT_HISTORY = 100;
    uint256 public constant MAX_FEE_BPS = 100;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public shieldFeeBps = 20;
    uint256 public unshieldFeeBps = 20;
    uint256 public constant MAX_AMOUNT = 1 << 128;
    uint256 public constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant MAX_CIPHERTEXT = 1024;
    address public constant ETH = address(0);

    ILacunaHasher public immutable hasher;
    ILacunaVerifier public immutable verifier;
    address public immutable treasury;
    address public owner;
    address public relay;

    event ShieldFeeUpdated(uint256 oldBps, uint256 newBps);
    event UnshieldFeeUpdated(uint256 oldBps, uint256 newBps);

    uint256 public treeNumber;
    uint256 public nextIndex;
    uint256[LEVELS] public filledSubtrees;
    uint256[LEVELS] public zeros;
    uint256[ROOT_HISTORY] public roots;
    uint32 public currentRootIndex;

    mapping(uint256 => bool) public nullified;
    mapping(uint256 => bool) public commitmentUsed;
    mapping(uint256 => uint256) public poolBalance;
    /// @dev Roots kept after a tree is closed. The active tree still uses the ring above.
    mapping(uint256 => bool) public archivedRoot;

    event Note(uint256 indexed treeNumber, uint256 indexed leafIndex, uint256 commitment, bytes ciphertext);
    event Nullified(uint256 indexed nullifier);
    event Shielded(address indexed from, address indexed token, uint256 gross, uint256 fee);
    event PublicExit(
        address indexed token,
        address indexed to,
        uint256 amount,
        uint256 protocolFee,
        uint256 relayFee
    );

    error BadValue();
    error BadRoot();
    error BadProof();
    error BadFee();
    error NotOwner();
    error DoubleSpend();
    error CiphertextTooLarge();

    constructor(address hasher_, address verifier_, address treasury_) {
        if (hasher_ == address(0) || verifier_ == address(0) || treasury_ == address(0)) revert BadValue();
        hasher = ILacunaHasher(hasher_);
        verifier = ILacunaVerifier(verifier_);
        treasury = treasury_;
        owner = msg.sender;

        zeros[0] = 0;
        filledSubtrees[0] = 0;
        uint256 current = 0;
        for (uint256 i = 1; i < LEVELS; i++) {
            current = hasher.hash2(current, current);
            zeros[i] = current;
            filledSubtrees[i] = current;
        }
        roots[0] = hasher.hash2(zeros[LEVELS - 1], zeros[LEVELS - 1]);
    }

    function currentRoot() external view returns (uint256) {
        return roots[currentRootIndex];
    }

    function isKnownRoot(uint256 root) public view returns (bool) {
        if (root == 0) return false;
        if (archivedRoot[root]) return true;
        uint32 index = currentRootIndex;
        for (uint256 i = 0; i < ROOT_HISTORY; i++) {
            if (roots[index] == root) return true;
            index = index == 0 ? uint32(ROOT_HISTORY - 1) : index - 1;
        }
        return false;
    }

    /// @dev Tests use a smaller capacity. Production uses the full depth.
    function _treeCapacity() internal view virtual returns (uint256) {
        return 1 << LEVELS;
    }

    function tokenIdOf(address token) public pure returns (uint256) {
        return uint256(uint160(token));
    }

    /// @notice Token field of an ERC-721 note. The value of that note is always 1.
    function nftId(address collection, uint256 id) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(collection, id))) % FIELD;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Names the only contract that may submit a proof carrying an external call.
    function setRelay(address relay_) external {
        if (msg.sender != owner) revert NotOwner();
        if (relay != address(0) || relay_ == address(0)) revert BadValue();
        relay = relay_;
    }

    /// @notice One call the relay will make, in the order given.
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    /// @notice A balance the relay will shield after the calls.
    ///         For an ERC-20, `token` is the token and `nft` is false. For ETH, `token` is address(0).
    ///         For an ERC-721, `token` is the collection, `tokenId` is the id, and `nft` is true.
    struct ShieldPlan {
        address token;
        uint256 tokenId;
        bool nft;
        uint256 npk;
        uint256 blinding;
        bytes ciphertext;
    }

    /// @notice The ERC-721 a public exit sends. Empty when that exit is ETH or an ERC-20.
    struct NftLeg {
        address collection;
        uint256 id;
    }

    /// @notice Field element committed by a proof that asks the relay to run these calls,
    ///         then shield these tokens. The circuit carries the result as externalHash.
    function callCommitment(Call[] calldata calls, ShieldPlan[] calldata shields) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(calls, shields))) % FIELD;
    }

    /// @notice Shield fee in basis points. 20 is 0.20%. The maximum is 100, which is 1%.
    function setShieldFeeBps(uint256 bps) external {
        if (msg.sender != owner) revert NotOwner();
        if (bps > MAX_FEE_BPS) revert BadFee();
        emit ShieldFeeUpdated(shieldFeeBps, bps);
        shieldFeeBps = bps;
    }

    /// @notice Unshield fee in basis points. 20 is 0.20%. The maximum is 100, which is 1%.
    function setUnshieldFeeBps(uint256 bps) external {
        if (msg.sender != owner) revert NotOwner();
        if (bps > MAX_FEE_BPS) revert BadFee();
        emit UnshieldFeeUpdated(unshieldFeeBps, bps);
        unshieldFeeBps = bps;
    }

    /// @param npk Note public key, poseidon(spendingKey, 1).
    /// @param blinding Random 128-bit mask chosen by the sender.
    function shieldETH(uint256 npk, uint256 blinding, bytes calldata ciphertext) external payable nonReentrant {
        if (msg.value == 0 || msg.value >= MAX_AMOUNT) revert BadValue();
        uint256 fee = (msg.value * shieldFeeBps) / BPS_DENOMINATOR;
        uint256 net = msg.value - fee;
        _shield(ETH, npk, blinding, net, ciphertext);
        if (fee > 0) {
            (bool ok, ) = treasury.call{value: fee}("");
            if (!ok) revert BadValue();
        }
        emit Shielded(msg.sender, ETH, msg.value, fee);
    }

    function shieldERC20(
        address token,
        uint256 amount,
        uint256 npk,
        uint256 blinding,
        bytes calldata ciphertext
    ) external nonReentrant {
        if (token == ETH || amount == 0 || amount >= MAX_AMOUNT) revert BadValue();
        uint256 fee = (amount * shieldFeeBps) / BPS_DENOMINATOR;
        uint256 net = amount - fee;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _shield(token, npk, blinding, net, ciphertext);
        if (fee > 0) IERC20(token).safeTransfer(treasury, fee);
        emit Shielded(msg.sender, token, amount, fee);
    }

    /// @notice Shield one ERC-721. The note value is 1 and there is no percentage fee.
    function shieldERC721(
        address collection,
        uint256 id,
        uint256 npk,
        uint256 blinding,
        bytes calldata ciphertext
    ) external nonReentrant {
        if (collection == address(0)) revert BadValue();
        uint256 tokenField = nftId(collection, id);
        if (tokenField <= type(uint160).max) revert BadValue();
        IERC721(collection).safeTransferFrom(msg.sender, address(this), id);
        _insertNote(tokenField, npk, blinding, 1, ciphertext);
        emit Shielded(msg.sender, collection, 1, 0);
    }

    /// @notice Public signals, in order:
    /// merkleRoot, nullifier0, nullifier1, commitment0, commitment1,
    /// publicAmount0, publicAmount1, recipient, token0, token1, twoTokens,
    /// relayFee, protocolFee0, protocolFee1, relayRecipient, externalHash.
    /// Each protocol fee is the unshield fee for that exit. A private send has none.
    /// relayFee is paid from token0 to relayRecipient.
    /// externalHash locks the relay's call list and the tokens it shields afterwards.
    /// An ERC-721 exit sets the matching NftLeg. Its public amount is 1 and its fee is 0.
    function transact(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[16] calldata pubSignals,
        bytes calldata ciphertext0,
        bytes calldata ciphertext1,
        NftLeg calldata nft0,
        NftLeg calldata nft1
    ) external nonReentrant {
        if (!verifier.verifyProof(pA, pB, pC, pubSignals)) revert BadProof();
        _checkPublic(pubSignals, nft1);
        _spend(pubSignals[1]);
        _spend(pubSignals[2]);
        if (pubSignals[1] != 0 && pubSignals[1] == pubSignals[2]) revert DoubleSpend();
        if (pubSignals[3] != 0) _insert(pubSignals[3], ciphertext0);
        if (pubSignals[4] != 0) _insert(pubSignals[4], ciphertext1);
        _exit(pubSignals[8], pubSignals[5], pubSignals[12], pubSignals[11], pubSignals[7], pubSignals[14], nft0);
        _exit(pubSignals[9], pubSignals[6], pubSignals[13], 0, pubSignals[7], 0, nft1);
    }

    function _checkPublic(uint256[16] calldata pub, NftLeg calldata nft1) internal view {
        if (!isKnownRoot(pub[0])) revert BadRoot();
        if (pub[10] > 1) revert BadValue();
        if (pub[5] >= MAX_AMOUNT || pub[6] >= MAX_AMOUNT || pub[11] >= MAX_AMOUNT) revert BadValue();
        if (pub[12] >= MAX_AMOUNT || pub[13] >= MAX_AMOUNT) revert BadValue();
        if (pub[10] == 0 && (pub[9] != 0 || pub[6] != 0 || pub[13] != 0 || nft1.collection != address(0))) revert BadValue();
        _checkFee(pub[5], pub[12]);
        _checkFee(pub[6], pub[13]);
        if (pub[11] == 0) {
            if (pub[14] != 0) revert BadValue();
        } else if (pub[14] == 0 || pub[14] > type(uint160).max) {
            revert BadValue();
        }
        if (pub[15] != 0 && msg.sender != relay) revert BadValue();
        if (pub[5] == 0 && pub[6] == 0) {
            if (pub[7] != 0) revert BadValue();
        } else if (pub[7] == 0 || pub[7] > type(uint160).max) {
            revert BadValue();
        }
    }

    function _checkFee(uint256 amount, uint256 fee) internal view {
        if (fee != ((amount + fee) * unshieldFeeBps) / BPS_DENOMINATOR) revert BadFee();
    }

    function _exit(
        uint256 token,
        uint256 amount,
        uint256 fee,
        uint256 relayFee,
        uint256 recipient,
        uint256 relayTo,
        NftLeg calldata nft
    ) internal {
        if (nft.collection != address(0)) {
            if (relayFee != 0 || amount != 1 || fee != 0) revert BadValue();
            if (nftId(nft.collection, nft.id) != token) revert BadValue();
            address nftTo = address(uint160(recipient));
            IERC721(nft.collection).safeTransferFrom(address(this), nftTo, nft.id);
            emit PublicExit(nft.collection, nftTo, 1, 0, 0);
            return;
        }
        if (amount == 0 && fee == 0 && relayFee == 0) return;
        if (token > type(uint160).max) revert BadValue();
        uint256 payout = amount + fee + relayFee;
        if (poolBalance[token] < payout) revert BadValue();
        poolBalance[token] -= payout;
        address tokenAddress = address(uint160(token));
        address to = address(uint160(recipient));
        _pay(tokenAddress, treasury, fee);
        _pay(tokenAddress, address(uint160(relayTo)), relayFee);
        _pay(tokenAddress, to, amount);
        emit PublicExit(tokenAddress, to, amount, fee, relayFee);
    }

    function _shield(address token, uint256 npk, uint256 blinding, uint256 net, bytes calldata ciphertext) internal {
        uint256 tokenField = tokenIdOf(token);
        _insertNote(tokenField, npk, blinding, net, ciphertext);
        poolBalance[tokenField] += net;
    }

    function _insertNote(
        uint256 tokenField,
        uint256 npk,
        uint256 blinding,
        uint256 net,
        bytes calldata ciphertext
    ) internal {
        if (npk >= FIELD || blinding >= FIELD || net == 0 || net >= MAX_AMOUNT) revert BadValue();
        uint256 commitment = hasher.hash2(hasher.hash2(net, npk), hasher.hash2(blinding, tokenField));
        _insert(commitment, ciphertext);
    }

    function _spend(uint256 nullifier) internal {
        if (nullifier == 0) return;
        if (nullified[nullifier]) revert DoubleSpend();
        nullified[nullifier] = true;
        emit Nullified(nullifier);
    }

    function _insert(uint256 commitment, bytes calldata ciphertext) internal {
        if (commitment == 0 || commitment >= FIELD) revert BadValue();
        if (commitmentUsed[commitment]) revert BadValue();
        if (ciphertext.length > MAX_CIPHERTEXT) revert CiphertextTooLarge();
        if (nextIndex >= _treeCapacity()) _rollTree();

        uint256 index = nextIndex;
        uint256 currentIndex = index;
        uint256 current = commitment;
        for (uint256 level = 0; level < LEVELS; level++) {
            if (currentIndex % 2 == 0) {
                filledSubtrees[level] = current;
                current = hasher.hash2(current, zeros[level]);
            } else {
                current = hasher.hash2(filledSubtrees[level], current);
            }
            currentIndex /= 2;
        }
        nextIndex = index + 1;
        currentRootIndex = (currentRootIndex + 1) % uint32(ROOT_HISTORY);
        roots[currentRootIndex] = current;
        commitmentUsed[commitment] = true;
        emit Note(treeNumber, index, commitment, ciphertext);
    }

    function _rollTree() internal {
        for (uint256 i = 0; i < ROOT_HISTORY; i++) {
            if (roots[i] != 0) archivedRoot[roots[i]] = true;
        }
        for (uint256 level = 0; level < LEVELS; level++) {
            filledSubtrees[level] = zeros[level];
        }
        nextIndex = 0;
        treeNumber += 1;
    }

    function _pay(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == ETH) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert BadValue();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
