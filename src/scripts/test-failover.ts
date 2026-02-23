import { runWithModelFallback } from "../src/agents/model-fallback.js";
import { markProviderGlobalCooldown, clearProviderGlobalCooldown } from "../src/agents/auth-profiles/provider-cooldown.js";

async function testFailover() {
  const agentDir = "/tmp/openclaw-test";
  
  // Limpiar cooldowns previos
  await clearProviderGlobalCooldown("groq", agentDir);
  await clearProviderGlobalCooldown("github-copilot", agentDir);
  
  console.log("🧪 Test 1: Todos los proveedores funcionan");
  
  const result1 = await runWithModelFallback({
    cfg: undefined,
    provider: "groq",
    model: "llama3",
    fallbacksOverride: [
      "github-copilot/copilot",
      "openrouter/deepseek",
    ],
    agentDir,
    run: async (provider, model) => {
      console.log(`   Intentando: ${provider}/${model}`);
      if (provider === "groq") return "✅ Groq OK";
      throw new Error(`❌ ${provider} no debería intentarse`);
    },
  });
  
  console.log("   Resultado:", result1);
  
  console.log("\n🧪 Test 2: Groq en cooldown, fallback a GitHub");
  
  // Marcar Groq en cooldown
  await markProviderGlobalCooldown({
    provider: "groq",
    reason: "rate_limit",
    agentDir,
  });
  
  const result2 = await runWithModelFallback({
    cfg: undefined,
    provider: "groq",
    model: "llama3",
    fallbacksOverride: [
      "github-copilot/copilot",
      "openrouter/deepseek",
    ],
    agentDir,
    run: async (provider, model) => {
      console.log(`   Intentando: ${provider}/${model}`);
      if (provider === "github-copilot") return "✅ GitHub OK";
      throw new Error(`❌ ${provider} no esperado`);
    },
  });
  
  console.log("   Resultado:", result2);
  
  console.log("\n🧪 Test 3: Todos fallan");
  
  const result3 = await runWithModelFallback({
    cfg: undefined,
    provider: "groq",
    model: "llama3",
    fallbacksOverride: [
      "github-copilot/copilot",
      "openrouter/deepseek",
    ],
    agentDir,
    run: async () => {
      throw new Error("❌ Error simulado");
    },
  }).catch(e => e);
  
  console.log("   Error esperado:", result3.message);
}

testFailover().catch(console.error);
