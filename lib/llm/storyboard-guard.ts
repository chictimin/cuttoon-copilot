// storyboard.schema.json이 구조적으로 못 잡는 세 가지를 런타임에 확인한다.
// 이 파일은 storyboard.schema.json 전체를 재현하는 타입가드가 아니다(preset-guard.ts와
// 같은 실수를 반복하지 않기 위해 범위를 명시) — 딱 아래 세 가지만 본다:
//
// 1. cut_index 유일성: cuts 배열 요소가 객체라 JSON Schema의 uniqueItems로는 못 잡는다
//    (uniqueItems는 요소 전체를 비교하지, 특정 필드만 비교하지 않는다). 4컷 전부
//    cut_index:1이어도 각 컷 자체의 스키마(minimum/maximum/allOf)는 통과하므로,
//    LLM이 채우는 필드에서 실제로 벌어질 수 있는 실패 모드다.
// 2. cta_override 유효성: cta_presets.json의 presets[].id 중 하나여야 한다는 규약이
//    스키마 레벨(자유 문자열)로는 안 잡히므로 preset.rules.cta_format과 동일하게
//    isValidCtaId()로 확인한다.
// 3. cta 비트 개수·위치: 스키마의 contains/minContains/maxContains/allOf가 강제하는
//    "cta는 정확히 1개, cut_index=4"를 런타임에서도 확인한다. 지금은 브레인스토밍
//    mock이 항상 cta를 4번째에 고정 배치해서 우연히 항상 통과하지만, LLM 교체나
//    사용자의 흐름 편집이 들어오면 이 보장이 깨질 수 있다 (#28).

import { isValidCtaId } from "./cta-presets";

export interface StoryboardCut {
  cut_index: number;
  narrative_beat: string;
  cta_override?: string | null;
}

export class StoryboardValidationError extends Error {}

/** cuts[].cut_index가 1~4를 한 번씩만 쓰는지 확인. */
export function assertUniqueCutIndices(cuts: StoryboardCut[]): void {
  const indices = cuts.map((c) => c.cut_index);
  const unique = new Set(indices);
  if (unique.size !== cuts.length) {
    throw new StoryboardValidationError(
      `cut_index 중복 발견: [${indices.join(", ")}]`
    );
  }
  const expected = Array.from({ length: cuts.length }, (_, i) => i + 1);
  const missing = expected.filter((n) => !unique.has(n));
  if (missing.length) {
    throw new StoryboardValidationError(
      `cut_index 누락: [${missing.join(", ")}] (있는 값: [${indices.join(", ")}])`
    );
  }
}

/** narrative_beat=cta인 컷의 cta_override가 null이 아니면 cta_presets.json에 실제로 있는 id인지 확인. */
export function assertValidCtaOverrides(cuts: StoryboardCut[]): void {
  for (const cut of cuts) {
    if (cut.narrative_beat !== "cta") continue;
    if (cut.cta_override == null) continue; // null이면 preset 기본값 사용, 검증 불필요
    if (!isValidCtaId(cut.cta_override)) {
      throw new StoryboardValidationError(
        `cuts[cut_index=${cut.cut_index}].cta_override "${cut.cta_override}"가 ` +
          `cta_presets.json의 preset id가 아님`
      );
    }
  }
}

/** cta 비트가 정확히 1개이고, 그 컷의 cut_index가 4인지 확인. */
export function assertExactlyOneCta(cuts: StoryboardCut[]): void {
  const ctaCuts = cuts.filter((c) => c.narrative_beat === "cta");
  if (ctaCuts.length !== 1) {
    throw new StoryboardValidationError(
      `cta 비트는 정확히 1개여야 함 (발견: ${ctaCuts.length}개)`
    );
  }
  if (ctaCuts[0].cut_index !== 4) {
    throw new StoryboardValidationError(
      `cta 비트는 cut_index 4에 있어야 함 (발견: ${ctaCuts[0].cut_index})`
    );
  }
}

/** 위 세 체크를 함께 실행. storyboard.schema.json 검증(별도, ajv 미사용) 이후에 호출하는 걸 전제로 함. */
export function assertStoryboardRuntimeInvariants(cuts: StoryboardCut[]): void {
  assertUniqueCutIndices(cuts);
  assertValidCtaOverrides(cuts);
  assertExactlyOneCta(cuts);
}
