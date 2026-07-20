// DV8 마크다운 렌더 안전 파이프라인(치명). 4중 방어:
//  (1) markdown-it({html:false}) — 원문 raw HTML 을 파싱하지 않고 escape(태그 주입 봉쇄).
//  (2) URL scheme 화이트리스트(http/https/mailto) — validateLink 로 javascript:/data:/vbscript: 링크 href 제거.
//  (3) DOMPurify.sanitize — 태그/속성 allowlist·이벤트핸들러 제거·ALLOWED_URI_REGEXP 재확인(defense-in-depth).
//  (4) 외부 리소스 차단 — img/svg/iframe/object 등 전면 금지(원격 img·SVG 스크립트 봉쇄) + 파일응답 CSP 백스톱.
// 산출은 sanitize 완료 HTML 문자열. 이 문자열만 dangerouslySetInnerHTML 로 주입(raw/텍스트는 React escape).
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

// 링크 href 허용 scheme(콜론 포함 절대 scheme 만 검사 — 상대/앵커 링크는 통과). data:/javascript:/vbscript:/file: 거부.
const SAFE_LINK_SCHEME = /^(?:https?|mailto):/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// html:false → 원문 raw HTML(<script> 등)은 렌더되지 않고 텍스트로 escape. linkify off(자동 링크 표면 최소화).
const md = new MarkdownIt({ html: false, linkify: false, breaks: false, typographer: false });

// URL scheme 화이트리스트(거부 스위트 15/16). scheme 있는 링크는 http/https/mailto 만 허용, 나머지 href 제거.
md.validateLink = (url: string): boolean => {
  const s = url.trim();
  if (HAS_SCHEME.test(s)) return SAFE_LINK_SCHEME.test(s);
  return true; // 상대 경로·프래그먼트 링크(동일 오리진·무해)
};

// DOMPurify allowlist — 문서 마크다운에 필요한 최소 태그만. img/svg/iframe/object/script/style/form 등 전면 금지(외부리소스·XSS 벡터 차단).
const PURIFY_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  ALLOWED_TAGS: [
    "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "blockquote", "pre", "code", "kbd", "samp",
    "em", "strong", "b", "i", "del", "sup", "sub", "a", "span",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  ALLOWED_ATTR: ["href", "title", "align", "class"],
  // http/https/mailto + 상대/프래그먼트 만 허용. javascript:/data:/vbscript: 거부(markdown-it 통과분 재확인).
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  FORBID_TAGS: ["img", "svg", "math", "iframe", "object", "embed", "form", "input",
    "script", "style", "link", "video", "audio", "source", "picture", "track"],
  FORBID_ATTR: ["target", "src", "srcset", "style", "on*"],
  ALLOW_DATA_ATTR: false,
  RETURN_TRUSTED_TYPE: false,
};

// 앵커에 rel 강제·target 제거(탭내빙 방지). window 부재(비-DOM import) 시 no-op — 모듈 로드 안전.
let hooked = false;
function ensureHook(): void {
  if (hooked || typeof DOMPurify.addHook !== "function") return;
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (node.tagName === "A") {
      node.setAttribute("rel", "noopener noreferrer nofollow");
      node.removeAttribute("target");
    }
  });
  hooked = true;
}

// 마크다운 원문 → sanitize 완료 HTML 문자열. 실행/외부리소스/스크립트 전부 무력화. (DOM 환경에서만 호출)
export function renderMarkdown(raw: string): string {
  ensureHook();
  const dirty = md.render(raw ?? "");
  return DOMPurify.sanitize(dirty, PURIFY_CONFIG) as string;
}
