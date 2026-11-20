// Shared places for ties: two players on the same number both show the same rank ("1, 1, 3"),
// the way people expect a scoreboard to read. The list order still comes from the server
// (whoever got there first is listed first).

type Ranked = { rank: number; value: number };

export function sameScore(a: { value: number }, b: { value: number }): boolean {
  return a.value === b.value;
}

/** Place shown for each row of a list sorted by the server (rank = position on the full board). */
export function tiePlaces<T extends Ranked>(rows: T[]): number[] {
  const places: number[] = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    places.push(prev && prev.rank === r.rank - 1 && sameScore(prev, r) ? places[i - 1] : r.rank);
  });
  return places;
}
