import { describe, expect, it } from "bun:test";
import {
  classifyGitConnectFailure,
  detectGitConnectPrompt,
  isUserVisibleProjectPath,
  resolveGitConnectFailureReason,
} from "./project-files.ts";

describe("detectGitConnectPrompt", () => {
  it("detects HTTPS username prompts", () => {
    const prompt = detectGitConnectPrompt("Username for 'https://github.com':");
    expect(prompt?.type).toBe("https_username");
  });

  it("detects HTTPS password prompts", () => {
    const prompt = detectGitConnectPrompt("Password for 'https://github.com':");
    expect(prompt?.type).toBe("https_password");
  });

  it("detects SSH passphrase prompts", () => {
    const prompt = detectGitConnectPrompt("Enter passphrase for key '/Users/test/.ssh/id_ed25519':");
    expect(prompt?.type).toBe("ssh_passphrase");
  });

  it("detects OTP prompts", () => {
    const prompt = detectGitConnectPrompt("Enter your one-time verification code:");
    expect(prompt?.type).toBe("otp");
  });

  it("detects yes/no prompts", () => {
    const prompt = detectGitConnectPrompt("Are you sure you want to continue connecting (yes/no)?");
    expect(prompt?.type).toBe("yes_no");
  });

  it("returns null for normal git output", () => {
    const prompt = detectGitConnectPrompt("From github.com:user/repo");
    expect(prompt).toBeNull();
  });
});

describe("classifyGitConnectFailure", () => {
  it("classifies missing SSH key errors", () => {
    const message = classifyGitConnectFailure("git@github.com: Permission denied (publickey).");
    expect(message).toContain("no usable SSH key");
  });

  it("classifies HTTPS auth errors", () => {
    const message = classifyGitConnectFailure("remote: Invalid username or password.");
    expect(message).toContain("HTTPS authentication failed");
  });

  it("falls back to generic message for unknown errors", () => {
    const message = classifyGitConnectFailure("fatal: unexpected transport error");
    expect(message).toBe("Git remote validation failed. Check credentials and try again.");
  });

  it("classifies repository not found errors", () => {
    const message = classifyGitConnectFailure("ERROR: Repository not found.");
    expect(message).toContain("Repository not found");
  });
});

describe("resolveGitConnectFailureReason", () => {
  it("overrides repository-not-found for SSH remotes with no agent identities", () => {
    const message = resolveGitConnectFailureReason({
      output: "ERROR: Repository not found.",
      remoteUrl: "git@github.com:owner/private-repo.git",
      sshAgentHasIdentities: false,
    });
    expect(message).toContain("no identities are loaded in ssh-agent");
  });

  it("returns ssh-specific guidance for repository-not-found on SSH remotes when agent state is inconclusive", () => {
    const message = resolveGitConnectFailureReason({
      output: "ERROR: Repository not found.",
      remoteUrl: "git@github.com:owner/private-repo.git",
      sshAgentHasIdentities: null,
    });
    expect(message).toContain("Repository not found or SSH authentication failed.");
  });
});

describe("isUserVisibleProjectPath", () => {
  it("hides agent-managed instruction files at the project root", () => {
    expect(isUserVisibleProjectPath("AGENTS.md")).toBe(false);
    expect(isUserVisibleProjectPath("CLAUDE.md")).toBe(false);
  });

  it("hides injected agent directories and their contents", () => {
    expect(isUserVisibleProjectPath(".agents")).toBe(false);
    expect(isUserVisibleProjectPath(".agents/skills/add-firebase/SKILL.md")).toBe(false);
    expect(isUserVisibleProjectPath(".claude/settings.local.json")).toBe(false);
  });

  it("keeps normal user project files visible", () => {
    expect(isUserVisibleProjectPath("app/page.tsx")).toBe(true);
    expect(isUserVisibleProjectPath(".env.local")).toBe(true);
  });
});
