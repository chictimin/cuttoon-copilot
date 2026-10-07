import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// service role 키를 쓴다. 클라이언트에서 이 파일을 import하면 server-only가
// 빌드를 실패시킨다 — 런타임에 조용히 깨지는 대신 빌드에서 걸린다.
//
// Next 밖(스크립트·테스트)에서 이 모듈을 쓰려면 react-server 조건을 켜야 한다.
// server-only가 그 조건에서만 빈 모듈로 해석되고, 아니면 일부러 throw한다.
//   npx tsx --conditions=react-server <script>
//
// 클라이언트를 모듈 최상위에서 만들지 않는 이유: next build가 라우트의 page
// data를 수집할 때 이 모듈을 평가하는데, 그 시점에 환경변수가 없으면 빌드
// 자체가 실패한다. 키는 실행 시점에만 있으면 되므로 첫 호출까지 미룬다.
let client: SupabaseClient | null = null;

// 테스트 전용 주입점(spec-263 #8·#9 계약). 이름 고정: setTestDbClient.
// 테스트 외 호출(NODE_ENV가 "test"가 아님)이면 throw하고, 주입하지 않으면
// 기존 getDb 동작 그대로다. 검증이 끝나면 null로 되돌린다.
let testClient: SupabaseClient | null = null;

export function setTestDbClient(client: SupabaseClient | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setTestDbClient는 테스트에서만 사용할 수 있습니다");
  }
  testClient = client;
}

export function getDb(): SupabaseClient {
  if (testClient) return testClient;
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다 (.env 확인)"
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return client;
}
