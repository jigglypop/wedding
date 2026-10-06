"""Creates small WebP previews for bundled reference images and records them in data/materials.json.

The material grid shows these previews instead of multi-megabyte originals. Run after build-source-data.py.
"""
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'data' / 'assets'
THUMBS = ASSETS / 'thumbs'
MATERIALS = ROOT / 'data' / 'materials.json'
MIME = {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp'}

THUMBS.mkdir(parents=True, exist_ok=True)
materials = json.loads(MATERIALS.read_text(encoding='utf-8'))
items = materials if isinstance(materials, list) else materials['materials']
made = 0
for material in items:
    filename = material.get('filename') or ''
    if material.get('sourceType') == 'upload' or Path(filename).suffix.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
        continue
    source = ASSETS / filename
    with Image.open(source) as image:
        material['mimeType'] = MIME.get(image.format, material.get('mimeType'))
        preview = ImageOps.exif_transpose(image).convert('RGB')
        preview.thumbnail((720, 720), Image.LANCZOS)
        target = THUMBS / (Path(filename).stem + '.webp')
        preview.save(target, 'WEBP', quality=80, method=6)
    material['thumbnail'] = f'thumbs/{target.name}'
    made += 1
MATERIALS.write_text(json.dumps(materials, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'{made} previews written to {THUMBS.relative_to(ROOT)}')
