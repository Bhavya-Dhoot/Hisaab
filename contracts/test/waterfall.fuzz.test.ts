import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAll, sbHashOf, irmHashOf, iecHashOf, CCY_USD, WORKED_EXAMPLE } from "./fixture";

// Invariant 6: for any realisedInr, the waterfall legs reconcile exactly against realisedInr —
// either with zero shortfall (legs sum to realisedInr) or with a shortfall that, added back,
// reconstitutes financierDue. Run over >=200 randomized inputs, covering both a financed bill
// and a never-financed bill (financierDue == 0 branch).
describe("Hisab contracts — invariant 6: computeWaterfall reconciliation (fuzz)", function () {
  this.timeout(120_000);

  it("holds for >=200 randomized realisedInr values on a financed bill", async () => {
    const ctx = await deployAll();
    const sbHash = sbHashOf("fuzz-financed");
    const iecHash = iecHashOf("fuzz-financed");
    const leoTs = await time.latest();
    await ctx.registry
      .connect(ctx.customs)
      .registerShippingBill(sbHash, iecHash, ctx.exporter1.address, WORKED_EXAMPLE.fobMinor, CCY_USD, leoTs, WORKED_EXAMPLE.fobInrMinor);

    const id = BigInt(sbHash);
    await ctx.token
      .connect(ctx.exporter1)
      .lock(id, ctx.financier1.address, WORKED_EXAMPLE.fobMinor, WORKED_EXAMPLE.advanceInrMinor, WORKED_EXAMPLE.rateBps);
    await time.increase(WORKED_EXAMPLE.lockDays * 24 * 60 * 60);

    const wfMax = await ctx.engine.computeWaterfall(sbHash, 0);
    const upperBound = (wfMax.financierDue + BigInt(wfMax.platformFee)) * 3n + 1_000_000n;

    const ITERATIONS = 220;
    for (let i = 0; i < ITERATIONS; i++) {
      const realisedInr = BigInt(Math.floor(Math.random() * Number(upperBound > 10_000_000_000n ? 10_000_000_000n : upperBound)));
      const wf = await ctx.engine.computeWaterfall(sbHash, realisedInr);

      if (wf.shortfall > 0n) {
        expect(wf.financierDue > realisedInr, `iter ${i}: shortfall implies financierDue > realised`).to.equal(true);
        expect(realisedInr + BigInt(wf.shortfall)).to.equal(BigInt(wf.financierDue));
        expect(wf.platformFee).to.equal(0n);
        expect(wf.exporterBalance).to.equal(0n);
      } else {
        const financierPaid = wf.financierDue < realisedInr ? wf.financierDue : realisedInr;
        expect(financierPaid + BigInt(wf.platformFee) + BigInt(wf.exporterBalance)).to.equal(realisedInr);
      }
    }
  });

  it("holds for >=200 randomized realisedInr values on a never-financed bill (financierDue == 0)", async () => {
    const ctx = await deployAll();
    const sbHash = sbHashOf("fuzz-unfinanced");
    const iecHash = iecHashOf("fuzz-unfinanced");
    const leoTs = await time.latest();
    await ctx.registry
      .connect(ctx.customs)
      .registerShippingBill(sbHash, iecHash, ctx.exporter1.address, WORKED_EXAMPLE.fobMinor, CCY_USD, leoTs, WORKED_EXAMPLE.fobInrMinor);

    const ITERATIONS = 200;
    for (let i = 0; i < ITERATIONS; i++) {
      const realisedInr = BigInt(Math.floor(Math.random() * 1_000_000_000));
      const wf = await ctx.engine.computeWaterfall(sbHash, realisedInr);

      expect(wf.financierDue).to.equal(0n);
      expect(wf.platformFee).to.equal(0n);
      expect(wf.shortfall).to.equal(0n);
      expect(wf.exporterBalance).to.equal(realisedInr);
    }
  });
});
