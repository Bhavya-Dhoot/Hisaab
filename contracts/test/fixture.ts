import { ethers } from "hardhat";

export async function deployAll() {
  const signers = await ethers.getSigners();
  const [admin, customs, adBank, ops, payoutAdapter, exporter1, exporter2, exporter3, financier1, financier2] =
    signers;

  const HisabRoles = await ethers.getContractFactory("HisabRoles");
  const roles = await HisabRoles.deploy(admin.address);

  const ShippingBillRegistry = await ethers.getContractFactory("ShippingBillRegistry");
  const registry = await ShippingBillRegistry.deploy(await roles.getAddress());

  const ReceivableToken = await ethers.getContractFactory("ReceivableToken");
  const token = await ReceivableToken.deploy(await roles.getAddress(), "https://hisab.local/token/{id}.json");

  const RemittanceRegistry = await ethers.getContractFactory("RemittanceRegistry");
  const remittance = await RemittanceRegistry.deploy(await roles.getAddress());

  const RealisationEngine = await ethers.getContractFactory("RealisationEngine");
  const engine = await RealisationEngine.deploy(await roles.getAddress());

  const EBRCIssuer = await ethers.getContractFactory("EBRCIssuer");
  const ebrc = await EBRCIssuer.deploy(await roles.getAddress());

  const PayoutLedger = await ethers.getContractFactory("PayoutLedger");
  const payoutLedger = await PayoutLedger.deploy(await roles.getAddress());

  await registry.setToken(await token.getAddress());
  await token.setRegistry(await registry.getAddress());
  await token.setPayoutLedger(await payoutLedger.getAddress());
  await engine.setRegistry(await registry.getAddress());
  await engine.setRemittance(await remittance.getAddress());
  await engine.setToken(await token.getAddress());
  await ebrc.setRegistry(await registry.getAddress());

  const INTERNAL_ROLE = await roles.INTERNAL_ROLE();
  await roles.grantRole(INTERNAL_ROLE, await token.getAddress());
  await roles.grantRole(INTERNAL_ROLE, await engine.getAddress());

  await roles.grantRole(await roles.CUSTOMS_ROLE(), customs.address);
  await roles.grantRole(await roles.AD_BANK_ROLE(), adBank.address);
  await roles.grantRole(await roles.OPS_ROLE(), ops.address);
  await roles.grantRole(await roles.PAYOUT_ROLE(), payoutAdapter.address);
  await roles.grantRole(await roles.EXPORTER_ROLE(), exporter1.address);
  await roles.grantRole(await roles.EXPORTER_ROLE(), exporter2.address);
  await roles.grantRole(await roles.EXPORTER_ROLE(), exporter3.address);
  await roles.grantRole(await roles.FINANCIER_ROLE(), financier1.address);
  await roles.grantRole(await roles.FINANCIER_ROLE(), financier2.address);
  await roles.grantRole(await roles.REGULATOR_ROLE(), admin.address);

  return {
    roles,
    registry,
    token,
    remittance,
    engine,
    ebrc,
    payoutLedger,
    admin,
    customs,
    adBank,
    ops,
    payoutAdapter,
    exporter1,
    exporter2,
    exporter3,
    financier1,
    financier2,
  };
}

export function sbHashOf(seed: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(`sb:${seed}`));
}

export function irmHashOf(seed: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(`irm:${seed}`));
}

export function iecHashOf(seed: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(`iec:${seed}`));
}

export const CCY_USD = ethers.hexlify(ethers.toUtf8Bytes("USD")); // bytes3

// Worked-example magnitudes from docs/SMART_CONTRACTS.md §5.
export const WORKED_EXAMPLE = {
  fobMinor: 4_875_000, // USD 48,750.00 in cents
  ccy: CCY_USD,
  fobInrMinor: 407_812_500, // INR 40,78,125.00 in paise
  advanceInrMinor: 358_875_000, // INR 35,88,750.00 in paise (88% advance)
  rateBps: 1150, // 11.5% p.a.
  lockDays: 74,
  realisedInr: 408_693_000, // INR 40,86,930.00 in paise
};
