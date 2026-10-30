"""Five synthetic T16 images; no network/user files. PNG uses the standard codec."""
from pathlib import Path
import base64, datetime, hashlib, json, shutil, struct, subprocess, tempfile, zlib

base = Path(tempfile.mkdtemp(prefix='willyou-ordinary-images-', dir='/private/tmp'))
project = base / 'project'
project.mkdir()
def chunk(name, data):
    return struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data))
def png(name, width, height, transparent=False):
    pixels = b''.join(b'\0' + b''.join(bytes([32, 170, 128, 0 if transparent and x < width // 2 else 255]) for x in range(width)) for _ in range(height))
    (project/name).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b''))
    return {'name': name, 'width': width, 'height': height, 'mime': 'image/png', 'transparent': transparent}
cases = [png('wide.png', 1600, 200), png('tall.png', 200, 1600), png('transparent.png', 240, 180, True)]
for n, color in enumerate([[220, 30, 40], [20, 190, 90]]):
    (base/f'frame-{n}.ppm').write_bytes(b'P6\n40 30\n255\n' + bytes(color) * (40 * 30))
command = [shutil.which('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-framerate', '5', '-i', str(base/'frame-%d.ppm'), '-loop', '0', str(project/'animated.gif')]
subprocess.run(command, check=True, capture_output=True)
probe = json.loads(subprocess.check_output([shutil.which('ffprobe'), '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames', '-of', 'json', str(project/'animated.gif')]))['streams'][0]
assert int(probe['nb_read_frames']) == 2
cases.append({'name': 'animated.gif', 'mime': 'image/gif', 'width': 40, 'height': 30, 'animation': True, 'probe': probe})
(project/'vector.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect x="20" y="20" width="80" height="40" fill="#20aa80"/></svg>\n')
cases.append({'name': 'vector.svg', 'mime': 'image/svg+xml', 'width': 120, 'height': 80, 'svg': True})
for item in cases:
    data = (project/item['name']).read_bytes()
    item.update(size=len(data), sha256=hashlib.sha256(data).hexdigest(), dataUrl='data:'+item['mime']+';base64,'+base64.b64encode(data).decode())
record = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'project': str(project), 'cases': cases, 'command': command, 'scope': 'Synthetic PNG/GIF/SVG only. P embeds the exact same encoded bytes; A uses protected real files.'}
(base/'fixtures.json').write_text(json.dumps(record, indent=2)+'\n')
print(json.dumps({'manifest': str(base/'fixtures.json'), 'project': str(project), 'cases': len(cases)}))
