import { describe, expect, it } from "bun:test";

import { translateFrameToMessage } from "./agent-message.ts";

describe("translateFrameToMessage", () => {
  it("keeps canonical app session IDs in init messages while exposing providerSessionId separately", () => {
    const translated = translateFrameToMessage({
      type: "init",
      sessionId: "app-session-1",
      seq: 3,
      ts: "2026-03-11T12:00:00.000Z",
      payload: {
        realSessionId: "provider-session-1",
        availableTools: ["Bash"],
        model: "gpt-5.3-codex",
      },
    });

    expect(translated.type).toBe("init");
    expect(translated.content).toEqual({
      sessionId: "app-session-1",
      providerSessionId: "provider-session-1",
      availableTools: ["Bash"],
      model: "gpt-5.3-codex",
    });
    expect(translated.metadata?.seq).toBe(3);
  });
});
