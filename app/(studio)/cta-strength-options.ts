import type { CtaStrength } from "@/lib/llm/narrative-flow";

// #205: 마무리 강도 3단 선택지(왼쪽부터 none → clear). 세션 "말투와 마무리" 화면과
// 온보딩 프로젝트 기본값이 같은 순서·라벨을 써야 하므로 한 곳에서 정의한다.
export const CTA_STRENGTHS: { id: CtaStrength; label: string }[] = [
  { id: "none", label: "이야기만" },
  { id: "soft", label: "은근하게" },
  { id: "clear", label: "확실하게" },
];
