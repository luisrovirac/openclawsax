import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  calculateProviderCooldownMs,
  markProviderGlobalCooldown,
  isProviderInGlobalCooldown,
  clearProviderGlobalCooldown,
  getProviderCooldownStats,
} from "./provider-cooldown.js";

describe("provider-cooldown", () => {
  const testDir = path.join(os.tmpdir(), "openclaw-test-cooldown");
  const agentDir = path.join(testDir, "agent");
  
  beforeEach(() => {
    fs.mkdirSync(agentDir, { recursive: true });
  });
  
  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });
  
  it("should calculate cooldown times correctly", () => {
    expect(calculateProviderCooldownMs("rate_limit", 1)).toBe(60_000); // 1 min
    expect(calculateProviderCooldownMs("rate_limit", 2)).toBe(120_000); // 2 min
    expect(calculateProviderCooldownMs("rate_limit", 3)).toBe(240_000); // 4 min
    expect(calculateProviderCooldownMs("rate_limit", 4)).toBe(480_000); // 8 min
    expect(calculateProviderCooldownMs("rate_limit", 5)).toBe(960_000); // 16 min
    expect(calculateProviderCooldownMs("rate_limit", 6)).toBe(1_920_000); // 32 min
    expect(calculateProviderCooldownMs("rate_limit", 7)).toBe(3_600_000); // max 1 hora
  });
  
  it("should mark and check provider cooldown", async () => {
    await markProviderGlobalCooldown({
      provider: "groq",
      reason: "rate_limit",
      agentDir,
    });
    
    const result = await isProviderInGlobalCooldown("groq", agentDir);
    expect(result.inCooldown).toBe(true);
    expect(result.cooldown?.reason).toBe("rate_limit");
    expect(result.remainingMs).toBeGreaterThan(0);
  });
  
  it("should clear provider cooldown", async () => {
    await markProviderGlobalCooldown({
      provider: "groq",
      reason: "rate_limit",
      agentDir,
    });
    
    await clearProviderGlobalCooldown("groq", agentDir);
    
    const result = await isProviderInGlobalCooldown("groq", agentDir);
    expect(result.inCooldown).toBe(false);
  });
  
  it("should get cooldown stats", async () => {
    await markProviderGlobalCooldown({
      provider: "groq",
      reason: "rate_limit",
      agentDir,
    });
    
    await markProviderGlobalCooldown({
      provider: "anthropic",
      reason: "auth",
      agentDir,
    });
    
    const stats = await getProviderCooldownStats(agentDir);
    expect(stats.activeCooldowns).toBe(2);
    expect(stats.cooldownsByReason.rate_limit).toBe(1);
    expect(stats.cooldownsByReason.auth).toBe(1);
  });
});
