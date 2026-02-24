// src/commands/auth-choice.apply.groq.ts
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { ensureApiKeyFromOptionEnvOrPrompt } from "./auth-choice.apply-helpers.js";
import {
  applyAuthProfileConfig,
  setGroqApiKey,
  GROQ_DEFAULT_MODEL_REF,
  applyGroqConfig,
  applyGroqProviderConfig,
} from "./onboard-auth.js";
import {
  normalizeApiKeyInput,
  validateApiKeyInput,
  formatApiKeyPreview,
} from "./auth-choice.api-key.js";
import { createAuthChoiceDefaultModelApplier, createAuthChoiceModelStateBridge } from "./auth-choice.apply-helpers.js";
import { resolveEnvApiKey } from "../agents/model-auth.js";

export async function applyAuthChoiceGroq(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "groq-api-key") {
    return null;
  }

  let nextConfig = params.config;
  let agentModelOverride: string | undefined;
  
  const stateBridge = createAuthChoiceModelStateBridge({
    getConfig: () => nextConfig,
    setConfig: (config) => (nextConfig = config),
    getAgentModelOverride: () => agentModelOverride,
    setAgentModelOverride: (model) => (agentModelOverride = model),
  });
  
  const applyProviderDefaultModel = createAuthChoiceDefaultModelApplier(params, stateBridge);

  // Verificar si ya existe una API key en el entorno
  const envKey = resolveEnvApiKey("groq");
  if (envKey) {
    const useExisting = await params.prompter.confirm({
      message: `Use existing GROQ_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
      initialValue: true,
    });
    if (useExisting) {
      await setGroqApiKey(envKey.apiKey, params.agentDir);
    }
  }

  // Si no hay key en entorno o el usuario dijo que no, pedirla
  await ensureApiKeyFromOptionEnvOrPrompt({
    token: params.opts?.token,
    provider: "groq",
    tokenProvider: params.opts?.tokenProvider,
    expectedProviders: ["groq"],
    envLabel: "GROQ_API_KEY",
    promptMessage: "Enter Groq API key",
    normalize: normalizeApiKeyInput,
    validate: validateApiKeyInput,
    prompter: params.prompter,
    setCredential: async (apiKey) => setGroqApiKey(apiKey, params.agentDir),
    noteMessage: [
      "Groq provides ultra-fast inference for Llama 3, Mixtral, and other open models.",
      "Get your API key at: https://console.groq.com/keys",
      "Free tier includes rate limits suitable for development.",
    ].join("\n"),
    noteTitle: "Groq",
  });

  // Aplicar perfil de autenticación
  nextConfig = applyAuthProfileConfig(nextConfig, {
    profileId: "groq:default",
    provider: "groq",
    mode: "api_key",
  });

  // Aplicar modelo por defecto - AHORA USA LAS FUNCIONES IMPORTADAS
  await applyProviderDefaultModel({
    defaultModel: GROQ_DEFAULT_MODEL_REF,
    applyDefaultConfig: applyGroqConfig,
    applyProviderConfig: applyGroqProviderConfig,
    noteDefault: GROQ_DEFAULT_MODEL_REF,
  });

  return { config: nextConfig, agentModelOverride };
}
