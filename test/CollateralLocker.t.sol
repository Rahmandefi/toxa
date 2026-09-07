// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CollateralLocker} from "../contracts/sepolia/CollateralLocker.sol";

contract CollateralLockerTest is Test {
    CollateralLocker internal locker;
    address internal user = address(0xA11CE);
    address internal releaser;
    uint256 internal releaserPk;

    event Locked(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 nonce,
        uint256 timestamp
    );
    event Unlocked(address indexed user, uint256 amount, uint256 nonce);
    event EmergencyUnlocked(address indexed user, uint256 amount, uint256 nonce);

    function setUp() public {
        (releaser, releaserPk) = makeAddrAndKey("releaser");
        locker = new CollateralLocker(releaser);
        vm.deal(user, 10 ether);
    }

    function _voucher(address who, uint256 amount, uint256 nonce, uint256 deadline, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = locker.releaseDigest(who, amount, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function testLockETH_recordsBalanceAndEmits() public {
        vm.expectEmit(true, true, false, true, address(locker));
        emit Locked(user, address(0), 1.5 ether, 0, block.timestamp);

        vm.prank(user);
        uint256 nonce = locker.lockETH{value: 1.5 ether}();

        assertEq(nonce, 0);
        assertEq(locker.getLocked(user), 1.5 ether);
        assertEq(locker.nonces(user), 1);
        assertEq(locker.lastLockAt(user), block.timestamp);
        assertEq(address(locker).balance, 1.5 ether);
    }

    function testLockETH_revertsOnZero() public {
        vm.prank(user);
        vm.expectRevert("amount=0");
        locker.lockETH{value: 0}();
    }

    function testUnlockETH_releasesAgainstVoucher() public {
        vm.prank(user);
        locker.lockETH{value: 2 ether}();

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _voucher(user, 0.75 ether, 0, deadline, releaserPk);
        uint256 beforeBal = user.balance;

        vm.expectEmit(true, false, false, true, address(locker));
        emit Unlocked(user, 0.75 ether, 0);

        vm.prank(user);
        locker.unlockETH(0.75 ether, deadline, sig);

        assertEq(locker.getLocked(user), 1.25 ether);
        assertEq(user.balance, beforeBal + 0.75 ether);
        assertEq(locker.releaseNonce(user), 1);
    }

    function testUnlockETH_rejectsUnsignedWithdrawal() public {
        vm.prank(user);
        locker.lockETH{value: 1 ether}();

        uint256 deadline = block.timestamp + 1 hours;
        (, uint256 strangerPk) = makeAddrAndKey("stranger");
        bytes memory sig = _voucher(user, 1 ether, 0, deadline, strangerPk);

        vm.prank(user);
        vm.expectRevert("bad voucher");
        locker.unlockETH(1 ether, deadline, sig);

        assertEq(locker.getLocked(user), 1 ether);
    }

    function testUnlockETH_rejectsReplay() public {
        vm.prank(user);
        locker.lockETH{value: 2 ether}();

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _voucher(user, 0.5 ether, 0, deadline, releaserPk);

        vm.prank(user);
        locker.unlockETH(0.5 ether, deadline, sig);

        vm.prank(user);
        vm.expectRevert("bad voucher");
        locker.unlockETH(0.5 ether, deadline, sig);
    }

    function testUnlockETH_rejectsExpiredVoucher() public {
        vm.prank(user);
        locker.lockETH{value: 1 ether}();

        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig = _voucher(user, 1 ether, 0, deadline, releaserPk);
        vm.warp(deadline + 1);

        vm.prank(user);
        vm.expectRevert("voucher expired");
        locker.unlockETH(1 ether, deadline, sig);
    }

    function testUnlockETH_rejectsVoucherIssuedToSomeoneElse() public {
        address other = address(0xB0B);
        vm.deal(other, 1 ether);
        vm.prank(user);
        locker.lockETH{value: 1 ether}();
        vm.prank(other);
        locker.lockETH{value: 1 ether}();

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _voucher(other, 1 ether, 0, deadline, releaserPk);

        vm.prank(user);
        vm.expectRevert("bad voucher");
        locker.unlockETH(1 ether, deadline, sig);
    }

    function testUnlockETH_rejectsAmountTampering() public {
        vm.prank(user);
        locker.lockETH{value: 2 ether}();

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _voucher(user, 0.5 ether, 0, deadline, releaserPk);

        vm.prank(user);
        vm.expectRevert("bad voucher");
        locker.unlockETH(1.5 ether, deadline, sig);
    }

    function testUnlockETH_revertsIfOverdrawn() public {
        vm.prank(user);
        locker.lockETH{value: 1 ether}();

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _voucher(user, 1 ether + 1, 0, deadline, releaserPk);

        vm.prank(user);
        vm.expectRevert("insufficient locked");
        locker.unlockETH(1 ether + 1, deadline, sig);
    }

    function testUnlockETH_revertsOnZero() public {
        vm.prank(user);
        vm.expectRevert("amount=0");
        locker.unlockETH(0, block.timestamp + 1 hours, hex"");
    }

    function testUnlockETH_revertsWhenReleaserUnset() public {
        CollateralLocker bare = new CollateralLocker(address(0));
        vm.prank(user);
        bare.lockETH{value: 1 ether}();

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = bare.releaseDigest(user, 1 ether, 0, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(releaserPk, digest);

        vm.prank(user);
        vm.expectRevert("releaser unset");
        bare.unlockETH(1 ether, deadline, abi.encodePacked(r, s, v));
    }

    function testEmergencyUnlock_blockedBeforeTimeout() public {
        vm.prank(user);
        locker.lockETH{value: 1 ether}();

        vm.warp(block.timestamp + locker.RELEASE_TIMEOUT() - 1);
        vm.prank(user);
        vm.expectRevert("timeout pending");
        locker.emergencyUnlock(1 ether);
    }

    function testEmergencyUnlock_freesCollateralAfterTimeout() public {
        vm.prank(user);
        locker.lockETH{value: 1 ether}();
        uint256 beforeBal = user.balance;

        vm.warp(block.timestamp + locker.RELEASE_TIMEOUT());

        vm.expectEmit(true, false, false, true, address(locker));
        emit EmergencyUnlocked(user, 1 ether, 0);

        vm.prank(user);
        locker.emergencyUnlock(1 ether);

        assertEq(locker.getLocked(user), 0);
        assertEq(user.balance, beforeBal + 1 ether);
    }

    function testEmergencyUnlockAt_reportsClock() public {
        assertEq(locker.emergencyUnlockAt(user), 0);
        vm.prank(user);
        locker.lockETH{value: 1 ether}();
        assertEq(locker.emergencyUnlockAt(user), block.timestamp + locker.RELEASE_TIMEOUT());
    }

    function testLockRestartsEmergencyClock() public {
        vm.prank(user);
        locker.lockETH{value: 1 ether}();
        vm.warp(block.timestamp + locker.RELEASE_TIMEOUT() - 1);

        vm.prank(user);
        locker.lockETH{value: 1 ether}();

        vm.prank(user);
        vm.expectRevert("timeout pending");
        locker.emergencyUnlock(1 ether);
    }

    function testSetReleaser_onlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        locker.setReleaser(address(0xCAFE));

        locker.setReleaser(address(0xCAFE));
        assertEq(locker.releaser(), address(0xCAFE));
    }
}
