// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {LacunaPool} from "./LacunaPool.sol";

/// @notice Submits a Lacuna proof whose public output is this contract, runs the
///         call list named in that proof, then shields the tokens named in the proof.
///         Each shielded ERC-20 amount is only the balance gained during this transaction.
///         An ERC-721 is shielded only when this contract receives it during the transaction.
///         A token that is not named stays on this contract. The calls never receive
///         the pool's other notes.
contract LacunaRelay is ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_CALLS = 16;
    uint256 public constant MAX_SHIELDS = 8;

    LacunaPool public immutable pool;

    error BadCall();

    constructor(address pool_) {
        pool = LacunaPool(pool_);
    }

    receive() external payable {}

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function transactAndCall(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[16] calldata pubSignals,
        bytes calldata ciphertext0,
        bytes calldata ciphertext1,
        LacunaPool.NftLeg calldata nft0,
        LacunaPool.NftLeg calldata nft1,
        LacunaPool.Call[] calldata calls,
        LacunaPool.ShieldPlan[] calldata shields
    ) external nonReentrant {
        if (calls.length == 0 || calls.length > MAX_CALLS || shields.length > MAX_SHIELDS) revert BadCall();
        if (pubSignals[7] != uint256(uint160(address(this)))) revert BadCall();
        if (pubSignals[11] != 0) revert BadCall();
        if (pubSignals[15] != pool.callCommitment(calls, shields)) revert BadCall();

        uint256 ethFloor = address(this).balance;
        uint256 before0 = _beforeFungible(pubSignals[8], nft0);
        uint256 before1 = _beforeFungible(pubSignals[9], nft1);
        uint256[] memory bases = new uint256[](shields.length);
        bool[] memory owned = new bool[](shields.length);
        for (uint256 i = 0; i < shields.length; i++) {
            if (shields[i].npk == 0) revert BadCall();
            for (uint256 j = 0; j < i; j++) {
                if (
                    shields[j].token == shields[i].token &&
                    shields[j].nft == shields[i].nft &&
                    shields[j].tokenId == shields[i].tokenId
                ) revert BadCall();
            }
            if (shields[i].nft) owned[i] = _owns(shields[i].token, shields[i].tokenId);
            else bases[i] = _balance(shields[i].token);
        }

        pool.transact(pA, pB, pC, pubSignals, ciphertext0, ciphertext1, nft0, nft1);
        _checkArrived(pubSignals[8], pubSignals[5], before0, nft0);
        if (pubSignals[10] == 1) _checkArrived(pubSignals[9], pubSignals[6], before1, nft1);

        for (uint256 i = 0; i < calls.length; i++) {
            address target = calls[i].target;
            if (target == address(pool) || target == address(this) || target == address(0)) revert BadCall();
            uint256 value = calls[i].value;
            if (value > address(this).balance - ethFloor) revert BadCall();
            (bool ok, ) = target.call{value: value}(calls[i].data);
            if (!ok) revert BadCall();
        }

        for (uint256 i = 0; i < shields.length; i++) {
            if (shields[i].nft) {
                if (owned[i] || !_owns(shields[i].token, shields[i].tokenId)) continue;
                IERC721(shields[i].token).approve(address(pool), shields[i].tokenId);
                pool.shieldERC721(shields[i].token, shields[i].tokenId, shields[i].npk, shields[i].blinding, shields[i].ciphertext);
            } else {
                uint256 gained = _balance(shields[i].token) - bases[i];
                if (gained == 0) continue;
                _shield(shields[i], gained);
            }
        }
    }

    function _beforeFungible(uint256 token, LacunaPool.NftLeg calldata nft) internal view returns (uint256) {
        if (nft.collection != address(0) || token > type(uint160).max) return 0;
        return token == 0 ? address(this).balance : IERC20(address(uint160(token))).balanceOf(address(this));
    }

    function _checkArrived(
        uint256 token,
        uint256 expected,
        uint256 beforeBalance,
        LacunaPool.NftLeg calldata nft
    ) internal view {
        if (nft.collection != address(0)) {
            if (expected == 1 && !_owns(nft.collection, nft.id)) revert BadCall();
            return;
        }
        uint256 afterBalance = token == 0 ? address(this).balance : IERC20(address(uint160(token))).balanceOf(address(this));
        if (afterBalance - beforeBalance != expected) revert BadCall();
    }

    function _shield(LacunaPool.ShieldPlan calldata plan, uint256 amount) internal {
        if (plan.token == address(0)) {
            pool.shieldETH{value: amount}(plan.npk, plan.blinding, plan.ciphertext);
            return;
        }
        IERC20(plan.token).safeApprove(address(pool), 0);
        IERC20(plan.token).safeApprove(address(pool), amount);
        pool.shieldERC20(plan.token, amount, plan.npk, plan.blinding, plan.ciphertext);
        IERC20(plan.token).safeApprove(address(pool), 0);
    }

    function _owns(address collection, uint256 id) internal view returns (bool) {
        (bool ok, bytes memory data) = collection.staticcall(abi.encodeWithSignature("ownerOf(uint256)", id));
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (address)) == address(this);
    }

    function _balance(address token) internal view returns (uint256) {
        if (token == address(0)) return address(this).balance;
        return IERC20(token).balanceOf(address(this));
    }
}
