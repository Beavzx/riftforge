// Official ban list (data/banlist.json, maintained by the CARD DATA agent). enforceBanlist uses it unless the setup
// passes its own `banlist`.
import data from '../../data/banlist.json' with { type: 'json' };

export type BanFormat = 'standard' | 'constructed2v2';

/** Banned card names/ids for a format (2v2 games use the constructed 2v2 list). */
export function officialBanlist(format: BanFormat = 'standard'): string[] {
  const d = data as unknown as Partial<Record<BanFormat, string[]>>;
  return [...(d[format] ?? [])];
}
export const BANLIST_EFFECTIVE: string = (data as { effective?: string }).effective ?? '';
