// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ToxascoreHarness} from "./harness/ToxascoreHarness.sol";
import {Toxascore} from "../contracts/creditcoin/Toxascore.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

contract ToxascoreTest is Test {
    ToxascoreHarness internal desk;
    address internal locker = address(0x10C4);
    address internal borrower = address(0xB0B);
    address internal spoofed = address(0xBAD);

    bytes32 internal constant LOCKED =
        0xc392e99d431032ac14a872985e1784cd90533e27608253c002a198d8e6358ed9;

    function setUp() public {
        desk = new ToxascoreHarness(locker);
        vm.deal(address(desk), 100 ether);
        vm.deal(borrower, 0);
    }

    function testConstructorRegistersLocker() public view {
        assertEq(desk.sourceLocker(), locker);
    }

    function testLockedLog_acceptsRegisteredEmitter() public view {
        (address user, address token, uint256 amount, uint256 nonce) =
            desk.exposeProcessLockedLog(_lockedLog(locker, borrower, address(0), 2 ether, 3), borrower);
        assertEq(user, borrower);
        assertEq(token, address(0));
        assertEq(amount, 2 ether);
        assertEq(nonce, 3);
    }

    function testLockedLog_rejectsWrongEmitter() public {
        vm.expectRevert("bad emitter");
        desk.exposeProcessLockedLog(_lockedLog(spoofed, borrower, address(0), 1 ether, 0), borrower);
    }

    function testLockedLog_rejectsUnsetLocker() public {
        ToxascoreHarness fresh = new ToxascoreHarness(address(0));
        vm.expectRevert("locker unset");
        fresh.exposeProcessLockedLog(_lockedLog(locker, borrower, address(0), 1 ether, 0), borrower);
    }

    function testLockedLog_rejectsFromMismatch() public {
        vm.expectRevert("from != locker user");
        desk.exposeProcessLockedLog(_lockedLog(locker, borrower, address(0), 1 ether, 0), address(0xFEE));
    }

    function testIssueLoan_disbursesAndUpdatesScore() public {
        bytes32 queryId = keccak256("q1");
        desk.exposeIssueLoan(borrower, 2 ether, 0, queryId);

        uint256 principal = (2 ether * 6000) / 10_000;
        assertEq(borrower.balance, principal);
        assertEq(desk.getToxascore(borrower), 705);
        assertEq(desk.ltvFor(borrower), 6050);

        (
            address storedBorrower,
            uint256 storedPrincipal,
            uint256 collateral,
            uint256 ltvBps,
            uint256 lockNonce,
            bool repaid,
            ,
            bytes32 storedQuery
        ) = desk.loans(1);

        assertEq(storedBorrower, borrower);
        assertEq(storedPrincipal, principal);
        assertEq(collateral, 2 ether);
        assertEq(ltvBps, 6000);
        assertEq(lockNonce, 0);
        assertFalse(repaid);
        assertEq(storedQuery, queryId);
        assertEq(desk.activeLoanId(borrower), 1);
    }

    function testIssueLoan_rejectsActiveLoan() public {
        desk.exposeIssueLoan(borrower, 1 ether, 0, keccak256("a"));
        vm.expectRevert("active loan");
        desk.exposeIssueLoan(borrower, 1 ether, 1, keccak256("b"));
    }

    function testIssueLoan_revertsWhenPoolDry() public {
        ToxascoreHarness dry = new ToxascoreHarness(locker);
        uint256 principal = (1 ether * 6000) / 10_000;
        vm.expectRevert(abi.encodeWithSelector(Toxascore.PoolUnderfunded.selector, principal, 0));
        dry.exposeIssueLoan(borrower, 1 ether, 0, keccak256("dry"));
    }

    function testQuoteLoan_previewsBeforeTheLock() public {
        (uint256 principal, uint256 ltvBps, bool fundable, uint256 pool) = desk.quoteLoan(borrower, 1 ether);
        assertEq(ltvBps, 6000);
        assertEq(principal, 0.6 ether);
        assertEq(pool, address(desk).balance);
        assertTrue(fundable);

        ToxascoreHarness dry = new ToxascoreHarness(locker);
        (, , bool dryFundable, uint256 dryPool) = dry.quoteLoan(borrower, 1 ether);
        assertFalse(dryFundable);
        assertEq(dryPool, 0);
    }

    function testQuoteLoan_notFundableWithLoanOutstanding() public {
        desk.exposeIssueLoan(borrower, 1 ether, 0, keccak256("q"));
        (, , bool fundable, ) = desk.quoteLoan(borrower, 1 ether);
        assertFalse(fundable);
    }

    function testRepay_collectsPrincipalAndBoostsScore() public {
        desk.exposeIssueLoan(borrower, 1 ether, 0, keccak256("r"));
        uint256 principal = (1 ether * 6000) / 10_000;
        vm.deal(borrower, principal);

        uint256 poolBefore = address(desk).balance;
        vm.prank(borrower);
        desk.repay{value: principal}(1);

        (,,,,, bool repaid,,) = desk.loans(1);
        assertTrue(repaid);
        assertEq(desk.getToxascore(borrower), 720);
        assertEq(address(desk).balance, poolBefore + principal);
    }

    function testRepay_refundsOverpay() public {
        desk.exposeIssueLoan(borrower, 1 ether, 0, keccak256("o"));
        uint256 principal = (1 ether * 6000) / 10_000;
        vm.deal(borrower, principal + 0.2 ether);

        vm.prank(borrower);
        desk.repay{value: principal + 0.2 ether}(1);
        assertEq(borrower.balance, 0.2 ether);
    }

    function testRepay_rejectsNonBorrower() public {
        desk.exposeIssueLoan(borrower, 1 ether, 0, keccak256("n"));
        vm.expectRevert("not borrower");
        desk.repay{value: 1 ether}(1);
    }

    function testLtv_scalesThenCaps() public view {
        assertEq(desk.exposeLtvBps(700), 6000);
        assertEq(desk.exposeLtvBps(742), 6420);
        assertEq(desk.exposeLtvBps(900), 8000);
        assertEq(desk.exposeLtvBps(1000), 8000);
    }

    function testSecondLoanAfterRepay_usesHigherLtv() public {
        desk.exposeIssueLoan(borrower, 1 ether, 0, keccak256("1"));
        uint256 firstPrincipal = (1 ether * 6000) / 10_000;
        vm.deal(borrower, firstPrincipal);
        vm.prank(borrower);
        desk.repay{value: firstPrincipal}(1);

        // score is 720 after lock(+5) and repay(+15)
        assertEq(desk.getToxascore(borrower), 720);
        desk.exposeIssueLoan(borrower, 1 ether, 1, keccak256("2"));
        (, uint256 secondPrincipal, , uint256 ltvBps, , , , ) = desk.loans(2);
        assertEq(ltvBps, 6200);
        assertEq(secondPrincipal, (1 ether * 6200) / 10_000);
    }

    function testRegisterSourceLocker_onlyOwner() public {
        vm.prank(borrower);
        vm.expectRevert();
        desk.registerSourceLocker(address(0x1234));
    }

    function _lockedLog(
        address emitter,
        address user,
        address token,
        uint256 amount,
        uint256 nonce
    ) internal pure returns (EvmV1Decoder.LogEntry memory log) {
        log.address_ = emitter;
        log.topics = new bytes32[](3);
        log.topics[0] = LOCKED;
        log.topics[1] = bytes32(uint256(uint160(user)));
        log.topics[2] = bytes32(uint256(uint160(token)));
        log.data = abi.encode(amount, nonce, uint256(1_700_000_000));
    }
}
