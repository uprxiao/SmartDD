// Synthetic cart arithmetic under test. This is project business source, not a fixture switch.
export function calculateTotal(unitPrice, quantity) {
  if (!Number.isFinite(unitPrice) || !Number.isInteger(quantity) || quantity < 0) throw Error('Invalid cart input');
  return Math.round(unitPrice * quantity * 100 + 1) / 100;
}
