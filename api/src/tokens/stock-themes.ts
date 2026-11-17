import type { ThemeId } from '../../types/sectors';

// Editorial exposure lists, not GICS subsectors or investment rankings.
// Canonical identities verified against Oren's stock catalog on 2026-11-16.
// Companies may occur in several themes. Only catalog equities are eligible.
// Theme taxonomy references: https://thematic.globalxetfs.eu/
export const themeAssetIds: Record<ThemeId, readonly string[]> = {
  artificialIntelligence: [
    'nvidia',
    'microsoft',
    'alphabet',
    'amazon',
    'meta',
    'palantir',
    'broadcom',
    'amd',
    'oracle',
    'salesforce',
  ],
  semiconductors: [
    'nvidia',
    'broadcom',
    'amd',
    'tsmc',
    'asml',
    'micron',
    'intel',
    'arm-holdings-plc',
    'qualcomm',
  ],
  cybersecurity: [
    'crowdstrike',
    'palo-alto-networks',
    'stock-ztay65fc',
    'cisco',
  ],
  cloudComputing: [
    'microsoft',
    'amazon',
    'alphabet',
    'oracle',
    'salesforce',
    'snowflake',
    'servicenow',
    'stock-ztay65fc',
  ],
  robotics: [
    'intuitive-surgical',
    'tesla',
    'deere',
    'honeywell',
    'stock-e83twwrv',
    'stock-np42lxps',
    'stock-ahvtjqt6',
  ],
  cleanEnergy: ['nextera-energy', 'stock-bbmtgf7a', 'constellation-energy'],
  fintech: [
    'visa',
    'mastercard',
    'paypal',
    'block',
    'coinbase',
    'robinhood',
    'sofi-technologies',
  ],
  spaceAndDefense: [
    'rocket-lab',
    'ast-spacemobile',
    'lockheed',
    'rtx',
    'boeing',
  ],
};
