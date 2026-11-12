import type { SectorId } from '../../types/sectors';

export interface SectorCandidate {
  id: string;
  sectorId: SectorId;
  sortRank: number;
}

export function rankSectorMatches<T extends SectorCandidate>(
  candidates: readonly T[],
  limit = 6,
): T[] {
  const ordered = [...candidates].sort(
    (a, b) =>
      a.sortRank - b.sortRank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const groups = new Map<SectorId, T[]>();
  const seen = new Set<string>();
  for (const item of ordered) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const group = groups.get(item.sectorId) ?? [];
    group.push(item);
    groups.set(item.sectorId, group);
  }
  const results: T[] = [];
  for (let round = 0; results.length < Math.min(seen.size, limit); round++) {
    for (const group of groups.values()) {
      if (group[round]) results.push(group[round]);
      if (results.length === limit) break;
    }
  }
  return results;
}
