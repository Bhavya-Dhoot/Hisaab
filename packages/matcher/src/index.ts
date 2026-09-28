export type {
  IRMInput,
  Candidate,
  Reason,
  Allocation,
  MatchResult,
  MatchConfig,
  MT103Fields,
  Extraction,
  Deduction,
  Extractor,
} from './types.js';

export { parseMT103 } from './parse.js';
export { match } from './match.js';
export { heuristicExtractor, anthropicExtractor } from './extract.js';
export { PRESETS } from './presets.js';
export type { PresetSb, PresetOpts } from './presets.js';
