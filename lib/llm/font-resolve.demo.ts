// issue #209 F2 resolveFontSource 실실행 케이스 (verify #11).
// 실행: npx tsx lib/llm/font-resolve.demo.ts (~10초+ 소요, 느린 본문 1건 탓)
// in-process 루프백 HTTP 서버를 띄워 spec-209 rev2 5절 T1′ 15종을 실실행한다.
// 루프백 허용 정책은 이 demo 파일 안에서만 정의한다(제품 코드 금지, verify #14).
// 폰트 fixture 바이트는 opentype.js로 메모리에서 만든다(바이너리 추가 없음).
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import opentype from "opentype.js";
import {
  httpsOnly,
  resolveFontSource,
  type FontKind,
  type FontResolveReason,
  type UrlPolicy,
} from "@/lib/render/font";

let failed = 0;

function check(name: string, pass: boolean, detail?: string): void {
  if (pass) {
    console.log(`ok   ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${detail ? ` (받은 값: ${detail})` : ""}`);
  }
}

function buildFontBytes(): Buffer {
  const notdef = new opentype.Glyph({
    name: ".notdef",
    unicode: 0,
    advanceWidth: 500,
    path: new opentype.Path(),
  });
  const font = new opentype.Font({
    familyName: "Demo",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [notdef],
  });
  return stabilize(Buffer.from(font.toArrayBuffer()));
}

/**
 * 생성 시각(head.created·modified)과 그로 계산된 checkSumAdjustment를 0으로 지워
 * 실행마다 같은 바이트가 나오게 한다. opentype.parse는 체크섬을 검증하지 않아
 * 판정에 영향이 없다.
 */
function stabilize(buf: Buffer): Buffer {
  const out = Buffer.from(buf);
  const numTables = out.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    out.fill(0, off + 4, off + 8); // sfnt 디렉토리 checkSum (테이블 내용 기반)
    if (out.toString("ascii", off, off + 4) !== "head") continue;
    const tableOff = out.readUInt32BE(off + 8);
    out.fill(0, tableOff + 8, tableOff + 12); // checkSumAdjustment
    out.fill(0, tableOff + 20, tableOff + 36); // created + modified
  }
  return out;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const fontBytes = buildFontBytes();
  const sha256 = createHash("sha256").update(fontBytes).digest("hex");

  // --- fixture 서버 B: redirect 최종 URL용(메인 정책에서 거부됨) ---
  const serverB = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "content-type": "font/ttf" }).end(fontBytes);
  });
  const portB = await listen(serverB);
  const baseB = `http://127.0.0.1:${portB}`;

  // --- fixture 서버 A: 15종 ---
  let base = "";
  const serverA = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.on("error", () => {});
    const path = (req.url ?? "").split("?")[0];
    const cssAbs =
      `@font-face{font-family:'Woff2 Only';src:url(${base}/font.woff2) format('woff2')}` +
      `@font-face{font-family:'Abs Family';src:url(${base}/valid.ttf)}`;
    switch (path) {
      case "/valid.ttf":
      case "/assets/valid.ttf":
        res.writeHead(200, { "content-type": "font/ttf" }).end(fontBytes);
        break;
      case "/css-abs.css":
        res.writeHead(200, { "content-type": "text/css" }).end(cssAbs);
        break;
      case "/assets/rel.css":
        res.writeHead(200, { "content-type": "text/css" }).end(
          `@font-face{font-family:"Rel Family";src:url(valid.ttf)}`,
        );
        break;
      case "/redir/dir/css":
        res.writeHead(302, { location: "/assets/rel.css" }).end();
        break;
      case "/css-404.css":
        res.writeHead(200, { "content-type": "text/css" }).end(
          `@font-face{font-family:'Missing';src:url(${base}/missing.ttf)}`,
        );
        break;
      case "/missing.ttf":
        res.writeHead(404, { "content-type": "text/plain" }).end("no such font");
        break;
      case "/css-woff2.css":
        res.writeHead(200, { "content-type": "text/css" }).end(
          `@font-face{font-family:'Woff2';src:url(${base}/fake.ttf)}`,
        );
        break;
      case "/fake.ttf":
        res.writeHead(200, { "content-type": "font/ttf" }).end(
          Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(100)]),
        );
        break;
      case "/css-unusable.css":
        res.writeHead(200, { "content-type": "text/css" }).end(
          "@font-face{font-family:'Unusable';" +
            "src:url(data:font/ttf;base64,AAAA) format('truetype')," +
            "url(http://example.com/x.ttf)}",
        );
        break;
      case "/broken.ttf":
        res.writeHead(200, { "content-type": "font/ttf" }).end(Buffer.from("not a font at all...."));
        break;
      case "/empty.ttf":
        res.writeHead(200, { "content-type": "font/ttf" }).end(Buffer.alloc(0));
        break;
      case "/page.html":
        res.writeHead(200, { "content-type": "text/html" }).end("<html><body>hi</body></html>");
        break;
      case "/redirect-reject":
        res.writeHead(302, { location: `${baseB}/valid-b.ttf` }).end();
        break;
      case "/gzip.ttf":
        res.writeHead(200, { "content-type": "font/ttf", "content-encoding": "gzip" }).end(gzipSync(fontBytes));
        break;
      case "/bom.css":
        res.writeHead(200, { "content-type": "text/css" }).end(
          "﻿/* 앞선 주석 */@font-face{font-family:Bom Family;" +
            `src:url(${base}/valid.ttf)}`,
        );
        break;
      case "/big.ttf": {
        res.writeHead(200, { "content-type": "font/ttf" });
        const chunk = Buffer.alloc(256 * 1024, 1);
        let sent = 0;
        const total = 30 * 1024 * 1024 + 1;
        const pump = (): void => {
          if (sent >= total || res.destroyed) return;
          const n = Math.min(chunk.byteLength, total - sent);
          sent += n;
          if (!res.write(n === chunk.byteLength ? chunk : chunk.subarray(0, n))) {
            res.once("drain", pump);
            return;
          }
          setImmediate(pump);
        };
        pump();
        break;
      }
      case "/slow.ttf":
        void sleep(12_000).then(() => {
          if (!res.destroyed) res.writeHead(200, { "content-type": "font/ttf" }).end(fontBytes);
        });
        break;
      default:
        res.writeHead(404, { "content-type": "text/plain" }).end("no fixture");
        break;
    }
  });
  const portA = await listen(serverA);
  base = `http://127.0.0.1:${portA}`;

  // 루프백 허용 정책 — 이 demo 안에서만 정의한다(제품 코드에 두지 않음).
  const loopbackPolicy: UrlPolicy = (url) =>
    url.protocol === "http:" && url.host === `127.0.0.1:${portA}`;

  type Expect =
    | { ok: true; kind: FontKind; family: string | null }
    | { ok: false; reason: FontResolveReason };
  const cases: { name: string; path: string; expectKind?: FontKind; expect: Expect }[] = [
    { name: "css 절대 src (교차 블록→둘째 family)", path: "/css-abs.css", expect: { ok: true, kind: "css", family: "Abs Family" } },
    { name: "css 상대 src", path: "/assets/rel.css", expect: { ok: true, kind: "css", family: "Rel Family" } },
    { name: "redirect 후 base 기준 상대 해석", path: "/redir/dir/css", expect: { ok: true, kind: "css", family: "Rel Family" } },
    { name: "선택 src 404", path: "/css-404.css", expect: { ok: false, reason: "http_status" } },
    { name: "선택 src WOFF2 바이트", path: "/css-woff2.css", expect: { ok: false, reason: "woff2" } },
    { name: "src data:·http:만", path: "/css-unusable.css", expect: { ok: false, reason: "css_no_usable_src" } },
    { name: "손상 파일", path: "/broken.ttf", expect: { ok: false, reason: "parse_failed" } },
    { name: "0바이트", path: "/empty.ttf", expect: { ok: false, reason: "empty_body" } },
    { name: "HTML 200", path: "/page.html", expect: { ok: false, reason: "parse_failed" } },
    { name: "redirect 최종 정책 거부", path: "/redirect-reject", expect: { ok: false, reason: "url_rejected" } },
    { name: "gzip 전송 정상", path: "/gzip.ttf", expect: { ok: true, kind: "file", family: null } },
    { name: "BOM·주석 앞선 CSS 정상", path: "/bom.css", expect: { ok: true, kind: "css", family: "Bom Family" } },
    { name: "30MB 초과 chunked", path: "/big.ttf", expect: { ok: false, reason: "too_large" } },
    { name: "느린 본문", path: "/slow.ttf", expect: { ok: false, reason: "timeout" } },
    { name: "expectKind 불일치", path: "/valid.ttf", expectKind: "css", expect: { ok: false, reason: "kind_mismatch" } },
  ];

  try {
    for (const c of cases) {
      let pass = false;
      let detail = "";
      try {
        const r = await resolveFontSource(`${base}${c.path}`, {
          policy: loopbackPolicy,
          expectKind: c.expectKind,
        });
        if (c.expect.ok && r.ok) {
          pass =
            r.kind === c.expect.kind &&
            (c.expect.kind === "file" || r.cssFamily === c.expect.family);
          if (c.expect.kind === "css" && r.ok) detail = `cssFamily=${JSON.stringify(r.cssFamily)}`;
        } else if (!c.expect.ok && !r.ok) {
          pass = r.reason === c.expect.reason;
          detail = `reason=${r.reason}`;
        } else {
          detail = JSON.stringify(r.ok ? { ok: r.ok, kind: r.kind } : r);
        }
      } catch (e) {
        detail = `예외: ${e instanceof Error ? e.message : String(e)}`;
      }
      check(c.expect.ok ? `${c.name} → ok` : `${c.name} → ${c.expect.reason}`, pass, detail || undefined);
    }

    // 같은 URL을 httpsOnly로 재실행하면 전종 url_rejected.
    for (const c of cases) {
      let pass = false;
      let detail = "";
      try {
        const r = await resolveFontSource(`${base}${c.path}`, { policy: httpsOnly });
        pass = !r.ok && r.reason === "url_rejected";
        detail = JSON.stringify(r.ok ? { ok: r.ok } : r);
      } catch (e) {
        detail = `예외: ${e instanceof Error ? e.message : String(e)}`;
      }
      check(`httpsOnly ${c.name} → url_rejected`, pass, pass ? undefined : detail);
    }
  } finally {
    await close(serverA);
    await close(serverB);
  }

  console.log(`valid.ttf sha256=${sha256}`);
  if (failed > 0) {
    console.error(`\n${failed}건 실패`);
    process.exit(1);
  }
  console.log(`\n${cases.length}종 통과 + httpsOnly 재실행 ${cases.length}종 url_rejected (예외 0건)`);
}

void main();
