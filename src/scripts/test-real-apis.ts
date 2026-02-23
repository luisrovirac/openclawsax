import { runWithModelFallback } from "../src/agents/model-fallback.js";
import dotenv from "dotenv";

dotenv.config();

async function callRealAPI(provider: string, model: string) {
  console.log(`🌐 Llamando a ${provider}/${model}...`);
  
  // Aquí implementarías la llamada real a cada API
  // usando fetch con las keys de environment
  
  switch(provider) {
    case "groq":
      // llamar a Groq
      break;
    case "github-copilot":
      // llamar a GitHub
      break;
    case "openrouter":
      // llamar a OpenRouter
      break;
  }
}

async function testReal() {
  const result = await runWithModelFallback({
    cfg: undefined,
    provider: "groq",
    model: "llama3-70b-8192",
    fallbacksOverride: [
      "github-copilot/copilot-llama3",
      "openrouter/deepseek/deepseek-coder",
    ],
    agentDir: process.env.OPENCLAW_AGENT_DIR,
    run: callRealAPI,
  });
  
  console.log("✅ Resultado final:", result);
}

testReal().catch(console.error);
