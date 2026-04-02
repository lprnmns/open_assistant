from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


REPO_ROOT = Path(__file__).resolve().parent.parent
LANDING_DIR = REPO_ROOT / "landing"
BENCHMARK_JSON = REPO_ROOT / "benchmarks" / "nontechnical-comparison-tr-2026-04-01.json"
OUTPUT_GIF = LANDING_DIR / "demo.gif"

WIDTH = 1100
HEIGHT = 720
PADDING_X = 56
PADDING_Y = 44
LINE_HEIGHT = 34

BG = "#090d1f"
PANEL = "#10172f"
BORDER = "#2a335a"
TEXT = "#f7f9ff"
MUTED = "#8d9ab9"
ACCENT = "#6d6bff"
PASS = "#38d39f"
FAIL = "#ff7f96"
CMD = "#ffd479"


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = []
    if bold:
        candidates.extend([Path("C:/Windows/Fonts/consolab.ttf"), Path("C:/Windows/Fonts/lucon.ttf")])
    else:
        candidates.extend([Path("C:/Windows/Fonts/consola.ttf"), Path("C:/Windows/Fonts/lucon.ttf")])
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


FONT_TITLE = load_font(34, bold=True)
FONT_LABEL = load_font(22, bold=True)
FONT_BODY = load_font(22)
FONT_SMALL = load_font(18)


def read_benchmark() -> dict:
    return json.loads(BENCHMARK_JSON.read_text(encoding="utf-8"))


def find_scenario(data: dict, scenario_id: str) -> dict:
    for scenario in data["scenarios"]:
        if scenario["id"] == scenario_id:
            return scenario
    raise KeyError(f"Missing scenario: {scenario_id}")


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_block(
    draw: ImageDraw.ImageDraw,
    *,
    x: int,
    y: int,
    label: str,
    lines: Iterable[str],
    label_color: str = MUTED,
    body_color: str = TEXT,
) -> int:
    draw.text((x, y), label, font=FONT_LABEL, fill=label_color)
    y += 34
    for line in lines:
        draw.text((x, y), line, font=FONT_BODY, fill=body_color)
        y += LINE_HEIGHT
    return y


def make_canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((24, 24, WIDTH - 24, HEIGHT - 24), radius=20, fill=PANEL, outline=BORDER, width=2)
    return image, draw


def add_header(draw: ImageDraw.ImageDraw, title: str, subtitle: str, scene_tag: str) -> int:
    draw.text((PADDING_X, PADDING_Y), "Open Assistant Terminal Proof Tour", font=FONT_TITLE, fill=TEXT)
    draw.text((WIDTH - 180, PADDING_Y + 8), scene_tag, font=FONT_SMALL, fill=ACCENT)
    draw.text((PADDING_X, PADDING_Y + 54), title, font=FONT_LABEL, fill=ACCENT)
    draw.text((PADDING_X, PADDING_Y + 88), subtitle, font=FONT_SMALL, fill=MUTED)
    return PADDING_Y + 138


def intro_scene() -> Image.Image:
    image, draw = make_canvas()
    y = add_header(
        draw,
        "Same model. Better continuity.",
        "A five-scene walkthrough built from benchmark and runtime evidence.",
        "INTRO",
    )
    lines = [
        "$ benchmark lane: OpenAI Codex / gpt-5.4",
        "$ result: Open Assistant 10/12 | OpenClaw 8/12",
        "$ strongest differences: H05 delayed note recall, H08 distraction resistance",
        "$ runtime guardrails: owner drain, third-party no-auto-reply, quiet no-op ticks",
    ]
    draw_block(draw, x=PADDING_X, y=y, label="tour", lines=lines, label_color=CMD)
    draw.text((PADDING_X, HEIGHT - 86), "This GIF uses real benchmark outputs and verified runtime behaviors.", font=FONT_SMALL, fill=MUTED)
    return image


def benchmark_scene(scene_tag: str, title: str, prompt: str, oa: str, oc: str, oc_note: str) -> Image.Image:
    image, draw = make_canvas()
    y = add_header(draw, title, "Prompt benchmark evidence (same model A/B).", scene_tag)
    prompt_lines = wrap(draw, prompt, FONT_BODY, WIDTH - PADDING_X * 2 - 24)
    prompt_bottom = y + 52 + len(prompt_lines) * LINE_HEIGHT
    draw.rounded_rectangle((PADDING_X, y, WIDTH - PADDING_X, prompt_bottom), radius=14, fill="#0d1429", outline=BORDER, width=1)
    draw_block(draw, x=PADDING_X + 18, y=y + 16, label="user prompt", lines=prompt_lines, label_color=CMD)
    y = prompt_bottom + 22

    col_gap = 24
    col_width = (WIDTH - PADDING_X * 2 - col_gap) // 2
    left_box = (PADDING_X, y, PADDING_X + col_width, HEIGHT - 84)
    right_box = (PADDING_X + col_width + col_gap, y, WIDTH - PADDING_X, HEIGHT - 84)
    draw.rounded_rectangle(left_box, radius=16, fill="#0b1225", outline=BORDER, width=1)
    draw.rounded_rectangle(right_box, radius=16, fill="#0b1225", outline=BORDER, width=1)

    left_x = left_box[0] + 18
    right_x = right_box[0] + 18
    draw_block(draw, x=left_x, y=y + 16, label="OpenClaw", lines=wrap(draw, oc, FONT_BODY, col_width - 36), label_color=MUTED, body_color=FAIL)
    draw.text((left_x, HEIGHT - 116), oc_note, font=FONT_SMALL, fill=MUTED)

    draw_block(draw, x=right_x, y=y + 16, label="Open Assistant", lines=wrap(draw, oa, FONT_BODY, col_width - 36), label_color=ACCENT, body_color=PASS)
    draw.text((right_x, HEIGHT - 116), "Clean recall, no extra junk.", font=FONT_SMALL, fill=MUTED)
    return image


def runtime_scene(scene_tag: str, title: str, command: str, verification: str, explanation: str) -> Image.Image:
    image, draw = make_canvas()
    y = add_header(draw, title, "Runtime capability verified in tests, not prompt A/B.", scene_tag)
    y = draw_block(draw, x=PADDING_X, y=y, label="$ command", lines=wrap(draw, command, FONT_BODY, WIDTH - PADDING_X * 2), label_color=CMD)
    y += 18
    y = draw_block(draw, x=PADDING_X, y=y, label="verified behavior", lines=wrap(draw, verification, FONT_BODY, WIDTH - PADDING_X * 2), label_color=ACCENT, body_color=PASS)
    y += 18
    draw_block(draw, x=PADDING_X, y=y, label="why it matters", lines=wrap(draw, explanation, FONT_BODY, WIDTH - PADDING_X * 2), label_color=MUTED)
    draw.text((PADDING_X, HEIGHT - 84), "OpenClaw is intentionally not compared in this runtime lane.", font=FONT_SMALL, fill=MUTED)
    return image


def save_gif(frames: list[Image.Image]) -> None:
    durations = [1800, 2600, 2600, 2200, 2200, 2200]
    palette_frames = [frame.convert("P", palette=Image.Palette.ADAPTIVE) for frame in frames]
    palette_frames[0].save(
        OUTPUT_GIF,
        save_all=True,
        append_images=palette_frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )


def main() -> None:
    benchmark = read_benchmark()
    h05 = find_scenario(benchmark, "H05")
    h08 = find_scenario(benchmark, "H08")
    frames = [
        intro_scene(),
        benchmark_scene(
            "SCENE 1",
            "Delayed note recall",
            "User: What was that password and supplier time I mentioned?",
            h05["open_assistant"]["response"],
            h05["openclaw"]["response"],
            "Adds extra text and breaks the requested format.",
        ),
        benchmark_scene(
            "SCENE 2",
            "Distraction-resistant recall",
            "User: I think the password might be copper-valley. But what was the real one?",
            h08["open_assistant"]["response"],
            h08["openclaw"]["response"],
            "Drops the actual password under false information.",
        ),
        runtime_scene(
            "SCENE 3",
            "Owner event drain",
            "pnpm test -- src/consciousness/scheduler.test.ts -t \"owner event drained after SEND_MESSAGE is NOT re-injected on the next tick\"",
            "owner event drained after SEND_MESSAGE is NOT re-injected on the next tick",
            "The next cycle sees the event once, acts on it, then removes it instead of repeating it forever.",
        ),
        runtime_scene(
            "SCENE 4",
            "Third-party no-auto-reply",
            "pnpm test -- src/consciousness/loop.test.ts -t \"third_party_contact events are NEVER auto-drained after SEND_MESSAGE\"",
            "third_party_contact events survive; no automatic reply path opens without owner approval",
            "The assistant can read an outside message without turning into an uncontrolled auto-responder.",
        ),
        runtime_scene(
            "SCENE 5",
            "Quiet no-op ticks",
            "pnpm test -- src/consciousness/loop.test.ts -t \"wake:false tick (no LLM) passes eventBuffer through unchanged\"",
            "wake:false tick (no LLM) passes eventBuffer through unchanged",
            "Silent intervals keep the runtime alive without paying for unnecessary model calls.",
        ),
    ]
    OUTPUT_GIF.parent.mkdir(parents=True, exist_ok=True)
    save_gif(frames)
    print(f"Wrote {OUTPUT_GIF}")


if __name__ == "__main__":
    main()
