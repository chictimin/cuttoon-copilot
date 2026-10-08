"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { assertStoryboardRuntimeInvariants } from "@/lib/llm/storyboard-guard";
import {
  displaySubject,
  normalizeStoredSubjectTags,
  type StoredSubjectTag,
} from "@/lib/llm/subject-tags";
import { POSITION_BOX } from "@/lib/render/position-box";
import { resolveImageUrl } from "../../asset-url";
import { beatLabel } from "../../ui-labels";
import { useProjectFont } from "./useProjectFont";
import type { CaptionPosition, Storyboard } from "../../session/[id]/storyboard-types";

type Anchor = { x: number; y: number };

// spec-a3 3-2(e): 에디터도 로드 시 저장본을 정규화한다. 화면 타입은 A① 소유라
// 손대지 않고 이 화면에서만 쓰는 별칭으로 subject_tags를 단다.
type Board = Storyboard & { subject_tags?: StoredSubjectTag[] };

// #259 7번: "완료"를 누르지 않은 입력칸의 글자를 반영한 사본. 대사가 같으면 원본을 그대로 돌려줘
// 저장 여부(isDirty) 비교가 흔들리지 않는다.
function withCaptionText(board: Board, index: number, text: string): Board {
  if (board.cuts[index]?.caption.text === text) return board;
  return {
    ...board,
    cuts: board.cuts.map((cut, i) => (i === index ? { ...cut, caption: { ...cut.caption, text } } : cut)),
  };
}

function stripSubjectTags(board: Board): Board {
  const copy = { ...board };
  delete copy.subject_tags;
  return copy;
}

// #278: 세로 자리는 Export(compose.ts)와 같은 비율 상수(POSITION_BOX.y)를 쓴다. 알약의 윗변을 그
// 높이에 두므로 "어느 높이대인지"만 맞고 픽셀까지 같지는 않다(Export는 줄바꿈·경계 보정이 더 있다).
// 가로(구석 8px·가운데)와 알약 모양은 그대로 둔다.
const topAt = (position: CaptionPosition) => `${POSITION_BOX[position].y * 100}%`;
const POSITION_STYLE: Record<CaptionPosition, React.CSSProperties> = {
  top_left: { top: topAt("top_left"), left: 8 },
  top_right: { top: topAt("top_right"), right: 8 },
  bottom_left: { top: topAt("bottom_left"), left: 8 },
  bottom_right: { top: topAt("bottom_right"), right: 8 },
  center: { top: topAt("center"), left: "50%", transform: "translateX(-50%)" },
};

// #242: 말풍선 드래그는 caption.anchor(말풍선 몸통 중심, 원본 이미지 기준 0~1·좌상단 원점)로 저장한다.
// 좌표가 있으면 칸 이름(position)은 좌표가 없을 때의 기본값일 뿐이라 드래그로 바꾸지 않는다.
// 미리보기는 정사각형(aspect-square)이라 화면 좌표와 원본 비율 좌표가 1:1이다(역변환 없음).
const DRAG_START_PX = 3; // 이보다 덜 움직이면 클릭으로 보고 좌표를 만들지 않는다.
// 좌표가 있을 때 몸통 폭은 구석 칸과 같은 0.44다(#242 결정). 그래서 가로 중심이 0.22~0.78 밖이면
// 몸통이 그림 밖으로 걸친다. 세로는 대사 줄 수로 정해져 한 줄 기준의 대략값만 쓴다(rounded 타원
// 반높이 ≈ 64px/1024 = 0.0625에 여유를 둔 값, 줄이 늘면 더 커진다). 사용자가 놓은 좌표는 보정하지 않고
// 알리기만 한다.
const ANCHOR_HALF_W = POSITION_BOX.top_left.w / 2;
const ANCHOR_EDGE_Y = 0.07;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function anchorMayBeCut(a: Anchor): boolean {
  return a.x < ANCHOR_HALF_W || a.x > 1 - ANCHOR_HALF_W || a.y < ANCHOR_EDGE_Y || a.y > 1 - ANCHOR_EDGE_Y;
}

function clone(storyboard: Storyboard): Storyboard {
  return JSON.parse(JSON.stringify(storyboard));
}

async function resolveImages(storyboard: Storyboard): Promise<Record<number, string>> {
  const entries = await Promise.all(
    storyboard.cuts.map(async (cut) => {
      if (!cut.generated_image) return null;
      try {
        return [cut.cut_index, await resolveImageUrl(cut.generated_image)] as const;
      } catch {
        return null;
      }
    })
  );
  return Object.fromEntries(entries.filter((e): e is NonNullable<typeof e> => e !== null));
}

// GET /api/session/export의 Content-Disposition에서 파일명을 뽑는다. filename*
// (RFC 5987, 한글 subject)을 우선 쓰고 없으면 ASCII fallback으로.
function parseExportFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return "cuttoon.zip";
  const starMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (starMatch) {
    try {
      return decodeURIComponent(starMatch[1]);
    } catch {
      // fall through to plain filename
    }
  }
  const plainMatch = contentDisposition.match(/filename="([^"]+)"/i);
  return plainMatch ? plainMatch[1] : "cuttoon.zip";
}

type Phase = "loading" | "not_found" | "load_error" | "ready";

interface SavedState {
  version: number;
  storyboard: Board;
}

export default function EditorFlow({ sessionId }: { sessionId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [saved, setSaved] = useState<SavedState | null>(null);
  const [draft, setDraft] = useState<Board | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // #209: 프로젝트 폰트. 프리셋을 못 읽거나 폰트가 없으면 null·undefined — 현행 그대로.
  const [presetId, setPresetId] = useState<string | null>(null);
  const captionFontFamily = useProjectFont(presetId);
  // spec-a3 3-3: 400(subject_tags) 복구. saveRecovery가 true면 복구 버튼+안내를
  // 기존 에러 아래에 보여준다. saveLockRef는 원래 저장과 복구를 같은 플래그로 막는다.
  const [recovering, setRecovering] = useState(false);
  const [saveRecovery, setSaveRecovery] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const saveLockRef = useRef(false);
  // #242: 진행 중인 말풍선 드래그. offset은 잡은 지점과 말풍선 중심의 차이(px)라 놓을 때 튀지 않는다.
  const dragRef = useRef<{ index: number; startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/session?id=${encodeURIComponent(sessionId)}`);
        if (cancelled) return;

        if (res.status === 404) {
          setPhase("not_found");
          return;
        }
        if (!res.ok) {
          setPhase("load_error");
          return;
        }

        const data = await res.json();
        if (cancelled) return;

        // spec-a3 3-2(e): 로드 시 저장본을 정규화해 draft와 다음 저장본을 같은
        // 값으로 둔다. 태그가 깨졌으면 subject_tags 키 없이 둔다.
        const restored = data.storyboard as Board;
        const loaded = normalizeStoredSubjectTags(restored.subject_tags, restored.subject);
        const normalized: Board =
          loaded.tags.length > 0
            ? { ...restored, subject_tags: loaded.tags }
            : stripSubjectTags(restored);
        setSaved({ version: data.version, storyboard: normalized });
        setPresetId(typeof data.presetId === "string" ? data.presetId : null);
        setDraft(clone(normalized));
        setPhase("ready");

        const urls = await resolveImages(data.storyboard);
        if (!cancelled) setImageUrls(urls);
      } catch {
        if (!cancelled) setPhase("load_error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // #259: 저장하지 않은 수정이 있으면 새로고침·탭 닫기 때 브라우저 확인창을 띄운다.
  // 앱 안의 링크 이동은 막지 않는다.
  // 입력칸이 열려 있으면 거기 쓴 글자까지 수정으로 본다(#259 7번).
  const pendingBoard = draft && editingIndex !== null ? withCaptionText(draft, editingIndex, draftCaption) : draft;
  const hasUnsavedEdits =
    phase === "ready" && !!pendingBoard && !!saved && JSON.stringify(pendingBoard) !== JSON.stringify(saved.storyboard);
  useEffect(() => {
    if (!hasUnsavedEdits) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedEdits]);

  if (phase === "loading") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-700" />
        <p className="text-sm text-zinc-500">불러오는 중...</p>
      </main>
    );
  }

  if (phase === "not_found") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">아직 완성된 컷툰이 없어요</h1>
        <p className="text-sm text-zinc-500">컷툰 만들기 화면에서 4컷을 먼저 완성해주세요</p>
        <Link href="/" className="text-sm font-medium text-zinc-600 underline hover:text-zinc-900">
          목록으로
        </Link>
      </main>
    );
  }

  if (phase === "load_error" || !saved || !draft) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">불러오지 못했어요</h1>
        <p className="text-sm text-zinc-500">잠시 후 새로고침해주세요</p>
        <Link href="/" className="text-sm font-medium text-zinc-600 underline hover:text-zinc-900">
          목록으로
        </Link>
      </main>
    );
  }

  const isDirty = JSON.stringify(pendingBoard) !== JSON.stringify(saved.storyboard);
  const canRevert = saved.version > 1;

  // anchor가 null이면 좌표를 지워 칸 이름(position)의 기본 자리로 돌아간다.
  function updateAnchor(index: number, anchor: Anchor | null) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cuts: prev.cuts.map((cut, i) => {
          if (i !== index) return cut;
          const caption = { ...cut.caption };
          if (anchor) caption.anchor = anchor;
          else delete caption.anchor;
          return { ...cut, caption };
        }),
      };
    });
  }

  function updateCaptionText(index: number, text: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cuts: prev.cuts.map((cut, i) =>
          i === index ? { ...cut, caption: { ...cut.caption, text } } : cut
        ),
      };
    });
  }

  // 저장이 끝까지 성공했을 때만 true. 내보내기 전 저장(#259)이 이 결과를 본다.
  async function handleSave(): Promise<boolean> {
    if (!draft || !pendingBoard) return false;
    // #259 7번: 열려 있는 대사 입력은 "완료"를 안 눌렀어도 먼저 확정해 그 글자로 저장한다.
    // setDraft는 다음 렌더에야 반영되므로, 저장 본문과 저장본 갱신에는 이 지역 값을 쓴다.
    const board = pendingBoard;

    try {
      // #205: 강도를 함께 넘겨야 none(CTA 컷 0개)이 기존 규칙(CTA 1개)에 막히지 않는다.
      assertStoryboardRuntimeInvariants(board.cuts, board.cta_strength);
    } catch {
      setActionError("컷 구성에 문제가 있어요");
      return false;
    }

    // spec-a3 3-3: 동기 잠금 — 복구 버튼과 같은 플래그를 쓴다.
    if (saveLockRef.current) return false;
    saveLockRef.current = true;
    if (board !== draft) setDraft(board);
    setEditingIndex(null);
    setActionError(null);
    setSaveRecovery(false);
    setSaving(true);
    try {
      const res = await fetch("/api/session/version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, storyboard: board }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // spec-a3 3-3: HTTP 400이고 error가 "subject_tags"로 시작할 때만 복구 버튼.
        // #260: 이때 서버 메시지(영문 필드명 포함)는 화면에 보이지 않고 콘솔에만 남긴다.
        if (res.status === 400 && typeof body?.error === "string" && body.error.startsWith("subject_tags")) {
          console.warn(body.error);
          setActionError("소재 태그를 저장하지 못했어요");
          setSaveRecovery(true);
        } else {
          setActionError(body?.error ?? "저장에 실패했어요. 다시 시도해주세요");
        }
        return false;
      }

      const data = await res.json();
      setSaved({ version: data.version, storyboard: board });
      setSaveNotice(null);
      setSavedAt(new Date().toLocaleTimeString());
      return true;
    } catch {
      setActionError("저장에 실패했어요. 다시 시도해주세요");
      return false;
    } finally {
      setSaving(false);
      saveLockRef.current = false;
    }
  }

  // spec-a3 3-3: "소재 태그 없이 저장" 복구. 요청 본문은 현재 draft에서
  // subject_tags 키를 뺀 사본이고 화면 상태는 아직 바꾸지 않는다. 실패하면 원본
  // 유지·에러 표시·버튼 재사용, 성공할 때만 사본으로 교체한다.
  async function handleRecoverSave() {
    if (!draft || !pendingBoard || saveLockRef.current) return;
    saveLockRef.current = true;
    setRecovering(true);
    setActionError(null);
    try {
      // #259 7번: 실패 뒤 새로 쓰던 입력칸 글자도 같이 저장한다(handleSave와 같은 pendingBoard).
      const stripped = stripSubjectTags(pendingBoard);
      const res = await fetch("/api/session/version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, storyboard: stripped }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(body?.error ?? "저장에 실패했어요. 다시 시도해주세요");
        return;
      }

      const data = await res.json();
      setSaved({ version: data.version, storyboard: stripped });
      setDraft(clone(stripped));
      setEditingIndex(null);
      setSaveRecovery(false);
      setSaveNotice("소재 태그 매핑 없이 저장했어요");
      setSavedAt(new Date().toLocaleTimeString());
    } catch {
      setActionError("저장에 실패했어요. 다시 시도해주세요");
    } finally {
      setRecovering(false);
      saveLockRef.current = false;
    }
  }

  async function handleRevert() {
    setActionError(null);
    setReverting(true);
    try {
      const res = await fetch("/api/session/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      if (res.status === 409) {
        setActionError("되돌릴 이전 버전이 없어요");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(body?.error ?? "되돌리기에 실패했어요. 다시 시도해주세요");
        return;
      }

      const data = await res.json();
      setSaved({ version: data.version, storyboard: data.storyboard });
      setDraft(clone(data.storyboard));
      setEditingIndex(null);
      setImageUrls(await resolveImages(data.storyboard));
    } catch {
      setActionError("되돌리기에 실패했어요. 다시 시도해주세요");
    } finally {
      setReverting(false);
    }
  }

  async function handleExport() {
    setActionError(null);
    setExportNotice(null);
    setExporting(true);
    try {
      // #259: Export는 DB 저장본만 읽는다. 미저장 수정이 있으면 먼저 저장하고, 저장이 실패하면
      // 수정 전 대사로 내보내지 않고 멈춘다(오류·복구 버튼은 handleSave가 이미 보여 준다).
      if (isDirty && !(await handleSave())) return;
      const res = await fetch(`/api/session/export?id=${encodeURIComponent(sessionId)}`);

      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        setActionError(body?.error ?? "내보낼 이미지가 없어요");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(body?.error ?? "내보내기에 실패했어요. 다시 시도해주세요");
        return;
      }

      const skipped = res.headers.get("X-Export-Skipped")?.split(",").filter(Boolean) ?? [];
      const filename = parseExportFilename(res.headers.get("Content-Disposition"));
      const blob = await res.blob();

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);

      if (skipped.length > 0) {
        setExportNotice(`${skipped.join(", ")}번 컷은 이미지가 없어 제외했어요`);
      }
    } catch {
      setActionError("내보내기에 실패했어요. 다시 시도해주세요");
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-4xl flex-col items-center gap-1 text-center">
        <Link
          href="/"
          className="self-start text-sm font-medium text-zinc-500 underline hover:text-zinc-900"
        >
          ← 목록으로
        </Link>
        <h1 className="text-xl font-semibold">&ldquo;{displaySubject(draft.subject)}&rdquo; 수정하기</h1>
        <p className="text-sm text-zinc-500">
          대사를 고치거나, 말풍선을 원하는 자리로 끌어다 놓으세요
        </p>
        {/* #259 6번: 이 말풍선은 한 줄 알약 모양의 위치 확인용이다. 말풍선 종류·줄바꿈·꼬리는 Export에서만 그려진다. */}
        <p className="text-xs text-zinc-400">
          화면의 말풍선은 위치 확인용 미리보기예요. 실제 모양은 내보내기에서 확인하세요
        </p>
      </div>

      {actionError && (
        <p className="w-full max-w-md rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">
          {actionError}
        </p>
      )}
      {/* spec-a3 3-3: 기존 에러 아래 복구 버튼 + 안내 1줄. 다른 400·5xx에는 안 보인다. */}
      {saveRecovery && (
        <div className="flex w-full max-w-md flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRecoverSave()}
            disabled={saving || reverting || recovering}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
          >
            {recovering ? "저장 중…" : "소재 태그 없이 저장"}
          </button>
          <p className="text-sm text-zinc-500">
            저장된 대사·그림은 그대로이고, 이후 컷을 다시 뽑으면 브랜드 대신 &lsquo;제품&rsquo;으로 나올 수 있어요
          </p>
        </div>
      )}
      {saveNotice && (
        <p className="w-full max-w-md rounded-md bg-zinc-100 px-4 py-2 text-sm text-zinc-700">
          {saveNotice}
        </p>
      )}
      {exportNotice && (
        <p className="w-full max-w-md rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-700">
          {exportNotice}
        </p>
      )}

      <div className="grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
        {draft.cuts.map((cut, i) => (
          <div key={cut.cut_index} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
            <div className="relative aspect-square w-full overflow-hidden rounded-md bg-zinc-100">
              {imageUrls[cut.cut_index] ? (
                // eslint-disable-next-line @next/next/no-img-element -- 생성된 이미지의 리졸브 URL, next/image 불필요
                <img
                  src={imageUrls[cut.cut_index]}
                  alt={`컷 ${cut.cut_index}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full animate-pulse bg-zinc-200" />
              )}
              <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                {cut.cut_index}컷 · {beatLabel(cut.narrative_beat)}
              </span>
              <div
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  dragRef.current = {
                    index: i,
                    startX: e.clientX,
                    startY: e.clientY,
                    offsetX: e.clientX - (r.left + r.width / 2),
                    offsetY: e.clientY - (r.top + r.height / 2),
                    moved: false,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  if (!d || d.index !== i) return;
                  if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_START_PX) return;
                  d.moved = true;
                  const box = e.currentTarget.parentElement?.getBoundingClientRect();
                  if (!box || box.width === 0 || box.height === 0) return;
                  updateAnchor(i, {
                    x: round4(clamp01((e.clientX - d.offsetX - box.left) / box.width)),
                    y: round4(clamp01((e.clientY - d.offsetY - box.top) / box.height)),
                  });
                }}
                onPointerUp={() => {
                  dragRef.current = null;
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
                className="absolute max-w-[70%] cursor-move touch-none select-none truncate rounded-full bg-white px-3 py-1 text-xs font-medium shadow"
                style={{
                  ...(cut.caption.anchor
                    ? {
                        left: `${cut.caption.anchor.x * 100}%`,
                        top: `${cut.caption.anchor.y * 100}%`,
                        transform: "translate(-50%, -50%)",
                        maxWidth: `${POSITION_BOX.top_left.w * 100}%`,
                      }
                    : POSITION_STYLE[cut.caption.position]),
                  fontFamily: captionFontFamily,
                }}
                title="끌어서 말풍선 위치를 옮길 수 있어요"
              >
                {cut.caption.text}
              </div>
            </div>

            {cut.caption.anchor && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateAnchor(i, null)}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
                >
                  기본 자리로
                </button>
                {anchorMayBeCut(cut.caption.anchor) && (
                  <span className="text-xs text-amber-700">
                    이 자리는 말풍선이 그림 밖으로 잘릴 수 있어요. 안쪽으로 옮기면 덜 잘려요
                  </span>
                )}
              </div>
            )}

            {editingIndex === i ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={draftCaption}
                  onChange={(e) => setDraftCaption(e.target.value)}
                  className="flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => {
                    updateCaptionText(i, draftCaption);
                    setEditingIndex(null);
                  }}
                  className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"
                >
                  완료
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditingIndex(i);
                  setDraftCaption(cut.caption.text);
                }}
                className="rounded-md border border-transparent px-2 py-1.5 text-left text-sm hover:border-zinc-200 hover:bg-zinc-50"
              >
                {cut.caption.text}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleRevert}
          disabled={!canRevert || saving || reverting}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
        >
          {reverting ? "되돌리는 중…" : "이전 저장본으로 되돌리기"}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || saving || reverting || recovering}
          className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || saving || reverting || recovering}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
        >
          {exporting ? "내보내는 중…" : "내보내기"}
        </button>
        {!isDirty && savedAt && (
          <span className="text-xs text-zinc-400">{savedAt}에 저장됨</span>
        )}
      </div>
    </main>
  );
}
