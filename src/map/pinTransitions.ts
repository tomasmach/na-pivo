type Point = { lat: number; lng: number };
type Node = Point & { key: string; lead: { id: string }; members: readonly { id: string }[] };

/**
 * A marker the map draws. `from` is where a new marker starts its flight, `at` where it rests,
 * and a `leaving` marker flies to `at` and fades before it goes.
 */
export type ShownPin<N extends Node = Node> = { node: N; at: Point; from: Point | null; leaving: boolean };

function unchanged(a: Node, b: Node): boolean {
  return a === b || (a.lat === b.lat && a.lng === b.lng && a.members.length === b.members.length && a.members.every((member, i) => member === b.members[i]));
}

/**
 * The markers to draw once the groups change from `shown` to `next`. A new marker flies out of
 * the bubble its pubs were in, and a marker that is gone flies into the bubble that took its pubs.
 */
export function movePins<N extends Node>(shown: readonly ShownPin<N>[], next: readonly N[]): ShownPin<N>[] {
  const before = new Map(shown.map((pin) => [pin.node.key, pin]));
  const wasIn = new Map<string, ShownPin<N>>();
  for (const pin of shown) for (const member of pin.node.members) wasIn.set(member.id, pin);
  const nowIn = new Map<string, N>();
  for (const node of next) for (const member of node.members) nowIn.set(member.id, node);

  const result: ShownPin<N>[] = next.map((node) => {
    const same = before.get(node.key);
    if (same) return unchanged(same.node, node) ? same : { node, at: node, from: same.from, leaving: false };
    return { node, at: node, from: wasIn.get(node.lead.id)?.at ?? null, leaving: false };
  });
  const kept = new Set(next.map((node) => node.key));
  for (const pin of shown) {
    if (!kept.has(pin.node.key)) result.push({ node: pin.node, at: nowIn.get(pin.node.lead.id) ?? pin.at, from: pin.from, leaving: true });
  }
  return result;
}
