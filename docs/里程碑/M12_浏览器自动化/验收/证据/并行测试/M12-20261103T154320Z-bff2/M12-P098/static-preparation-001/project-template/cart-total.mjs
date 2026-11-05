// Deliberate local synthetic defect. Real Codex should repair this source for T125.
export const calculate = (unitPrice, quantity) => unitPrice * quantity + 0.01;
