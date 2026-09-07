// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Toxascore} from "../../contracts/creditcoin/Toxascore.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @dev Exposes internal lock decoding and loan issuance for unit tests.
contract ToxascoreHarness is Toxascore {
    constructor(address locker) Toxascore(locker) {}

    function exposeProcessLockedLog(EvmV1Decoder.LogEntry memory log, address txFrom)
        external
        view
        returns (address user, address token, uint256 amount, uint256 nonce)
    {
        return _processLockedLog(log, txFrom);
    }

    function exposeIssueLoan(address borrower, uint256 collateralAmount, uint256 nonce, bytes32 queryId)
        external
    {
        _issueLoan(borrower, collateralAmount, nonce, queryId);
    }

    function exposeLtvBps(uint256 score) external pure returns (uint256) {
        return _ltvBps(score);
    }
}
