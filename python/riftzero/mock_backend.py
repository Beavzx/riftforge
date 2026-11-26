"""Mock inference backend (numpy only): uniform priors, constant value. Used for plumbing tests and dry runs.

Test hooks (infer_server --mock-slot-value / --mock-fail-first / --mock-oom-above):
  slot_value   value = slot × 0.1 instead of 0 (lets a test see which slot answered)
  fail_first   the first N infer() calls raise RuntimeError
  oom_above    batches larger than this raise a CUDA-style "out of memory" error (tests the split-and-retry path)
"""
from __future__ import annotations

import numpy as np

from .wire import Obs


class MockBackend:
    name = "mock"
    n_slots = 3
    device = "mock"

    def __init__(self, value: float = 0.0, noise: float = 0.0, seed: int = 0, slot_value: bool = False,
                 fail_first: int = 0, oom_above: int = 0):
        self.value = value
        self.noise = noise
        self.rng = np.random.default_rng(seed)
        self.step = 0
        self.slot_steps: dict[int, int] = {0: 0, 1: 0, 2: 0}
        self.slot_value = slot_value
        self.fail_left = fail_first
        self.oom_above = oom_above
        self.calls = 0

    def infer(self, batch: list[Obs]) -> list[tuple[float, np.ndarray]]:
        self.calls += 1
        if self.fail_left > 0:
            self.fail_left -= 1
            raise RuntimeError("mock backend: injected failure")
        if self.oom_above and len(batch) > self.oom_above:
            raise RuntimeError(f"CUDA out of memory. Tried to allocate (mock, batch {len(batch)} > {self.oom_above})")
        out = []
        for o in batch:
            logits = np.zeros(o.n_a, np.float32)
            if self.noise:
                logits += self.rng.normal(0, self.noise, o.n_a).astype(np.float32)
            out.append((o.slot * 0.1 if self.slot_value else self.value, logits))
        return out

    def on_oom(self) -> None:
        pass

    def maybe_reload(self) -> None:
        pass
