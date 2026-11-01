/** 1478 → "1 478", the Czech thousands grouping the design uses. */
export function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
