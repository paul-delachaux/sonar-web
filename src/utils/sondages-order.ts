import sondagesOrder from '../data/sondages-order.json';

type PollWithId = { id: string; data?: { isVisible?: boolean } };

export function orderSondages<T extends PollWithId>(polls: T[], onlyVisible = false): T[] {
  const positions = new Map<string, number>();
  sondagesOrder.order.forEach((slug, index) => positions.set(slug, index));
  const selected = onlyVisible ? polls.filter((poll) => poll.data?.isVisible) : polls;

  return [...selected].sort((a, b) => {
    const positionA = positions.get(a.id);
    const positionB = positions.get(b.id);
    if (positionA !== undefined && positionB !== undefined) return positionA - positionB;
    if (positionA !== undefined) return -1;
    if (positionB !== undefined) return 1;
    return a.id.localeCompare(b.id);
  });
}
