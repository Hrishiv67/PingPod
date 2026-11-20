// Shared places for ties: two players on the same number both show the same rank ("1, 1, 3"),
// the way people expect a scoreboard to read. The list order still comes from the server
// (whoever got there first is listed first). On SPINDEX, a verified and a self-reported rating
// are never tied, because verified ratings are listed first.

type Ranked = { rank: number; value: number; detail?: string | null };

export function sameScore(board: string, a: Omit<Ranked, "rank">, b: Omit<Ranked, "rank">): boolean {
  if (a.value !== b.value) return false;
  return board !== "spindex" || (a.detail === "verified") === (b.detail === "verified");
}

/** Place shown for each row of a list sorted by the server (rank = position on the full board). */
export function tiePlaces<T extends Ranked>(board: string, rows: T[]): number[] {
  const places: number[] = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    places.push(prev && prev.rank === r.rank - 1 && sameScore(board, prev, r) ? places[i - 1] : r.rank);
  });
  return places;
}
