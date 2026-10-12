// 발표용 데모 캐시 모드 (#307, #239·#240 후속).
//
// 표지 3안·나머지 3컷의 이미지 생성(유료 호출)을 public/demo-cache/의 미리 만든 PNG로
// 대신하는 화면 쪽 스위치다. 서버·Export는 manifest에 적힌 /demo-cache/… 값을 이미 허용한다
// (lib/render/demo-cache.ts, app/api/session/validate.ts) — 여기서는 켜고 끄는 것과
// manifest 읽기만 한다. 대사·저장·Export는 평소처럼 실제로 실행된다.
//
//  - 켜기: 주소에 ?demo=1 (프로젝트 목록·세션 어디서든). 브라우저(localStorage)에 기억한다.
//  - 끄기: ?demo=0 또는 화면의 "데모 끄기" 버튼.

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "cuttoon.demoCache";
const CHANGE_EVENT = "cuttoon-demo-mode-change";
const MANIFEST_URL = "/demo-cache/manifest.json";

/** public/demo-cache/manifest.json 중 화면이 쓰는 부분(#240). */
export interface DemoManifest {
  /** 캐시를 만들 때 쓴 소재 — 이 소재일 때만 그림이 이야기와 맞는다. */
  subject: string;
  /** 표지 3안 중 선택해야 하는 번호(1부터). 캐시 컷들이 이 표지를 기준으로 만들어졌다. */
  cover_pick: number;
  covers: string[];
  /** cut_index(문자열) → 이미지 경로. 표지(1번 컷)는 covers에서 고른다. */
  cuts: Record<string, string>;
}

function urlFlag(): "1" | "0" | null {
  try {
    const value = new URLSearchParams(window.location.search).get("demo");
    return value === "1" || value === "0" ? value : null;
  } catch {
    return null;
  }
}

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getSnapshot(): boolean {
  const flag = urlFlag();
  if (flag !== null) return flag === "1";
  return readStored();
}

// 주소의 ?demo 값을 저장값에 반영한다. 목록 → 세션처럼 이동하면 주소의 값은 사라지므로 기억해 둔다.
function persistUrlFlag() {
  const flag = urlFlag();
  if (flag === null) return;
  try {
    if (flag === "1") window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 저장소를 못 쓰는 브라우저는 주소의 값만으로 동작한다.
  }
}

function subscribe(onChange: () => void): () => void {
  persistUrlFlag();
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** 데모 캐시 모드가 켜져 있는지. 서버 렌더에서는 항상 false다. */
export function useDemoMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function setDemoMode(on: boolean) {
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 저장소를 못 쓰면 이번 화면 안에서만 바뀐다.
  }
  // 주소에 남은 ?demo 값이 끈 뒤에도 켜 둔 것으로 읽히지 않게 지운다.
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("demo")) {
      url.searchParams.delete("demo");
      window.history.replaceState(window.history.state, "", url);
    }
  } catch {
    // 주소를 못 고쳐도 모드 전환 자체는 진행한다.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** manifest를 읽고 화면이 쓰는 모양인지 확인한다. 아니면 던진다(호출부가 안내 문구를 정한다). */
export async function fetchDemoManifest(): Promise<DemoManifest> {
  const res = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`demo manifest ${res.status}`);
  const raw = (await res.json()) as Partial<DemoManifest> | null;
  const covers = raw?.covers;
  const cuts = raw?.cuts;
  if (
    !raw ||
    typeof raw.subject !== "string" ||
    !Array.isArray(covers) ||
    covers.length === 0 ||
    !covers.every((c) => typeof c === "string") ||
    typeof raw.cover_pick !== "number" ||
    !Number.isInteger(raw.cover_pick) ||
    raw.cover_pick < 1 ||
    raw.cover_pick > covers.length ||
    typeof cuts !== "object" ||
    cuts === null ||
    Array.isArray(cuts) ||
    !Object.values(cuts).every((c) => typeof c === "string")
  ) {
    throw new Error("demo manifest 형식이 맞지 않습니다");
  }
  return { subject: raw.subject, cover_pick: raw.cover_pick, covers, cuts };
}
