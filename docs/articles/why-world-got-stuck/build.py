"""Assemble editable article and diagram fragments into a portable HTML draft."""
import base64
import re
from pathlib import Path

root = Path(__file__).resolve().parent
article = (root / 'article.html').read_text()
diagrams = []

def diagram(match):
    name = match.group(1)
    diagrams.append(name)
    return (root / 'diagrams' / f'{name}.html').read_text()

article = re.sub(r'\{\{diagram:([a-z-]+)\}\}', diagram, article)
assert '{{diagram:' not in article
fonts = []
for weight, style in [(400, 'normal'), (400, 'italic'), (500, 'normal'), (600, 'normal')]:
    font = root / 'fonts' / f'spectral-latin-{weight}-{style}.woff2'
    data = base64.b64encode(font.read_bytes()).decode()
    fonts.append(f"@font-face{{font-family:Spectral;src:url(data:font/woff2;base64,{data}) format('woff2');font-weight:{weight};font-style:{style};font-display:swap;}}")
css = (root / 'style.css').read_text()
js = (root / 'interaction.js').read_text()
html = ('<!doctype html>\n<html lang="en" data-theme="light">\n<head>\n'
        '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        '<meta name="description" content="An illustrated beginner’s guide to the economic and political bugs that stalled a simulated world, and what happened when they were repaired.">\n'
        '<meta name="robots" content="noindex">\n'
        '<title>Why my simulated world got stuck · Carlo Venditti</title>\n<style>\n'
        + '\n'.join(fonts) + '\n' + css + '\n</style>\n</head>\n<body>\n'
        + article + '\n<script>\n' + js + '\n</script>\n</body>\n</html>\n')
(root / 'index.html').write_text(html)
print(f'Built {len(diagrams)} diagrams in {len(html):,} characters: {root / "index.html"}')
