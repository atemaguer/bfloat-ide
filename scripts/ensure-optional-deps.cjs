const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
const args = [
  "list",
  "-a",
  "--include",
  "prod",
  "--include",
  "optional",
  "--omit",
  "dev",
  "--json",
  "--long",
  "--silent",
];

const child = spawn(cmd, args, {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
  shell: process.platform === "win32"
});

let stdout = "";
let stderr = "";

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

child.on("close", (code) => {
  const hasOutput = stdout.trim().length > 0;
  if (code !== 0 && !hasOutput) {
    console.error(stderr.trim() || "npm list failed");
    process.exit(code ?? 1);
  }

  let tree;
  try {
    tree = JSON.parse(stdout);
  } catch (error) {
    console.error("Failed to parse npm list output.");
    process.exit(1);
  }

  const missing = new Map();

  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.path && typeof node.path === "string") {
      if (!fs.existsSync(node.path)) {
        const key = node.path;
        if (!missing.has(key)) {
          missing.set(key, { name: node.name, version: node.version });
        }
      }
    }
    if (node.dependencies && typeof node.dependencies === "object") {
      for (const dep of Object.values(node.dependencies)) {
        visit(dep);
      }
    }
  };

  visit(tree);

  if (missing.size === 0) {
    return;
  }

  for (const [dir, meta] of missing.entries()) {
    fs.mkdirSync(dir, { recursive: true });
    const pkgPath = path.join(dir, "package.json");
    if (!fs.existsSync(pkgPath)) {
      fs.writeFileSync(
        pkgPath,
        JSON.stringify(
          {
            name: meta.name || path.basename(dir),
            version: meta.version || "0.0.0",
            optional: true,
          },
          null,
          2
        )
      );
    }
  }
});
