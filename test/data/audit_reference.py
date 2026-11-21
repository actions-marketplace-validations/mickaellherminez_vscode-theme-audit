"""Copies the 48 themes of 365 Day & Night into test/data/365/, and writes the results of its audit for them into
test/data/audit-reference.json: the checks of audit.py and the variety of variety.py, that the TypeScript port
must match.

The tests do not run this script. It only rebuilds these files, from a clone of 365 Day & Night:

    python3 -I test/data/audit_reference.py ../365-daynight-vscode-theme-ext test/data

The labels of audit.py are in French: the script gives them in English, as the package writes them, and stops on a
label it cannot translate. audit.py: https://github.com/mickaellherminez/365-daynight-vscode-theme-ext/blob/main/scripts/themes/audit.py
"""
import json
import os
import re
import shutil
import subprocess
import sys

repo, out = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.path.join(repo, 'scripts', 'themes'))
import audit  # noqa: E402
import variety  # noqa: E402
from colorlib import CVD, delta_e_2000  # noqa: E402

ROLES = {
    'commentaire': 'comment', 'mot-clé': 'keyword', 'fonction': 'function', 'chaîne': 'string', 'nombre': 'number',
    'classe': 'class', 'variable': 'variable', 'opérateur': 'operator', 'ponctuation': 'punctuation', 'balise': 'tag',
    'attribut': 'attribute', 'regex': 'regex', 'clé JSON': 'JSON key', 'invalide': 'invalid',
    'erreur': 'error', 'avertissement': 'warning', 'info': 'info', 'ajout': 'added', 'modification': 'modified',
    'suppression': 'deleted', 'test réussi': 'test passed', 'test échoué': 'test failed',
    **{f'graphe {i}': f'Git graph {i}' for i in range(1, 6)},
}
STYLES = {
    'commentaire en italique': 'comment in italic', 'code invalide en souligné': 'invalid code underlined',
    'code obsolète en barré': 'deprecated code struck through', 'lien en souligné': 'link underlined',
    'titre Markdown en gras': 'Markdown heading in bold', 'gras Markdown en gras': 'Markdown bold in bold',
    'italique Markdown en italique': 'Markdown italic in italic',
    'jeton sémantique obsolète en barré': 'deprecated semantic token struck through',
}
FIXED = {
    'Éditeur : texte / fond': 'Editor: text / background',
    'Éditeur : texte / ligne courante': 'Editor: text / current line',
    'Éditeur : sélection visible / fond': 'Editor: selection visible on the background',
    'Éditeur : texte sélectionné': 'Editor: selected text',
    'Éditeur : sélection inactive visible': 'Editor: inactive selection visible',
    'Éditeur : texte / sélection inactive': 'Editor: text / inactive selection',
    'Éditeur : sélection ≠ ligne courante': 'Editor: selection distinct from the current line',
    'Recherche : texte / résultat actif': 'Find: text / current match',
    'Recherche : bordure résultat actif': 'Find: border of the current match',
    'Recherche : texte / autres résultats': 'Find: text / other matches',
    'Occurrences : bordure': 'Occurrences: border',
    'Numéros de ligne': 'Line numbers',
    'Numéro de ligne actif': 'Active line number',
    'Curseur': 'Cursor',
    'Indicateur de focus': 'Focus indicator',
    'Terminal : texte / fond': 'Terminal: text / background',
    'Terminal : sélection visible': 'Terminal: selection visible',
    'Terminal : texte sélectionné': 'Terminal: selected text',
    'Terminal : sélection inactive visible': 'Terminal: inactive selection visible',
    'Console : sélection visible': 'Debug console: selection visible',
    "Bouton de la barre d'état / barre": 'Status bar button / status bar',
    "Bouton de la barre d'état ≠ texte de la barre": 'Status bar button distinct from the status bar text',
    'Chat : commande / pastille': 'Chat: slash command / its background',
    'Chat : avatar': 'Chat: avatar',
    "Chat dans l'éditeur : texte": 'Inline chat: text',
    "Chat dans l'éditeur : texte indicatif": 'Inline chat: placeholder',
    'Notebook : texte / cellule': 'Notebook: text / cell',
    'Notebook : bordure de la cellule active': 'Notebook: border of the focused cell',
    'Fusion : conflit à traiter': 'Merge: unhandled conflict',
    'Fusion : conflit traité': 'Merge: handled conflict',
    'Multi-diff : texte / en-tête': 'Multi-diff: text / header',
    'Centre de commande : texte': 'Command center: text',
    'Centre de commande : texte (fenêtre inactive)': 'Command center: text (inactive window)',
    "Sessions d'agents : texte des panneaux": 'Agent sessions: panel text',
    "Sessions d'agents : champ de saisie": 'Agent sessions: input',
    "Sessions d'agents : texte indicatif": 'Agent sessions: placeholder',
    "Sessions d'agents : badges": 'Agent sessions: badges',
}
KEY = r'([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)'
PATTERNS = [
    (rf'^Indicateur {KEY}$', r'Indicator \1'),
    (r'^Paires de crochets (\d)$', r'Bracket pair \1'),
    (r'^Terminal ANSI (\w+)$', r'Terminal ANSI \1'),
    (r'^Console : (\w+) sélectionné$', r'Debug console: \1 selected'),
    (r'^Console : (\w+)$', r'Debug console: \1'),
    (rf'^Clé prioritaire : {KEY}$', r'Required key: \1'),
    (rf'^Chat : {KEY} / barre latérale$', r'Chat: \1 / side bar'),
    (rf'^Tests : {KEY} / barre latérale$', r'Testing: \1 / side bar'),
    (rf'^Tests : {KEY} / éditeur$', r'Testing: \1 / editor'),
    (rf'^Fusion : texte / {KEY}$', r'Merge: text / \1'),
    (rf'^Symbole : {KEY} / barre latérale$', r'Symbol: \1 / side bar'),
    (rf'^Symbole : {KEY} / suggestions$', r'Symbol: \1 / suggestions'),
    (r'^Graphe Git : ligne (\d)$', r'Git graph: line \1'),
    (rf'^Graphe Git : {KEY} / survol$', r'Git graph: \1 / hover'),
    (rf'^Graphe Git : {KEY}$', r'Git graph: \1'),
    (rf'^Sémantique : {KEY} sélectionné$', r'Semantic: \1 selected'),
    (rf'^Sémantique : {KEY}$', r'Semantic: \1'),
    (rf'^{KEY} / {KEY}$', r'\1 / \2'),
]
FAMILIES = {'rose': 'pink', 'rouge-orangé': 'red-orange', 'jaune': 'yellow', 'vert': 'green', 'vert-bleu': 'blue-green',
            'cyan': 'cyan', 'bleu': 'blue', 'violet': 'violet', 'neutre': 'neutral'}
STATUSES = {'OK': 'pass', 'ÉCHEC': 'fail', 'MANQUANT': 'missing', 'CONFUSION': 'fail'}


def english(label):
    """The label of a check of audit.py, as the package writes it."""
    if label in FIXED:
        return FIXED[label]
    match = re.match(r'^Style \(WCAG 1\.4\.1\) : (.+)$', label)
    if match and match.group(1) in STYLES:
        return f'Style (WCAG 1.4.1): {STYLES[match.group(1)]}'
    match = re.match(r'^Jeton : (.+?)( sélectionné)?$', label)
    if match and match.group(1) in ROLES:
        return f'Token: {ROLES[match.group(1)]}{" selected" if match.group(2) else ""}'
    match = re.match(r'^Notebook : jeton (.+) / cellule$', label)
    if match and match.group(1) in ROLES:
        return f'Notebook: token {ROLES[match.group(1)]} / cell'
    for pattern, replacement in PATTERNS:
        if re.match(pattern, label):
            return re.sub(pattern, replacement, label)
    sys.exit(f'No English label for: {label}')


def number(value):
    return None if value is None else round(value, 6)


def theme_result(path, ui, theme):
    hc = ui.startswith('hc')
    checks = [{'label': english(label), 'value': number(value), 'minimum': minimum, 'status': STATUSES[status]}
              for label, value, minimum, status in audit.checks(theme, hc)]
    distinctions = []
    for view, (pairs, alert_pairs) in audit.distinctions(theme).items():
        for delta, a, b, model, cie76 in pairs + alert_pairs:
            distinctions.append({'view': view, 'pair': [ROLES[a], ROLES[b]], 'deltaE2000': number(delta),
                                 'model': model or None, 'cie76': number(cie76),
                                 'status': 'pass' if delta >= audit.MIN_DELTA_E_2000 else 'fail'})
    achromatopsia = [{'pair': [ROLES[a], ROLES[b]], 'deltaE2000': number(delta), 'cie76': number(cie76)}
                     for delta, a, b, _, cie76 in audit.information(theme)['achromatopsie']]
    return {'path': path, 'name': theme['name'], 'uiTheme': ui, 'checks': checks, 'distinctions': distinctions,
            'achromatopsia': achromatopsia}


def variety_result(ui, months, paths):
    measures = []
    for name, values, distance, minimum in variety.measures(ui, months):
        pairs = variety.pair_distances(values, distance)
        mean2000 = sum(d for d, _, _ in variety.pair_distances(values, distance, metric=delta_e_2000)) / len(pairs)
        measures.append({
            'measure': {"Fond de l'éditeur": 'editor.background', 'Cadre': 'sideBar.background',
                        "Barre d'état": 'statusBar.background', 'Accent': 'activityBarBadge.background',
                        'Syntaxe (6 rôles)': 'syntax'}[name],
            'threshold': minimum,
            'pairs': [{'themes': [paths[a], paths[b]], 'deltaE': number(d)} for d, a, b in pairs],
            'meanDeltaE2000': number(mean2000),
            'colorBlindness': {view: [{'themes': [paths[a], paths[b]], 'deltaE': number(d)}
                                      for d, a, b in variety.pair_distances(values, distance, matrix)]
                               for view, matrix in CVD.items()} if minimum is not None else None,
        })
    families = {key: {paths[m]: FAMILIES[variety.hue_family(t['colors'][key])] for m, t in sorted(months.items())}
                for _, key in (variety.SURFACES[0], variety.SURFACES[3])}
    return {'uiTheme': ui, 'themes': [paths[m] for m in sorted(months)], 'measures': measures, 'families': families,
            'maxPerFamily': variety.MAX_PER_FAMILY}


# Copy of the themes, of a manifest with what the audit reads, and of the license
package = json.load(open(os.path.join(repo, 'package.json'), encoding='utf-8'))
target = os.path.join(out, '365')
shutil.rmtree(target, ignore_errors=True)
os.makedirs(os.path.join(target, 'themes'))
for entry in package['contributes']['themes']:
    shutil.copyfile(os.path.join(repo, entry['path']), os.path.join(target, entry['path']))
manifest = {key: package[key] for key in ('name', 'displayName', 'publisher', 'version') if key in package}
manifest['license'] = 'MIT'
manifest['contributes'] = {key: package['contributes'][key] for key in ('themes', 'colors')}
with open(os.path.join(target, 'package.json'), 'w', encoding='utf-8') as handle:
    json.dump(manifest, handle, ensure_ascii=False, indent=2)
    handle.write('\n')
shutil.copyfile(os.path.join(repo, 'LICENSE'), os.path.join(target, 'LICENSE'))

themes = []
paths = {}
for entry in package['contributes']['themes']:
    path = os.path.normpath(entry['path'])
    paths[os.path.normpath(os.path.join(repo, entry['path']))] = path
    themes.append(theme_result(path, entry['uiTheme'], audit.load_theme(os.path.join(repo, entry['path']))))

varieties = []
for ui, months in variety.load_variants().items():
    by_month = {}
    for entry in package['contributes']['themes']:
        match = re.match(r'365 (\d{2})-', entry['label'])
        if match and entry['uiTheme'] == ui:
            by_month[int(match.group(1))] = os.path.normpath(entry['path'])
    varieties.append(variety_result(ui, months, by_month))

commit = subprocess.run(['git', '-C', repo, 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()
result = {
    'source': f'365 Day & Night {commit}, scripts/themes/audit.py and variety.py, test/data/audit_reference.py',
    'minimumDeltaE2000': audit.MIN_DELTA_E_2000,
    'themes': themes,
    'variety': varieties,
}
# One theme or variant per line, so that a change of the results gives a readable diff
with open(os.path.join(out, 'audit-reference.json'), 'w', encoding='utf-8') as handle:
    compact = {'separators': (',', ':'), 'ensure_ascii': False}
    handle.write('{\n' + f'"source":{json.dumps(result["source"], **compact)},\n'
                 + f'"minimumDeltaE2000":{result["minimumDeltaE2000"]},\n"themes":[\n')
    handle.write(',\n'.join(json.dumps(t, **compact) for t in themes) + '\n],\n"variety":[\n')
    handle.write(',\n'.join(json.dumps(v, **compact) for v in varieties) + '\n]\n}\n')
print(f'{len(themes)} themes, {sum(len(t["checks"]) for t in themes)} checks, '
      f'{sum(len(t["distinctions"]) for t in themes)} distinctions, {len(varieties)} variants ({commit})')
