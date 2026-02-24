import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAgentModelPrimaryValue } from "../config/model-input.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { applyAuthChoiceGroq } from "./auth-choice.apply.groq.js";
import {
  createAuthTestLifecycle,
  createExitThrowingRuntime,
  createWizardPrompter,
  readAuthProfilesForAgent,
  setupAuthTestEnv,
} from "./test-wizard-helpers.js";

function createGroqPrompter(
  params: {
    text?: WizardPrompter["text"];
    confirm?: WizardPrompter["confirm"];
    select?: WizardPrompter["select"];
    note?: WizardPrompter["note"];
  } = {},
): WizardPrompter {
  return createWizardPrompter(
    {
      text: params.text,
      confirm: params.confirm,
      select: params.select,
      note: params.note,
    },
    { defaultSelect: "groq-api-key" },
  );
}

describe("applyAuthChoiceGroq", () => {
  const lifecycle = createAuthTestLifecycle([
    "OPENCLAW_STATE_DIR",
    "OPENCLAW_AGENT_DIR",
    "PI_CODING_AGENT_DIR",
    "GROQ_API_KEY",
  ]);

  async function setupTempState() {
    const env = await setupAuthTestEnv("openclaw-groq-");
    lifecycle.setStateDir(env.stateDir);
    return env.agentDir;
  }

  async function readAuthProfiles(agentDir: string) {
    return await readAuthProfilesForAgent<{
      profiles?: Record<string, { key?: string }>;
    }>(agentDir);
  }

  function resetGroqEnv(): void {
    delete process.env.GROQ_API_KEY;
  }

  afterEach(async () => {
    await lifecycle.cleanup();
  });

  it("returns null for unrelated authChoice", async () => {
    const result = await applyAuthChoiceGroq({
      authChoice: "openrouter-api-key",
      config: {},
      prompter: createGroqPrompter(),
      runtime: createExitThrowingRuntime(),
      setDefaultModel: true,
    });

    expect(result).toBeNull();
  });

  it("uses opts token for groq-api-key without prompt", async () => {
    const agentDir = await setupTempState();
    resetGroqEnv();

    const text = vi.fn(async () => "should-not-be-used");
    const confirm = vi.fn(async () => true);
    const note = vi.fn(async () => {});

    const result = await applyAuthChoiceGroq({
      authChoice: "groq-api-key",
      config: {},
      prompter: createGroqPrompter({ text, confirm, note }),
      runtime: createExitThrowingRuntime(),
      setDefaultModel: true,
      opts: {
        tokenProvider: "groq",
        token: "gsk-opts-token",
      },
    });

    expect(result).not.toBeNull();
    expect(result?.config.auth?.profiles?.["groq:default"]).toMatchObject({
      provider: "groq",
      mode: "api_key",
    });
    expect(resolveAgentModelPrimaryValue(result?.config.agents?.defaults?.model)).toBe(
      "groq/llama3-70b-8192",
    );
    expect(text).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    const parsed = await readAuthProfiles(agentDir);
    expect(parsed.profiles?.["groq:default"]?.key).toBe("gsk-opts-token");
  });

  it("uses env token when confirmed", async () => {
    const agentDir = await setupTempState();
    process.env.GROQ_API_KEY = "gsk-env-token";

    const text = vi.fn(async () => "should-not-be-used");
    const confirm = vi.fn(async () => true);
    const note = vi.fn(async () => {});

    const result = await applyAuthChoiceGroq({
      authChoice: "groq-api-key",
      config: {},
      prompter: createGroqPrompter({ text, confirm, note }),
      runtime: createExitThrowingRuntime(),
      setDefaultModel: true,
    });

    expect(result).not.toBeNull();
    expect(result?.config.auth?.profiles?.["groq:default"]).toMatchObject({
      provider: "groq",
      mode: "api_key",
    });
    expect(resolveAgentModelPrimaryValue(result?.config.agents?.defaults?.model)).toBe(
      "groq/llama3-70b-8192",
    );
    expect(text).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalled();

    const parsed = await readAuthProfiles(agentDir);
    expect(parsed.profiles?.["groq:default"]?.key).toBe("gsk-env-token");
  });

  it("prompts for key when no env token and no opts token", async () => {
    const agentDir = await setupTempState();
    resetGroqEnv();

    const text = vi.fn(async () => "gsk-prompted-token");
    const confirm = vi.fn(async () => false);
    const note = vi.fn(async () => {});

    const result = await applyAuthChoiceGroq({
      authChoice: "groq-api-key",
      config: {},
      prompter: createGroqPrompter({ text, confirm, note }),
      runtime: createExitThrowingRuntime(),
      setDefaultModel: true,
    });

    expect(result).not.toBeNull();
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Enter Groq API key" }),
    );
    expect(confirm).toHaveBeenCalled();

    const parsed = await readAuthProfiles(agentDir);
    expect(parsed.profiles?.["groq:default"]?.key).toBe("gsk-prompted-token");
  });

  it("shows note with Groq information", async () => {
    const agentDir = await setupTempState();
    resetGroqEnv();

    const note = vi.fn(async () => {});
    const text = vi.fn(async () => "gsk-note-token");
    const confirm = vi.fn(async () => false);

    const prompter = createGroqPrompter({ text, confirm, note });

    const result = await applyAuthChoiceGroq({
      authChoice: "groq-api-key",
      config: {},
      prompter,
      runtime: createExitThrowingRuntime(),
      setDefaultModel: true,
    });

    expect(result).not.toBeNull();
    expect(note).toHaveBeenCalledWith(
      expect.stringContaining("Groq provides ultra-fast inference"),
      "Groq",
    );
  });

  it("does not override default model when setDefaultModel is false", async () => {
    const agentDir = await setupTempState();
    resetGroqEnv();

    const text = vi.fn(async () => "gsk-test-token");
    const confirm = vi.fn(async () => false);
    const note = vi.fn(async () => {});

    const result = await applyAuthChoiceGroq({
      authChoice: "groq-api-key",
      config: {
        agents: {
          defaults: {
            model: { primary: "anthropic/claude-sonnet-4-6" },
          },
        },
      },
      prompter: createGroqPrompter({ text, confirm, note }),
      runtime: createExitThrowingRuntime(),
      setDefaultModel: false,
    });

    expect(result).not.toBeNull();
    expect(resolveAgentModelPrimaryValue(result?.config.agents?.defaults?.model)).toBe(
      "anthropic/claude-sonnet-4-6",
    );
    expect(result?.agentModelOverride).toBe("groq/llama3-70b-8192");
  });

  it("handles empty token gracefully", async () => {
    const agentDir = await setupTempState();
    resetGroqEnv();

    const text = vi.fn(async () => "");
    const confirm = vi.fn(async () => false);
    const note = vi.fn(async () => {});

    const result = await applyAuthChoiceGroq({
      authChoice: "groq-api-key",
      config: {},
      prompter: createGroqPrompter({ text, confirm, note }),
      runtime: createExitThrowingRuntime(),
      setDefaultModel: true,
    });

    expect(result).not.toBeNull();
    expect(text).toHaveBeenCalled();
    
    const parsed = await readAuthProfiles(agentDir);
    expect(parsed.profiles?.["groq:default"]?.key).toBe("");
  });

  it("preserves existing auth profiles when adding Groq", async () => {
    const agentDir = await setupTempState();
    resetGroqEnv();

    // Crear un perfil existente primero
    const existingConfig = {
      auth: {
        profiles: {
          "anthropic:default": {
            provider: "anthropic",
            mode: "api_key",
          },
        },
      },
    };

    const text = vi.fn(async () => "gsk-test-token");
    const confirm = vi.fn(async () => false);
    const note = vi.fn(async () => {});

    const result = await applyAuthChoiceGroq({
      authChoice: "groq-api-key",
      config: existingConfig,
      prompter: createGroqPrompter({ text, confirm, note }),
      runtime: createExitThrowingRuntime(),
      setDefaultModel: true,
    });

    expect(result).not.toBeNull();
    expect(result?.config.auth?.profiles?.["anthropic:default"]).toBeDefined();
    expect(result?.config.auth?.profiles?.["groq:default"]).toBeDefined();
  });
});
