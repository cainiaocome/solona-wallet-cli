import os
import shutil
import sys
import unittest
from pathlib import Path


def main() -> int:
    if not os.environ.get("SOL_WALLET_E2E_IMAGE"):
        print("SOL_WALLET_E2E_IMAGE must name the image under test.", file=sys.stderr)
        return 1
    if not shutil.which("docker"):
        print("Docker is required for the image E2E gate.", file=sys.stderr)
        return 1
    try:
        import pexpect  # noqa: F401
    except ImportError:
        print("pexpect is required for the image E2E gate.", file=sys.stderr)
        return 1
    suite = unittest.defaultTestLoader.discover("test/e2e", pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        artifact_dir = Path("test/e2e/.artifacts")
        artifact_dir.mkdir(parents=True, exist_ok=True)
        try:
            from mock_rpc import Handler

            (artifact_dir / "rpc-methods.log").write_text(
                "\n".join(Handler.state.methods) + "\n"
            )
        except Exception as error:
            (artifact_dir / "runner-error.log").write_text(str(error))
    if result.skipped:
        print(
            f"Docker E2E unexpectedly skipped {len(result.skipped)} test(s).",
            file=sys.stderr,
        )
        return 1
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
