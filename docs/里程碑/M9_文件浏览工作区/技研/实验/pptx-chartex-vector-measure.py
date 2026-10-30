"""Independent raster measurement of the ChartEx vector feasibility samples.

Expected values are fixed test data, not copied from the geometry generator.
Exact interior colors exclude antialiasing edges; allow two raster pixels.
"""
import collections
import hashlib
import json
import pathlib
import subprocess
import sys

COLORS = [(20, 128, 110), (195, 91, 85), (87, 121, 168), (182, 133, 56)]
VALUES = [6, 3, 4, 2, 5]


def measure(pdf):
    stem = pdf.with_suffix('')
    subprocess.run(['/opt/homebrew/bin/pdftoppm', '-f', '1', '-singlefile', '-r', '72', str(pdf), str(stem)], check=True)
    head, size, maximum, data = stem.with_suffix('.ppm').read_bytes().split(b'\n', 3)
    width, height = map(int, size.split())
    assert head == b'P6' and maximum == b'255' and len(data) == width*height*3
    pixels = {i: COLORS.index(rgb) for i, rgb in enumerate(zip(data[::3], data[1::3], data[2::3])) if rgb in COLORS}
    components = []
    while pixels:
        seed, color = pixels.popitem()
        queue = collections.deque([seed])
        xs, ys = [], []
        while queue:
            at = queue.popleft()
            x, y = at % width, at // width
            xs.append(x); ys.append(y)
            adjacent = ([at-1] if x else []) + ([at+1] if x+1 < width else []) + ([at-width] if y else []) + ([at+width] if y+1 < height else [])
            for other in adjacent:
                if pixels.get(other) == color:
                    del pixels[other]; queue.append(other)
        components.append({'color': color, 'x': min(xs), 'y': min(ys), 'width': max(xs)-min(xs)+1, 'height': max(ys)-min(ys)+1, 'pixels': len(xs)})
    components.sort(key=lambda row: row['y'] if pdf.stem == 'funnel' else row['x'])
    expected = [2, 1, 2] if pdf.stem == 'histogram' else VALUES
    assert len(components) == len(expected)
    assert [row['color'] for row in components] == [i % 4 for i in range(len(expected))]
    dimension = 'width' if pdf.stem in ['funnel', 'treemap'] else 'height'
    scale = sum(row[dimension] for row in components) / sum(expected)
    errors = [abs(row[dimension] - value*scale) for row, value in zip(components, expected)]
    assert max(errors) <= 2, (pdf, errors)
    if pdf.stem == 'funnel':
        centers = [row['x']+row['width']/2 for row in components]
        assert max(centers)-min(centers) <= 1
        assert max(row['height'] for row in components)-min(row['height'] for row in components) <= 1
    if pdf.stem == 'waterfall':
        assert all(abs(left['y']-(right['y']+right['height'])) <= 2 for left, right in zip(components, components[1:]))
    if pdf.stem in ['histogram', 'treemap']:
        assert all(abs(left['x']+left['width']-right['x']) <= 2 for left, right in zip(components, components[1:]))
    if pdf.stem == 'treemap':
        assert len({row['height'] for row in components}) == 1
    return {'type': pdf.stem, 'pdfSha256': hashlib.sha256(pdf.read_bytes()).hexdigest(), 'expected': expected, 'components': components, 'proportionMaxErrorPixels': max(errors), 'pass': True}


if __name__ == '__main__':
    folder = pathlib.Path(sys.argv[1])
    results = [measure(folder/(kind+'.pdf')) for kind in ['funnel', 'histogram', 'waterfall', 'treemap']]
    (folder/'measurement.json').write_text(json.dumps(results, indent=2)+'\n')
    print(json.dumps(results))
