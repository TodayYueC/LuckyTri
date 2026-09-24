// Unit tests run in an always-awake world so they never depend on the wall
// clock. Tests about her rhythm turn it on explicitly in her nature.
import { NATURE_DEFAULTS } from "../server/mind/nature.js";

NATURE_DEFAULTS.rhythm = { ...NATURE_DEFAULTS.rhythm, enabled: false };
