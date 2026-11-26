"""riftzero: self-play training for the Riftforge Riftbound engine.

Modules that need only numpy (importable and tested without torch):
    wire, schema, config, dataset, mock_backend, infer_server (mock backend), launch, status, elo, stop
Modules that need torch:
    model, torch_backend, train, export
"""
__version__ = "0.1.0"
