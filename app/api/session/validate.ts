import type { Storyboard } from "@/lib/db/sessions";
import {
  StoryboardValidationError,
  assertStoryboardRuntimeInvariants,
} from "@/lib/llm/storyboard-guard";

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

  assertStoryboardRuntimeInvariants(sb.cuts as Parameters<typeof assertStoryboardRuntimeInvariants>[0]);
}
