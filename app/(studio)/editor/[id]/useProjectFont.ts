"use client";

import { useEffect, useState } from "react";
import type { PresetFont } from "@/lib/llm/preset-guard";

// issue #209: 프로젝트 폰트(preset.assets.font)를 에디터 말풍선에도 쓴다. Export가 같은
// 폰트로 그리므로(#236) 에디터가 시스템 폰트로 보이면 두 결과가 달라 보인다.
//
// - 저장된 kind만 믿는다. url 모양으로 css/file을 추측하지 않는다(#209 결정).
//   css → <link rel="stylesheet">, file → @font-face(font-display: swap).
// - 프리셋 조회가 실패하거나 폰트가 없으면 아무것도 하지 않는다 — 현행(폰트 지정 없음)과
//   같다. 폰트 때문에 에디터가 막히지 않는다.
// - 서버가 프리셋 저장 때 assertValidPreset으로 검사하지만, 여기서도 모양을 한 번 더 확인한다.

function isPresetFont(value: unknown): value is PresetFont {
  if (typeof value !== "object" || value === null) return false;
  const font = value as Record<string, unknown>;
  return (
    typeof font.family === "string" &&
    font.family.length > 0 &&
    typeof font.url === "string" &&
    font.url.startsWith("https://") &&
    (font.kind === "css" || font.kind === "file")
  );
}

/** CSS 문자열 리터럴 안에 안전하게 넣을 값. 역슬래시·따옴표를 이스케이프하고 제어 문자는 뺀다. */
function cssString(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "");
  return `"${cleaned.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function createFontElement(font: PresetFont): HTMLLinkElement | HTMLStyleElement {
  if (font.kind === "css") {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = font.url;
    return link;
  }
  const style = document.createElement("style");
  style.textContent =
    `@font-face { font-family: ${cssString(font.family)}; ` +
    `src: url(${cssString(font.url)}); font-display: swap; }`;
  return style;
}

/**
 * presetId의 프로젝트 폰트를 문서에 주입하고, 말풍선에 쓸 font-family 값을 돌려준다.
 * 폰트가 없거나 아직 못 읽었으면 undefined(현행 스타일 그대로).
 */
export function useProjectFont(presetId: string | null): string | undefined {
  const [font, setFont] = useState<PresetFont | null>(null);

  useEffect(() => {
    if (!presetId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/preset?id=${encodeURIComponent(presetId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { preset?: { assets?: { font?: unknown } } };
        const found = data.preset?.assets?.font;
        if (!cancelled && isPresetFont(found)) setFont(found);
      } catch {
        // 폰트 때문에 에디터가 막히지 않는다 — 현행 폰트로 계속한다.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [presetId]);

  useEffect(() => {
    if (!font) return;
    const element = createFontElement(font);
    document.head.appendChild(element);
    return () => element.remove();
  }, [font]);

  return font ? `${cssString(font.family)}, sans-serif` : undefined;
}
