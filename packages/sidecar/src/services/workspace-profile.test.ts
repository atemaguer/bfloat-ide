import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildWorkspaceProfile, shouldBlockScaffoldCommand } from "./workspace-profile.ts";

const tempDirs: string[] = [];

function createTempWorkspace(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("workspace-profile", () => {
  it("detects existing expo workspace", () => {
    const cwd = createTempWorkspace("workspace-expo-");
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify(
        {
          name: "my-app",
          dependencies: {
            expo: "^52.0.0",
            react: "^19.0.0",
            "react-native": "^0.76.0",
          },
        },
        null,
        2
      )
    );
    fs.mkdirSync(path.join(cwd, "app"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "app", "index.tsx"), "export default function App() { return null }");

    const profile = buildWorkspaceProfile(cwd);
    expect(profile.isExistingApp).toBe(true);
    expect(profile.detectedFramework).toBe("expo");
  });

  it("marks tool-only workspace as effectively empty", () => {
    const cwd = createTempWorkspace("workspace-empty-");
    fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
    fs.mkdirSync(path.join(cwd, ".bfloat-ide"), { recursive: true });

    const profile = buildWorkspaceProfile(cwd);
    expect(profile.isEffectivelyEmpty).toBe(true);
    expect(profile.isExistingApp).toBe(false);
  });

  it("blocks scaffold commands in existing workspace only", () => {
    const existingCwd = createTempWorkspace("workspace-existing-");
    fs.writeFileSync(
      path.join(existingCwd, "package.json"),
      JSON.stringify({ dependencies: { expo: "^52.0.0" } }, null, 2)
    );
    const existingProfile = buildWorkspaceProfile(existingCwd);
    const blocked = shouldBlockScaffoldCommand(
      "npx create-expo-app@latest timer-app --template",
      existingProfile
    );
    expect(blocked.shouldBlock).toBe(true);

    const emptyCwd = createTempWorkspace("workspace-fresh-");
    const emptyProfile = buildWorkspaceProfile(emptyCwd);
    const allowed = shouldBlockScaffoldCommand(
      "npx create-expo-app@latest timer-app --template",
      emptyProfile
    );
    expect(allowed.shouldBlock).toBe(false);
  });

  it("classifies template-bootstrap workspaces as greenfield design mode", () => {
    const cwd = createTempWorkspace("workspace-template-origin-");
    fs.mkdirSync(path.join(cwd, ".bfloat-ide"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".bfloat-ide", "project-origin.json"),
      JSON.stringify({ origin: "template-bootstrap" }, null, 2)
    );
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ dependencies: { expo: "^52.0.0" } }, null, 2)
    );

    const profile = buildWorkspaceProfile(cwd);
    expect(profile.isTemplateBootstrap).toBe(true);
    expect(profile.designMode).toBe("greenfield-template");
  });

  it("classifies starter-template signature workspaces as greenfield without marker", () => {
    const cwd = createTempWorkspace("workspace-template-signature-");
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify(
        {
          name: "expo-template-default",
          scripts: {
            "reset-project": "node ./scripts/reset-project.js",
          },
          dependencies: { expo: "^52.0.0" },
        },
        null,
        2
      )
    );
    fs.mkdirSync(path.join(cwd, "app", "(tabs)"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "app", "(tabs)", "index.tsx"), "export default function Screen() { return null }");

    const profile = buildWorkspaceProfile(cwd);
    expect(profile.isTemplateBootstrap).toBe(true);
    expect(profile.designMode).toBe("greenfield-template");
    expect(profile.reasons).toContain("origin:template-bootstrap-signature");
  });

  it("classifies non-template workspaces as adapt-existing design mode", () => {
    const cwd = createTempWorkspace("workspace-imported-origin-");
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ dependencies: { next: "^15.0.0" } }, null, 2)
    );

    const profile = buildWorkspaceProfile(cwd);
    expect(profile.isTemplateBootstrap).toBe(false);
    expect(profile.designMode).toBe("adapt-existing");
  });
});
