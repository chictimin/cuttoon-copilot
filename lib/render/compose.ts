// 대사 말풍선을 그림 위에 실제로 구워 넣는다(ZIP 내보내기용) — caption.bubble_type/position은
// storyboard.schema.json(A①, 2026-08-19 확정)이 그대로 확정한 필드다.
// instacut(양진형님 공유 참고자료)의 "말풍선 자리 배치 + 시선 흐름" 아이디어를
// Next.js/sharp 조합으로 옮긴 것 — 파이썬 코드 자체는 재사용 안 함.
//
// 주의(프로덕션 배포 시 확인 필요): 리눅스 서버에는 기본적으로 한글 폰트가 없을 수 있다.
// 지금은 이 컴퓨터(Windows, Malgun Gothic)에서 방식만 검증하는 단계 — 실제 배포 전에는
// 폰트를 프로젝트에 직접 포함시키거나 서버에 한글 폰트를 설치해야 한다.

import sharp from "sharp";
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
const POSITION_BOX: Record<Position, { x: number; y: number; w: number }> = {
  top_left: { x: -0.03, y: 0.0, w: 0.44 },
  top_right: { x: 0.59, y: 0.0, w: 0.44 },
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

function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (textWidth(trial, fontSize) <= maxWidth) {
      line = trial;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    if (textWidth(word, fontSize) <= maxWidth) {
      line = word;
      continue;
    }
    // 단어 하나가 통째로 넘치면(주로 공백 없는 한글 문장) 글자 단위로 쪼갠다
    let chunk = "";
    for (const ch of word) {
      if (textWidth(chunk + ch, fontSize) <= maxWidth || !chunk) {
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

function fitText(text: string, maxWidth: number, maxHeight: number) {
  for (let fontSize = FONT_MAX; fontSize >= FONT_MIN; fontSize -= 2) {
    const lines = wrapText(text, fontSize, maxWidth - PADDING * 2);
    if (lines.length * fontSize * LINE_HEIGHT <= maxHeight) {
      return { fontSize, lines };
    }
  }
  return { fontSize: FONT_MIN, lines: wrapText(text, FONT_MIN, maxWidth - PADDING * 2) };
}

const FILL = `fill="white" fill-opacity="${BUBBLE_OPACITY}"`;
const STROKE = `stroke="black" stroke-width="3" stroke-linejoin="round"`;

// 몸통과 꼬리를 반드시 "하나의 도형"(polygon 하나)으로 그린다 — 따로 그려서 겹치면,
// 반투명 채우기 때문에 아래에 깔린 도형의 테두리 선이 위 도형을 통해 비쳐 보여서
// 두 개의 별도 모양처럼 보인다(인선님 피드백 2026-08-19: "원형하고 하나처럼 보여야
// 되는데 2개처럼 보이자나" — 반투명 도형을 두 번 겹쳐 그리면 항상 생기는 문제라,
// 애초에 이음매 없는 폐곡선 하나로 만드는 것 말고는 해결 방법이 없다).
//
// 꼬리 방향/길이: 인물 얼굴 좌표를 실제로는 모른다(스키마에 없음) — 대신 "인물은 보통
// 화면 중앙 쪽에 있다"는 가정으로 캔버스 중심 쪽을 향해 가늘고 길게 뻗는다.
function tailGeometry(canvasW: number, canvasH: number, cx: number, cy: number) {
  // 정중앙보다 살짝 위쪽을 조준한다 — 클로즈업/바스트샷에서 얼굴(특히 입)이 보통
  // 화면 세로 중앙보다 조금 위에 오기 때문(인선님 피드백: "입하고 좀 더 가깝게").
  const targetX = canvasW / 2;
  const targetY = canvasH * 0.42;
  const angle = Math.atan2(targetY - cy, targetX - cx);
  const reach = 0.85; // 목표점 쪽으로 그 거리의 85%까지 — 더 바짝 붙이되 완전히 덮진 않게
  const tip: [number, number] = [cx + (targetX - cx) * reach, cy + (targetY - cy) * reach];
  return { angle, tip };
}

// 타원 테두리 중 꼬리가 나갈 좁은 구간만 갈라서 뾰족한 끝(tip)을 끼워 넣은, 하나로
// 이어진 폐곡선. instacut 참고자료의 아이디어(그림/텍스트는 재사용 안 함, 수학만 참고).
function ellipsePath(cx: number, cy: number, rx: number, ry: number, tail: { angle: number; tip: [number, number] } | null): string {
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
  pts.push(`${tail.tip[0]},${tail.tip[1]}`);
  return `<polygon points="${pts.join(" ")}" ${FILL} ${STROKE}/>`;
}

// 사각형(rect/cloud 바탕)도 같은 원리 — 중심에서 꼬리 방향으로 쏜 광선이 변과 만나는
// 지점을 찾아 그 자리만 갈라서 꼬리를 끼운다.
function rectPath(x: number, y: number, w: number, h: number, rx: number, tail: { angle: number; tip: [number, number] } | null): string {
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
      pts.push(`${p2[0]},${p2[1]}`, `${tail.tip[0]},${tail.tip[1]}`, `${p1[0]},${p1[1]}`);
    }
  }
  return `<polygon points="${pts.join(" ")}" ${FILL} ${STROKE}/>`;
}

function bubbleShapeSvg(
  bubbleType: BubbleType, x: number, y: number, w: number, h: number,
  position: Position, canvasW: number, canvasH: number,
): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const tail = position === "center" ? null : tailGeometry(canvasW, canvasH, cx, cy);

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
  // rounded: 사각형이 아니라 실제 웹툰처럼 타원으로 — 텍스트 박스보다 넉넉하게 감싼다
  const rx = (w / 2) * 1.12;
  const ry = (h / 2) * 1.28;
  return ellipsePath(cx, cy, rx, ry, tail);
}

function captionSvg(caption: Caption, canvasW: number, canvasH: number): string {
  const box = POSITION_BOX[caption.position];
  const x = box.x * canvasW;
  const maxWidth = box.w * canvasW;
  const maxHeight = canvasH * 0.3;

  const { fontSize, lines } = fitText(caption.text, maxWidth, maxHeight);
  const textH = lines.length * fontSize * LINE_HEIGHT;
  const bubbleH = textH + PADDING * 2;
  const y = box.y * canvasH;

  const shape = bubbleShapeSvg(caption.bubble_type, x, y, maxWidth, bubbleH, caption.position, canvasW, canvasH);

  const cx = x + maxWidth / 2;
  const firstLineY = y + PADDING + fontSize * 0.85;
  const tspans = lines
    .map((line, i) => `<tspan x="${cx}" y="${firstLineY + i * fontSize * LINE_HEIGHT}">${escapeXml(line)}</tspan>`)
    .join("");
  const text = `<text text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="bold" fill="black">${tspans}</text>`;

  return `${shape}${text}`;
}

export async function composeCut(imageBuffer: Buffer, captions: Caption[]): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const meta = await image.metadata();
  const canvasW = meta.width ?? 1080;
  const canvasH = meta.height ?? 1080;

  const overlaySvg = `
    <svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
      ${captions.map((c) => captionSvg(c, canvasW, canvasH)).join("\n")}
    </svg>
  `;

  return image
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
