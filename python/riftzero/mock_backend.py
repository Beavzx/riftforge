"""Mock inference backend (numpy only): uniform priors, constant value. Used for plumbing tests and dry runs."""
from __future__ import annotations

import numpy as np

from .wire import Obs


class MockBackend:
    name = "mock"
    n_slots = 2

    def __init__(self, value: float = 0.0, noise: float = 0.0, seed: int = 0):
        self.value = value
        self.noise = noise
        self.rng = np.random.default_rng(seed)
        self.step = 0

    def infer(self, batch: list[Obs]) -> list[tuple[float, np.ndarray]]:
        out = []
        for o in batch:
            logits = np.zeros(o.n_a, np.float32)
            if self.noise:
                logits += self.rng.normal(0, self.noise, o.n_a).astype(np.float32)
            out.append((self.value, logits))
        return out

    def maybe_reload(self) -> None:
        pass
