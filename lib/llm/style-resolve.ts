/**
 * 그림체 키워드 반영 초안 (issue #151·#125 선행분, 호출처 연결 없음).
 *
 * 온보딩의 스타일 확정 지점에서 부를 한 함수다. 추출값(레퍼런스 있음) 또는
 * null(레퍼런스 스킵)과 사용자 키워드·금지 요소를 받아, (1) enum 병합 결과와
 * (2) 프롬프트용 영문 힌트를 함께 내놓는다.
 *
 * 기존 함수 재사용 — 복제 없음. mergeStyleValues(추출·키워드 병합 규칙),
 * checkUnmappedWordsPolicy(자유 단어 → 영문 힌트 치환 + findings).
 * 순수 모듈이라 클라이언트에서도 import할 수 있다 — 서버 모듈·DB·env 금지.
 */

import {
  checkUnmappedWordsPolicy,
  type UnmappedWordFinding,
} from "./preset-guard";
import {
  mergeStyleValues,
  appliedEnumKeywordIndices,
  type MergedStyleResult,
  type StyleExtractionResult,
} from "./style-merge";

export interface ResolvePresetStyleInput {
  /** 레퍼런스 추출값. 스킵했으면 null — mergeStyleValues의 null 분기가 탄다. */
  extracted: StyleExtractionResult | null;
  /** 온보딩 키워드 입력(원본 한국어). enum 일치분은 추출값을 덮어쓴다. */
  userKeywords: string[];
  /** DetailsStep 금지 요소(원본). */
  forbidden: string[];
}

export interface ResolvePresetStyleResult {
  /** mergeStyleValues 결과. enum 덮어쓰기·추출값·DEFAULT 경로를 그대로 따른다. */
  style: MergedStyleResult;
  /** 프롬프트 `Style keywords:`에 넣을 영문 힌트. */
  keywordHints: string[];
  /** 프롬프트 `Do not include:`에 넣을 영문 힌트. */
  forbiddenHints: string[];
  /** 치환되지 않고 원본이 흐른 단어(unmapped). 로그·UI 확인용. */
  findings: UnmappedWordFinding[];
}

/**
 * 스타일 확정 한 번에 필요한 것을 다 뽑는다. keywords·forbidden 원본 저장은
 * 호출자(온보딩 배선)가 결정 메모의 (a)/(b)에 따라 한다 — 이 함수는 저장하지
 * 않고 계산만 한다.
 */
export function resolvePresetStyle(input: ResolvePresetStyleInput): ResolvePresetStyleResult {
  const style = mergeStyleValues(input.extracted, input.userKeywords);
  const checked = checkUnmappedWordsPolicy({
    style: { keywords: input.userKeywords },
    rules: { forbidden: input.forbidden },
  });

  // spec-b2 3-2 + B2 재작업: enum으로 이미 적용된 키워드는 findings에서
  // 삭제하지 않고 status만 "enum_applied"로 바꿔 남긴다. rules.forbidden은
  // 대상이 아니다. resolveField가 original을 trim하므로 문자열 대조가 아니라
  // 위치로 대응시킨다 — style.keywords finding의 k번째 = trim 후 비지 않은
  // k번째 입력 항목. merge가 정확 일치로 소비한 그 입력 항목의 finding만 바꾼다.
  const consumed = new Set(appliedEnumKeywordIndices(input.userKeywords));
  const nonEmptyIndices: number[] = [];
  input.userKeywords.forEach((keyword, index) => {
    if (keyword.trim()) nonEmptyIndices.push(index);
  });
  let keywordOrdinal = 0;
  const findings = checked.findings.map((finding) => {
    if (finding.field !== "style.keywords") return finding;
    const inputIndex = nonEmptyIndices[keywordOrdinal];
    keywordOrdinal++;
    return finding.status === "unmapped" &&
      inputIndex !== undefined &&
      consumed.has(inputIndex)
      ? { ...finding, status: "enum_applied" as const }
      : finding;
  });

  return {
    style,
    keywordHints: checked.resolvedHints["style.keywords"],
    forbiddenHints: checked.resolvedHints["rules.forbidden"],
    findings,
  };
}
