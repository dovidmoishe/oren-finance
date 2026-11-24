import type { InterestId, SectorId } from '../../types/sectors';

export interface SectorCandidate {
  id: string;
  sectorId: SectorId | null;
  interestId?: InterestId;
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
  const groups = new Map<InterestId, T[]>();
  const seen = new Set<string>();
  for (const item of ordered) {
    const interest = item.interestId ?? item.sectorId;
    if (!interest) continue;
    const group = groups.get(interest) ?? [];
    group.push(item);
    groups.set(interest, group);
  }
  const results: T[] = [];
  // Scan within each interest so overlapping themes cannot consume a slot twice
  // or hide a unique candidate behind an already-selected company.
  while (results.length < limit) {
    let added = false;
    for (const group of groups.values()) {
      let candidate = group.shift();
      while (candidate && seen.has(candidate.id)) candidate = group.shift();
      if (candidate) {
        seen.add(candidate.id);
        results.push(candidate);
        added = true;
      }
      if (results.length === limit) break;
    }
    if (!added) break;
  }
  return results;
}
