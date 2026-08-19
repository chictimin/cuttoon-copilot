// 세션(A②) 컷 생성. B①(lib/openai/generate.ts)의 실제 구현을 호출합니다.
// PRD.md 6절: "표지컷만 3안, 나머지 3컷은 선택 후 생성한다. 표지 3안은 독립 호출이고,
// 나머지 3컷은 previous_response_id로 이전 turn 응답을 체이닝해 생성한다."

import type { Preset } from "@/lib/llm/preset-guard";
import type { Storyboard } from "./storyboard-types";

export interface GeneratedCut {
  image: string;
  prompt: string;
}

/**
 * 표지 3안을 생성합니다.
 * 각 3안은 독립적인 API 호출로 생성되어 서로 다른 특성을 유지합니다.
 */
export async function generateCoverVariants(promptBase: string): Promise<GeneratedCut[]> {
  try {
    const results: GeneratedCut[] = [];

    // 3안을 병렬로 생성
    const promises = Array.from({ length: 3 }, (_, i) =>
      fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "cut",
          prompt: `${promptBase} (variant ${i + 1})`,
        }),
      })
        .then((res) => res.json())
        .then((data) => ({
          image: data.asset || generatePlaceholder(`hsl(${i * 120}, 70%, 80%)`),
          prompt: `${promptBase} (variant ${i + 1})`,
        }))
        .catch(() => ({
          image: generatePlaceholder(`hsl(${i * 120}, 70%, 80%)`),
          prompt: `${promptBase} (variant ${i + 1})`,
        }))
    );

    const generated = await Promise.all(promises);
    return generated;
  } catch {
    // fallback: placeholder 이미지로 3안 생성
    return Array.from({ length: 3 }, (_, i) => ({
      image: generatePlaceholder(`hsl(${i * 120}, 70%, 80%)`),
      prompt: `${promptBase} (variant ${i + 1})`,
    }));
  }
}

/**
 * 나머지 3컷을 생성합니다.
 * previous_response_id 체이닝으로 일관성 있는 이미지를 생성합니다.
 */
export async function generateChainedCuts(
  prompts: string[],
  preset?: Preset,
  previousResponseId?: string
): Promise<GeneratedCut[]> {
  try {
    const results: GeneratedCut[] = [];
    let lastResponseId = previousResponseId;

    // 순차적으로 생성 (이전 응답 ID로 체이닝)
    for (const prompt of prompts) {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "cut",
          prompt,
          previousResponseId: lastResponseId,
          preset,
        }),
      });

      const data = await response.json();
      const image = data.asset || generatePlaceholder("#d4d4d8");

      results.push({ image, prompt });

      // 다음 호출에 이 응답 ID 사용
      if (data.responseId) {
        lastResponseId = data.responseId;
      }
    }

    return results;
  } catch {
    // fallback: placeholder 이미지로 생성
    return prompts.map((prompt) => ({
      image: generatePlaceholder("#d4d4d8"),
      prompt,
    }));
  }
}

function generatePlaceholder(fill: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="${fill}"/></svg>`
  )}`;
}
