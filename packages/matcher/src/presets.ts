export interface PresetSb {
  sbNo: string;
  invoiceNos: string[];
  fobMinor: number;
  ccy: string;
  buyerName: string;
  buyerCountry: string;
}

export interface PresetOpts {
  second?: PresetSb;
}

function formatAmount(minor: number): string {
  return (minor / 100).toFixed(2).replace('.', ',');
}

function buildRaw(
  sb: PresetSb,
  amountMinor: number,
  remitLines: string[],
  senderToReceiverInfo: string
): string {
  return [
    '{1:F01CITIINBBAXXX0000000000}{2:I103CITIUS33AXXXN}{4:',
    ':20:ACME20261213001',
    ':23B:CRED',
    `:32A:261213${sb.ccy}${formatAmount(amountMinor)}`,
    ':50K:/9876543210',
    sb.buyerName,
    '120 COMMERCE DR',
    `NEWARK NJ ${sb.buyerCountry}`,
    ':59:/00123456789',
    'SHARMA TEXTILES PVT LTD',
    'TIRUPUR IN',
    `:70:${remitLines.join('\n')}`,
    ':71A:SHA',
    `:72:${senderToReceiverInfo}`,
    '-}',
  ].join('\n');
}

function lastSegment(ref: string): string {
  const parts = ref.split('/');
  return parts[parts.length - 1];
}

export const PRESETS: Record<'clean' | 'typo' | 'bundle' | 'noref' | 'fraud', (sb: PresetSb, opts?: PresetOpts) => string> = {
  clean(sb) {
    return buildRaw(sb, sb.fobMinor, [`/INV/${sb.invoiceNos[0]} /SB/${sb.sbNo}`], '');
  },

  typo(sb) {
    const typoRef = sb.invoiceNos[0].replace(/0/g, 'O');
    // API_SPEC §8: letter O for zero, USD 45 charges deducted
    return buildRaw(
      sb,
      sb.fobMinor - 4500,
      [`PAYMNT FOR GOODS INV ${typoRef}`, 'LESS BANK CHGS'],
      `/ACC/CHGS ${sb.ccy} 45.00`
    );
  },

  bundle(sb, opts) {
    const second = opts?.second;
    if (!second) throw new Error("bundle preset requires opts.second");
    const chargeMinor = 4500; // USD 45.00 bank charge, per MATCHING_ENGINE.md §6
    const amountMinor = sb.fobMinor + second.fobMinor - chargeMinor;
    const suffix1 = lastSegment(sb.invoiceNos[0]);
    const suffix2 = lastSegment(second.invoiceNos[0]);
    return buildRaw(
      sb,
      amountMinor,
      [`INV ${suffix1} AND ${suffix2} LESS BANK CHGS`],
      `/ACC/CHGS ${sb.ccy} 45.00`
    );
  },

  noref(sb) {
    return buildRaw(sb, sb.fobMinor, ['PAYMENT FOR GOODS'], '');
  },

  fraud(sb) {
    return buildRaw(sb, sb.fobMinor * 3, [`/SB/${sb.sbNo}`], '');
  },
};
