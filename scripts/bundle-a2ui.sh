#!/usr/bin/env bash
set -euo pipefail

on_error() {
  echo "A2UI bundling failed. Re-run with: pnpm canvas:a2ui:bundle" >&2
  echo "If this persists, verify pnpm deps and try again." >&2
}
trap on_error ERR

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HASH_FILE="$ROOT_DIR/src/canvas-host/a2ui/.bundle.hash"
OUTPUT_FILE="$ROOT_DIR/src/canvas-host/a2ui/a2ui.bundle.js"
A2UI_RENDERER_DIR="$ROOT_DIR/vendor/a2ui/renderers/lit"
A2UI_APP_DIR="$ROOT_DIR/apps/shared/OpenClawKit/Tools/CanvasA2UI"

# Docker builds exclude vendor/apps via .dockerignore.
# In that environment we can keep a prebuilt bundle only if it exists.
if [[ ! -d "$A2UI_RENDERER_DIR" || ! -d "$A2UI_APP_DIR" ]]; then
  if [[ -f "$OUTPUT_FILE" ]]; then
    echo "A2UI sources missing; keeping prebuilt bundle."
    exit 0
  fi
  echo "A2UI sources missing and no prebuilt bundle found at: $OUTPUT_FILE" >&2
  exit 1
fi

INPUT_PATHS=(
  "$ROOT_DIR/package.json"
  "$ROOT_DIR/pnpm-lock.yaml"
  "$A2UI_RENDERER_DIR"
  "$A2UI_APP_DIR"
)

resolve_node_bin() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  normalize_windows_path_for_bash() {
    local candidate="$1"
    if [[ "$candidate" =~ ^([A-Za-z]):\\(.*)$ ]]; then
      local drive_letter="${BASH_REMATCH[1],,}"
      local remainder="${BASH_REMATCH[2]//\\//}"
      printf '/mnt/%s/%s\n' "$drive_letter" "$remainder"
      return 0
    fi
    printf '%s\n' "$candidate"
  }

  if command -v cmd.exe >/dev/null 2>&1; then
    local candidate
    candidate="$(
      cmd.exe /d /s /c "where node 2>NUL" 2>/dev/null \
        | tr -d '\r' \
        | head -n 1
    )"
    if [[ -n "$candidate" ]] && command -v cygpath >/dev/null 2>&1; then
      candidate="$(cygpath -u "$candidate" 2>/dev/null || printf '%s' "$candidate")"
    elif [[ -n "$candidate" ]]; then
      candidate="$(normalize_windows_path_for_bash "$candidate")"
    fi
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  return 1
}

NODE_BIN="$(resolve_node_bin || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "node: command not found" >&2
  exit 1
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"

to_native_node_path() {
  local candidate="$1"
  if [[ "$NODE_BIN" =~ \.exe$ ]]; then
    if command -v cygpath >/dev/null 2>&1; then
      cygpath -w "$candidate" 2>/dev/null && return 0
    fi
    if [[ "$candidate" =~ ^/mnt/([A-Za-z])/(.*)$ ]]; then
      local drive_letter="${BASH_REMATCH[1]^^}"
      local remainder="${BASH_REMATCH[2]//\//\\}"
      printf '%s:\\%s\n' "$drive_letter" "$remainder"
      return 0
    fi
  fi
  printf '%s\n' "$candidate"
}

ROOT_DIR_FOR_NODE="$(to_native_node_path "$ROOT_DIR")"
INPUT_PATHS_FOR_NODE=()
for input_path in "${INPUT_PATHS[@]}"; do
  INPUT_PATHS_FOR_NODE+=("$(to_native_node_path "$input_path")")
done

compute_hash() {
  ROOT_DIR="$ROOT_DIR_FOR_NODE" "$NODE_BIN" --input-type=module --eval '
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const rootDir = process.env.ROOT_DIR ?? process.cwd();
const inputs = process.argv.slice(1);
const files = [];

async function walk(entryPath) {
  const st = await fs.stat(entryPath);
  if (st.isDirectory()) {
    const entries = await fs.readdir(entryPath);
    for (const entry of entries) {
      await walk(path.join(entryPath, entry));
    }
    return;
  }
  files.push(entryPath);
}

for (const input of inputs) {
  await walk(input);
}

function normalize(p) {
  return p.split(path.sep).join("/");
}

files.sort((a, b) => normalize(a).localeCompare(normalize(b)));

const hash = createHash("sha256");
for (const filePath of files) {
  const rel = normalize(path.relative(rootDir, filePath));
  hash.update(rel);
  hash.update("\0");
  hash.update(await fs.readFile(filePath));
  hash.update("\0");
}

process.stdout.write(hash.digest("hex"));
' "${INPUT_PATHS_FOR_NODE[@]}"
}

current_hash="$(compute_hash)"
if [[ -f "$HASH_FILE" ]]; then
  previous_hash="$(cat "$HASH_FILE")"
  if [[ "$previous_hash" == "$current_hash" && -f "$OUTPUT_FILE" ]]; then
    echo "A2UI bundle up to date; skipping."
    exit 0
  fi
fi

"$NODE_BIN" "$(to_native_node_path "$ROOT_DIR/node_modules/typescript/bin/tsc")" \
  -p "$(to_native_node_path "$A2UI_RENDERER_DIR/tsconfig.json")"
if [[ -f "$ROOT_DIR/node_modules/rolldown/bin/cli.mjs" ]]; then
  "$NODE_BIN" "$(to_native_node_path "$ROOT_DIR/node_modules/rolldown/bin/cli.mjs")" \
    -c "$(to_native_node_path "$A2UI_APP_DIR/rolldown.config.mjs")"
elif [[ -f "$ROOT_DIR/node_modules/.pnpm/node_modules/rolldown/bin/cli.mjs" ]]; then
  "$NODE_BIN" "$(to_native_node_path "$ROOT_DIR/node_modules/.pnpm/node_modules/rolldown/bin/cli.mjs")" \
    -c "$(to_native_node_path "$A2UI_APP_DIR/rolldown.config.mjs")"
elif [[ -f "$ROOT_DIR/node_modules/.pnpm/rolldown@1.0.0-rc.9/node_modules/rolldown/bin/cli.mjs" ]]; then
  "$NODE_BIN" "$(to_native_node_path "$ROOT_DIR/node_modules/.pnpm/rolldown@1.0.0-rc.9/node_modules/rolldown/bin/cli.mjs")" \
    -c "$(to_native_node_path "$A2UI_APP_DIR/rolldown.config.mjs")"
else
  pnpm -s dlx rolldown -c "$A2UI_APP_DIR/rolldown.config.mjs"
fi

echo "$current_hash" > "$HASH_FILE"
