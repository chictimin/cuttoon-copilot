// #260: 화면에 보이는 값 이름. 저장·전송하는 값은 영문 키 그대로 두고, 보여 줄 때만 한글로 바꾼다.
// 목록에 없는 값(스키마가 늘어난 경우)은 원래 값을 그대로 보여 준다.

const NARRATIVE_BEAT_LABELS: Record<string, string> = {
  hook: "도입",
  problem: "문제",
  solution: "해결",
  cta: "마무리",
  question: "질문",
  fact: "사실",
  benefit: "이점",
  before: "이전",
  turning: "전환",
  after: "이후",
};

const LINE_WEIGHT_LABELS: Record<string, string> = {
  thin: "가늘게",
  medium: "보통",
  thick: "굵게",
};

const CHARACTER_RATIO_LABELS: Record<string, string> = {
  "2head": "2등신",
  "2.5head": "2.5등신",
  "3head": "3등신",
  realistic: "실사 비율",
};

const BUBBLE_STYLE_LABELS: Record<string, string> = {
  rounded: "둥근형",
  rect: "사각형",
  cloud: "구름형",
};

export const beatLabel = (v: string) => NARRATIVE_BEAT_LABELS[v] ?? v;
export const lineWeightLabel = (v: string) => LINE_WEIGHT_LABELS[v] ?? v;
export const characterRatioLabel = (v: string) => CHARACTER_RATIO_LABELS[v] ?? v;
export const bubbleStyleLabel = (v: string) => BUBBLE_STYLE_LABELS[v] ?? v;
