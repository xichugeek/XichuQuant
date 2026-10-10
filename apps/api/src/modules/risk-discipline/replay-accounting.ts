export type ReplayLot = { quantity: number; averageCost: number; realizedPnl: number };

// Signed inventory handles long exits, short covers and a reversal without inventing a fill.
export function applyReplayFill(lot: ReplayLot, side: string, quantity: number, price: number, commission: number) {
  if (![quantity, price, commission].every(Number.isFinite) || quantity <= 0 || price <= 0 || commission < 0) throw new Error("Invalid replay fill");
  const normalized = side.toUpperCase();
  if (!["BUY", "BOT", "SELL", "SLD", "SELL_SHORT", "BUY_TO_COVER"].includes(normalized)) throw new Error("Unknown replay side");
  const delta = ["BUY", "BOT", "BUY_TO_COVER"].includes(normalized) ? quantity : -quantity;
  const closes = lot.quantity !== 0 && Math.sign(lot.quantity) !== Math.sign(delta);
  const closedQuantity = closes ? Math.min(Math.abs(lot.quantity), quantity) : 0;
  const nextQuantity = lot.quantity + delta;
  const realizedPnl = lot.realizedPnl + closedQuantity * (price - lot.averageCost) * Math.sign(lot.quantity) - commission;
  const averageCost = nextQuantity === 0 ? 0 : !closes
    ? (Math.abs(lot.quantity) * lot.averageCost + quantity * price) / Math.abs(nextQuantity)
    : Math.sign(nextQuantity) !== Math.sign(lot.quantity) ? price : lot.averageCost;
  return { quantity: nextQuantity, averageCost, realizedPnl, closedQuantity, stage: closes ? "EXIT" : lot.quantity === 0 ? "INITIAL_ENTRY" : "SCALE_IN" };
}
