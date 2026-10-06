// 컷 기본값 단일 출처 (issue #152 W1-a).
//
// storyboard-assembly.ts(조립 기본값)와 captions.ts(폴백 기본값)가 같은 값을
// 각각 하드코딩하고 있었다 — 2차에서 두 파일 모두 chictimin 소유라 복제 사유가
// 없어 spec/data/cut-defaults.json 하나로 모았다. 값은 하나도 바꾸지 않은 순수
// 리팩터다. narrative-flow.ts·cta-presets.ts·caption-tones.ts와 같은 패턴 —
// ajv 없이 손으로 짠 가드, 모듈 로드 시점 fail-fast, enum은
// spec/storyboard.schema.json에서 읽어 검증한다.
//
// 클라이언트에서도 import한다(SessionFlow.tsx가 storyboard-assembly.ts를 거쳐
// 닿는다) — OPENAI_API_KEY를 쓰는 모듈을 import하지 않는다.

import cutDefaultsRaw from "@/spec/data/cut-defaults.json";
import storyboardSchema from "@/spec/storyboard.schema.json";

export interface BeatExpressionPose {
  expression: string;
  pose: string;
}

export interface CutShot {
  shot_type: string;
  camera_angle: string;
}

export interface CutDefaultsFile {
  cut_defaults_version: string;
  beat_expression_pose: Record<string, BeatExpressionPose>;
  beat_caption_templates: Record<string, string>;
  cut_shot_plan: CutShot[];
  caption_positions: string[];
  supporting_default: BeatExpressionPose;
  /** 조연이 함께 등장하는 컷(1-based cut_index). 현행 규칙: CTA 직전 3번째 컷. */
  supporting_cut_index: number;
  /** 1컷 time_of_day 기본값. */
  first_cut_time_of_day: string;
  /** cta beat 폴백 대사 강도별 (issue #205 K4b). none은 CTA beat가 없어 쓰지 않는다. */
  cta_fallback: {
    soft: string;
    clear: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getEnumAt(schema: unknown, pathParts: string[]): string[] {
  let node: unknown = schema;
  for (const part of pathParts) {
    if (!isRecord(node)) return [];
    node = node[part];
  }
  if (isRecord(node) && Array.isArray(node.enum)) {
    return node.enum.filter((v): v is string => typeof v === "string");
  }
  return [];
}

// storyboard.schema.json의 enum을 실시간으로 읽음 (하드코딩 아님) —
// narrative-flow.ts가 narrative_beat enum을 읽는 것과 같은 이유.
const VALID_BEATS = getEnumAt(storyboardSchema, ["$defs", "cut", "properties", "narrative_beat"]);
const VALID_EXPRESSIONS = getEnumAt(storyboardSchema, [
  "$defs",
  "cut",
  "properties",
  "characters_in_frame",
  "items",
  "properties",
  "expression",
]);
const VALID_POSES = getEnumAt(storyboardSchema, [
  "$defs",
  "cut",
  "properties",
  "characters_in_frame",
  "items",
  "properties",
  "pose",
]);
const VALID_SHOT_TYPES = getEnumAt(storyboardSchema, ["$defs", "cut", "properties", "shot_type"]);
const VALID_CAMERA_ANGLES = getEnumAt(storyboardSchema, [
  "$defs",
  "cut",
  "properties",
  "camera_angle",
]);
const VALID_TIME_OF_DAY = getEnumAt(storyboardSchema, [
  "$defs",
  "cut",
  "properties",
  "time_of_day",
]);
const VALID_CAPTION_POSITIONS = getEnumAt(storyboardSchema, [
  "$defs",
  "cut",
  "properties",
  "caption",
  "properties",
  "position",
]);
const VALID_RESERVED_ZONES = getEnumAt(storyboardSchema, [
  "$defs",
  "cut",
  "properties",
  "reserved_zone",
]);

for (const [key, values] of Object.entries({
  narrative_beat: VALID_BEATS,
  expression: VALID_EXPRESSIONS,
  pose: VALID_POSES,
  shot_type: VALID_SHOT_TYPES,
  camera_angle: VALID_CAMERA_ANGLES,
  time_of_day: VALID_TIME_OF_DAY,
  caption_position: VALID_CAPTION_POSITIONS,
  reserved_zone: VALID_RESERVED_ZONES,
})) {
  if (values.length === 0) {
    throw new Error(
      `storyboard.schema.json에서 연출 허용값 enum을 못 읽음(${key}) — 스키마 경로 확인 필요`
    );
  }
}

export class CutDefaultsValidationError extends Error {}

/**
 * cut-defaults.json 전체 정합성 체크.
 * - beat_expression_pose·beat_caption_templates가 narrative_beat enum 전체를
 *   빠짐없이 덮는지 (키가 모자라거나 enum 밖 키가 있으면 실패)
 * - 표정·포즈·샷·앵글·캡션 위치·조연 기본값·1컷 time_of_day가 각 enum에 속하는지
 * - cut_shot_plan·caption_positions가 정확히 4개(컷 수와 동일)인지
 * - supporting_cut_index가 1~4 사이의 정수인지
 */
export function assertValidCutDefaultsFile(data: unknown): asserts data is CutDefaultsFile {
  if (!isRecord(data)) {
    throw new CutDefaultsValidationError("cut-defaults.json이 객체가 아님");
  }
  if (typeof data.cut_defaults_version !== "string") {
    throw new CutDefaultsValidationError("cut_defaults_version 누락/타입 오류");
  }

  if (!isRecord(data.beat_expression_pose)) {
    throw new CutDefaultsValidationError("beat_expression_pose가 객체가 아님");
  }
  for (const beat of VALID_BEATS) {
    const entry = data.beat_expression_pose[beat];
    if (!isRecord(entry)) {
      throw new CutDefaultsValidationError(`beat_expression_pose["${beat}"] 누락`);
    }
    if (typeof entry.expression !== "string" || !VALID_EXPRESSIONS.includes(entry.expression)) {
      throw new CutDefaultsValidationError(
        `beat_expression_pose["${beat}"].expression "${entry.expression}"가 스키마 enum에 없음`
      );
    }
    if (typeof entry.pose !== "string" || !VALID_POSES.includes(entry.pose)) {
      throw new CutDefaultsValidationError(
        `beat_expression_pose["${beat}"].pose "${entry.pose}"가 스키마 enum에 없음`
      );
    }
  }
  for (const key of Object.keys(data.beat_expression_pose)) {
    if (!VALID_BEATS.includes(key)) {
      throw new CutDefaultsValidationError(
        `beat_expression_pose["${key}"]가 narrative_beat enum에 없음 — 스키마가 바뀌었는데 이 파일을 안 맞춘 것으로 보임`
      );
    }
  }

  if (!isRecord(data.beat_caption_templates)) {
    throw new CutDefaultsValidationError("beat_caption_templates가 객체가 아님");
  }
  for (const beat of VALID_BEATS) {
    const template = data.beat_caption_templates[beat];
    if (typeof template !== "string" || template.length === 0) {
      throw new CutDefaultsValidationError(`beat_caption_templates["${beat}"] 누락/빈 문자열`);
    }
  }
  for (const key of Object.keys(data.beat_caption_templates)) {
    if (!VALID_BEATS.includes(key)) {
      throw new CutDefaultsValidationError(
        `beat_caption_templates["${key}"]가 narrative_beat enum에 없음`
      );
    }
  }

  if (!Array.isArray(data.cut_shot_plan) || data.cut_shot_plan.length !== 4) {
    throw new CutDefaultsValidationError("cut_shot_plan은 정확히 4개여야 함");
  }
  data.cut_shot_plan.forEach((raw, index) => {
    if (!isRecord(raw)) {
      throw new CutDefaultsValidationError(`cut_shot_plan[${index}]가 객체가 아님`);
    }
    if (typeof raw.shot_type !== "string" || !VALID_SHOT_TYPES.includes(raw.shot_type)) {
      throw new CutDefaultsValidationError(
        `cut_shot_plan[${index}].shot_type "${raw.shot_type}"가 스키마 enum에 없음`
      );
    }
    if (typeof raw.camera_angle !== "string" || !VALID_CAMERA_ANGLES.includes(raw.camera_angle)) {
      throw new CutDefaultsValidationError(
        `cut_shot_plan[${index}].camera_angle "${raw.camera_angle}"가 스키마 enum에 없음`
      );
    }
  });

  if (!Array.isArray(data.caption_positions) || data.caption_positions.length !== 4) {
    throw new CutDefaultsValidationError("caption_positions는 정확히 4개여야 함");
  }
  data.caption_positions.forEach((position, index) => {
    if (typeof position !== "string" || !VALID_CAPTION_POSITIONS.includes(position)) {
      throw new CutDefaultsValidationError(
        `caption_positions[${index}] "${position}"가 스키마 enum에 없음`
      );
    }
  });

  if (!isRecord(data.supporting_default)) {
    throw new CutDefaultsValidationError("supporting_default가 객체가 아님");
  }
  if (
    typeof data.supporting_default.expression !== "string" ||
    !VALID_EXPRESSIONS.includes(data.supporting_default.expression)
  ) {
    throw new CutDefaultsValidationError(
      `supporting_default.expression "${data.supporting_default.expression}"가 스키마 enum에 없음`
    );
  }
  if (
    typeof data.supporting_default.pose !== "string" ||
    !VALID_POSES.includes(data.supporting_default.pose)
  ) {
    throw new CutDefaultsValidationError(
      `supporting_default.pose "${data.supporting_default.pose}"가 스키마 enum에 없음`
    );
  }

  if (
    typeof data.supporting_cut_index !== "number" ||
    !Number.isInteger(data.supporting_cut_index) ||
    data.supporting_cut_index < 1 ||
    data.supporting_cut_index > 4
  ) {
    throw new CutDefaultsValidationError("supporting_cut_index는 1~4 사이의 정수여야 함");
  }

  if (
    typeof data.first_cut_time_of_day !== "string" ||
    !VALID_TIME_OF_DAY.includes(data.first_cut_time_of_day)
  ) {
    throw new CutDefaultsValidationError(
      `first_cut_time_of_day "${data.first_cut_time_of_day}"가 스키마 enum에 없음`
    );
  }

  if (!isRecord(data.cta_fallback)) {
    throw new CutDefaultsValidationError("cta_fallback이 객체가 아님");
  }
  if (typeof data.cta_fallback.soft !== "string" || data.cta_fallback.soft.length === 0) {
    throw new CutDefaultsValidationError("cta_fallback.soft 누락/빈 문자열");
  }
  if (typeof data.cta_fallback.clear !== "string" || data.cta_fallback.clear.length === 0) {
    throw new CutDefaultsValidationError("cta_fallback.clear 누락/빈 문자열");
  }
}

// 모듈 로드 시점에 한 번 검증 — cta-presets.ts와 같은 이유로 fail-fast.
assertValidCutDefaultsFile(cutDefaultsRaw);
const cutDefaultsFile: CutDefaultsFile = cutDefaultsRaw;

/** spec/data/cut-defaults.json을 읽고 검증한 결과 (검증은 모듈 로드 시점에 이미 끝남). */
export function loadCutDefaults(): CutDefaultsFile {
  return cutDefaultsFile;
}

/** beat별 표정·포즈 기본값. enum 밖 beat면 undefined — 호출부가 폴백을 정한다. */
export function getBeatExpressionPose(beat: string): BeatExpressionPose | undefined {
  return cutDefaultsFile.beat_expression_pose[beat];
}

/** beat별 폴백 대사. 템플릿의 {subject} 자리에 소재를 넣는다. */
export function defaultCaptionForBeat(beat: string, subject: string, ctaStrength = "clear"): string {
  // cta beat는 선택 강도를 따른다 (issue #205 K4b). soft면 전용 은근한 폴백,
  // 그 외(clear·없음·none)는 현행 문장 — none은 CTA beat가 없어 이 경로를 타지 않는다.
  if (beat === "cta" && ctaStrength === "soft") {
    return cutDefaultsFile.cta_fallback.soft;
  }
  const template = cutDefaultsFile.beat_caption_templates[beat] ?? "지금 바로 확인해보세요";
  return template.split("{subject}").join(subject);
}

/** 4컷 샷·앵글 기본 시퀀스. */
export function getCutShotPlan(): CutShot[] {
  return cutDefaultsFile.cut_shot_plan;
}

/** 4컷 캡션 위치 기본 시퀀스. */
export function getCaptionPositions(): string[] {
  return cutDefaultsFile.caption_positions;
}

/** 조연 표정·포즈 기본값. */
export function getSupportingDefault(): BeatExpressionPose {
  return cutDefaultsFile.supporting_default;
}

/** 조연이 함께 등장하는 컷(1-based cut_index). */
export function getSupportingCutIndex(): number {
  return cutDefaultsFile.supporting_cut_index;
}

/** 1컷 time_of_day 기본값. */
export function getFirstCutTimeOfDay(): string {
  return cutDefaultsFile.first_cut_time_of_day;
}

/** 캡션 위치에서 reserved_zone 기본값을 읽는다 (top으로 시작하면 top, 아니면 bottom). */
export function defaultReservedZoneFor(position: string): string {
  return position.startsWith("top") ? "top" : "bottom";
}
