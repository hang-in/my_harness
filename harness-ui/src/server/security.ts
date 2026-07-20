// 보안 미들웨어 (설계 §5b·§0-VOID). token bootstrap(fragment)·Host allowlist·Origin(state-mutating)·denylist.
// 쿼리 토큰 금지. bootstrap single-use→session 교환+즉시 무효화. 로컬 전용.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

function eq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type SecurityState = {
  bootstrap: string;          // 1회용 부트스트랩(터미널·로그 미노출 — fragment 로만)
  bootstrapUsed: boolean;
  session: string;            // 교환된 세션 토큰
  port: number;
};

export function makeSecurity(port: number): SecurityState {
  return { bootstrap: randomBytes(32).toString("hex"), bootstrapUsed: false, session: randomBytes(32).toString("hex"), port };
}

// bootstrap 회전 — **write-then-publish**: 새 토큰 파일 기록 성공 후에만 in-memory 교체(파일↔메모리 불일치 방지).
async function rotateBootstrap(sec: SecurityState): Promise<void> {
  const next = randomBytes(32).toString("hex");
  try {
    const { writeBootstrap } = await import("./launcher.js");
    await writeBootstrap(next);          // 파일 먼저
    sec.bootstrap = next; sec.bootstrapUsed = false; // 성공 후 메모리 발행
  } catch { /* 파일 실패 → 기존 bootstrap 유지(used=true 상태로 남아 재교환 불가, 다음 부팅서 갱신) */ }
}

function allowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}
function allowedOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return false;
  try { const u = new URL(origin); return allowedHost(u.host, port); } catch { return false; }
}

function tokenFromReq(req: FastifyRequest): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7);
  const x = req.headers["x-harness-token"];
  if (typeof x === "string") return x;
  return null; // 쿼리 토큰 미지원(§0-VOID)
}

export function registerSecurity(app: FastifyInstance, sec: SecurityState): void {
  // bootstrap → session 교환(1회용). client 가 URL fragment 에서 읽어 호출.
  app.post<{ Body: { bootstrap?: string } }>("/api/auth/exchange", async (req, reply) => {
    if (!allowedHost(req.headers.host, sec.port)) return reply.code(403).send({ error: "bad-host" });
    if (!allowedOrigin(req.headers.origin, sec.port)) return reply.code(403).send({ error: "bad-origin" });
    const b = req.body?.bootstrap ?? "";
    if (sec.bootstrapUsed || !eq(b, sec.bootstrap)) return reply.code(401).send({ error: "invalid-bootstrap" });
    sec.bootstrapUsed = true;                 // 즉시 무효화(single-use)
    void rotateBootstrap(sec);                // 새 bootstrap 발급·파일 갱신(런처 재접속 A31용)
    return { session: sec.session };
  });

  // 전 API 게이트: Host 검증(모두) + Origin 검증(state-mutating) + session token(모두, exchange 제외).
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    // 라우터(find-my-way)는 (a)authority-form(`http://host/api/…`)을 pathname 으로 정규화하고
    // (b)percent-decode 후 매칭한다. 게이트도 동일하게 **pathname 정규화 + 디코드** 후 판정해야
    // `http://…/api/`(authority-form)·`/%61pi/`(인코딩) 우회를 막는다.
    let url: string;
    try {
      const pathname = new URL(req.url, "http://localhost").pathname; // authority-form·path-form 모두 pathname
      url = decodeURIComponent(pathname);
    } catch { return reply.code(400).send({ error: "bad-target" }); }
    if (!url.startsWith("/api/")) {
      // 정적 자원(SPA 셸·JS·CSS·/healthz): **토큰 불요**(비인증 로드 → 이후 /api/auth/exchange).
      // 단 Host 게이트는 적용(DNS rebinding 심층방어). allowedHost = 127.0.0.1|localhost|[::1] + 포트.
      if (!allowedHost(req.headers.host, sec.port)) return reply.code(403).send({ error: "bad-host" });
      return;
    }
    if (url === "/api/auth/exchange") return;                   // 교환 엔드포인트는 자체 검증
    if (!allowedHost(req.headers.host, sec.port)) return reply.code(403).send({ error: "bad-host" }); // DNS rebinding 방지
    const mutating = req.method !== "GET" && req.method !== "HEAD";
    if (mutating && !allowedOrigin(req.headers.origin, sec.port)) return reply.code(403).send({ error: "bad-origin" });
    const tok = tokenFromReq(req);
    if (!tok || !eq(tok, sec.session)) return reply.code(401).send({ error: "unauthorized" });
  });

  // 응답 공통 헤더.
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    return payload;
  });
}

// 파일 경로 API denylist — dotfile·토큰·레지스트리·secret 세그먼트 차단(경로 해석 전).
const DENY = /(^|\/)\.[^/]|(^|\/)(node_modules|\.git)(\/|$)/i;
export function deniedPath(rel: string): boolean {
  if (DENY.test(rel)) return true;
  if (/ui-session-token|\.owner\.json|session\.key|registry/i.test(rel)) return true;
  return false;
}

// F5 docs 뷰어 전용 denylist (DV5·V5 정정). `deniedPath` 의 `/registry/i` 부분일치 오거부를
// docs 에 쓰지 않는다 — `docs/registry-*.md`·본문 "registry"/"session" 포함 정상문서는 ACCEPT.
// 커버: (a) DENY = dot-prefix 세그먼트(.env/.git/.ssh/.aws)·node_modules·.git (재사용)
//       (b) 확장자 기반 secret: *.key/*.pem/*.p12/*.pfx/*.crt/*.cer (비-dot foo.key 도 차단)
//       (c) 비-dot 개인키 파일명: id_rsa*/id_dsa*/id_ecdsa*/id_ed25519* (세그먼트 앵커)
//       (d) 토큰 파일명: ui-session-token (세그먼트 앵커)
const DOCS_DENY_EXT = /\.(key|pem|p12|pfx|crt|cer)$/i;
const DOCS_DENY_NAME = /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519|ui-session-token)([._-][^/]*)?(\/|$)/i;
export function deniedDocsPath(rel: string): boolean {
  if (DENY.test(rel)) return true;        // dot-prefix·node_modules·.git (재사용 — 재발명 아님)
  if (DOCS_DENY_EXT.test(rel)) return true;
  if (DOCS_DENY_NAME.test(rel)) return true;
  return false;
}
