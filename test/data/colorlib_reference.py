"""Generates colorlib-reference.json: results of colorlib.py from 365 Day & Night, that the TypeScript port must match.

The tests do not run this script. It only rebuilds the reference file, from a clone of 365 Day & Night:

    python3 -I test/data/colorlib_reference.py ../365-daynight-vscode-theme-ext > test/data/colorlib-reference.json

colorlib.py: https://github.com/mickaellherminez/365-daynight-vscode-theme-ext/blob/main/scripts/themes/colorlib.py
"""
import json
import os
import subprocess
import sys

repo = sys.argv[1]
sys.path.insert(0, os.path.join(repo, 'scripts', 'themes'))
from colorlib import (ACHROMATOPSIA, MODELS, contrast, delta_e, delta_e_2000, lab, over,  # noqa: E402
                      simulate)

LEVELS = (0, 51, 102, 153, 204, 255)
colors = ['#%02X%02X%02X' % (r, g, b) for r in LEVELS for g in LEVELS for b in LEVELS]
# Some theme colors, with odd channels, so that rounding to 8 bits is tested on values that are not on the grid
colors += ['#A4E05C', '#C1CDFC', '#CA502B', '#5E7F2B', '#1565C0', '#FAFCFF', '#767676', '#777777', '#3B2718',
           '#F881F4', '#ADAEAF', '#13182C', '#E2E3F2', '#6D1830', '#03497F', '#9A2435']
pairs = [(colors[i], colors[(i * 37 + 11) % len(colors)]) for i in range(len(colors))]

simulations = {f'{model} {deficiency}': simulation for deficiency, models in MODELS.items()
               for model, simulation in models.items()}
simulations['achromatopsia'] = ACHROMATOPSIA

commit = subprocess.run(['git', '-C', repo, 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout
result = {
    'source': f'365 Day & Night {commit.strip()}, scripts/themes/colorlib.py, test/data/colorlib_reference.py',
    'colors': colors,
    'lab': [list(lab(c)) for c in colors],
    'simulate': {name: [simulate(c, s) for c in colors] for name, s in simulations.items()},
    'pairs': pairs,
    'contrast': [contrast(a, b) for a, b in pairs],
    'deltaE': [delta_e(a, b) for a, b in pairs],
    'deltaE2000': {name: [delta_e_2000(a, b, s) for a, b in pairs] for name, s in [('normal', None),
                                                                                 *simulations.items()]},
    'over': [[c + alpha, back, over(c + alpha, back)] for c in colors[::7] for alpha in ('00', '33', '80', 'CC')
             for back in ('#000000', '#FFFFFF', '#13182C')],
}
print(json.dumps(result, ensure_ascii=False, indent=1))
