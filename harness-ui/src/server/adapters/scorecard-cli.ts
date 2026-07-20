// portable CLI 엔트리(설계 §5-1·§3-b) — esbuild 로 scripts/harness-scorecard.mjs 로 번들(무의존·서버 불요).
//   read 모드:     node harness-scorecard.mjs [root]            → 계층A JSON stdout
//   snapshot 모드: node harness-scorecard.mjs --snapshot [root] → append-on-change·{written,state_key} stdout
// --snapshot 위치 무관·root=첫 non-flag positional.
import { computeHarnessScorecard } from "./scorecard.js";
import { writeHarnessScorecardSnapshot } from "./scorecard-snapshot.js";

const args = process.argv.slice(2);
const snapshot = args.includes("--snapshot");
const root = args.find((a) => !a.startsWith("--")) || process.cwd();
const now = new Date().toISOString().slice(0, 10);

computeHarnessScorecard(root, { now })
  .then(async (sc) => {
    if (snapshot) {
      const r = await writeHarnessScorecardSnapshot(sc, root, new Date().toISOString());
      process.stdout.write(JSON.stringify(r) + "\n");
    } else {
      process.stdout.write(JSON.stringify(sc, null, 2) + "\n");
    }
  })
  .catch((e) => { process.stderr.write(String(e?.stack || e) + "\n"); process.exit(1); });
