/**
 * issue #2: 스타일 추출값과 사용자 입력 키워드의 병합 규칙
 *
 * 온보딩에서 두 단계가 있다:
 * 1. "레퍼런스 제공" — 이미지에서 자동 추출 (StyleExtractionResult)
 * 2. "레퍼런스 건너뛰기" — 사용자 키워드만 입력 (userKeywords)
 *
 * mergeStyleValues는 둘을 합쳐서 최종 style 값을 결정한다.
 * - 사용자 키워드가 있으면 우선
 * - 키워드 없으면 추출값 사용
 * - 둘 다 없으면 기본값
 */

import presetSchema from "@/spec/preset.schema.json";

export interface StyleExtractionResult {
  line_weight: "thin" | "medium" | "thick";
  saturation: "pastel" | "vivid" | "muted";
  character_ratio: "2head" | "2.5head" | "3head" | "realistic";
  background_density: "none" | "low" | "medium" | "high";
  bubble_style: "rounded" | "rect" | "cloud";
  palette: string[];
}

export interface MergedStyleResult {
  line_weight: "thin" | "medium" | "thick";
  saturation: "pastel" | "vivid" | "muted";
  character_ratio: "2head" | "2.5head" | "3head" | "realistic";
  background_density: "none" | "low" | "medium" | "high";
  bubble_style: "rounded" | "rect" | "cloud";
  palette: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getEnumAt(pathParts: string[]): string[] {
  let node: unknown = presetSchema;
  for (const part of pathParts) {
    if (!isRecord(node)) return [];
    node = node[part];
  }
  if (isRecord(node) && Array.isArray(node.enum)) {
    return node.enum.filter((v): v is string => typeof v === "string");
  }
  return [];
}

// preset.schema.json에서 enum 값들을 읽음
const VALID = {
  line_weight: getEnumAt(["properties", "style", "properties", "line_weight"]),
  saturation: getEnumAt(["properties", "style", "properties", "saturation"]),
  character_ratio: getEnumAt(["properties", "style", "properties", "character_ratio"]),
  background_density: getEnumAt(["properties", "style", "properties", "background_density"]),
  bubble_style: getEnumAt(["properties", "style", "properties", "bubble_style"]),
};

const DEFAULT_STYLE_VALUES: MergedStyleResult = {
  line_weight: "medium",
  saturation: "pastel",
  character_ratio: "2head",
  background_density: "low",
  bubble_style: "rounded",
  palette: ["#4A90E2", "#50C878", "#FFD700", "#FF6B6B"],
};

/**
 * 추출된 스타일과 사용자 키워드를 병합해 최종 스타일을 반환한다.
 *
 * 규칙:
 * 1. 사용자 키워드에서 유효한 enum 값을 찾으면 그것을 사용
 * 2. 키워드가 없으면 추출값 사용
 * 3. 둘 다 없으면 기본값
 * 4. 팔레트는 추출값 우선 (사용자 키워드에서 HEX 색을 추출하기 어려움)
 */
export function mergeStyleValues(
  extracted: StyleExtractionResult | null,
  userKeywords: string[]
): MergedStyleResult {
  // 추출값이 없으면 기본값 사용
  if (!extracted) {
    return {
      ...DEFAULT_STYLE_VALUES,
    };
  }

  // 사용자 키워드에서 enum 값을 찾는 헬퍼
  const findKeywordMatch = <T extends string>(
    keywords: string[],
    validValues: string[]
  ): T | undefined => {
    for (const keyword of keywords) {
      if (validValues.includes(keyword)) {
        return keyword as T;
      }
    }
    return undefined;
  };

  // 사용자 키워드가 있으면 우선, 없으면 추출값 사용
  const line_weight = (
    findKeywordMatch(userKeywords, VALID.line_weight) ||
    extracted.line_weight ||
    DEFAULT_STYLE_VALUES.line_weight
  ) as "thin" | "medium" | "thick";

  const saturation = (
    findKeywordMatch(userKeywords, VALID.saturation) ||
    extracted.saturation ||
    DEFAULT_STYLE_VALUES.saturation
  ) as "pastel" | "vivid" | "muted";

  const character_ratio = (
    findKeywordMatch(userKeywords, VALID.character_ratio) ||
    extracted.character_ratio ||
    DEFAULT_STYLE_VALUES.character_ratio
  ) as "2head" | "2.5head" | "3head" | "realistic";

  const background_density = (
    findKeywordMatch(userKeywords, VALID.background_density) ||
    extracted.background_density ||
    DEFAULT_STYLE_VALUES.background_density
  ) as "none" | "low" | "medium" | "high";

  const bubble_style = (
    findKeywordMatch(userKeywords, VALID.bubble_style) ||
    extracted.bubble_style ||
    DEFAULT_STYLE_VALUES.bubble_style
  ) as "rounded" | "rect" | "cloud";

  // 팔레트는 추출값 우선
  const palette = extracted.palette || DEFAULT_STYLE_VALUES.palette;

  return {
    line_weight,
    saturation,
    character_ratio,
    background_density,
    bubble_style,
    palette,
  };
}
