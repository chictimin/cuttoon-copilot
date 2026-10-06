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

/** 어느 프리셋에서 읽은 폰트인지 함께 들고 있는다 — 프로젝트가 바뀌면 이전 폰트를 쓰지 않으려고. */
interface LoadedFont {
  presetId: string;
  font: PresetFont;
}

/**
 * presetId의 프로젝트 폰트를 문서에 주입하고, 말풍선에 쓸 font-family 값을 돌려준다.
 * 폰트가 없거나 아직 못 읽었으면 undefined(현행 스타일 그대로).
 *
 * 읽은 폰트는 읽은 presetId와 함께 보관하고, 지금 presetId와 같을 때만 쓴다. presetId가
 * 바뀌는 즉시 이전에 읽은 폰트를 비운다 — 다른 프로젝트로 갔다가 같은 프로젝트로 돌아와도
 * 새 조회가 끝나기 전에는 폰트 없음(undefined)이다. 새 조회가 실패하거나 폰트가 없거나
 * 모양이 어긋나도 폰트 없음이다(#246 리뷰).
 */
export function useProjectFont(presetId: string | null): string | undefined {
  const [loaded, setLoaded] = useState<LoadedFont | null>(null);
  // presetId가 바뀐 렌더에서 곧바로 비운다(props 변화에 따른 상태 초기화 — effect 안에서 동기적으로
  // setState하지 않는다). A→B→A, A→없음→A에서 이전에 읽은 A가 조회 전에 다시 쓰이는 것을 막는다.
  const [trackedPresetId, setTrackedPresetId] = useState(presetId);
  if (trackedPresetId !== presetId) {
    setTrackedPresetId(presetId);
    setLoaded(null);
  }
  const font =
    presetId !== null && trackedPresetId === presetId && loaded?.presetId === presetId
      ? loaded.font
      : null;

  useEffect(() => {
    if (!presetId) return;
    let cancelled = false;

    (async () => {
      let found: PresetFont | null = null;
      try {
        const res = await fetch(`/api/preset?id=${encodeURIComponent(presetId)}`);
        if (res.ok) {
          const data = (await res.json()) as { preset?: { assets?: { font?: unknown } } };
          const candidate = data.preset?.assets?.font;
          if (isPresetFont(candidate)) found = candidate;
        }
      } catch {
        // 폰트 때문에 에디터가 막히지 않는다 — 폰트 없음으로 계속한다.
      }
      // 이 요청이 아직 현재 프로젝트의 것일 때만 반영한다. 실패·폰트 없음도 null로 덮어써서
      // 같은 프로젝트로 돌아왔을 때 오래된 값이 남지 않게 한다.
      if (!cancelled) setLoaded(found ? { presetId, font: found } : null);
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
