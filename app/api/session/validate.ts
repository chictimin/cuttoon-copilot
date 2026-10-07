import type { Storyboard, StoryboardJudge } from "@/lib/db/sessions";
import {
  StoryboardValidationError,
  assertStoryboardRuntimeInvariants,
  storyboardContractProblems,
  type ContractProblem,
} from "@/lib/llm/storyboard-guard";
import { manifestImageRefs } from "@/lib/render/demo-cache";
import { subjectTagsProblem } from "@/lib/llm/subject-tags";
import type { CtaStrength } from "@/lib/llm/narrative-flow";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 저장 전 최소 검증.
 *
 * storyboard.schema.json 전체를 재현하는 검증기는 만들지 않는다 — 스키마 소유권이
 * A①이고(PRD.md 5절) 여기서 따로 구현하면 스키마가 바뀔 때 두 곳을 고쳐야 한다.
 * 여기서는 (1) 최상위 required 네 개가 있는지, (2) lib/llm이 이미 제공하는 컷
 * 인바리언트를 통과하는지만 본다. 그 사이의 필드별 enum 검증은 A①이 정식
 * 타입가드를 내면 그쪽으로 넘긴다.
 */
export function assertStoryboardShape(body: unknown): asserts body is Storyboard {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new StoryboardValidationError("스토리보드는 객체여야 합니다");
  }

  const sb = body as Record<string, unknown>;

  if (typeof sb.storyboard_version !== "string" || sb.storyboard_version.length === 0) {
    throw new StoryboardValidationError("storyboard_version이 없습니다");
  }
  if (typeof sb.subject !== "string" || sb.subject.trim().length === 0) {
    // sessions.subject가 not null + length > 0 제약이라 여기서 막지 않으면 DB에서 500이 된다.
    throw new StoryboardValidationError("subject가 없습니다");
  }
  if (!Array.isArray(sb.cast)) {
    throw new StoryboardValidationError("cast 배열이 없습니다");
  }
  if (!Array.isArray(sb.cuts) || sb.cuts.length === 0) {
    throw new StoryboardValidationError("cuts 배열이 없습니다");
  }

  // CTA 강도(issue #205): 없으면 clear 취급이라 guard 기본값과 일치한다.
  // 무효값이면 400(라우트가 StoryboardValidationError를 400으로 받는다).
  const strength = sb.cta_strength;
  if (
    strength !== undefined &&
    strength !== "none" &&
    strength !== "soft" &&
    strength !== "clear"
  ) {
    throw new StoryboardValidationError("cta_strength는 none·soft·clear 중 하나여야 합니다");
  }

  assertStoryboardRuntimeInvariants(
    sb.cuts as Parameters<typeof assertStoryboardRuntimeInvariants>[0],
    strength as CtaStrength | undefined
  );

  if (sb.subject_tags !== undefined) {
    const problem = subjectTagsProblem(sb.subject_tags);
    if (problem !== null) throw new StoryboardValidationError(problem);
  }
}

/**
 * 허용 집합 판독(spec-263 3-4). public/demo-cache/manifest.json을 읽어
 * manifestImageRefs에 넘긴 결과를 돌려준다. 판정 함수(storyboard-guard.ts)는
 * 이 파일을 import하지 않으므로 서버 호출부가 읽어 ctx로 넘긴다.
 * 읽기에 실패하면 빈 집합(캐시 허용 없음) — 던지지 않는다.
 */
export async function loadDemoCacheValues(
  publicDir?: string
): Promise<ReadonlySet<string>> {
  const dir = publicDir ?? path.join(process.cwd(), "public");
  try {
    const raw = await readFile(path.join(dir, "demo-cache", "manifest.json"), "utf8");
    return manifestImageRefs(JSON.parse(raw));
  } catch (e) {
    console.warn(
      "[session] manifest를 읽지 못해 캐시 허용 없이 판정:",
      (e as Error).message
    );
    return new Set<string>();
  }
}

function asRec(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 보호 비교의 cause·투영 비교용 deepEqual(JSON 값 대상). */
export function storyboardCausesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => storyboardCausesEqual(v, (b as unknown[])[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) {
    if (!storyboardCausesEqual(ra[k], rb[k])) return false;
  }
  return true;
}

/**
 * 위반 근거 투영(spec-263 3-2 pin). 위반 판정에 쓰이는 필드만 넣고
 * caption·말풍선 위치 같은 편집 대상 필드는 넣지 않는다.
 */
export function projectViolationBasis(sb: unknown): {
  cuts: unknown;
  cast: unknown;
  frames: unknown;
} {
  const rec = asRec(sb);
  const cuts = rec?.cuts;
  const cast = rec?.cast;
  const cutsProj = !Array.isArray(cuts)
    ? { isArray: false }
    : {
        isArray: true,
        length: cuts.length,
        items: cuts.map((c) => {
          const r = asRec(c);
          return r ? { isObject: true, cut_index: r.cut_index } : { isObject: false };
        }),
      };
  const castProj = !Array.isArray(cast)
    ? { isArray: false }
    : {
        isArray: true,
        length: cast.length,
        items: cast.map((m) => {
          const r = asRec(m);
          return r
            ? { isObject: true, character_id: r.character_id, role: r.role }
            : { isObject: false };
        }),
      };
  const framesProj = !Array.isArray(cuts)
    ? { isArray: false }
    : cuts.map((c) => {
        const r = asRec(c);
        if (!r) return { isObject: false };
        const fr = r.characters_in_frame;
        if (!Array.isArray(fr)) return { isObject: true, isArray: false };
        return {
          isObject: true,
          isArray: true,
          length: fr.length,
          members: fr.map((e) => {
            const er = asRec(e);
            return er ? { isObject: true, character_id: er.character_id } : { isObject: false };
          }),
        };
      });
  return { cuts: cutsProj, cast: castProj, frames: framesProj };
}

/**
 * 기존 위반 보호 비교(spec-263 3-2). 새 storyboard의 각 problem p에 대해
 * baseline의 problem 중 rule·locator·kind가 같고 cause가 deepEqual이면 예외,
 * 없으면 새 위반으로 돌려준다. 불안정 locator(!)가 들어간 problem은
 * 위반 근거 투영까지 deepEqual일 때만 예외다.
 * baseline이 null이면(새 세션) 예외 없음 — 전량을 돌려준다.
 */
export function findNewViolations(
  newSb: unknown,
  baselineSb: unknown,
  demoCacheValues?: ReadonlySet<string>
): ContractProblem[] {
  const ctx = demoCacheValues === undefined ? undefined : { demoCacheValues };
  const fresh = storyboardContractProblems(newSb, ctx);
  if (baselineSb === null || baselineSb === undefined) return fresh;
  const base = storyboardContractProblems(baselineSb, ctx);
  const basisSame = storyboardCausesEqual(
    projectViolationBasis(newSb),
    projectViolationBasis(baselineSb)
  );
  return fresh.filter((p) => {
    // 불안정 locator(!)는 인덱스 교환으로 예외를 다른 개체에 물려줄 수 있어
    // locator 일치 + 위반 근거 투영 일치가 함께 있어야만 예외다.
    const unstable = p.locator.includes("!");
    for (const q of base) {
      if (q.rule !== p.rule || q.kind !== p.kind) continue;
      if (!storyboardCausesEqual(q.cause, p.cause)) continue;
      if (q.locator !== p.locator) continue;
      if (unstable && !basisSame) continue;
      return false;
    }
    return true;
  });
}

/** sessions.ts helper에 넘기는 judge를 만든다. */
export function buildStoryboardJudge(
  demoCacheValues?: ReadonlySet<string>
): StoryboardJudge {
  return (newStoryboard, baseline) =>
    findNewViolations(newStoryboard, baseline, demoCacheValues);
}
