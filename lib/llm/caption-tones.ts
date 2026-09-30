// F2 컷 대사 톤 로더 (spec-llm-line.md F2).
// 톤 목록·설명은 업종 문구가 코드에 박히지 않도록 spec/data/caption-tones.json에 둔다.
// narrative-flow.ts·cta-presets.ts와 같은 패턴 — ajv 없이 손으로 짠 가드, 모듈 로드 시점 fail-fast.

import captionTonesRaw from "@/spec/data/caption-tones.json";

export interface CaptionTone {
  id: string;
  label: string;
  description: string;
}

export interface CaptionTonesFile {
  caption_tones_version: string;
  tones: CaptionTone[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class CaptionTonesValidationError extends Error {}

/** caption-tones.json 전체 정합성 체크 — tones[].id 유일성, label·description 비어 있지 않음. */
export function assertValidCaptionTonesFile(
  data: unknown
): asserts data is CaptionTonesFile {
  if (!isRecord(data)) {
    throw new CaptionTonesValidationError("caption-tones.json이 객체가 아님");
  }
  if (typeof data.caption_tones_version !== "string") {
    throw new CaptionTonesValidationError("caption_tones_version 누락/타입 오류");
  }
  if (!Array.isArray(data.tones)) {
    throw new CaptionTonesValidationError("tones가 배열이 아님");
  }
  if (data.tones.length === 0) {
    throw new CaptionTonesValidationError("tones가 비어 있음");
  }

  const seenIds = new Set<string>();
  data.tones.forEach((raw, index) => {
    if (!isRecord(raw)) {
      throw new CaptionTonesValidationError(`tones[${index}]가 객체가 아님`);
    }
    if (typeof raw.id !== "string" || raw.id.length === 0) {
      throw new CaptionTonesValidationError(`tones[${index}].id 누락`);
    }
    if (seenIds.has(raw.id)) {
      throw new CaptionTonesValidationError(`tones[${index}].id 중복: "${raw.id}"`);
    }
    seenIds.add(raw.id);
    if (typeof raw.label !== "string" || raw.label.length === 0) {
      throw new CaptionTonesValidationError(`tones[${index}].label 누락 (id: ${raw.id})`);
    }
    if (typeof raw.description !== "string" || raw.description.length === 0) {
      throw new CaptionTonesValidationError(
        `tones[${index}].description 누락 (id: ${raw.id})`
      );
    }
  });
}

// 모듈 로드 시점에 한 번 검증 — cta-presets.ts와 같은 이유로 fail-fast.
assertValidCaptionTonesFile(captionTonesRaw);
const captionTonesFile: CaptionTonesFile = captionTonesRaw;

/** spec/data/caption-tones.json의 톤 목록 (검증은 모듈 로드 시점에 이미 끝남). */
export function loadCaptionTones(): CaptionTone[] {
  return captionTonesFile.tones;
}

/** tone_id가 실제 존재하는 톤인지 확인. */
export function isValidToneId(id: string): boolean {
  return captionTonesFile.tones.some((t) => t.id === id);
}

/** id로 톤 조회. 없으면 undefined. */
export function getCaptionToneById(id: string): CaptionTone | undefined {
  return captionTonesFile.tones.find((t) => t.id === id);
}
