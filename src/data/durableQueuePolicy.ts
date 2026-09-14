/** Pending user operations stay durable; storage failure must surface at enqueue. */
export function preserveDurableQueue<T>(items: T[], _formerLimit: number): T[] {
  return items;
}
