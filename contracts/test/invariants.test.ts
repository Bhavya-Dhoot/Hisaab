import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAll, sbHashOf, irmHashOf, iecHashOf, CCY_USD, WORKED_EXAMPLE } from "./fixture";

const NONE = 0;
const OPEN = 1;
const FINANCED = 2;
const PARTIAL = 3;
const REALISED = 4;
const DISPUTED = 5;

const ADVANCE_LEG = 0;
const FINANCIER_REPAY_LEG = 1;
const EXPORTER_BALANCE_LEG = 2;

describe("Hisab contracts — invariants", () => {
  async function registerBill(ctx: Awaited<ReturnType<typeof deployAll>>, seed: string, overrides: Partial<{ fobMinor: number; fobInrMinor: number; exporter: string }> = {}) {
    const sbHash = sbHashOf(seed);
    const iecHash = iecHashOf(seed);
    const fobMinor = overrides.fobMinor ?? WORKED_EXAMPLE.fobMinor;
    const fobInrMinor = overrides.fobInrMinor ?? WORKED_EXAMPLE.fobInrMinor;
    const exporter = overrides.exporter ?? ctx.exporter1.address;
    const leoTs = await time.latest();
    await ctx.registry.connect(ctx.customs).registerShippingBill(sbHash, iecHash, exporter, fobMinor, CCY_USD, leoTs, fobInrMinor);
    return { sbHash, iecHash, fobMinor, fobInrMinor, leoTs };
  }

  // --- Invariant 1 ---
  it("1. registerShippingBill twice with same hash reverts AlreadyRegistered", async () => {
    const ctx = await deployAll();
    const { sbHash, iecHash, fobMinor, fobInrMinor, leoTs } = await registerBill(ctx, "inv1");
    await expect(
      ctx.registry.connect(ctx.customs).registerShippingBill(sbHash, iecHash, ctx.exporter1.address, fobMinor, CCY_USD, leoTs, fobInrMinor)
    ).to.be.revertedWithCustomError(ctx.registry, "AlreadyRegistered");
  });

  // --- Invariant 2 ---
  it("2. lock on an already-locked id reverts AlreadyLocked", async () => {
    const ctx = await deployAll();
    const { sbHash, fobMinor } = await registerBill(ctx, "inv2");
    const id = BigInt(sbHash);
    await ctx.token.connect(ctx.exporter1).lock(id, ctx.financier1.address, fobMinor, WORKED_EXAMPLE.advanceInrMinor, WORKED_EXAMPLE.rateBps);

    await expect(
      ctx.token.connect(ctx.exporter1).lock(id, ctx.financier2.address, fobMinor, WORKED_EXAMPLE.advanceInrMinor, WORKED_EXAMPLE.rateBps)
    )
      .to.be.revertedWithCustomError(ctx.token, "AlreadyLocked")
      .withArgs(id, ctx.financier1.address);
  });

  // --- Invariant 3 ---
  it("3. safeTransferFrom of a locked id by the exporter reverts Locked", async () => {
    const ctx = await deployAll();
    const { sbHash, fobMinor } = await registerBill(ctx, "inv3");
    const id = BigInt(sbHash);
    await ctx.token.connect(ctx.exporter1).lock(id, ctx.financier1.address, fobMinor, WORKED_EXAMPLE.advanceInrMinor, WORKED_EXAMPLE.rateBps);

    // exporter's remaining balance for this id is 0 (all units locked into escrow), so attempt
    // a transfer from the escrow-holding exporter's perspective is moot; instead confirm the
    // escrow contract itself cannot be drained by anyone other than itself via release().
    // Simulate an attempted external transfer of the locked id by having exporter try to move
    // 0 units is meaningless — assert the guard directly by attempting a transfer of the id
    // while some balance is still nonzero: mint extra units is not applicable to MVP (full lock),
    // so instead we verify a partial lock scenario where exporter retains a balance.
    const sbHash2 = sbHashOf("inv3-partial");
    const iecHash2 = iecHashOf("inv3-partial");
    const leoTs2 = await time.latest();
    await ctx.registry.connect(ctx.customs).registerShippingBill(sbHash2, iecHash2, ctx.exporter1.address, WORKED_EXAMPLE.fobMinor, CCY_USD, leoTs2, WORKED_EXAMPLE.fobInrMinor);
    const id2 = BigInt(sbHash2);
    const lockedUnits = Math.floor(WORKED_EXAMPLE.fobMinor / 2);
    await ctx.token.connect(ctx.exporter1).lock(id2, ctx.financier1.address, lockedUnits, WORKED_EXAMPLE.advanceInrMinor, WORKED_EXAMPLE.rateBps);

    await expect(
      ctx.token.connect(ctx.exporter1).safeTransferFrom(ctx.exporter1.address, ctx.exporter2.address, id2, 1, "0x")
    )
      .to.be.revertedWithCustomError(ctx.token, "Locked")
      .withArgs(id2);
  });

  // --- Invariant 4 ---
  it("4. realise with allocInr exceeding IRM remaining reverts IRMOverAllocated", async () => {
    const ctx = await deployAll();
    const { sbHash, fobMinor } = await registerBill(ctx, "inv4");
    const id = BigInt(sbHash);
    await ctx.token.connect(ctx.exporter1).lock(id, ctx.financier1.address, fobMinor, WORKED_EXAMPLE.advanceInrMinor, WORKED_EXAMPLE.rateBps);
    await time.increase(WORKED_EXAMPLE.lockDays * 24 * 60 * 60);

    const irmHash = irmHashOf("inv4");
    const inrMinor = 100_000_000;
    await ctx.remittance.connect(ctx.adBank).registerIRM(irmHash, 1_000_000, CCY_USD, inrMinor, await time.latest());

    await expect(ctx.engine.connect(ctx.adBank).realise(sbHash, irmHash, inrMinor + 1, 95)).to.be.revertedWithCustomError(
      ctx.remittance,
      "IRMOverAllocated"
    );
  });

  // --- Invariant 5 ---
  it("5. realise from non-ops with confidencePct < 92 reverts ConfidenceTooLow", async () => {
    const ctx = await deployAll();
    const { sbHash, fobMinor } = await registerBill(ctx, "inv5");
    const id = BigInt(sbHash);
    await ctx.token.connect(ctx.exporter1).lock(id, ctx.financier1.address, fobMinor, WORKED_EXAMPLE.advanceInrMinor, WORKED_EXAMPLE.rateBps);
    await time.increase(WORKED_EXAMPLE.lockDays * 24 * 60 * 60);

    const irmHash = irmHashOf("inv5");
    await ctx.remittance.connect(ctx.adBank).registerIRM(irmHash, 1_000_000, CCY_USD, 100_000_000, await time.latest());

    await expect(ctx.engine.connect(ctx.adBank).realise(sbHash, irmHash, 1_000_000, 91)).to.be.revertedWithCustomError(
      ctx.engine,
      "ConfidenceTooLow"
    );

    // ops can override below 92
    await expect(ctx.engine.connect(ctx.ops).realise(sbHash, irmHash, 1_000_000, 50)).to.not.be.reverted;
  });

  // --- Invariant 7 ---
  it("7. anchor before REALISED reverts", async () => {
    const ctx = await deployAll();
    const { sbHash } = await registerBill(ctx, "inv7");
    await expect(ctx.ebrc.connect(ctx.adBank).anchor(sbHash, ethers.keccak256(ethers.toUtf8Bytes("vc")))).to.be.revertedWithCustomError(
      ctx.ebrc,
      "NotRealised"
    );
  });

  // --- Invariant 8 ---
  it("8. recordPayout same leg twice reverts DuplicateLeg", async () => {
    const ctx = await deployAll();
    const { sbHash } = await registerBill(ctx, "inv8");
    const utrHash = ethers.keccak256(ethers.toUtf8Bytes("utr-1"));
    await ctx.payoutLedger.connect(ctx.payoutAdapter).recordPayout(sbHash, ADVANCE_LEG, ctx.financier1.address, 1000, utrHash);
    await expect(
      ctx.payoutLedger.connect(ctx.payoutAdapter).recordPayout(sbHash, ADVANCE_LEG, ctx.financier1.address, 1000, utrHash)
    ).to.be.revertedWithCustomError(ctx.payoutLedger, "DuplicateLeg");
  });

  // --- Invariant 9 ---
  it("9. amend after lock -> DISPUTED; realise on DISPUTED reverts until resolveDispute", async () => {
    const ctx = await deployAll();
    const { sbHash, fobMinor } = await registerBill(ctx, "inv9");
    const id = BigInt(sbHash);
    await ctx.token.connect(ctx.exporter1).lock(id, ctx.financier1.address, fobMinor, WORKED_EXAMPLE.advanceInrMinor, WORKED_EXAMPLE.rateBps);

    await expect(ctx.registry.connect(ctx.customs).amendShippingBill(sbHash, fobMinor - 1000))
      .to.emit(ctx.registry, "SBDisputed")
      .withArgs(sbHash);
    expect((await ctx.registry.bills(sbHash)).state).to.equal(BigInt(DISPUTED));

    await time.increase(WORKED_EXAMPLE.lockDays * 24 * 60 * 60);
    const irmHash = irmHashOf("inv9");
    await ctx.remittance.connect(ctx.adBank).registerIRM(irmHash, 1_000_000, CCY_USD, 100_000_000, await time.latest());

    await expect(ctx.engine.connect(ctx.adBank).realise(sbHash, irmHash, 1_000_000, 95)).to.be.revertedWithCustomError(
      ctx.engine,
      "InvalidState"
    );

    // only the current lock holder (financier1) can resolve
    await expect(ctx.registry.connect(ctx.financier2).resolveDispute(sbHash)).to.be.reverted;
    await expect(ctx.registry.connect(ctx.financier1).resolveDispute(sbHash))
      .to.emit(ctx.registry, "SBDisputeResolved")
      .withArgs(sbHash);
    expect((await ctx.registry.bills(sbHash)).state).to.equal(BigInt(FINANCED));

    await expect(ctx.engine.connect(ctx.adBank).realise(sbHash, irmHash, 1_000_000, 95)).to.not.be.reverted;
  });

  // --- Happy path: register -> lock -> IRM -> realise -> waterfall (worked-example magnitudes) ---
  it("happy path matches the spec's worked-example magnitudes", async () => {
    const ctx = await deployAll();
    const { sbHash, fobMinor, fobInrMinor } = await registerBill(ctx, "happy");
    const id = BigInt(sbHash);

    await expect(
      ctx.token.connect(ctx.exporter1).lock(id, ctx.financier1.address, fobMinor, WORKED_EXAMPLE.advanceInrMinor, WORKED_EXAMPLE.rateBps)
    )
      .to.emit(ctx.token, "TokenLocked")
      .withArgs(id, ctx.financier1.address, fobMinor, WORKED_EXAMPLE.advanceInrMinor, WORKED_EXAMPLE.rateBps);
    expect((await ctx.registry.bills(sbHash)).state).to.equal(BigInt(FINANCED));

    await time.increase(WORKED_EXAMPLE.lockDays * 24 * 60 * 60);

    const irmHash = irmHashOf("happy");
    await ctx.remittance
      .connect(ctx.adBank)
      .registerIRM(irmHash, 4_500_000, CCY_USD, WORKED_EXAMPLE.realisedInr, await time.latest());

    const expectedWf = await ctx.engine.computeWaterfall(sbHash, WORKED_EXAMPLE.realisedInr);

    // Exact values per the spec's day-count/bps formula (docs/SMART_CONTRACTS.md §5), which land
    // within a few hundred paise of the doc's rounded worked example (interest ₹83,678 etc).
    expect(expectedWf.financierDue).to.equal(367_242_195n); // advance + interest over 74 days @ 11.5%
    expect(expectedWf.platformFee).to.equal(1_256_062n); // 35bps of advance, floor
    expect(expectedWf.exporterBalance).to.equal(40_194_743n);
    expect(expectedWf.shortfall).to.equal(0n);

    await expect(ctx.engine.connect(ctx.adBank).realise(sbHash, irmHash, WORKED_EXAMPLE.realisedInr, 95))
      .to.emit(ctx.engine, "Realised")
      .withArgs(sbHash, irmHash, WORKED_EXAMPLE.realisedInr, ctx.adBank.address, 95)
      .and.to.emit(ctx.engine, "WaterfallComputed")
      .withArgs(sbHash, WORKED_EXAMPLE.realisedInr, expectedWf.financierDue, expectedWf.platformFee, expectedWf.exporterBalance, expectedWf.shortfall);

    expect((await ctx.registry.bills(sbHash)).state).to.equal(BigInt(REALISED));
    expect((await ctx.registry.bills(sbHash)).realisedInr).to.equal(BigInt(WORKED_EXAMPLE.realisedInr));

    // anchor now succeeds
    const vcHash = ethers.keccak256(ethers.toUtf8Bytes("vc-happy"));
    await expect(ctx.ebrc.connect(ctx.adBank).anchor(sbHash, vcHash)).to.emit(ctx.ebrc, "EBRCAnchored").withArgs(sbHash, vcHash, ctx.adBank.address);
    expect(await ctx.ebrc.verify(sbHash, vcHash)).to.equal(true);

    // downstream payouts can now be recorded, respecting the DuplicateLeg guard per leg
    await ctx.payoutLedger
      .connect(ctx.payoutAdapter)
      .recordPayout(sbHash, FINANCIER_REPAY_LEG, ctx.financier1.address, expectedWf.financierDue, ethers.keccak256(ethers.toUtf8Bytes("utr-repay")));
    expect(await ctx.payoutLedger.hasLeg(sbHash, FINANCIER_REPAY_LEG)).to.equal(true);
  });

  // --- Partial realisation: two IRMs -> PARTIAL then REALISED ---
  it("partial realisation: first IRM -> PARTIAL, second IRM -> REALISED", async () => {
    const ctx = await deployAll();
    const { sbHash, fobMinor, fobInrMinor } = await registerBill(ctx, "partial");
    const id = BigInt(sbHash);
    await ctx.token.connect(ctx.exporter1).lock(id, ctx.financier1.address, fobMinor, WORKED_EXAMPLE.advanceInrMinor, WORKED_EXAMPLE.rateBps);
    await time.increase(WORKED_EXAMPLE.lockDays * 24 * 60 * 60);

    const threshold = (BigInt(fobInrMinor) * 9800n) / 10000n;
    const firstAlloc = threshold / 2n; // well under tolerance threshold -> PARTIAL
    const secondAlloc = threshold - firstAlloc + 1n; // pushes cumulative just over threshold -> REALISED

    const irm1 = irmHashOf("partial-1");
    await ctx.remittance.connect(ctx.adBank).registerIRM(irm1, 2_000_000, CCY_USD, firstAlloc, await time.latest());
    await ctx.engine.connect(ctx.adBank).realise(sbHash, irm1, firstAlloc, 95);
    expect((await ctx.registry.bills(sbHash)).state).to.equal(BigInt(PARTIAL));

    const irm2 = irmHashOf("partial-2");
    await ctx.remittance.connect(ctx.adBank).registerIRM(irm2, 2_500_000, CCY_USD, secondAlloc, await time.latest());
    await ctx.engine.connect(ctx.adBank).realise(sbHash, irm2, secondAlloc, 95);
    expect((await ctx.registry.bills(sbHash)).state).to.equal(BigInt(REALISED));
    expect((await ctx.registry.bills(sbHash)).realisedInr).to.equal(firstAlloc + secondAlloc);
  });

  // --- Release before advance payout ---
  it("release() returns the token to the exporter and reopens the bill, only before an ADVANCE payout", async () => {
    const ctx = await deployAll();
    const { sbHash, fobMinor } = await registerBill(ctx, "release");
    const id = BigInt(sbHash);
    await ctx.token.connect(ctx.exporter1).lock(id, ctx.financier1.address, fobMinor, WORKED_EXAMPLE.advanceInrMinor, WORKED_EXAMPLE.rateBps);
    expect((await ctx.registry.bills(sbHash)).state).to.equal(BigInt(FINANCED));

    await expect(ctx.token.connect(ctx.financier1).release(id, 0))
      .to.emit(ctx.token, "TokenReleased")
      .withArgs(id, ctx.financier1.address, fobMinor);

    expect((await ctx.registry.bills(sbHash)).state).to.equal(BigInt(OPEN));
    expect(await ctx.token.balanceOf(ctx.exporter1.address, id)).to.equal(BigInt(fobMinor));
    expect(await ctx.token.lockedTotal(id)).to.equal(0n);

    // re-lock, record an ADVANCE payout, then release must revert
    await ctx.token.connect(ctx.exporter1).lock(id, ctx.financier1.address, fobMinor, WORKED_EXAMPLE.advanceInrMinor, WORKED_EXAMPLE.rateBps);
    await ctx.payoutLedger
      .connect(ctx.payoutAdapter)
      .recordPayout(sbHash, ADVANCE_LEG, ctx.financier1.address, WORKED_EXAMPLE.advanceInrMinor, ethers.keccak256(ethers.toUtf8Bytes("utr-advance")));

    await expect(ctx.token.connect(ctx.financier1).release(id, 1)).to.be.revertedWithCustomError(ctx.token, "AdvanceAlreadyPaid");
  });
});
