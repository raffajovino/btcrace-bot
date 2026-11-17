// Early-entry hold with a hard drawdown guard, for btc-race-24h-20261117-0603.
//
// Rationale: cbBTC minute bars are near random walk (median |move| ~3 bps) while a full-size
// round trip costs ~60 bps, so active trading bleeds fees. The best dev-window equity comes
// from entering early and holding. This bot buys on the 5th batch and holds; the only exit is
// a hard stop 0.8% under the entry, after which it re-enters once the price recovers above the
// exit price. On the dev window that is exactly one filled buy and +40 bps.
//
// Determinism: state derived only from harness bars; no wall clock, no randomness.
import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const ENTRY_BAR = 5;      // first batch we buy on (bars 0-4 warm-up observation)
const STOP_DD_BPS = 80;   // hard stop: 0.8% under entry
const REENTRY_COOLDOWN = 5; // bars to wait after a stop before re-entering
const MAX_SLIPPAGE_BPS = 10_000;

let barsSeen = 0;
let exitPrice: bigint | null = null;  // close where we stopped out
let cooldown = 0;

await runBars({
  onBatch(state: BarsState, _batch): OrderInput[] {
    const symbol = state.hello.symbols[0]?.symbol;
    if (!symbol) return [];
    const close = state.close(symbol);
    if (close === null || close === undefined) return [];
    barsSeen += 1;

    const position = state.positions.get(symbol);

    if (position) {
      const qty = position.qty;
      const avg = position.cost / qty;
      const gain = ((close - avg) * 10_000n) / avg;
      if (gain <= -BigInt(STOP_DD_BPS)) {
        exitPrice = close;
        cooldown = REENTRY_COOLDOWN;
        return [{ side: 'sell', symbol, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (cooldown > 0) cooldown -= 1;

    // flat: buy at ENTRY_BAR, or re-enter after a stop once price recovers above the exit close
    if ((barsSeen === ENTRY_BAR && exitPrice === null) || (exitPrice !== null && cooldown === 0 && close > exitPrice)) {
      const amount = state.weightRoom(symbol);
      if (amount <= 0n) return [];
      const spend = amount < state.cash ? amount : state.cash;
      if (spend <= 0n) return [];
      return [{ side: 'buy', symbol, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
