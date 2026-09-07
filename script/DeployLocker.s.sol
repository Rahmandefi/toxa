// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {CollateralLocker} from "../contracts/sepolia/CollateralLocker.sol";

contract DeployLocker is Script {
    function run() external returns (CollateralLocker locker) {
        // Relayer key that signs release vouchers once a loan is repaid on Creditcoin.
        address releaser = vm.envOr("RELEASER_ADDRESS", address(0));
        vm.startBroadcast();
        locker = new CollateralLocker(releaser);
        vm.stopBroadcast();
    }
}
