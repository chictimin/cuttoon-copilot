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

const ENUM_FIELDS = [
  "line_weight",
  "saturation",
  "character_ratio",
  "background_density",
  "bubble_style",
] as const;

/** 앞에서부터 첫 정확 일치의 입력 인덱스 — merge 경로와 소비 판정의 공유 규칙. */
function findFirstEnumMatchIndex(keywords: string[], validValues: string[]): number {
  return keywords.findIndex((keyword) => validValues.includes(keyword));
}

/** 앞에서부터 첫 정확 일치 1개 — mergeStyleValues와 appliedEnumKeywords의 공유 규칙. */
function findFirstEnumMatch(keywords: string[], validValues: string[]): string | undefined {
  const index = findFirstEnumMatchIndex(keywords, validValues);
  return index === -1 ? undefined : keywords[index];
}

/**
 * enum으로 실제 소비된 입력 인덱스 목록 (B2 재작업).
 *
 * enum 필드 5개 각각에서 mergeStyleValues와 같은 규칙(앞에서부터 첫 정확
 * 일치)으로 고른 입력 위치를 모은 배열(중복 제거, 오름차순). 같은 문자열이
 * 두 번 나와도 첫 위치만 소비된다.
 */
export function appliedEnumKeywordIndices(userKeywords: string[]): number[] {
  const indices: number[] = [];
  for (const field of ENUM_FIELDS) {
    const index = findFirstEnumMatchIndex(userKeywords, VALID[field]);
    if (index !== -1 && !indices.includes(index)) {
      indices.push(index);
    }
  }
  indices.sort((a, b) => a - b);
  return indices;
}

/**
 * enum으로 실제 적용된 키워드 목록 (spec-b2 3-1).
 *
 * enum 필드 5개 각각에서 mergeStyleValues와 같은 규칙(앞에서부터 첫 정확
 * 일치 1개)으로 고른 키워드를 모은 배열(중복 제거, 입력 순서). 같은 필드의
 * 두 번째 이후 enum 단어는 적용되지 않았으므로 포함하지 않는다.
 */
export function appliedEnumKeywords(userKeywords: string[]): string[] {
  const picked: string[] = [];
  for (const index of appliedEnumKeywordIndices(userKeywords)) {
    const keyword = userKeywords[index];
    if (!picked.includes(keyword)) {
      picked.push(keyword);
    }
  }
  return picked;
}

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
  // 사용자 키워드에서 enum 값을 찾는 헬퍼
  const findKeywordMatch = <T extends string>(
    keywords: string[],
    validValues: string[]
  ): T | undefined => findFirstEnumMatch(keywords, validValues) as T | undefined;

  // 사용자 키워드가 있으면 우선, 없으면 추출값(또는 기본값) 사용
  const line_weight = (
    findKeywordMatch(userKeywords, VALID.line_weight) ||
    extracted?.line_weight ||
    DEFAULT_STYLE_VALUES.line_weight
  ) as "thin" | "medium" | "thick";

  const saturation = (
    findKeywordMatch(userKeywords, VALID.saturation) ||
    extracted?.saturation ||
    DEFAULT_STYLE_VALUES.saturation
  ) as "pastel" | "vivid" | "muted";

  const character_ratio = (
    findKeywordMatch(userKeywords, VALID.character_ratio) ||
    extracted?.character_ratio ||
    DEFAULT_STYLE_VALUES.character_ratio
  ) as "2head" | "2.5head" | "3head" | "realistic";

  const background_density = (
    findKeywordMatch(userKeywords, VALID.background_density) ||
    extracted?.background_density ||
    DEFAULT_STYLE_VALUES.background_density
  ) as "none" | "low" | "medium" | "high";

  const bubble_style = (
    findKeywordMatch(userKeywords, VALID.bubble_style) ||
    extracted?.bubble_style ||
    DEFAULT_STYLE_VALUES.bubble_style
  ) as "rounded" | "rect" | "cloud";

  // 팔레트: 추출값 우선, 없으면 기본값
  const palette = extracted?.palette || DEFAULT_STYLE_VALUES.palette;

  return {
    line_weight,
    saturation,
    character_ratio,
    background_density,
    bubble_style,
    palette,
  };
}
