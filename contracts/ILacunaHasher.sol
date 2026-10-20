// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface ILacunaHasher {
    function hash2(uint256 left, uint256 right) external pure returns (uint256);
}
