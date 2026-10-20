// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

/// @notice Poseidon hash of two field elements. Must match circomlib Poseidon(2).
contract LacunaHasher {
    function hash2(uint256 left, uint256 right) external pure returns (uint256) {
        return PoseidonT3.hash([left, right]);
    }
}
