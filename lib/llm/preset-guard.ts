// issue #5: 프리셋 전체 타입가드 (필수 필드 · 패턴 · enum). ajv 없이 손으로 짠 가드.
// enum 값 목록은 preset.schema.json에서 직접 읽어온다 — 여기 하드코딩된 건 TS 타입(컴파일 타임
// 전용, 런타임엔 사라짐)뿐이고, 이건 스키마가 바뀌면 사람이 같이 고쳐야 한다는 걸 뜻한다.
// (vocabulary.json ↔ storyboard.schema.json과 같은 종류의 수동 동기화 리스크 — spec/sync-check.mjs
// 참고. 이 파일의 타입도 그 스크립트 점검 대상에 넣는 걸 고려할 것.)
//
// 검증 범위: 최상위 6개 키의 additionalProperties만 재현한다. assets/style/rules/context
// 서브객체 4곳에도 스키마엔 additionalProperties:false가 걸려 있지만 여기선 안 잡는다(예:
// style.line_width처럼 오타난 필드가 이 가드는 통과함). uniqueItems(스키마 9곳)도 미검증.
// 가드의 목적이 LLM 출력의 큰 형태 오류를 잡는 것이라 오타 필드까지는 지금 급하지 않다고 판단.

import presetSchema from "@/spec/preset.schema.json";
import vocabulary from "@/spec/vocabulary.json";
import { isValidCtaId, type Interest } from "./cta-presets";

export type { Interest };
export type LineWeight = "thin" | "medium" | "thick";
export type Saturation = "pastel" | "vivid" | "muted";
export type CharacterRatio = "2head" | "2.5head" | "3head" | "realistic";
export type BackgroundDensity = "none" | "low" | "medium" | "high";
export type BubbleStyle = "rounded" | "rect" | "cloud";
export type AgeBand = "10s" | "20s" | "30s" | "40s" | "50s" | "60s_plus";
export type LifeStage =
  | "student"
  | "job_seeker"
  | "early_career"
  | "parent"
  | "business_owner"
  | "retired";

export interface Preset {
  preset_version: "1.1";
  project_name: string;
  assets: {
    character_sheet: string;
    style_refs: string[];
    reference_asset_ids: string[];
  };
  style: {
    keywords: string[];
    line_weight: LineWeight;
    palette: string[];
    saturation: Saturation;
    character_ratio: CharacterRatio;
    background_density: BackgroundDensity;
    bubble_style: BubbleStyle;
  };
  rules: {
    forbidden: string[];
    cta_format: string;
  };
  context: {
    industry: string[];
    interests: Interest[];
    age_band: AgeBand[];
    life_stage: LifeStage[];
    main_subjects: string[];
  };
}

const ASSET_URI_PATTERN = /^asset:\/\//;
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

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

// 런타임 검증에 실제로 쓰는 값 목록은 스키마에서 읽는다(하드코딩 아님)
const VALID = {
  line_weight: getEnumAt(["properties", "style", "properties", "line_weight"]),
  saturation: getEnumAt(["properties", "style", "properties", "saturation"]),
  character_ratio: getEnumAt(["properties", "style", "properties", "character_ratio"]),
  background_density: getEnumAt([
    "properties",
    "style",
    "properties",
    "background_density",
  ]),
  bubble_style: getEnumAt(["properties", "style", "properties", "bubble_style"]),
  age_band: getEnumAt(["properties", "context", "properties", "age_band", "items"]),
  life_stage: getEnumAt(["properties", "context", "properties", "life_stage", "items"]),
  interests: getEnumAt(["properties", "context", "properties", "interests", "items"]),
};

// getEnumAt이 경로를 못 찾으면 []를 반환하는데, 그대로 두면 나중에 "값이 유효하지 않음"
// 에러가 나면서 마치 데이터가 잘못된 것처럼 보인다 — 실제 원인은 스키마 경로 오류일 수 있다.
// 모듈 로드 시점에 fail-fast로 잡아 진단이 어긋나지 않게 한다.
for (const [key, values] of Object.entries(VALID)) {
  if (values.length === 0) {
    throw new Error(`preset.schema.json에서 ${key} enum을 못 읽음 — 스키마 경로 확인 필요`);
  }
}

// vocabulary.json의 모든 값을 하나의 Set으로 flatten — 미매핑 단어 검사에 사용
const ALLOWED_VOCABULARY = new Set<string>();
for (const [key, values] of Object.entries(vocabulary)) {
  if (key === "vocabulary_version") continue;
  if (Array.isArray(values)) {
    for (const v of values) {
      if (typeof v === "string") {
        ALLOWED_VOCABULARY.add(v);
      }
    }
  }
}

export class PresetValidationError extends Error {}

function fail(message: string): never {
  throw new PresetValidationError(message);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string");
}

/**
 * preset.schema.json v1.1을 그대로 옮긴 손 타입가드.
 * 최상위 additionalProperties만 재현(정의 안 된 최상위 필드는 던짐) — 서브객체
 * additionalProperties·uniqueItems는 파일 상단 주석 참고, 미검증.
 */
export function assertValidPreset(data: unknown): asserts data is Preset {
  if (typeof data !== "object" || data === null) fail("preset이 객체가 아님");
  const d = data as Record<string, unknown>;

  const allowedTopKeys = ["preset_version", "project_name", "assets", "style", "rules", "context"];
  const extraTop = Object.keys(d).filter((k) => !allowedTopKeys.includes(k));
  if (extraTop.length) {
    fail(`허용되지 않은 최상위 필드: ${extraTop.join(", ")} (additionalProperties: false)`);
  }

  if (d.preset_version !== "1.1") {
    fail(`preset_version은 "1.1"만 허용 (받은 값: ${String(d.preset_version)})`);
  }
  if (typeof d.project_name !== "string" || d.project_name.length < 1) {
    fail("project_name 누락");
  }

  // assets
  if (typeof d.assets !== "object" || d.assets === null) fail("assets 누락");
  const assets = d.assets as Record<string, unknown>;
  if (typeof assets.character_sheet !== "string" || !ASSET_URI_PATTERN.test(assets.character_sheet)) {
    fail(`assets.character_sheet는 asset://로 시작해야 함 (받은 값: ${String(assets.character_sheet)})`);
  }
  if (
    !isStringArray(assets.style_refs) ||
    !assets.style_refs.every((s) => ASSET_URI_PATTERN.test(s))
  ) {
    fail("assets.style_refs는 asset:// 문자열 배열이어야 함");
  }
  if (!isStringArray(assets.reference_asset_ids)) {
    fail("assets.reference_asset_ids는 문자열 배열이어야 함");
  }

  // style
  if (typeof d.style !== "object" || d.style === null) fail("style 누락");
  const style = d.style as Record<string, unknown>;
  if (!isStringArray(style.keywords)) fail("style.keywords는 문자열 배열이어야 함");
  if (!VALID.line_weight.includes(style.line_weight as string)) {
    fail(`style.line_weight 값이 유효하지 않음: ${String(style.line_weight)}`);
  }
  if (
    !isStringArray(style.palette) ||
    style.palette.length < 1 ||
    !style.palette.every((c) => HEX_COLOR_PATTERN.test(c))
  ) {
    fail("style.palette는 #RRGGBB 형식 문자열 1개 이상 배열이어야 함");
  }
  if (!VALID.saturation.includes(style.saturation as string)) {
    fail(`style.saturation 값이 유효하지 않음: ${String(style.saturation)}`);
  }
  if (!VALID.character_ratio.includes(style.character_ratio as string)) {
    fail(`style.character_ratio 값이 유효하지 않음: ${String(style.character_ratio)}`);
  }
  if (!VALID.background_density.includes(style.background_density as string)) {
    fail(`style.background_density 값이 유효하지 않음: ${String(style.background_density)}`);
  }
  if (!VALID.bubble_style.includes(style.bubble_style as string)) {
    fail(`style.bubble_style 값이 유효하지 않음: ${String(style.bubble_style)}`);
  }

  // rules
  if (typeof d.rules !== "object" || d.rules === null) fail("rules 누락");
  const rules = d.rules as Record<string, unknown>;
  if (!isStringArray(rules.forbidden)) fail("rules.forbidden은 문자열 배열이어야 함");
  if (typeof rules.cta_format !== "string" || rules.cta_format.length < 1) {
    fail("rules.cta_format 누락");
  }
  if (!isValidCtaId(rules.cta_format as string)) {
    fail(`rules.cta_format "${String(rules.cta_format)}"가 cta_presets.json의 preset id가 아님`);
  }

  // context
  if (typeof d.context !== "object" || d.context === null) fail("context 누락");
  const context = d.context as Record<string, unknown>;
  if (!isStringArray(context.industry)) fail("context.industry는 문자열 배열이어야 함");
  if (
    !isStringArray(context.interests) ||
    !context.interests.every((v) => VALID.interests.includes(v))
  ) {
    fail("context.interests에 정의되지 않은 값이 있음");
  }
  if (
    !isStringArray(context.age_band) ||
    !context.age_band.every((v) => VALID.age_band.includes(v))
  ) {
    fail("context.age_band에 정의되지 않은 값이 있음");
  }
  if (
    !isStringArray(context.life_stage) ||
    !context.life_stage.every((v) => VALID.life_stage.includes(v))
  ) {
    fail("context.life_stage에 정의되지 않은 값이 있음");
  }
  if (!isStringArray(context.main_subjects)) {
    fail("context.main_subjects는 문자열 배열이어야 함");
  }
}

export function isValidPreset(data: unknown): data is Preset {
  try {
    assertValidPreset(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * issue #15: 미매핑 단어 처리 정책 - 경고 방식.
 * style.keywords/rules.forbidden/context.main_subjects/context.industry는 자유 태그라,
 * 프롬프트 조립 시 모델이 못 알아듣는 단어가 섞일 위험이 있다.
 *
 * 정책: vocabulary.json에 없는 단어를 감지하여 경고 메시지 반환 (저장은 허용).
 *
 * @returns 미매핑된 단어 목록. 빈 배열이면 모든 단어가 허용됨.
 */
export function checkUnmappedWordsPolicy(preset: Preset): string[] {
  const unmappedWords: string[] = [];

  const checkField = (fieldName: string, values: string[]) => {
    for (const value of values) {
      if (!ALLOWED_VOCABULARY.has(value)) {
        unmappedWords.push(`${fieldName}: "${value}"`);
      }
    }
  };

  checkField("style.keywords", preset.style.keywords);
  checkField("rules.forbidden", preset.rules.forbidden);
  checkField("context.main_subjects", preset.context.main_subjects);
  checkField("context.industry", preset.context.industry);

  return unmappedWords;
}
