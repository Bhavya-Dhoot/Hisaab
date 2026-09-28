import fs from "fs";
import path from "path";
import { ethers, artifacts, network } from "hardhat";

async function main() {
  const signers = await ethers.getSigners();
  const [admin, customs, adBank, ops, payoutAdapter, exporter1, exporter2, exporter3, financier1, financier2] =
    signers;

  const HisabRoles = await ethers.getContractFactory("HisabRoles");
  const roles = await HisabRoles.deploy(admin.address);
  await roles.waitForDeployment();

  const ShippingBillRegistry = await ethers.getContractFactory("ShippingBillRegistry");
  const registry = await ShippingBillRegistry.deploy(await roles.getAddress());
  await registry.waitForDeployment();

  const ReceivableToken = await ethers.getContractFactory("ReceivableToken");
  const token = await ReceivableToken.deploy(await roles.getAddress(), "https://hisab.local/token/{id}.json");
  await token.waitForDeployment();

  const RemittanceRegistry = await ethers.getContractFactory("RemittanceRegistry");
  const remittance = await RemittanceRegistry.deploy(await roles.getAddress());
  await remittance.waitForDeployment();

  const RealisationEngine = await ethers.getContractFactory("RealisationEngine");
  const engine = await RealisationEngine.deploy(await roles.getAddress());
  await engine.waitForDeployment();

  const EBRCIssuer = await ethers.getContractFactory("EBRCIssuer");
  const ebrc = await EBRCIssuer.deploy(await roles.getAddress());
  await ebrc.waitForDeployment();

  const PayoutLedger = await ethers.getContractFactory("PayoutLedger");
  const payoutLedger = await PayoutLedger.deploy(await roles.getAddress());
  await payoutLedger.waitForDeployment();

  // --- wire cross-contract references ---
  await (await registry.setToken(await token.getAddress())).wait();
  await (await token.setRegistry(await registry.getAddress())).wait();
  await (await token.setPayoutLedger(await payoutLedger.getAddress())).wait();
  await (await engine.setRegistry(await registry.getAddress())).wait();
  await (await engine.setRemittance(await remittance.getAddress())).wait();
  await (await engine.setToken(await token.getAddress())).wait();
  await (await ebrc.setRegistry(await registry.getAddress())).wait();

  // --- internal cross-contract role: token + engine may call registry/remittance setters ---
  const INTERNAL_ROLE = await roles.INTERNAL_ROLE();
  await (await roles.grantRole(INTERNAL_ROLE, await token.getAddress())).wait();
  await (await roles.grantRole(INTERNAL_ROLE, await engine.getAddress())).wait();

  // --- grant roles to Hardhat accounts per plans/2026-09-28-mvp-build.md ---
  const CUSTOMS_ROLE = await roles.CUSTOMS_ROLE();
  const AD_BANK_ROLE = await roles.AD_BANK_ROLE();
  const OPS_ROLE = await roles.OPS_ROLE();
  const PAYOUT_ROLE = await roles.PAYOUT_ROLE();
  const EXPORTER_ROLE = await roles.EXPORTER_ROLE();
  const FINANCIER_ROLE = await roles.FINANCIER_ROLE();
  const REGULATOR_ROLE = await roles.REGULATOR_ROLE();

  await (await roles.grantRole(CUSTOMS_ROLE, customs.address)).wait();
  await (await roles.grantRole(AD_BANK_ROLE, adBank.address)).wait();
  await (await roles.grantRole(OPS_ROLE, ops.address)).wait();
  await (await roles.grantRole(PAYOUT_ROLE, payoutAdapter.address)).wait();
  for (const exporter of [exporter1, exporter2, exporter3]) {
    await (await roles.grantRole(EXPORTER_ROLE, exporter.address)).wait();
  }
  for (const financier of [financier1, financier2]) {
    await (await roles.grantRole(FINANCIER_ROLE, financier.address)).wait();
  }
  await (await roles.grantRole(REGULATOR_ROLE, admin.address)).wait();

  const net = await ethers.provider.getNetwork();

  const addresses = {
    HisabRoles: await roles.getAddress(),
    ShippingBillRegistry: await registry.getAddress(),
    ReceivableToken: await token.getAddress(),
    RemittanceRegistry: await remittance.getAddress(),
    RealisationEngine: await engine.getAddress(),
    EBRCIssuer: await ebrc.getAddress(),
    PayoutLedger: await payoutLedger.getAddress(),
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const abiDir = path.join(deploymentsDir, "abi");
  fs.mkdirSync(abiDir, { recursive: true });

  fs.writeFileSync(
    path.join(deploymentsDir, `${network.name}.json`),
    JSON.stringify({ chainId: Number(net.chainId), addresses }, null, 2) + "\n"
  );

  for (const name of Object.keys(addresses)) {
    const artifact = await artifacts.readArtifact(name);
    fs.writeFileSync(path.join(abiDir, `${name}.json`), JSON.stringify(artifact.abi, null, 2) + "\n");
  }

  console.log("Deployed:", addresses);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
