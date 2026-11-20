"""Generates daltonlens-cvd.json: colors simulated by DaltonLens, to check Brettel and Viénot in src/simulation.ts.

The tests do not run this script. It only rebuilds the reference file:

    python3 -m venv /tmp/daltonlens && /tmp/daltonlens/bin/pip install daltonlens==0.1.5 numpy
    /tmp/daltonlens/bin/python -I test/data/daltonlens_reference.py > test/data/daltonlens-cvd.json

DaltonLens (MIT license): https://github.com/DaltonLens/DaltonLens-Python. The simulators use their default
parameters: the LMS model of Smith and Pokorny (1975) adapted to sRGB, with RGB white as the neutral color.
"""
import json
from importlib.metadata import version

import numpy as np
from daltonlens import convert, simulate

LEVELS = (0, 51, 102, 153, 204, 255)
colors = [(r, g, b) for r in LEVELS for g in LEVELS for b in LEVELS]
linear = convert.linearRGB_from_sRGB(np.array([colors], dtype=np.float64) / 255)

DEFICIENCIES = {'protan': simulate.Deficiency.PROTAN, 'deutan': simulate.Deficiency.DEUTAN,
                'tritan': simulate.Deficiency.TRITAN}
MODELS = {
    'Brettel 1997': (simulate.Simulator_Brettel1997(), ('protan', 'deutan', 'tritan')),
    'Viénot 1999': (simulate.Simulator_Vienot1999(), ('protan', 'deutan')),
}

result = {
    'source': f'DaltonLens {version("daltonlens")}, test/data/daltonlens_reference.py',
    'input': ['#%02X%02X%02X' % c for c in colors],
    'output': 'Linear RGB, before clipping to 0..1',
}
for name, (simulator, deficiencies) in MODELS.items():
    result[name] = {}
    for deficiency in deficiencies:
        out = simulator._simulate_dichromacy_linear_rgb(linear.copy(), DEFICIENCIES[deficiency])
        result[name][deficiency] = [[round(float(x), 12) for x in pixel] for pixel in out[0]]

print(json.dumps(result, ensure_ascii=False, indent=1))
