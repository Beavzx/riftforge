"""Checks used by scripts/setup.sh (runs as a plain script; the pure helpers are unit-tested without torch).

    python python/riftzero/torch_check.py "torch>=2.7.1,<2.11"   # exit 0 if installed torch is CUDA >= 12.8 and in range
    python python/riftzero/torch_check.py --gpu                    # CUDA visible + arch kernels present + bf16 matmul
"""
from __future__ import annotations

import re
import sys

HINT = ("Fix: update the NVIDIA driver on Windows (for WSL) / Linux, run 'wsl --shutdown' after a driver update, then "
        "re-run scripts/setup.sh.")


def _num(s: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", s))


def version_in_spec(version: str, spec: str) -> bool:
    """'2.8.0+cu128' against 'torch>=2.7.1,<2.11' (>=, <=, <, >, ==; compared on the spec's precision)."""
    ver = _num(version.split("+")[0])[:3]
    for op, v in re.findall(r"(>=|<=|==|<|>)\s*([\d.]+)", spec):
        want = _num(v)
        have = ver[: len(want)] + (0,) * max(0, len(want) - len(ver))
        if not {">=": have >= want, "<=": have <= want, "<": have < want, ">": have > want, "==": have == want}[op]:
            return False
    return True


def cuda_ok(cuda_version: str | None, minimum: tuple[int, int] = (12, 8)) -> bool:
    return bool(cuda_version) and _num(cuda_version)[:2] >= minimum


def arch_supported(cap: int, arch_list: list[str]) -> bool:
    """cap = major*10+minor. Supported if the build has sm_<cap>, or PTX (compute_XY) for an arch <= cap."""
    sm = [int(a[3:]) for a in arch_list if a.startswith("sm_") and a[3:].isdigit()]
    ptx = [int(a[8:]) for a in arch_list if a.startswith("compute_") and a[8:].isdigit()]
    return cap in sm or any(c <= cap for c in ptx)


def check_install(spec: str) -> int:
    try:
        import torch
    except ImportError:
        print("torch not installed")
        return 1
    ok = cuda_ok(torch.version.cuda) and version_in_spec(torch.__version__, spec)
    print(f"torch {torch.__version__} cuda {torch.version.cuda}")
    return 0 if ok else 1


def check_gpu() -> int:
    import torch
    if not torch.cuda.is_available():
        print(f"  \033[31mFAIL\033[0m CUDA is not available to PyTorch (torch {torch.__version__}, cuda {torch.version.cuda}). {HINT}")
        return 1
    arch = torch.cuda.get_arch_list()
    bad = False
    for i in range(torch.cuda.device_count()):
        p = torch.cuda.get_device_properties(i)
        cap = p.major * 10 + p.minor
        if not arch_supported(cap, arch):
            print(f"  \033[31mFAIL\033[0m GPU {i} {p.name} is sm_{cap}, but this torch build only has {arch}. "
                  "Reinstall: rm -rf .venv && scripts/setup.sh (CUDA 12.8 index).")
            bad = True
            continue
        try:
            x = torch.randn(512, 512, device=f"cuda:{i}", dtype=torch.bfloat16)
            (x @ x).float().sum().item()
        except Exception as e:  # noqa: BLE001
            print(f"  \033[31mFAIL\033[0m GPU {i} {p.name}: test matmul failed: {e}. {HINT}")
            bad = True
            continue
        print(f"  \033[32mOK\033[0m   GPU {i}: {p.name}, {p.total_memory / 2**30:.1f} GB, sm_{cap} (bf16 matmul ok)")
    return 1 if bad else 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--gpu":
        sys.exit(check_gpu())
    sys.exit(check_install(sys.argv[1] if len(sys.argv) > 1 else "torch>=2.7.1"))
