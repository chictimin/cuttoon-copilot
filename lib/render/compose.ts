// 대사 말풍선을 그림 위에 실제로 구워 넣는다(ZIP 내보내기용) — caption.bubble_type/position은
// storyboard.schema.json(A①, 2026-08-19 확정)이 그대로 확정한 필드다.
// instacut(양진형님 공유 참고자료)의 "말풍선 자리 배치 + 시선 흐름" 아이디어를
// Next.js/sharp 조합으로 옮긴 것 — 파이썬 코드 자체는 재사용 안 함.
//
// 주의(프로덕션 배포 시 확인 필요): 리눅스 서버에는 기본적으로 한글 폰트가 없을 수 있다.
// 지금은 이 컴퓨터(Windows, Malgun Gothic)에서 방식만 검증하는 단계 — 실제 배포 전에는
// 폰트를 프로젝트에 직접 포함시키거나 서버에 한글 폰트를 설치해야 한다.

import sharp from "sharp";
import { coversText, type LoadedFont } from "./font";
import type { BubbleType, Caption, Position } from "./types";

const FONT_FAMILY = "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
const PADDING = 24;
const LINE_HEIGHT = 1.3;
const FONT_MAX = 40;
const FONT_MIN = 22;
// 인선님이 공유한 실제 웹툰 참고 이미지는 말풍선이 거의 완전 불투명하다 — 처음엔
// 얼굴을 덜 가리려고 0.85로 반투명하게 뒀지만, 이제 위치/꼬리 자체가 얼굴을 피해서
// 자연스럽게 이어지므로(2026-08-19 이후 수정) 투명도로 눈속임할 필요가 없어졌다.
// 실제 웹툰처럼 진하게 보이도록 거의 불투명하게 되돌린다.
const BUBBLE_OPACITY = 0.98;

// 구석 자리는 일부러 캔버스 경계를 살짝 넘어가게 뒀다 — 인선님 피드백(2026-08-19):
// "화면을 나가도 된다, 그림에 반 걸치고 화면 밖으로 반 걸치고" — 실제 웹툰에서 흔히
// 쓰는 방식이고, 인물(보통 화면 중앙 쪽)에서 멀어지니 얼굴을 덜 가리는 효과도 같이 있다.
// composeCut의 SVG 오버레이가 캔버스 크기 그대로라 경계 밖으로 나간 부분은 자동으로 잘린다.
// (말풍선 도형 자체는 텍스트 박스보다 위아래로 28% 더 커서, 이 값이 0이어도 이미
// 타원 테두리가 살짝 넘어간다 — 텍스트는 안전하게 안쪽에 두면서 도형만 자연스럽게
// 걸치게 하려고 오프셋을 크게 잡지 않았다.)
// bottom_* 는 아래쪽 구석에 두되, 인선님 피드백("꼬리만 가지 말고 말풍선 전체를
// 당겨줘")에 따라 예전(y: 0.66)보다 인물 쪽(화면 중앙)에 확실히 더 가깝게 뒀다.
// top_* 도 같은 이유로 예전(y: 0.0, 캔버스 맨 위)보다 인물(보통 화면 중앙 쪽) 쪽으로
// 당겼다(인선님 피드백 2026-08-20: "사람하고 가깝게 그려줘").
const POSITION_BOX: Record<Position, { x: number; y: number; w: number }> = {
  top_left: { x: -0.03, y: 0.07, w: 0.44 },
  top_right: { x: 0.59, y: 0.07, w: 0.44 },
  bottom_left: { x: 0.0, y: 0.46, w: 0.44 },
  bottom_right: { x: 0.56, y: 0.46, w: 0.44 },
  center: { x: 0.22, y: 0.38, w: 0.56 },
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 실제 폰트 메트릭 없이 대략적인 폭을 추정한다 — 한글/한자 등 non-ASCII는 정사각형에
// 가깝게(fontSize 그대로), 영문/숫자는 좁게(fontSize*0.55) 잡는다.
function charWidth(ch: string, fontSize: number): number {
  return /[\x00-\xff]/.test(ch) ? fontSize * 0.55 : fontSize;
}

function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch, fontSize);
  return w;
}

// 글자 폭 재는 함수 — 프로젝트 웹폰트가 있으면 그 폰트의 실제 폭(#209), 없으면 위 추정값.
type Measure = (text: string, fontSize: number) => number;

function wrapText(text: string, fontSize: number, maxWidth: number, measure: Measure = textWidth): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (measure(trial, fontSize) <= maxWidth) {
      line = trial;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    if (measure(word, fontSize) <= maxWidth) {
      line = word;
      continue;
    }
    // 단어 하나가 통째로 넘치면(주로 공백 없는 한글 문장) 글자 단위로 쪼갠다
    let chunk = "";
    for (const ch of word) {
      if (measure(chunk + ch, fontSize) <= maxWidth || !chunk) {
        chunk += ch;
      } else {
        lines.push(chunk);
        chunk = ch;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function fitText(text: string, maxWidth: number, maxHeight: number, fontMax: number = FONT_MAX, measure: Measure = textWidth) {
  for (let fontSize = fontMax; fontSize >= FONT_MIN; fontSize -= 2) {
    const lines = wrapText(text, fontSize, maxWidth - PADDING * 2, measure);
    if (lines.length * fontSize * LINE_HEIGHT <= maxHeight) {
      return { fontSize, lines };
    }
  }
  return { fontSize: FONT_MIN, lines: wrapText(text, FONT_MIN, maxWidth - PADDING * 2, measure) };
}

const FILL = `fill="white" fill-opacity="${BUBBLE_OPACITY}"`;
const STROKE = `stroke="black" stroke-width="3" stroke-linejoin="round"`;

// 몸통과 꼬리를 반드시 "하나의 도형"(polygon 하나)으로 그린다 — 따로 그려서 겹치면,
// 반투명 채우기 때문에 아래에 깔린 도형의 테두리 선이 위 도형을 통해 비쳐 보여서
// 두 개의 별도 모양처럼 보인다(인선님 피드백 2026-08-19: "원형하고 하나처럼 보여야
// 되는데 2개처럼 보이자나" — 반투명 도형을 두 번 겹쳐 그리면 항상 생기는 문제라,
// 애초에 이음매 없는 폐곡선 하나로 만드는 것 말고는 해결 방법이 없다).
//
// 꼬리 방향/길이: 인물 얼굴 좌표를 실제로는 모른다(storyboard.schema.json에 없음,
// yj78615-blip 리뷰 PR #65에서도 지적됨 — wide 샷이면 인물이 작고 위치도 치우쳐서
// "화면 중앙"이라는 고정 가정이 어긋난다). 그래서 목표점을 하드코딩하지 않고
// composeCut() 호출자가 caption별로 넘길 수 있게 하고(HeadTarget), 안 넘기면
// 기존처럼 "화면 중앙, 세로 42%"(클로즈업/바스트샷 기준 얼굴 위치 근사, 인선님
// 피드백 "입하고 좀 더 가깝게")로 폴백한다.
export interface HeadTarget {
  /** 캔버스 가로 기준 비율(0~1) — 캐릭터 머리가 있는 x 위치 */
  x: number;
  /** 캔버스 세로 기준 비율(0~1) — 캐릭터 머리가 있는 y 위치 */
  y: number;
}

const DEFAULT_HEAD_TARGET: HeadTarget = { x: 0.5, y: 0.42 };

// 꼬리 길이 — 처음엔 "중심→목표점 거리의 85%"로 잡았더니 구석 자리에서 지나치게
// 길어졌고(팀 피드백), 그다음 "몸통 경계선에서 고정된 짧은 길이만 튀어나오게"
// 바꿨더니 이번엔 반대로 목표점(대개 인물 머리)까지 못 미치고 허공에서 끝나
// "머리를 안 향하는 것처럼" 보이는 문제가 생겼다(인선님 피드백 2026-08-20).
//
// 그래서 "몸통 경계선부터 목표점까지 남은 거리의 REACH_RATIO만큼"으로 정한다 —
// 목표점에 가까이 다가가되(REACH_RATIO를 1 미만으로 둬서 얼굴에 완전히 박히진
// 않게) 몸통·목표점 사이 거리에 비례하므로, 말풍선이 인물과 가까우면 짧게, 멀면
// 길게 자동으로 맞춰진다. 다만 목표점이 아주 멀리 있는 극단적 배치까지 대비해
// MAX_PROTRUDE_RATIO로 절대 길이 상한도 같이 둔다.
const TAIL_REACH_RATIO = 0.4;
const MAX_PROTRUDE_RATIO = 0.12;

function tailGeometry(canvasW: number, canvasH: number, cx: number, cy: number, headTarget: HeadTarget) {
  const targetX = canvasW * headTarget.x;
  const targetY = canvasH * headTarget.y;
  const angle = Math.atan2(targetY - cy, targetX - cx);
  const totalDist = Math.hypot(targetX - cx, targetY - cy);
  const maxProtrude = canvasH * MAX_PROTRUDE_RATIO;
  return { angle, totalDist, maxProtrude };
}

// fixedProtrude가 있으면 목표점 거리와 상관없이 그 길이만큼만 튀어나온다 — center용(#170).
// minProtrude는 길이 하한 — center가 화자 쪽으로 꼬리를 낼 때 화자가 몸통 바로 옆이면
// "남은 거리의 40%"가 몇 px밖에 안 돼 꼬리가 안 보여서, 고정 꼬리 길이보다 짧아지지 않게 한다(#199).
export type Tail = {
  angle: number; totalDist: number; maxProtrude: number; fixedProtrude?: number; minProtrude?: number;
};

function protrudeFrom(boundaryDist: number, tail: Tail): number {
  if (tail.fixedProtrude !== undefined) return tail.fixedProtrude;
  const remaining = Math.max(tail.totalDist - boundaryDist, 0);
  return Math.max(Math.min(remaining * TAIL_REACH_RATIO, tail.maxProtrude), tail.minProtrude ?? 0);
}

// center는 원래(2026-08-19) 꼬리를 안 그렸다 — 기본 목표점(화면 중앙, 세로 42%)이
// center 말풍선 몸통 안쪽에 들어가서 방향 자체가 의미가 없기 때문. 그런데 꼬리가
// 없으면 누가 말하는지 안 보여서(#170), 웹툰에서 흔한 "아래쪽 화자를 향한 짧은
// 꼬리"를 고정 방향·고정 길이로 단다. 살짝 왼쪽으로 기울인 건 정확히 수직이면
// 꼬리가 몸통 한가운데에 박혀 장식처럼 보여서다.
const CENTER_TAIL_ANGLE = Math.PI * 0.58;
const CENTER_TAIL_PROTRUDE_RATIO = 0.045;

function centerTail(canvasH: number): Tail {
  return { angle: CENTER_TAIL_ANGLE, totalDist: 0, maxProtrude: 0, fixedProtrude: canvasH * CENTER_TAIL_PROTRUDE_RATIO };
}

// center도 목표점(화자 머리)이 몸통 밖에 있으면 그쪽으로 꼬리를 낸다(#199, PRD 4절
// "꼬리는 화자 방향으로"). 목표점이 몸통 안이면 방향이 의미 없으므로 지금의 고정
// 꼬리로 폴백한다 — 기본 목표점(화면 중앙, 세로 42%)은 늘 center 몸통 안에 들어가서,
// headTarget을 넘기지 않는 호출(지금의 Export)은 결과가 바뀌지 않는다.
// halfW/halfH는 도형의 반폭·반높이(rounded는 타원 반지름, rect/cloud는 박스 절반).
export function resolveTail(
  position: Position, shape: "ellipse" | "box", cx: number, cy: number, halfW: number, halfH: number,
  canvasW: number, canvasH: number, headTarget: HeadTarget,
): Tail {
  if (position !== "center") return tailGeometry(canvasW, canvasH, cx, cy, headTarget);
  const nx = (canvasW * headTarget.x - cx) / halfW;
  const ny = (canvasH * headTarget.y - cy) / halfH;
  const inside = shape === "ellipse" ? nx * nx + ny * ny <= 1 : Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
  if (inside) return centerTail(canvasH);
  return { ...tailGeometry(canvasW, canvasH, cx, cy, headTarget), minProtrude: canvasH * CENTER_TAIL_PROTRUDE_RATIO };
}

// 타원 테두리 중 꼬리가 나갈 좁은 구간만 갈라서, 그 경계점에서 목표점 쪽으로
// protrudeFrom()만큼 튀어나온 뾰족한 끝(tip)을 끼워 넣은, 하나로 이어진 폐곡선.
// instacut 참고자료의 아이디어(그림/텍스트는 재사용 안 함, 수학만 참고).
function ellipsePath(cx: number, cy: number, rx: number, ry: number, tail: Tail | null): string {
  if (!tail) {
    const steps = 64;
    const pts = Array.from({ length: steps }, (_, i) => {
      const a = (2 * Math.PI * i) / steps;
      return `${cx + rx * Math.cos(a)},${cy + ry * Math.sin(a)}`;
    });
    return `<polygon points="${pts.join(" ")}" ${FILL} ${STROKE}/>`;
  }
  const rootHalf = 0.05; // 아주 좁게 — 꼬리 뿌리가 가늘어야 한다
  const steps = 60;
  const span = 2 * Math.PI - 2 * rootHalf;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = tail.angle + rootHalf + (span * i) / steps;
    pts.push(`${cx + rx * Math.cos(a)},${cy + ry * Math.sin(a)}`);
  }
  const boundaryX = cx + rx * Math.cos(tail.angle);
  const boundaryY = cy + ry * Math.sin(tail.angle);
  const boundaryDist = Math.hypot(boundaryX - cx, boundaryY - cy);
  const protrude = protrudeFrom(boundaryDist, tail);
  const tipX = boundaryX + Math.cos(tail.angle) * protrude;
  const tipY = boundaryY + Math.sin(tail.angle) * protrude;
  pts.push(`${tipX},${tipY}`);
  return `<polygon points="${pts.join(" ")}" ${FILL} ${STROKE}/>`;
}

// 사각형(rect/cloud 바탕)도 같은 원리 — 중심에서 꼬리 방향으로 쏜 광선이 변과 만나는
// 지점을 찾아, 그 경계점에서 목표점 쪽으로 protrudeFrom()만큼 튀어나온 끝을 그
// 자리에 갈라 끼운다.
function rectPath(x: number, y: number, w: number, h: number, rx: number, tail: Tail | null): string {
  const corners: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  if (!tail) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ry="${rx}" ${FILL} ${STROKE}/>`;
  }

  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = Math.cos(tail.angle);
  const dy = Math.sin(tail.angle);
  const hw = w / 2;
  const hh = h / 2;
  const tX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const tY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);
  const exitX = cx + dx * t;
  const exitY = cy + dy * t;
  const protrude = protrudeFrom(t, tail);
  const tipX = exitX + dx * protrude;
  const tipY = exitY + dy * protrude;
  const onVerticalEdge = tX < tY; // 좌/우 변에서 나감 -> 세로 방향이 그 변의 접선
  const spread = Math.min(w, h) * 0.045;
  const tangent: [number, number] = onVerticalEdge ? [0, 1] : [1, 0];
  const p1: [number, number] = [exitX + tangent[0] * spread, exitY + tangent[1] * spread];
  const p2: [number, number] = [exitX - tangent[0] * spread, exitY - tangent[1] * spread];

  // 사각형 꼭짓점을 순서대로 훑다가, exit 지점이 속한 변에서 p2 -> tip -> p1로 갈라 끼운다.
  const pts: string[] = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    pts.push(`${ax},${ay}`);
    const onThisEdge = Math.min(ax, bx) - 0.01 <= exitX && exitX <= Math.max(ax, bx) + 0.01
      && Math.min(ay, by) - 0.01 <= exitY && exitY <= Math.max(ay, by) + 0.01;
    if (onThisEdge) {
      pts.push(`${p2[0]},${p2[1]}`, `${tipX},${tipY}`, `${p1[0]},${p1[1]}`);
    }
  }
  return `<polygon points="${pts.join(" ")}" ${FILL} ${STROKE}/>`;
}

// x, y는 이미 필요한 보정(둥근 타입의 상단 넘침 보정 등, captionSvg 참고)이 끝난
// 최종 좌표여야 한다 — 글씨 위치도 같은 x, y를 기준으로 그려지므로, 여기서 좌표를
// 다시 바꾸면 몸통과 글씨가 어긋난다(2026-08-20: 이전엔 여기서 cy를 따로 보정해서
// 몸통은 밀렸는데 글씨는 원래 자리에 남아 "글씨가 위에 떠있는" 결함이 있었다).
function bubbleShapeSvg(
  bubbleType: BubbleType, x: number, y: number, w: number, h: number,
  position: Position, canvasW: number, canvasH: number, headTarget: HeadTarget,
  radii: { rx: number; ry: number },
): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const tail = bubbleType === "rounded"
    ? resolveTail(position, "ellipse", cx, cy, radii.rx, radii.ry, canvasW, canvasH, headTarget)
    : resolveTail(position, "box", cx, cy, w / 2, h / 2, canvasW, canvasH, headTarget);

  if (bubbleType === "rect") {
    return rectPath(x, y, w, h, 6, tail);
  }
  if (bubbleType === "cloud") {
    // 단순화 버전: 둥근 사각형(꼬리 포함, 한 도형) + 위쪽 가장자리에 작은 원 몇 개로 구름 느낌만 낸다.
    const base = rectPath(x, y, w, h, h / 2, tail);
    const bumps = [0.15, 0.35, 0.55, 0.75].map((f) => {
      const bx = x + w * f;
      const r = h * 0.14;
      return `<circle cx="${bx}" cy="${y}" r="${r}" ${FILL} ${STROKE}/>`;
    }).join("");
    return `${base}${bumps}`;
  }
  // rounded: 사각형이 아니라 실제 웹툰처럼 타원으로 — 크기는 ellipseRadii()가 정한다
  return ellipsePath(cx, cy, radii.rx, radii.ry, tail);
}

// rounded 타원 크기. 가로는 텍스트 박스의 1.12배, 세로는 1.28배가 기본이다. 그런데
// 대사가 길어 줄이 많아지면 맨 윗줄·아랫줄 양 끝(텍스트 박스의 모서리 쪽)이 타원
// 곡선 밖으로 삐져나가 글자가 테두리에 닿았다(#170, 9/30 QA — 7줄에서 첫 줄이 닿음).
// 타원 식 (a/rx)² + (b/ry)² ≤ 1 로, 가장 긴 줄의 반폭(a)과 글자 묶음의 반높이(b)가
// 여유(ELLIPSE_TEXT_FIT) 안에 들어오도록 필요하면 세로만 더 키운다 — 짧은 대사는
// 기본 크기 그대로라 모양이 안 바뀐다.
const ELLIPSE_TEXT_FIT = 0.85;

function ellipseRadii(w: number, bubbleH: number, widestLine: number, textH: number) {
  const rx = (w / 2) * 1.12;
  let ry = (bubbleH / 2) * 1.28;
  const a = widestLine / 2;
  const b = textH / 2;
  const xShare = Math.min((a / rx) ** 2, ELLIPSE_TEXT_FIT * 0.9);
  const needRy = b / Math.sqrt(ELLIPSE_TEXT_FIT - xShare);
  if (needRy > ry) ry = needRy;
  return { rx, ry };
}

// 말풍선 도형(테두리)은 구석 자리에서 일부러 캔버스 밖으로 살짝 걸치지만(위
// POSITION_BOX 주석, 2026-08-19), 글자는 항상 캔버스 안쪽 TEXT_SAFE_MARGIN 안에
// 있어야 한다 — 글자 폭 추정 기준으로 top_right의 긴 줄 끝이 1024px 캔버스에서
// 약 1030px까지 나가는 경우가 있었다(#169).
const TEXT_SAFE_MARGIN = 16;
// 이 줄 수를 넘으면 "살짝 걸침"을 그만두고 도형 전체를 캔버스 안으로 당긴다 —
// 말풍선이 세로로 길어지면 같은 폭만큼 걸쳐도 잘린 테두리가 길게 보여서(#169).
const OVERHANG_MAX_LINES = 3;
// center는 줄이 많아지면 위아래로 커져 인물을 덮으므로(#170), 먼저 옆으로 넓혀
// 줄 수를 줄인다 — 캔버스 폭의 CENTER_MAX_W까지.
const CENTER_MAX_W = 0.8;
const CENTER_WIDEN_STEP = 0.04;
const ROUNDED_WRAP_RATIO = 0.9;
// 줄이 많아 도형 전체를 안으로 당길 때 테두리 선(두께 3) 절반이 잘리지 않을 만큼만 띄운다.
const STROKE_MARGIN = 2;

const VALID_BUBBLE_TYPES: BubbleType[] = ["rounded", "rect", "cloud"];

function captionSvg(caption: Caption, canvasW: number, canvasH: number, headTarget: HeadTarget, font: LoadedFont | null = null): string {
  // storyboard.schema.json의 enum 밖의 값이 저장 시점 검증을 뚫고 들어올 수 있다
  // (app/api/session/validate.ts는 아직 필드별 enum까지는 안 봄, #70). lib/render/는
  // 라이브러리 계층이라 호출자가 무엇을 넘기든 예외로 죽지 않는 편이 맞다고 보고
  // center/rounded로 폴백한다.
  //
  // #79: 폴백된 값을 한 번만 정하고 이후(box·shape·tail) 전부 그 값을 써야 한다 —
  // box만 폴백하고 tailSvg()엔 원본을 넘기면 몸통은 center인데 꼬리는 안 그려져야
  // 할 자리에 그려지는 식으로 서로 어긋난다.
  const position: Position = caption.position in POSITION_BOX ? caption.position : "center";
  if (position !== caption.position) {
    console.warn(`[compose] 알 수 없는 caption.position "${caption.position}" — center로 폴백`);
  }
  const bubbleType: BubbleType = VALID_BUBBLE_TYPES.includes(caption.bubble_type)
    ? caption.bubble_type
    : "rounded";
  if (bubbleType !== caption.bubble_type) {
    console.warn(`[compose] 알 수 없는 caption.bubble_type "${caption.bubble_type}" — rounded로 폴백`);
  }

  // 프로젝트 웹폰트(#209): 대사의 모든 글자가 그 폰트에 있을 때만 쓴다 — 한 글자라도 없으면
  // 그 글자가 빈 칸으로 그려지므로, 이 대사는 지금처럼 시스템 폰트로 그린다.
  const useFont = font && coversText(font, caption.text) ? font : null;
  const measure: Measure = useFont ? (t, size) => useFont.getAdvanceWidth(t, size) : textWidth;

  const box = POSITION_BOX[position];
  let x = box.x * canvasW;
  let maxWidth = box.w * canvasW;
  const maxHeight = canvasH * 0.3;

  // rounded는 글자를 박스 폭보다 조금 좁게 감싼다 — 줄 양 끝이 타원 곡선에 덜 걸려서
  // ellipseRadii()가 세로를 덜 키워도 된다(#170).
  const wrapWidth = (w: number) => (bubbleType === "rounded" ? w * ROUNDED_WRAP_RATIO : w);

  let { fontSize, lines } = fitText(caption.text, wrapWidth(maxWidth), maxHeight, FONT_MAX, measure);

  if (position === "center") {
    // 줄이 OVERHANG_MAX_LINES를 넘으면 가운데를 기준으로 폭을 넓혀 줄 수를 줄인다(#170).
    // 글자 크기는 원래 폭에서 정해진 값을 넘지 않게 묶는다 — 안 묶으면 폭이 넓어진
    // 만큼 fitText가 글자를 키워 버려서 줄 수(=높이)가 그대로다(9/30 테스트에서 확인).
    const baseFont = fontSize;
    let w = box.w;
    while (lines.length > OVERHANG_MAX_LINES && w + CENTER_WIDEN_STEP <= CENTER_MAX_W + 1e-9) {
      w += CENTER_WIDEN_STEP;
      ({ fontSize, lines } = fitText(caption.text, wrapWidth(w * canvasW), maxHeight, baseFont, measure));
    }
    maxWidth = w * canvasW;
    x = ((1 - w) / 2) * canvasW;
  }

  const textH = lines.length * fontSize * LINE_HEIGHT;
  const bubbleH = textH + PADDING * 2;
  const widestLine = Math.max(...lines.map((l) => measure(l, fontSize)));
  const radii = ellipseRadii(maxWidth, bubbleH, widestLine, textH);
  let y = box.y * canvasH;

  // 좌우 경계(#169). 도형은 짧은 대사에서만 살짝 걸치게 두고, 줄이 많으면 도형 전체를
  // 캔버스 안으로 당긴다. 어느 경우든 글자는 TEXT_SAFE_MARGIN 안쪽에 둔다.
  {
    const cx = x + maxWidth / 2;
    const shapeHalf = bubbleType === "rounded" ? radii.rx : maxWidth / 2;
    const keepHalf = lines.length > OVERHANG_MAX_LINES ? shapeHalf : widestLine / 2;
    const margin = lines.length > OVERHANG_MAX_LINES ? STROKE_MARGIN : TEXT_SAFE_MARGIN;
    const overRight = cx + keepHalf - (canvasW - margin);
    const overLeft = margin - (cx - keepHalf);
    if (overRight > 0) x -= overRight;
    else if (overLeft > 0) x += overLeft;
  }

  // rounded는 텍스트 박스보다 위아래로 28% 더 큰 타원이라, top_left/top_right처럼
  // y가 0에 가까운 자리에서는 타원 윗부분이 캔버스 경계(0) 위로 넘어간다. composeCut의
  // 오버레이는 클리핑 없이 그대로 합성되므로 타원 윗부분이 수평으로 잘려 반원+삼각형
  // 조합처럼 보이는 결함이 생긴다(joniverse-ai 리뷰, PR #65). 넘어간 만큼만 아래로
  // 밀어서 온전한 타원 모양을 유지한다 — 이 보정된 y를 몸통(bubbleShapeSvg)과 글씨
  // (firstLineY) 양쪽에 다 써야 서로 어긋나지 않는다(전에는 몸통만 보정하고 글씨는
  // 원래 y를 써서 "글씨가 위에 떠있는" 결함이 있었다).
  if (bubbleType === "rounded") {
    const cy = y + bubbleH / 2;
    const overflowTop = radii.ry - cy;
    if (overflowTop > 0) y += overflowTop;
  }

  // #79/#92 fallback을 여기서도 그대로 이어받는다 — bubbleShapeSvg에 원본 caption.*을
  // 넘기면 몸통/꼬리 계산에 유효하지 않은 enum이 들어가 버리므로, 위에서 이미
  // center/rounded로 정리한 position/bubbleType을 넘긴다.
  const shape = bubbleShapeSvg(bubbleType, x, y, maxWidth, bubbleH, position, canvasW, canvasH, headTarget, radii);

  const cx = x + maxWidth / 2;
  const firstLineY = y + PADDING + fontSize * 0.85;
  let text: string;
  if (useFont) {
    // 글자를 패스로 바꿔 넣는다 — 시스템 폰트와 무관하게 OS마다 같은 모양(#209 (가)안).
    // 굵기는 폰트 파일의 굵기를 따른다(굵게 쓰려면 웹폰트 주소에 굵은 굵기를 지정).
    text = lines
      .map((line, i) => {
        const x0 = cx - measure(line, fontSize) / 2;
        const d = useFont.getPath(line, x0, firstLineY + i * fontSize * LINE_HEIGHT, fontSize).toPathData(2);
        return d ? `<path d="${d}" fill="black"/>` : "";
      })
      .join("");
  } else {
    const tspans = lines
      .map((line, i) => `<tspan x="${cx}" y="${firstLineY + i * fontSize * LINE_HEIGHT}">${escapeXml(line)}</tspan>`)
      .join("");
    text = `<text text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="bold" fill="black">${tspans}</text>`;
  }

  return `${shape}${text}`;
}

// headTargets[i]는 captions[i]에 대응한다 — 생략하거나 특정 인덱스가 없으면
// DEFAULT_HEAD_TARGET(화면 중앙, 세로 42%)으로 폴백한다. 실제 인물 위치를 아는
// 호출자(예: 수동 보정, 향후 얼굴 검출 결과)가 캡션별로 꼬리 목표점을 옮길 수
// 있게 하기 위한 것 — storyboard.schema.json의 Caption 자체는 바꾸지 않는다
// (additionalProperties: false와 충돌하지 않도록).
// font: 프로젝트 웹폰트(#209, lib/render/font.ts의 loadFont 결과). null이면 지금처럼 시스템 폰트.
export async function composeCut(
  imageBuffer: Buffer, captions: Caption[], headTargets?: (HeadTarget | undefined)[], font: LoadedFont | null = null,
): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const meta = await image.metadata();
  const canvasW = meta.width ?? 1080;
  const canvasH = meta.height ?? 1080;

  const overlaySvg = `
    <svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
      ${captions.map((c, i) => captionSvg(c, canvasW, canvasH, headTargets?.[i] ?? DEFAULT_HEAD_TARGET, font)).join("\n")}
    </svg>
  `;

  return image
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
