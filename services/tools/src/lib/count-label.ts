/** "1 row", "2 rows", "1,204 rows". */
export function countLabel(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
}
