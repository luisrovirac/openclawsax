// src/agents/model-fallback.multi-provider.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runWithModelFallback } from "./model-fallback.js";
import * as providerCooldown from "./auth-profiles/provider-cooldown.js";

describe("model-fallback multi-provider", () => {
  const testDir = path.join(os.tmpdir(), "openclaw-test-fallback");
  const agentDir = path.join(testDir, "agent");
  
  beforeEach(() => {
    fs.mkdirSync(agentDir, { recursive: true });
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });
  
  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });
  
  it("should try multiple providers in order until one succeeds", async () => {
    const mockRun = vi.fn()
      .mockRejectedValueOnce(new Error("Groq failed"))
      .mockRejectedValueOnce(new Error("GitHub failed"))
      .mockResolvedValueOnce("OpenRouter success");
    
    const result = await runWithModelFallback({
      cfg: undefined,
      provider: "groq",
      model: "llama3",
      fallbacksOverride: [
        "github-copilot/copilot",
        "openrouter/deepseek",
      ],
      agentDir,
      run: mockRun,
    });
    
    // Verificar que se intentaron los 3 proveedores
    expect(mockRun).toHaveBeenCalledTimes(3);
    expect(mockRun.mock.calls).toEqual([
      ["groq", "llama3"],
      ["github-copilot", "copilot"],
      ["openrouter", "deepseek"],
    ]);
    
    // Verificar que el resultado final es de OpenRouter
    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("deepseek");
    expect(result.result).toBe("OpenRouter success");
    
    // Verificar que se registraron los intentos fallidos
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].provider).toBe("groq");
    expect(result.attempts[0].model).toBe("llama3");
    expect(result.attempts[0].error).toContain("Groq failed");
    
    expect(result.attempts[1].provider).toBe("github-copilot");
    expect(result.attempts[1].model).toBe("copilot");
    expect(result.attempts[1].error).toContain("GitHub failed");
  });
  
  it("should respect global cooldowns", async () => {
    vi.spyOn(providerCooldown, "isProviderInGlobalCooldown")
      .mockImplementation(async (provider) => {
        if (provider === "groq") {
          return { 
            inCooldown: true, 
            cooldown: { 
              provider: "groq", 
              reason: "rate_limit", 
              until: Date.now() + 60000, 
              attemptCount: 1,
              lastError: "rate_limit"
            },
            remainingMs: 60000 
          };
        }
        return { inCooldown: false };
      });
    
    const mockRun = vi.fn().mockResolvedValue("success");
    
    const result = await runWithModelFallback({
      cfg: undefined,
      provider: "groq",
      model: "llama3",
      fallbacksOverride: ["github-copilot/copilot"],
      run: mockRun,
      agentDir,
    });
    
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith("github-copilot", "copilot");
    expect(result.provider).toBe("github-copilot");
  });
  
  it("should mark global cooldown on failure", async () => {
    const markCooldownSpy = vi.spyOn(providerCooldown, "markProviderGlobalCooldown")
      .mockResolvedValue(undefined);
    
    vi.spyOn(providerCooldown, "isProviderInGlobalCooldown")
      .mockResolvedValue({ inCooldown: false });
    
    const mockRun = vi.fn()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce("success");
    
    const result = await runWithModelFallback({
      cfg: undefined,
      provider: "groq",
      model: "llama3",
      fallbacksOverride: ["github-copilot/copilot"],
      run: mockRun,
      agentDir,
    });
    
    expect(markCooldownSpy).toHaveBeenCalledTimes(1);
    const callArgs = markCooldownSpy.mock.calls[0][0];
    expect(callArgs.provider).toBe("groq");
    expect(callArgs.reason).toBe("rate_limit");
    expect(callArgs.agentDir).toBe(agentDir);
    
    expect(result.provider).toBe("github-copilot");
    expect(result.model).toBe("copilot");
  });
  
  it("should collect attempt history on failures and succeed with third provider", async () => {
    vi.spyOn(providerCooldown, "isProviderInGlobalCooldown")
      .mockResolvedValue({ inCooldown: false });
    
    const mockRun = vi.fn()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockRejectedValueOnce(new Error("auth error"))
      .mockResolvedValueOnce("success");
    
    const result = await runWithModelFallback({
      cfg: undefined,
      provider: "groq",
      model: "llama3",
      fallbacksOverride: [
        "github-copilot/copilot",
        "openrouter/deepseek",
      ],
      run: mockRun,
      agentDir,
    });
    
    // Verificar que se intentaron los 3 proveedores
    expect(mockRun).toHaveBeenCalledTimes(3);
    expect(mockRun.mock.calls).toEqual([
      ["groq", "llama3"],
      ["github-copilot", "copilot"],
      ["openrouter", "deepseek"],
    ]);
    
    // Verificar que el resultado final es de OpenRouter
    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("deepseek");
    expect(result.result).toBe("success");
    
    // Verificar que se registraron los intentos fallidos
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].provider).toBe("groq");
    expect(result.attempts[0].model).toBe("llama3");
    expect(result.attempts[0].error).toContain("rate limit");
    
    expect(result.attempts[1].provider).toBe("github-copilot");
    expect(result.attempts[1].model).toBe("copilot");
    expect(result.attempts[1].error).toContain("auth error");
  });
});
