export function swipeStep(translationX: number, velocityX: number): -1 | 0 | 1 {
  const reach = translationX + velocityX * 0.15;
  if (Math.abs(translationX) < 20 || Math.abs(reach) < 72 || reach * translationX <= 0) return 0;
  return reach < 0 ? 1 : -1;
}
