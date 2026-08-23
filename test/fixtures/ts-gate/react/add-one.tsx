export function addOne(n: number): number {
  return n + 1
}

export function AddOne({ n }: { n: number }) {
  return <span>{n + 1}</span>
}
