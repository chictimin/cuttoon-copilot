// issue #119-2 (갈래 3): 서사 흐름 템플릿을 spec/data/로 데이터화한다. 값·키·시퀀스는
// 하드코딩(app/(studio)/session/[id]/storyboard-assembly.ts의 FLOW_BEATS)과 완전히
// 동일하다 — 순수 리팩터이고, #113/#133 판정 케이스 설계(흐름 3종 전제)를 건드리지
// 않는 것이 이번 변경의 안전성 근거다. CLAUDE.md 범용화 항목("서사 템플릿은 JSON
// 데이터 파일로 분리")이 이 분리를 요구한다.
//
// 이 파일은 FLOW_BEATS·FLOW_OPTIONS만 다룬다. BEAT_EXPRESSION_POSE·CUT_SHOT_PLAN·
// CAPTION_POSITIONS는 #152에서 spec/data/cut-defaults.json +
// lib/llm/cut-defaults.ts로 분리됐다(조립·폴백이 같은 값을 읽는다).
//
// cta-presets.ts(#5)와 같은 패턴 — ajv 없이 손으로 짠 가드, 모듈 로드 시점 fail-fast.

import narrativeFlowRaw from "@/spec/data/narrative-flow.json";
import storyboardSchema from "@/spec/storyboard.schema.json";

/** CTA 강도 (issue #205). none(이야기만)·soft(은근하게)·clear(확실하게). */
export type CtaStrength = "none" | "soft" | "clear";

export interface NarrativeFlow {
  key: string;
  beats: string[];
  /** cta_strength none일 때 쓰는 4개 beat. cta 없음, 10 beat enum 안. */
  no_cta_beats: string[];
}

export interface NarrativeFlowFile {
  narrative_flow_version: string;
  flows: NarrativeFlow[];
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

// storyboard.schema.json의 $defs.cut.properties.narrative_beat enum을 실시간으로
// 읽음 (하드코딩 아님) — cta-presets.ts가 preset.schema.json의 interests enum을
// 읽는 것과 같은 이유.
const VALID_BEATS = getEnumAt(storyboardSchema, ["$defs", "cut", "properties", "narrative_beat"]);

if (VALID_BEATS.length === 0) {
  throw new Error(
    "storyboard.schema.json에서 $defs.cut.properties.narrative_beat enum을 못 읽음 — 스키마 경로 확인 필요"
  );
}

export class NarrativeFlowValidationError extends Error {}

/**
 * narrative-flow.json 전체 정합성 체크.
 * - flows[].key 유일성
 * - flows[].beats가 정확히 4개(storyboard.schema.json의 cuts minItems/maxItems 4와 동일)
 * - beats의 각 값이 narrative_beat enum에 속하는지
 * - "cta"가 정확히 1개, 그리고 마지막(4번째) 컷이어야 함 — storyboard.schema.json의
 *   $defs.cut.allOf(narrative_beat === "cta" ⇔ cut_index === 4) 제약과 같은 규칙
 * - flows[].no_cta_beats가 정확히 4개·enum 안·cta 0개·중복 없음 (issue #205)
 */
export function assertValidNarrativeFlowFile(data: unknown): asserts data is NarrativeFlowFile {
  if (!isRecord(data)) {
    throw new NarrativeFlowValidationError("narrative-flow.json이 객체가 아님");
  }

  if (typeof data.narrative_flow_version !== "string") {
    throw new NarrativeFlowValidationError("narrative_flow_version 누락/타입 오류");
  }
  if (!Array.isArray(data.flows)) {
    throw new NarrativeFlowValidationError("flows가 배열이 아님");
  }

  const seenKeys = new Set<string>();

  data.flows.forEach((raw, index) => {
    if (!isRecord(raw)) {
      throw new NarrativeFlowValidationError(`flows[${index}]가 객체가 아님`);
    }

    if (typeof raw.key !== "string" || raw.key.length === 0) {
      throw new NarrativeFlowValidationError(`flows[${index}].key 누락`);
    }
    if (seenKeys.has(raw.key)) {
      throw new NarrativeFlowValidationError(`flows[${index}].key 중복: "${raw.key}"`);
    }
    seenKeys.add(raw.key);

    if (!Array.isArray(raw.beats) || raw.beats.length !== 4) {
      throw new NarrativeFlowValidationError(
        `flows[${index}].beats는 정확히 4개여야 함 (id: ${raw.key})`
      );
    }
    raw.beats.forEach((beat) => {
      if (!VALID_BEATS.includes(beat as string)) {
        throw new NarrativeFlowValidationError(
          `flows[${index}].beats의 값 "${beat}"가 storyboard.schema.json의 narrative_beat ` +
            `enum에 없음 (key: ${raw.key}). 스키마가 바뀌었는데 이 파일을 안 맞춘 것으로 보임.`
        );
      }
    });
    const ctaCount = raw.beats.filter((b) => b === "cta").length;
    if (ctaCount !== 1 || raw.beats[3] !== "cta") {
      throw new NarrativeFlowValidationError(
        `flows[${index}].beats는 "cta"를 정확히 1개, 마지막(4번째) 자리에 가져야 함 (key: ${raw.key})`
      );
    }

    if (!Array.isArray(raw.no_cta_beats) || raw.no_cta_beats.length !== 4) {
      throw new NarrativeFlowValidationError(
        `flows[${index}].no_cta_beats는 정확히 4개여야 함 (key: ${raw.key})`
      );
    }
    raw.no_cta_beats.forEach((beat) => {
      if (!VALID_BEATS.includes(beat as string)) {
        throw new NarrativeFlowValidationError(
          `flows[${index}].no_cta_beats의 값 "${beat}"가 storyboard.schema.json의 narrative_beat ` +
            `enum에 없음 (key: ${raw.key}). 스키마가 바뀌었는데 이 파일을 안 맞춘 것으로 보임.`
        );
      }
    });
    if (raw.no_cta_beats.includes("cta")) {
      throw new NarrativeFlowValidationError(
        `flows[${index}].no_cta_beats에 "cta"가 있으면 안 됨 (key: ${raw.key})`
      );
    }
    if (new Set(raw.no_cta_beats).size !== raw.no_cta_beats.length) {
      throw new NarrativeFlowValidationError(
        `flows[${index}].no_cta_beats에 중복이 있음 (key: ${raw.key})`
      );
    }
  });
}

// 모듈 로드 시점에 한 번 검증 — cta-presets.ts와 같은 이유로 fail-fast.
assertValidNarrativeFlowFile(narrativeFlowRaw);
const narrativeFlowFile: NarrativeFlowFile = narrativeFlowRaw;

/** spec/data/narrative-flow.json을 읽고 검증한 결과 (검증은 모듈 로드 시점에 이미 끝남). */
export function loadNarrativeFlows(): NarrativeFlow[] {
  return narrativeFlowFile.flows;
}

/** 화면의 flow 턴 선택지 키 목록. */
export function getFlowOptions(): string[] {
  return narrativeFlowFile.flows.map((f) => f.key);
}

/** 선택된 흐름 key에 대응하는 beats. 못 찾으면 undefined — 호출부가 폴백을 정한다. */
export function getBeatsForFlow(key: string, strength?: CtaStrength): string[] | undefined {
  const flow = narrativeFlowFile.flows.find((f) => f.key === key);
  if (!flow) return undefined;
  // none이면 cta 없는 시퀀스. strength가 없으면 clear(현행) 취급.
  if (strength === "none") return flow.no_cta_beats;
  return flow.beats;
}

/**
 * 흐름 라벨 표시용 (issue #205). 끝 "→ CTA"를 "→ 마무리"로 바꾼 문자열을
 * 돌려준다 — key 자체는 그대로라 서버 계약·검증에 영향 없다.
 * 클라이언트에서도 import한다(순수 함수).
 */
export function displayFlowLabel(key: string): string {
  const suffix = "→ CTA";
  if (key.endsWith(suffix)) return `${key.slice(0, -suffix.length)}→ 마무리`;
  return key;
}
