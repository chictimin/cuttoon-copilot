// 세션(A②) 임시 컷 생성 mock. 실제 이미지 생성은 B①(lib/openai/generate.ts, 아직
// "TODO: B①" 스텁뿐)이지만 내 폴더 안에 mock을 둔다 (팀 브랜치 규약).
// PRD.md 6절: "표지컷만 3안, 나머지 3컷은 선택 후 생성한다. 표지 3안은 독립 호출이고,
// 나머지 3컷은 previous_response_id로 이전 turn 응답을 체이닝해 생성한다."

const MOCK_GENERATE_DELAY_MS = 1200;

function placeholderImage(fill: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="${fill}"/></svg>`
  )}`;
}

const COVER_VARIANT_FILLS = ["#d4d4d8", "#c7ccd6", "#dcd3c7"];

export interface GeneratedCut {
  image: string;
  prompt: string;
}

// 표지 3안은 서로 독립 호출 — 세션에 누적하면 안(2안)이 안(1안)에 끌려가 서로 비슷해진다.
// TODO(B①): 실제 이미지 생성(독립 호출 3회)으로 교체.
export async function generateCoverVariants(promptBase: string): Promise<GeneratedCut[]> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_GENERATE_DELAY_MS));
  return COVER_VARIANT_FILLS.map((fill, i) => ({
    image: placeholderImage(fill),
    prompt: `${promptBase} (variant ${i + 1})`,
  }));
}

// 나머지 컷은 표지 선택 이후 previous_response_id 체이닝으로 생성 — 여기선 mock이라
// 순서만 지키고 순차 반환한다.
// TODO(B①): previous_response_id 체이닝 실제 생성으로 교체.
export async function generateChainedCuts(prompts: string[]): Promise<GeneratedCut[]> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_GENERATE_DELAY_MS));
  return prompts.map((prompt) => ({ image: placeholderImage("#d4d4d8"), prompt }));
}
