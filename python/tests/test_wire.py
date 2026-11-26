"""python3 -m unittest discover -s python/tests   (from the repo root; numpy only)"""
import io
import json
import os
import sys
import unittest

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "python"))

from riftnet import load_schema, decode_obs, encode_obs, decode_result, encode_result, with_length, iter_frames, split_frames, collate  # noqa: E402

FIX = os.path.join(ROOT, "python", "tests", "fixtures")


class WireTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = load_schema()
        with open(os.path.join(FIX, "frames.bin"), "rb") as f:
            cls.raw = f.read()
        with open(os.path.join(FIX, "frames.json")) as f:
            cls.meta = json.load(f)

    def test_schema_and_card_table(self):
        s = self.schema
        t = s.card_table()
        self.assertEqual(t.shape, (s.n_card_rows, s.static_dim))
        self.assertTrue(np.all(t[0] == 0) and np.all(t[1] == 0), "pad / unknown rows are zero")
        self.assertEqual(len(s.card_ids) + s.raw["cards"]["firstCardIdx"], s.n_card_rows)
        self.assertEqual(len(s.entity_names), s.entity_dim)
        self.assertEqual(s.index("entity", "kind:object"), 0)

    def test_decode_ts_frames(self):
        frames = split_frames(self.raw)
        self.assertEqual(len(frames), len(self.meta))
        for buf, m in zip(frames, self.meta):
            f = decode_obs(buf, expected_hash=self.schema.schema_hash)
            self.assertEqual(f.tag, m["tag"])
            self.assertEqual(f.n_entities, m["nE"])
            self.assertEqual(f.n_actions, m["nA"])
            self.assertEqual(f.entities.shape[1], self.schema.entity_dim)
            self.assertEqual(f.actions.shape[1], self.schema.action_dim)
            self.assertAlmostEqual(float(f.global_.sum()), m["globalSum"], places=3)
            self.assertAlmostEqual(float(f.entities.sum()), m["entitySum"], places=2)
            self.assertEqual(int(f.card_idx[0]), m["cardIdx0"])
            self.assertEqual(int(f.ptr_idx[0, 0]), m["ptr0"])
            self.assertTrue(np.all(f.card_idx < self.schema.n_card_rows))
            self.assertTrue(np.all(f.ptr_idx < f.n_entities))
            self.assertEqual(encode_obs(f), bytes(buf), "re-encode is byte identical")

    def test_stream_and_batch(self):
        frames = [decode_obs(b) for b in iter_frames(io.BytesIO(self.raw))]
        b = collate(frames)
        self.assertEqual(b.entities.shape[0], len(frames))
        self.assertEqual(int(b.entity_mask.sum()), sum(f.n_entities for f in frames))
        self.assertEqual(int(b.action_mask.sum()), sum(f.n_actions for f in frames))
        self.assertTrue(np.all(b.ptr_idx[~b.action_mask] == -1))
        b2 = collate(frames, pad_entities=self.schema.max_entities)
        self.assertEqual(b2.entities.shape[1], self.schema.max_entities)

    def test_result_roundtrip(self):
        buf = encode_result(7, -0.5, np.array([0.1, 2.0, -3.0]), np.array([1.0]))
        tag, v, lg, ex = decode_result(buf)
        self.assertEqual(tag, 7)
        self.assertAlmostEqual(v, -0.5)
        np.testing.assert_allclose(lg, [0.1, 2.0, -3.0], rtol=1e-6)
        np.testing.assert_allclose(ex, [1.0])
        self.assertEqual(split_frames(with_length(buf)), [buf])


if __name__ == "__main__":
    unittest.main()
