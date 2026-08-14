import { NextResponse } from "next/server";
import { getStrategyEngineStatus } from "../../../strategy-engine/engine.server";
import { publicOrder } from "../../../strategy-engine/order-coordinator.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = getStrategyEngineStatus();
  return NextResponse.json({
    mode: status.mode,
    environments: status.environments,
    positions: status.positions.map((position) => ({
      environment: position.environment,
      marketCode: position.marketCode,
      code: position.code,
      generation: position.generation,
      quantity: position.quantity,
      availableQuantity: position.availableQuantity,
      paused: position.paused,
      pauseReason: position.pauseReason,
      trailingActivated: position.trailingActivated,
      trailingPeak: position.trailingPeak,
      lastSignal: position.lastSignal,
      updatedAt: position.updatedAt,
    })),
    activeOrders: status.activeOrders.map(publicOrder),
  }, { headers: { "Cache-Control": "no-store" } });
}
