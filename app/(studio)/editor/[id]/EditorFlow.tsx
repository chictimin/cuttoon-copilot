"use client";

import { useState, useSyncExternalStore } from "react";
import { assertStoryboardRuntimeInvariants } from "@/lib/llm/storyboard-guard";
import type { CaptionPosition, Storyboard } from "../../session/[id]/storyboard-types";

// sessionStorage는 탭 안에서만 유효하고 storage 이벤트도 안 쏘므로 구독할 게 없다 —
// useSyncExternalStore는 여기서 순전히 "서버에선 null, 하이드레이션 후 실제 값"을
// 안전하게 읽기 위한 용도로만 쓴다 (useEffect+setState로 하면 새 lint 규칙
// react-hooks/set-state-in-effect에 걸린다).
const noopSubscribe = () => () => {};

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

export default function EditorFlow({ sessionId }: { sessionId: string }) {
  const storageKey = `cuttoon:session:${sessionId}`;
  const raw = useSyncExternalStore(
    noopSubscribe,
    () => window.sessionStorage.getItem(storageKey),
    () => null
  );
  const saved = raw ? (JSON.parse(raw) as Storyboard) : null;

  const [draft, setDraft] = useState<Storyboard | null>(null);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // saved가 하이드레이션 이후 처음 도착했을 때(또는 sessionId가 바뀌었을 때) 딱 한 번
  // draft를 초기화한다. 렌더 중 조건부 setState — effect가 아니라서 위 lint 규칙에
  // 걸리지 않고, 매 렌더 setState되는 것도 initializedFor 가드로 막는다.
  if (saved && initializedFor !== storageKey) {
    setDraft(clone(saved));
    setInitializedFor(storageKey);
    setEditingIndex(null);
  }

  if (!saved || !draft) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-xl font-semibold">아직 완성된 스토리보드가 없어요</h1>
        <p className="text-sm text-zinc-500">
          세션 화면에서 4컷을 먼저 완성해주세요
        </p>
      </main>
    );
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(saved);

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

  function handleRevert() {
    if (!saved) return;
    setDraft(clone(saved));
    setEditingIndex(null);
  }

  function handleSave() {
    if (!draft) return;
    assertStoryboardRuntimeInvariants(draft.cuts);
    window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
    // sessionStorage에 쓰면 useSyncExternalStore가 다음 렌더(바로 아래 setSavedAt으로
    // 트리거됨)에서 알아서 새 값을 읽어오므로 saved를 직접 갱신할 필요 없다.
    setSavedAt(new Date().toLocaleTimeString());
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-4xl flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold">&ldquo;{draft.subject}&rdquo; 수정하기</h1>
        <p className="text-sm text-zinc-500">
          대사를 고치거나, 말풍선을 원하는 자리로 끌어다 놓으세요
        </p>
      </div>

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
              {/* eslint-disable-next-line @next/next/no-img-element -- mock placeholder, next/image 불필요 */}
              <img
                src={cut.generated_image ?? ""}
                alt={`컷 ${cut.cut_index}`}
                className="h-full w-full object-cover"
              />
              <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                {cut.cut_index}컷 · {cut.narrative_beat}
              </span>
              <div
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}
                className="absolute max-w-[70%] cursor-move truncate rounded-full bg-white px-3 py-1 text-xs font-medium shadow"
                style={POSITION_STYLE[cut.caption.position]}
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

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleRevert}
          disabled={!isDirty}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
        >
          되돌리기
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty}
          className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
        >
          저장
        </button>
        {!isDirty && savedAt && (
          <span className="text-xs text-zinc-400">{savedAt}에 저장됨</span>
        )}
      </div>
    </main>
  );
}
