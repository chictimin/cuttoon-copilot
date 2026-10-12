// 세션(A②) 실 이미지 생성 클라이언트. mock-generate.ts를 대체한다 (issue #82).
// 백엔드(lib/openai/generate.ts, POST /api/generate)는 PR #80으로 이미 실제
// OpenAI 호출로 붙어 있었는데 화면이 그 라우트를 안 타고 있던 게 이 이슈의 문제였다.
//
// PRD.md 6절: "표지컷만 3안, 나머지 3컷은 선택 후 생성한다. 표지 3안은 독립
// 호출이고, 나머지 3컷은 previous_response_id로 이전 turn 응답을 체이닝해
// 생성한다." 표지 3안은 kind: 'cover_variants'(서버가 3회 병렬 호출을 대신
// 해준다), 나머지 3컷은 kind: 'cut'을 continueFrom으로 체이닝하며 순차 호출한다.

import type { Preset } from "@/lib/llm/preset-guard";
import { fetchAssetUrl } from "../../asset-url";
import type { DemoManifest } from "../../demo-mode";
import type { Storyboard } from "./storyboard-types";

export interface GeneratedCut {
  /** 저장용 참조. storyboard.schema.json의 generated_image 패턴(^asset://)과 동일. */
  asset: string;
  /** 화면 표시용으로 리졸브한 공개 URL. 저장하지 않는다 — 매번 asset-url로 다시 받는다. */
  image: string;
  /** 다음 컷 체이닝에 쓸 토큰(provider의 previous_response_id). 표지 3안엔 없다. */
  continuationToken?: string;
  /**
   * #326 S6: 표지 안의 실제 연출(서버가 결과에 실어 보낸 경우).
   * 없으면(데모 캐시·이전 버전 결과) 컷1 값을 바꾸지 않는다.
   */
  shot_type?: string;
  camera_angle?: string;
}

function referenceAssetsOf(preset: Preset): string[] {
  return [preset.assets.character_sheet, ...preset.assets.style_refs];
}

async function toGeneratedCut(result: {
  asset: string;
  continuationToken?: string;
  shot_type?: string;
  camera_angle?: string;
}): Promise<GeneratedCut> {
  const image = await fetchAssetUrl(result.asset);
  return {
    asset: result.asset,
    image,
    continuationToken: result.continuationToken,
    ...(typeof result.shot_type === "string" ? { shot_type: result.shot_type } : {}),
    ...(typeof result.camera_angle === "string" ? { camera_angle: result.camera_angle } : {}),
  };
}

// URL 리졸브 없이 생성 결과(asset·continuationToken)만 받는다. #104: 리졸브
// 실패와 생성 실패를 분리해야 체이닝 중간에 리졸브만 실패했을 때 이미 유료로
// 생성된 asset·다음 컷 체이닝 토큰까지 잃지 않는다 — 아래 generateChainedCuts 참고.
async function callGenerateCut(input: {
  storyboard: Storyboard;
  preset: Preset;
  referenceAssets: string[];
  continueFrom?: string;
  /** #326 S9: 다시 그리기 자유 입력. 요청에만 싣는다. */
  regenNote?: string;
  /** #326 구조변경: 확정 레퍼런스 asset. 있으면 reference_asset 키로 실어 보낸다. */
  referenceAsset?: string;
  /** #326 절충안: 그릴 컷 번호. 있으면 target_cut_index 키로 실어 보낸다. */
  targetCutIndex?: number;
}): Promise<{ asset: string; continuationToken?: string }> {
  const { regenNote, referenceAsset, targetCutIndex, ...rest } = input;
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // 계약 키는 스네이크. 없으면 키를 빼고 보낸다.
    body: JSON.stringify({
      kind: "cut",
      ...rest,
      ...(regenNote ? { regen_note: regenNote } : {}),
      ...(referenceAsset ? { reference_asset: referenceAsset } : {}),
      ...(typeof targetCutIndex === "number" ? { target_cut_index: targetCutIndex } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "이미지 생성에 실패했습니다");
  }
  const { result } = (await res.json()) as {
    result: { asset: string; continuationToken?: string };
  };
  return result;
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
// #326 구조변경: 레퍼런스 1장 용도로 count 1을 보낼 수 있다(1~3, 기본 3).
export async function generateCoverVariants(
  storyboard: Storyboard,
  preset: Preset,
  count: number = 3,
  regenNote?: string
): Promise<CoverVariantsResult> {
  const referenceAssets = referenceAssetsOf(preset);
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "cover_variants",
      storyboard,
      preset,
      referenceAssets,
      count,
      ...(regenNote ? { regen_note: regenNote } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "표지 생성에 실패했습니다");
  }
  const { result, requested } = (await res.json()) as {
    result: Array<{ asset: string; continuationToken?: string; shot_type?: string; camera_angle?: string }>;
    requested?: number;
  };

  // Promise.all이면 3안 중 URL 리졸브 하나만 실패해도 즉시 reject되어 이미
  // 유료로 생성된 나머지 성공분까지 통째로 버려진다(PR #124 리뷰 지적) —
  // 서버가 generateCoverVariants에서 allSettled로 성공분을 지키는 것(#104)과
  // 같은 이유로, 여기서도 리졸브 실패 하나가 나머지를 끌고 내려가지 않게 한다.
  // 이러면 서버 쪽 부족(#108)과 클라이언트 쪽 리졸브 실패가 같은
  // "variants.length < requested" 배너(#117)로 합쳐진다.
  const settled = await Promise.allSettled(result.map(toGeneratedCut));
  const variants = settled
    .filter((r): r is PromiseFulfilledResult<GeneratedCut> => r.status === "fulfilled")
    .map((r) => r.value);
  settled
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .forEach((r) => console.error("[generateCoverVariants] 이미지 URL 리졸브 실패:", r.reason));

  // 0개면 서버와 같은 규약대로 던진다 — 골라야 할 것이 아무것도 없는 빈
  // 선택 화면을 보여주지 않는다.
  if (variants.length === 0) {
    throw new Error("표지 생성에 실패했습니다");
  }

  return { variants, requested };
}

export interface ChainedCutsCallbacks {
  onCut?: (cutArrayIndex: number, cut: GeneratedCut) => void;
  onProgress?: (done: number, total: number) => void;
}

// #326 구조변경: 레퍼런스 확정 이후 전 컷(컷1 포함) —
// continuationToken(previous_response_id) 체이닝으로 순차 생성한다.
// 매 호출 전 이전 컷까지 generated_image를 채운 storyboard를 넘겨야
// generateCut의 nextUngeneratedCut()이 다음 컷을 정확히 고른다.
// 이미 generated_image가 채워진 컷은 건너뛰고 첫 미생성 컷부터 이어간다 — 중간
// 실패 뒤 재시도가 이미 유료로 만든 컷을 다시 만들지 않게(#104).
// onCut: 컷 하나가 끝날 때마다 호출 — 호출부가 즉시 저장해 두면 다음 컷이
// 실패해도 앞 컷을 잃지 않는다. onProgress(done, total) 표시용(#138).
// referenceAsset이 있으면 매 컷 요청에 reference_asset 키로 실어 보낸다.
export async function generateChainedCuts(
  storyboard: Storyboard,
  preset: Preset,
  startContinueFrom: string,
  { onCut, onProgress }: ChainedCutsCallbacks = {},
  referenceAsset?: string
): Promise<GeneratedCut[]> {
  const referenceAssets = referenceAssetsOf(preset);
  const cuts = storyboard.cuts.map((c) => ({ ...c }));
  const results: GeneratedCut[] = [];
  let continueFrom: string | undefined = startContinueFrom;
  // #326 절충안: 컷1=기준컷은 미리 만들어져 있어 건너뛴다. 진행 표시는 남은 컷 기준(n/3).
  const total = cuts.filter((c) => !c.generated_image).length;
  let done = 0;
  onProgress?.(done, total);

  for (let i = 0; i < cuts.length; i++) {
    if (cuts[i].generated_image) continue;
    const raw = await callGenerateCut({
      storyboard: { ...storyboard, cuts },
      preset,
      referenceAssets,
      continueFrom,
      ...(referenceAsset ? { referenceAsset } : {}),
      targetCutIndex: cuts[i].cut_index,
    });
    // 생성(유료 호출) 자체는 여기서 이미 끝났다 — asset과 다음 컷 체이닝
    // 토큰을 확보했으니 체이닝은 리졸브 결과와 무관하게 이어간다.
    cuts[i] = { ...cuts[i], generated_image: raw.asset };
    continueFrom = raw.continuationToken ?? continueFrom;

    // URL 리졸브만 실패해도 여기서 던지면 이 컷과 앞서 성공한 컷들까지
    // handleSelectCover의 catch에서 통째로 버려진다(#104). 리졸브 실패는
    // 이 컷의 표시용 image만 비우고(저장은 asset 기준이라 영향 없음) 계속한다.
    let image = "";
    try {
      image = await fetchAssetUrl(raw.asset);
    } catch (e) {
      console.error(
        `[generateChainedCuts] 컷 ${cuts[i].cut_index} 이미지 URL 리졸브 실패 — asset은 보존됨:`,
        e
      );
    }

    const generated: GeneratedCut = { asset: raw.asset, image, continuationToken: raw.continuationToken };
    results.push(generated);
    onCut?.(i, generated);
    onProgress?.(++done, total);
  }

  return results;
}

// #307: 데모 캐시 모드 — 생성(유료 호출) 없이 public/demo-cache/의 미리 만든 이미지를 같은 모양으로 돌려준다.
// asset은 manifest에 적힌 /demo-cache/… 경로 그대로다(서버·Export가 manifest 정확 일치로 허용, #305·#310).
// 화면 표시용 image도 같은 경로라 resolveImageUrl이 그대로 쓴다.
export function demoCoverVariants(manifest: DemoManifest): CoverVariantsResult {
  return {
    variants: manifest.covers.map((src) => ({ asset: src, image: src })),
    requested: manifest.covers.length,
  };
}

// 표지 이후 컷을 manifest에서 채운다. generateChainedCuts와 같은 규칙: 이미 이미지가 있는 컷은 건너뛰고,
// 컷마다 onCut·onProgress를 부른다. manifest에 없는 컷이 있으면 던진다(호출부가 안내 문구를 정한다).
export function generateDemoCuts(
  storyboard: Storyboard,
  manifest: DemoManifest,
  { onCut, onProgress }: ChainedCutsCallbacks = {}
): GeneratedCut[] {
  const total = storyboard.cuts.length - 1;
  let done = storyboard.cuts.slice(1).filter((c) => c.generated_image).length;
  onProgress?.(done, total);
  const results: GeneratedCut[] = [];
  for (let i = 1; i < storyboard.cuts.length; i++) {
    const cut = storyboard.cuts[i];
    if (cut.generated_image) continue;
    const src = manifest.cuts[String(cut.cut_index)];
    if (!src) throw new Error(`demo manifest에 ${cut.cut_index}번 컷이 없습니다`);
    const generated: GeneratedCut = { asset: src, image: src };
    results.push(generated);
    onCut?.(i, generated);
    onProgress?.(++done, total);
  }
  return results;
}

// #326 S9: 한 컷만 다시 그리기. 호출부는 요청용 storyboard 복사본(대상 컷의
// generated_image만 비우고 모달 연출값으로 덮어쓴 것)과 앞 컷 체이닝 토큰·
// 자유 입력만 넘긴다. nextUngeneratedCut이 비워진 대상 컷을 고른다.
export async function generateRedrawnCut(input: {
  storyboard: Storyboard;
  preset: Preset;
  continueFrom?: string;
  regenNote?: string;
  referenceAsset?: string;
  targetCutIndex?: number;
}): Promise<GeneratedCut> {
  const referenceAssets = referenceAssetsOf(input.preset);
  const raw = await callGenerateCut({
    storyboard: input.storyboard,
    preset: input.preset,
    referenceAssets,
    ...(input.continueFrom ? { continueFrom: input.continueFrom } : {}),
    ...(input.regenNote ? { regenNote: input.regenNote } : {}),
    ...(input.referenceAsset ? { referenceAsset: input.referenceAsset } : {}),
    ...(typeof input.targetCutIndex === "number" ? { targetCutIndex: input.targetCutIndex } : {}),
  });
  return toGeneratedCut(raw);
}
