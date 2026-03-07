import { describe, expect, it } from "bun:test";
import { detectGitConnectPrompt } from "./project-files.ts";

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
