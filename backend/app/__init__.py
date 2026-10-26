"""SmartAttend backend package.

`ai_service` is a sibling package at the repository root. Adding the root to sys.path keeps the
AI code independently importable (and testable) without packaging it for a single-machine install.
"""

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
