"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { assertStoryboardRuntimeInvariants } from "@/lib/llm/storyboard-guard";
import {
  displaySubject,
  normalizeStoredSubjectTags,
  type StoredSubjectTag,
} from "@/lib/llm/subject-tags";
import { resolveImageUrl } from "../../asset-url";
import { beatLabel } from "../../ui-labels";
import { useProjectFont } from "./useProjectFont";
import type { CaptionPosition, Storyboard } from "../../session/[id]/storyboard-types";

// spec-a3 3-2(e): 에디터도 로드 시 저장본을 정규화한다. 화면 타입은 A① 소유라
// 손대지 않고 이 화면에서만 쓰는 별칭으로 subject_tags를 단다.
type Board = Storyboard & { subject_tags?: StoredSubjectTag[] };

function stripSubjectTags(board: Board): Board {
  const copy = { ...board };
  delete copy.subject_tags;
  return copy;
}

const POSITION_STYLE: Record<CaptionPosition, React.CSSProperties> = {
  top_left: { top: 8, left: 8 },
  top_right: { top: 8, right: 8 },
  bottom_left: { bottom: 8, left: 8 },
  bottom_right: { bottom: 8, right: 8 },
  center: { top: "50%", left: "50%", transform: "translate(-50%, -50%)" },
};

// 말풍선 드래그는 연속 좌표(offset)가 아니라 storyboard.schema.json의 caption.position
// enum 5개로 스냅한다 — 스키마에 없는 offset 필드를 화면에서 임의로 만들지 않기 위함
// (PRD.md 6절의 "위치만 허용" 원칙은 유지하되, 데이터 계약은 A①의 확정 없이 건드리지 않는다).
function snapPosition(relX: number, relY: number): CaptionPosition {
  const inCenterBand = relX > 0.35 && relX < 0.65 && relY > 0.35 && relY < 0.65;
  if (inCenterBand) return "center";
  const isTop = relY < 0.5;
  const isLeft = relX < 0.5;
  if (isTop && isLeft) return "top_left";
  if (isTop && !isLeft) return "top_right";
  if (!isTop && isLeft) return "bottom_left";
  return "bottom_right";
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
  const hasUnsavedEdits =
    phase === "ready" && !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved.storyboard);
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
        <h1 className="text-xl font-semibold">아직 완성된 스토리보드가 없어요</h1>
        <p className="text-sm text-zinc-500">세션 화면에서 4컷을 먼저 완성해주세요</p>
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

  const isDirty = JSON.stringify(draft) !== JSON.stringify(saved.storyboard);
  const canRevert = saved.version > 1;

  function updatePosition(index: number, position: CaptionPosition) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cuts: prev.cuts.map((cut, i) =>
          i === index ? { ...cut, caption: { ...cut.caption, position } } : cut
        ),
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
    if (!draft) return false;

    try {
      // #205: 강도를 함께 넘겨야 none(CTA 컷 0개)이 기존 규칙(CTA 1개)에 막히지 않는다.
      assertStoryboardRuntimeInvariants(draft.cuts, draft.cta_strength);
    } catch {
      setActionError("스토리보드에 문제가 있어요");
      return false;
    }

    // spec-a3 3-3: 동기 잠금 — 복구 버튼과 같은 플래그를 쓴다.
    if (saveLockRef.current) return false;
    saveLockRef.current = true;
    setActionError(null);
    setSaveRecovery(false);
    setSaving(true);
    try {
      const res = await fetch("/api/session/version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, storyboard: draft }),
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
      setSaved({ version: data.version, storyboard: draft });
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
    if (!draft || saveLockRef.current) return;
    saveLockRef.current = true;
    setRecovering(true);
    setActionError(null);
    try {
      const stripped = stripSubjectTags(draft);
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
            <div
              className="relative aspect-square w-full overflow-hidden rounded-md bg-zinc-100"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const relX = (e.clientX - rect.left) / rect.width;
                const relY = (e.clientY - rect.top) / rect.height;
                updatePosition(i, snapPosition(relX, relY));
              }}
            >
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
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}
                className="absolute max-w-[70%] cursor-move truncate rounded-full bg-white px-3 py-1 text-xs font-medium shadow"
                style={{ ...POSITION_STYLE[cut.caption.position], fontFamily: captionFontFamily }}
                title="끌어서 말풍선 위치를 옮길 수 있어요"
              >
                {cut.caption.text}
              </div>
            </div>

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
