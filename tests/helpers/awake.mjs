// Unit tests run in an always-awake world so they never depend on the wall
// clock. Tests about her rhythm turn it on explicitly in her nature.
import { NATURE_DEFAULTS } from "../../server/mind/nature.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests must never read or change a real instance, even when run in a checkout.
process.env.LUCKYTRI_HOME = mkdtempSync(join(tmpdir(), "luckytri-test-"));
for (const key of [
  "ADMIN_TOKEN",
  "ONEBOT_TOKEN",
  "LLM_API_KEY",
  "EMBEDDING_API_KEY",
  "QQBOT_APP_ID",
  "QQBOT_APP_SECRET",
  "DB_PATH",
  "BACKUP_DIR",
  "LUCKYTRI_CHANNEL",
])
  delete process.env[key];

NATURE_DEFAULTS.rhythm = { ...NATURE_DEFAULTS.rhythm, enabled: false };
