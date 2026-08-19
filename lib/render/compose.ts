// 대사 말풍선을 그림 위에 실제로 구워 넣는다(ZIP 내보내기용) — position/bubbleType은
// 이미 spec/vocabulary.json에 확정된 값이라 storyboard.schema.json이 아직 없어도
// 안전하게 구현할 수 있다. instacut(양진형님 공유 참고자료)의 "말풍선 자리 배치 +
// 시선 흐름" 아이디어를 Next.js/sharp 조합으로 옮긴 것 — 파이썬 코드 자체는 재사용 안 함.
//
// 주의(프로덕션 배포 시 확인 필요): 리눅스 서버에는 기본적으로 한글 폰트가 없을 수 있다.
// 지금은 이 컴퓨터(Windows, Malgun Gothic)에서 방식만 검증하는 단계 — 실제 배포 전에는
// 폰트를 프로젝트에 직접 포함시키거나 서버에 한글 폰트를 설치해야 한다.

import sharp from "sharp";
import type { BubbleType, CaptionInput, Position } from "./types";

const FONT_FAMILY = "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
const PADDING = 24;
const LINE_HEIGHT = 1.3;
const FONT_MAX = 40;
const FONT_MIN = 22;

const POSITION_BOX: Record<Position, { x: number; y: number; w: number }> = {
  top_left: { x: 0.04, y: 0.04, w: 0.44 },
  top_right: { x: 0.52, y: 0.04, w: 0.44 },
  bottom_left: { x: 0.04, y: 0.62, w: 0.44 },
  bottom_right: { x: 0.52, y: 0.62, w: 0.44 },
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

function bubbleShapeSvg(bubbleType: BubbleType, x: number, y: number, w: number, h: number): string {
  const stroke = `stroke="black" stroke-width="3" fill="white"`;
  if (bubbleType === "rect") {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" ry="6" ${stroke}/>`;
  }
  if (bubbleType === "cloud") {
    // 단순화 버전: 둥근 사각형 + 위쪽 가장자리에 작은 원 몇 개로 구름 느낌만 낸다.
    const bumps = [0.15, 0.35, 0.55, 0.75].map((f) => {
      const cx = x + w * f;
      const r = h * 0.14;
      return `<circle cx="${cx}" cy="${y}" r="${r}" ${stroke}/>`;
    }).join("");
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ry="${h / 2}" ${stroke}/>${bumps}`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28" ry="28" ${stroke}/>`;
}

function tailSvg(position: Position, x: number, y: number, w: number, h: number): string {
  // 위쪽 자리 말풍선은 꼬리가 아래(그림 쪽)를 향하고, 아래쪽 자리는 위(그림 쪽)를 향한다.
  const isUpper = position === "top_left" || position === "top_right";
  const cx = x + w / 2;
  if (position === "center") return "";
  if (isUpper) {
    const tipY = y + h + h * 0.22;
    return `<polygon points="${cx - 16},${y + h - 4} ${cx + 16},${y + h - 4} ${cx},${tipY}" fill="white" stroke="black" stroke-width="3"/>`;
  }
  const tipY = y - h * 0.22;
  return `<polygon points="${cx - 16},${y + 4} ${cx + 16},${y + 4} ${cx},${tipY}" fill="white" stroke="black" stroke-width="3"/>`;
}

function captionSvg(caption: CaptionInput, canvasW: number, canvasH: number): string {
  const box = POSITION_BOX[caption.position];
  const x = box.x * canvasW;
  const maxWidth = box.w * canvasW;
  const maxHeight = canvasH * 0.3;

  const { fontSize, lines } = fitText(caption.text, maxWidth, maxHeight);
  const textH = lines.length * fontSize * LINE_HEIGHT;
  const bubbleH = textH + PADDING * 2;
  const y = box.y * canvasH;

  const shape = bubbleShapeSvg(caption.bubbleType, x, y, maxWidth, bubbleH);
  const tail = tailSvg(caption.position, x, y, maxWidth, bubbleH);

  const cx = x + maxWidth / 2;
  const firstLineY = y + PADDING + fontSize * 0.85;
  const tspans = lines
    .map((line, i) => `<tspan x="${cx}" y="${firstLineY + i * fontSize * LINE_HEIGHT}">${escapeXml(line)}</tspan>`)
    .join("");
  const text = `<text text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${fontSize}" fill="black">${tspans}</text>`;

  return `${shape}${tail}${text}`;
}

export async function composeCut(imageBuffer: Buffer, captions: CaptionInput[]): Promise<Buffer> {
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
