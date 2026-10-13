import type { DirectionVariety } from "@/lib/llm/captions";

// #326 S1: 구도 변화 3단 선택지(왼쪽부터 calm → dynamic, 기본 normal).
// 세션 "말투와 마무리" 화면이 CTA 강도(cta-strength-options.ts)와 같은
// 순서·형태로 쓰도록 한 곳에서 정의한다.
export const DIRECTION_VARIETIES: { id: DirectionVariety; label: string }[] = [
  { id: "calm", label: "차분하게" },
  { id: "normal", label: "보통" },
  { id: "dynamic", label: "다이내믹하게" },
];
