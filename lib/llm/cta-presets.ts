// issue #5: CTA 프리셋 로더 + 정합성 체크. ajv 없이 손으로 짠 가드로 간다(레포 결정 사항).
// 값 목록(interests enum)은 여기 다시 하드코딩하지 않고 preset.schema.json에서 직접 읽는다 —
// vocabulary.json/storyboard.schema.json 사이에서 겪은 것과 같은 수동 동기화 문제를 피하기 위함.

import ctaPresetsRaw from "@/spec/data/cta_presets.json";
import presetSchema from "@/spec/preset.schema.json";

export type Interest =
  | "brand_awareness"
  | "trust_building"
  | "product_showcase"
  | "sales_conversion"
  | "event_promotion"
  | "info_education"
  | "lead_generation"
  | "recruiting";

export interface CtaPreset {
  id: string;
  label: string;
  template: string;
  interests: Interest[];
}

export interface CtaPresetsFile {
  cta_presets_version: string;
  fallback_id: string;
  presets: CtaPreset[];
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

// preset.schema.json의 context.interests enum을 실시간으로 읽음 (하드코딩 아님)
const VALID_INTERESTS = getEnumAt(presetSchema, [
  "properties",
  "context",
  "properties",
  "interests",
  "items",
]);

export class CtaPresetsValidationError extends Error {}

/**
 * cta_presets.json 파일 전체 정합성 체크.
 * - presets[].id 유일성
 * - fallback_id가 실제 presets 목록에 존재
 * - presets[].interests가 preset.schema.json의 context.interests enum에 속하는지
 */
export function assertValidCtaPresetsFile(
  data: unknown
): asserts data is CtaPresetsFile {
  if (typeof data !== "object" || data === null) {
    throw new CtaPresetsValidationError("cta_presets.json이 객체가 아님");
  }
  const d = data as Record<string, unknown>;

  if (typeof d.cta_presets_version !== "string") {
    throw new CtaPresetsValidationError("cta_presets_version 누락/타입 오류");
  }
  if (typeof d.fallback_id !== "string" || d.fallback_id.length === 0) {
    throw new CtaPresetsValidationError("fallback_id 누락/타입 오류");
  }
  if (!Array.isArray(d.presets)) {
    throw new CtaPresetsValidationError("presets가 배열이 아님");
  }

  const seenIds = new Set<string>();

  d.presets.forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new CtaPresetsValidationError(`presets[${index}]가 객체가 아님`);
    }
    const p = raw as Record<string, unknown>;

    if (typeof p.id !== "string" || p.id.length === 0) {
      throw new CtaPresetsValidationError(`presets[${index}].id 누락`);
    }
    if (seenIds.has(p.id)) {
      throw new CtaPresetsValidationError(`presets[${index}].id 중복: "${p.id}"`);
    }
    seenIds.add(p.id);

    if (typeof p.label !== "string" || p.label.length === 0) {
      throw new CtaPresetsValidationError(`presets[${index}].label 누락 (id: ${p.id})`);
    }
    if (typeof p.template !== "string" || p.template.length === 0) {
      throw new CtaPresetsValidationError(`presets[${index}].template 누락 (id: ${p.id})`);
    }
    if (!Array.isArray(p.interests)) {
      throw new CtaPresetsValidationError(
        `presets[${index}].interests가 배열이 아님 (id: ${p.id})`
      );
    }
    for (const interest of p.interests) {
      if (!VALID_INTERESTS.includes(interest as string)) {
        throw new CtaPresetsValidationError(
          `presets[${index}].interests의 값 "${interest}"가 preset.schema.json의 ` +
            `context.interests enum에 없음 (id: ${p.id}). 스키마가 바뀌었는데 이 파일을 ` +
            `안 맞춘 것으로 보임.`
        );
      }
    }
  });

  if (!seenIds.has(d.fallback_id)) {
    throw new CtaPresetsValidationError(
      `fallback_id "${d.fallback_id}"가 presets 목록에 없음`
    );
  }
}

let cache: CtaPresetsFile | null = null;

/** spec/data/cta_presets.json을 읽고 검증한 뒤 반환. 실패하면 던짐(앱 시작 시 바로 걸리는 게 목표). */
export function loadCtaPresets(): CtaPresetsFile {
  if (cache) return cache;
  assertValidCtaPresetsFile(ctaPresetsRaw);
  cache = ctaPresetsRaw;
  return cache;
}

/**
 * 프로젝트가 고른 마케팅 목적(context.interests)으로 CTA 후보를 좁힌다.
 * interests가 빈 배열이거나, 프리셋 자신의 interests가 빈 배열이면(=모든 목적 공통) 후보에 포함.
 */
export function resolveCandidates(interests: Interest[]): CtaPreset[] {
  const { presets } = loadCtaPresets();
  if (interests.length === 0) return presets;
  return presets.filter(
    (p) => p.interests.length === 0 || p.interests.some((i) => interests.includes(i))
  );
}

/** 저장된 rules.cta_format / cta_override 값이 실제 존재하는 preset id인지 확인 */
export function isValidCtaId(id: string): boolean {
  const { presets } = loadCtaPresets();
  return presets.some((p) => p.id === id);
}

/** "알아서 해줘" 경로에서 무조건 하나 고를 수 있어야 하므로 fallback_id를 노출 */
export function getFallbackCtaId(): string {
  return loadCtaPresets().fallback_id;
}

/** id로 실제 프리셋(문구 template 포함) 조회. 없으면 undefined. */
export function getCtaPresetById(id: string): CtaPreset | undefined {
  return loadCtaPresets().presets.find((p) => p.id === id);
}
