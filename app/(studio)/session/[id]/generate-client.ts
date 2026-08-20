// 세션(A②) 실 이미지 생성 클라이언트. mock-generate.ts를 대체한다 (issue #82).
// 백엔드(lib/openai/generate.ts, POST /api/generate)는 PR #80으로 이미 실제
// OpenAI 호출로 붙어 있었는데 화면이 그 라우트를 안 타고 있던 게 이 이슈의 문제였다.
//
// PRD.md 6절: "표지컷만 3안, 나머지 3컷은 선택 후 생성한다. 표지 3안은 독립
// 호출이고, 나머지 3컷은 previous_response_id로 이전 turn 응답을 체이닝해
// 생성한다." 표지 3안은 kind: 'cover_variants'(서버가 3회 병렬 호출을 대신
// 해준다), 나머지 3컷은 kind: 'cut'을 continueFrom으로 체이닝하며 순차 호출한다.

import type { Preset } from "@/lib/llm/preset-guard";
import type { Storyboard } from "./storyboard-types";

export interface GeneratedCut {
  /** 저장용 참조. storyboard.schema.json의 generated_image 패턴(^asset://)과 동일. */
  asset: string;
  /** 화면 표시용으로 리졸브한 공개 URL. 저장하지 않는다 — 매번 asset-url로 다시 받는다. */
  image: string;
  /** 다음 컷 체이닝에 쓸 토큰(provider의 previous_response_id). 표지 3안엔 없다. */
  continuationToken?: string;
}

function referenceAssetsOf(preset: Preset): string[] {
  return [preset.assets.character_sheet, ...preset.assets.style_refs];
}

async function resolveAssetUrl(uri: string): Promise<string> {
  const res = await fetch(`/session/asset-url?uri=${encodeURIComponent(uri)}`);
  if (!res.ok) {
    throw new Error("이미지 URL을 가져오지 못했습니다");
  }
  const { url } = (await res.json()) as { url: string };
  return url;
}

async function toGeneratedCut(result: { asset: string; continuationToken?: string }): Promise<GeneratedCut> {
  const image = await resolveAssetUrl(result.asset);
  return { asset: result.asset, image, continuationToken: result.continuationToken };
}

async function callGenerateCut(input: {
  storyboard: Storyboard;
  preset: Preset;
  referenceAssets: string[];
  continueFrom?: string;
}): Promise<GeneratedCut> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "cut", ...input }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "이미지 생성에 실패했습니다");
  }
  const { result } = (await res.json()) as {
    result: { asset: string; continuationToken?: string };
  };
  return toGeneratedCut(result);
}

export interface CoverVariantsResult {
  variants: GeneratedCut[];
  /**
   * 요청한 안 개수(항상 3, #50). generateCoverVariants가 allSettled라 일부
   * 안이 후처리에서 실패하면 variants.length가 이보다 작을 수 있다(#108) —
   * 화면이 variants.length < requested로 부족분을 판단한다(issue #117).
   * 구버전 서버 호환으로 응답에 없을 수 있어 optional이다.
   */
  requested?: number;
}

// 표지 3안 — 독립 호출(PRD 6절: 체이닝하면 2안이 1안에 끌려가 서로 닮아버림).
// storyboard는 cuts[0].generated_image가 아직 null인 상태로 넘겨야 한다.
// count=3은 서버 계약이 리터럴로 고정하므로 여기서 따로 받지 않는다.
export async function generateCoverVariants(
  storyboard: Storyboard,
  preset: Preset
): Promise<CoverVariantsResult> {
  const referenceAssets = referenceAssetsOf(preset);
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "cover_variants", storyboard, preset, referenceAssets }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "표지 생성에 실패했습니다");
  }
  const { result, requested } = (await res.json()) as {
    result: Array<{ asset: string; continuationToken?: string }>;
    requested?: number;
  };
  const variants = await Promise.all(result.map(toGeneratedCut));
  return { variants, requested };
}

// 표지 선택 이후 나머지 3컷 — continuationToken(previous_response_id) 체이닝으로
// 순차 생성한다. 매 호출 전 이전 컷까지 generated_image를 채운 storyboard를
// 넘겨야 generateCut의 nextUngeneratedCut()이 다음 컷을 정확히 고른다.
export async function generateChainedCuts(
  storyboard: Storyboard,
  preset: Preset,
  startContinueFrom: string
): Promise<GeneratedCut[]> {
  const referenceAssets = referenceAssetsOf(preset);
  const cuts = storyboard.cuts.map((c) => ({ ...c }));
  const results: GeneratedCut[] = [];
  let continueFrom: string | undefined = startContinueFrom;

  for (let i = 1; i < cuts.length; i++) {
    const result = await callGenerateCut({
      storyboard: { ...storyboard, cuts },
      preset,
      referenceAssets,
      continueFrom,
    });
    cuts[i] = { ...cuts[i], generated_image: result.asset };
    continueFrom = result.continuationToken ?? continueFrom;
    results.push(result);
  }

  return results;
}
