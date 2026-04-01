#!/usr/bin/env bash
# scripts/capture-demo.sh — Open Assistant terminal demo capture
#
# Prerequisites (install once):
#   cargo install --git https://github.com/asciinema/asciinema   (or: pip install asciinema)
#   cargo install --git https://github.com/asciinema/agg
#
# Usage:
#   bash scripts/capture-demo.sh
#
# Output:
#   landing/demo.cast   — raw asciinema recording
#   landing/demo.gif    — exported GIF (ready for embedding)
#
# The recording should cover these 5 scenes in order:
#   1. Note recall         — H05: password + supplier time recall
#   2. Distraction resist  — H08: copper-valley false inject, real note held
#   3. Owner event drain   — scheduler: event in, action taken, not repeated on tick 2
#   4. Third-party guard   — loop: external msg read, no auto-reply without owner
#   5. Quiet no-op tick    — loop: no event → no LLM call
#
# Recommended terminal size: 120x30 (set before recording)
# Recommended idle timeout:  2s  (--idle-time-limit 2)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAST_PATH="$REPO_ROOT/landing/demo.cast"
GIF_PATH="$REPO_ROOT/landing/demo.gif"

echo "=== Open Assistant Demo Capture ==="
echo "Cast output: $CAST_PATH"
echo "GIF  output: $GIF_PATH"
echo ""
echo "Ensure the system is running (pnpm dev or scheduler started) before proceeding."
echo "Terminal size: resize to 120x30 for best results."
echo ""
read -r -p "Press Enter to start asciinema recording (Ctrl-D or 'exit' to stop)..."

# Record
asciinema rec \
  --idle-time-limit 2 \
  --title "Open Assistant — Consciousness Runtime Demo" \
  "$CAST_PATH"

echo ""
echo "Recording complete: $CAST_PATH"
echo "Exporting GIF..."

# Export GIF
agg \
  --speed 1.5 \
  --font-size 14 \
  --cols 120 \
  --rows 30 \
  "$CAST_PATH" \
  "$GIF_PATH"

echo "GIF exported: $GIF_PATH"
echo ""
echo "Next step: commit landing/demo.cast and landing/demo.gif, then update CTA section."
