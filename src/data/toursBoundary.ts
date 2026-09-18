/** Generation invalidates every in-flight read/write before an account transition. */
let generation = 0;
let changing = false;
export function tourBoundary() {
  return { generation, changing };
}
export function beginTourAccountChange() {
  generation += 1;
  changing = true;
}
export function endTourAccountChange() {
  generation += 1;
  changing = false;
}
export function invalidateTours() {
  generation += 1;
}
