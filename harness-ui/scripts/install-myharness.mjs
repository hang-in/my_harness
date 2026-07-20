#!/usr/bin/env node
// harness-ui postinstall — myharness 팩토리 스킬을 ~/.claude/skills/myharness 에 설치/업데이트.
//
// 원칙:
//   - 미설치 → 설치. 이미 설치 → 업데이트만(재연결/재동기). 사용자 요청 계약.
//   - 심링크 우선(레포 정본을 가리켜 항상 최신 = 업데이트가 자동). 실패 시(Windows 권한 등) copy 폴백.
//   - npm install 을 절대 실패시키지 않음(무슨 일이 있어도 exit 0). 부가 편의일 뿐 빌드 게이트 아님.
//   - CI/자동화·opt-out 시 스킵(홈 디렉토리 부작용 회피).
import { existsSync, lstatSync, symlinkSync, rmSync, mkdirSync, cpSync, renameSync, readlinkSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const log = (m) => process.stdout.write(`[myharness] ${m}\n`);
// lstat 기반 존재 확인 — dangling 심링크도 감지(existsSync 는 링크를 따라가 false 오판·codex).
const lexists = (p) => { try { lstatSync(p); return true; } catch { return false; } };

// myharness 가 marketplace 플러그인으로 이미 설치됐는지 감지(installed_plugins.json 권위).
//   설치돼 있으면 글로벌 스킬을 또 깔면 동일 이름 스킬이 중복되므로 스킵한다.
function detectMarketplaceInstall(home) {
  try {
    const j = JSON.parse(readFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), "utf8"));
    const plugins = j && j.plugins ? j.plugins : {};
    const key = Object.keys(plugins).find((k) => k === "myharness" || k.startsWith("myharness@"));
    if (!key) return null;
    const entry = Array.isArray(plugins[key]) ? plugins[key][0] : plugins[key];
    return { key, version: entry && entry.version ? entry.version : "?" };
  } catch { return null; } // 파일 없음/파손 → 미설치 취급
}

try {
  // opt-out / CI 스킵 — 홈 디렉토리 변경은 개발 머신에서만.
  if (process.env.HARNESS_UI_SKIP_MYHARNESS === "1") { log("HARNESS_UI_SKIP_MYHARNESS=1 → 스킵."); process.exit(0); }
  if (process.env.CI) { log("CI 환경 → 스킵(홈 디렉토리 미변경)."); process.exit(0); }

  // 소스: 레포 루트 skills/myharness (이 스크립트 = harness-ui/scripts/).
  const here = dirname(fileURLToPath(import.meta.url));
  const src = resolve(here, "..", "..", "skills", "myharness"); // scripts → harness-ui → repo → skills/myharness
  if (!existsSync(join(src, "SKILL.md"))) {
    log(`정본 소스 미발견(${src}) → 스킵(레포 외부 설치 추정).`);
    process.exit(0);
  }

  // marketplace 플러그인으로 이미 설치돼 있으면 글로벌 스킬 중복 설치 스킵(업데이트는 /plugin 경로).
  const mkt = detectMarketplaceInstall(homedir());
  if (mkt) {
    log(`myharness 가 marketplace 플러그인으로 이미 설치됨(${mkt.version}). 글로벌 스킬 중복 설치 스킵.`);
    log("  업데이트: Claude Code 에서 `/plugin update myharness` (npm 은 마켓 플러그인을 갱신할 수 없음).");
    process.exit(0);
  }

  const skillsDir = join(homedir(), ".claude", "skills");
  const dest = join(skillsDir, "myharness");
  // 부모 경로 심링크 리다이렉트 차단(factory.ts 패리티·codex MED). 존재하는 심링크 부모면 안전상 스킵.
  for (const seg of [join(homedir(), ".claude"), skillsDir]) {
    if (lexists(seg) && lstatSync(seg).isSymbolicLink()) { log(`부모 경로 심링크(${seg}) → 안전상 스킵.`); process.exit(0); }
  }
  mkdirSync(skillsDir, { recursive: true });

  // 이미 올바른 심링크면 최신 유지 상태 — 아무 것도 안 함.
  if (lexists(dest) && lstatSync(dest).isSymbolicLink()) {
    let cur = "";
    try { cur = resolve(dirname(dest), readlinkSync(dest)); } catch { /* dangling */ }
    if (cur === src) { log(`이미 최신 심링크(~/.claude/skills/myharness → ${src}) → 업데이트 불필요.`); process.exit(0); }
    // 다른 곳을 가리키는 심링크 → 정본으로 재연결(업데이트).
    rmSync(dest, { force: true });
    try { linkOrCopy(src, dest); }
    catch (e) { // 실패 → 부분 산출물 제거 후 옛 심링크 복원(dest 공백 방지·factory.ts 패리티)
      try { rmSync(dest, { recursive: true, force: true }); if (cur) symlinkSync(cur, dest, "dir"); } catch { /* best-effort */ }
      throw e;
    }
    log("업데이트: 심링크를 현재 정본으로 재연결.");
    process.exit(0);
  }

  // 실물 디렉토리 존재(구버전 copy 설치) → 백업 후 재설치(업데이트).
  //   백업 실패 시 **하드삭제 금지**(HIGH·codex/agy): throw → 최상위 catch → exit 0(스킵). 데이터 파괴 안 함.
  if (lexists(dest)) {
    const bak = allocBackupSync(dest);
    renameSync(dest, bak); // 실패 시 throw(삭제 시도 없음)
    log(`기존 설치 백업 → ${bak}`);
    try { linkOrCopy(src, dest); }
    catch (e) { // 실패 → 부분 산출물 제거 후 백업 원복(dest 공백/잔여 방지)
      try { rmSync(dest, { recursive: true, force: true }); renameSync(bak, dest); } catch { /* best-effort */ }
      throw e;
    }
    log("업데이트: 기존 설치를 정본으로 교체.");
    process.exit(0);
  }

  // 미설치 → 신규 설치. 실패 시 부분 산출물 제거(absent 상태 유지·잔여 방지·factory.ts 패리티).
  try { linkOrCopy(src, dest); }
  catch (e) { try { rmSync(dest, { recursive: true, force: true }); } catch { /* best-effort */ } throw e; }
  log(`설치 완료: ~/.claude/skills/myharness → ${src}`);
  process.exit(0);
} catch (e) {
  // npm install 실패 방지 — 경고만.
  log(`자동 설치 스킵(비치명): ${e && e.message ? e.message : e}`);
  process.exit(0);
}

// 충돌 없는 백업 경로(같은 ms·기존 백업 존재 시 무작위 접미).
function allocBackupSync(dest) {
  let p = `${dest}.bak.${Date.now()}`;
  while (existsSync(p)) p = `${dest}.bak.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  return p;
}

// 심링크 시도 → 실패(Windows 권한 등) 시 recursive copy 폴백.
function linkOrCopy(src, dest) {
  try {
    symlinkSync(src, dest, "dir");
  } catch {
    cpSync(src, dest, { recursive: true });
    log("심링크 불가 → copy 로 설치(정본 갱신 시 재실행 필요).");
  }
}
