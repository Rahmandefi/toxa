// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {Toxascore} from "../contracts/creditcoin/Toxascore.sol";

contract DeployToxascore is Script {
    function run() external returns (Toxascore desk) {
        address locker = vm.envAddress("LOCKER_ADDRESS");
        vm.startBroadcast();
        desk = new Toxascore(locker);
        vm.stopBroadcast();
    }
}
