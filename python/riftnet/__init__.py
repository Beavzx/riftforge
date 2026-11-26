"""riftnet: Python side of the Riftforge neural-net interface (numpy only; see docs/agents/encoder.md)."""
from .schema import Schema, load_schema
from .wire import (ObsFrame, decode_obs, encode_obs, decode_result, encode_result, with_length, iter_frames, split_frames,
                   OBS_MAGIC, RES_MAGIC)
from .batch import Batch, collate

__all__ = ["Schema", "load_schema", "ObsFrame", "decode_obs", "encode_obs", "decode_result", "encode_result", "with_length",
           "iter_frames", "split_frames", "Batch", "collate", "OBS_MAGIC", "RES_MAGIC"]
