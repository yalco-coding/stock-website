export async function register() {
  const building = process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build";
  if (process.env.NEXT_RUNTIME === "nodejs" && !building) {
    const { startStrategyEngine } = await import("./app/strategy-engine/engine.server");
    await startStrategyEngine();
  }
}
