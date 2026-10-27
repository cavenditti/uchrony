"""Build Uchrony's scenery model kit in Blender.

Generate everything (editable .blend, runtime GLB and a preview sheet):

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python scripts/blender/scenery_models.py -- --preview docs/validation/scenery-models.png

Re-export after editing the meshes by hand in art/scenery-models.blend:

    /Applications/Blender.app/Contents/MacOS/Blender art/scenery-models.blend --background \
        --python scripts/blender/scenery_models.py -- --export-only

Models are authored in the renderer's Y-up space (+Z is forward) and keep the
bounds of the Three.js primitive each one replaces, so the existing instance
transforms (position, footprint scale and heading) still place them. Vertex
colors are linear: multipliers for instance-tinted models (trees, crowns,
sheep) and absolute colors for the moving props, which use a white instance.
"""

import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / "art" / "scenery-models.blend"
GLB = ROOT / "src" / "map" / "models" / "scenery-models.glb"
KIT = "Scenery kit"


def linear(value):
    """sRGB hex (or a gray multiplier) to a linear RGB tuple."""
    if isinstance(value, (int, float)):
        return (value, value, value)
    value = value.lstrip("#")
    srgb = [int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def scaled(color, k):
    return tuple(min(1.0, c * k) for c in color)


def three(v):
    """Blender (Z-up) coordinates to the renderer's Y-up coordinates."""
    return (v.x, v.z, -v.y)


def ring(center, axis, r1, r2, n, phase=0.0):
    cx, cy, cz = center
    points = []
    for i in range(n):
        a = phase + i * math.tau / n
        c, s = math.cos(a) * r1, math.sin(a) * r2
        points.append((cx + c, cy, cz + s) if axis == "y" else (cx, cy + c, cz + s) if axis == "x" else (cx + c, cy + s, cz))
    return points


class Model:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.layer = self.bm.loops.layers.float_color.new("Color")
        self.soft = []  # faces whose normals radiate from their part's centre

    def loft(self, rings, paint, smooth=False, caps=True, soft=False):
        """Connect point rings (a one-point ring is an apex) into a closed part."""
        verts = [[self.bm.verts.new((p[0], -p[2], p[1])) for p in r] for r in rings]
        faces = []
        for a, b in zip(verts, verts[1:]):
            if len(a) == 1 or len(b) == 1:
                apex, loop = (a[0], b) if len(a) == 1 else (b[0], a)
                faces += [self.bm.faces.new((apex, loop[i], loop[(i + 1) % len(loop)])) for i in range(len(loop))]
            else:
                faces += [
                    self.bm.faces.new((a[i], a[(i + 1) % len(a)], b[(i + 1) % len(b)], b[i])) for i in range(len(a))
                ]
        if caps:
            for end in (verts[0], verts[-1]):
                if len(end) >= 3:
                    faces.append(self.bm.faces.new(end))
        return self.finish(faces, paint, smooth, soft)

    def hull(self, points, paint, smooth=False):
        verts = [self.bm.verts.new((p[0], -p[2], p[1])) for p in points]
        out = bmesh.ops.convex_hull(self.bm, input=verts)
        for v in out["geom_interior"] + out["geom_unused"]:
            if isinstance(v, bmesh.types.BMVert) and v.is_valid and not v.link_faces:
                self.bm.verts.remove(v)
        faces = [g for g in out["geom"] if isinstance(g, bmesh.types.BMFace)]
        return self.finish(faces, paint, smooth)

    def box(self, center, size, paint, turn=0.0):
        cx, cy, cz = center
        w, h, d = (s / 2 for s in size)
        c, s = math.cos(turn), math.sin(turn)
        corners = [
            (cx + x * c + z * s, cy + y, cz - x * s + z * c) for x in (-w, w) for y in (-h, h) for z in (-d, d)
        ]
        return self.hull(corners, paint)

    def beam(self, a, b, width, height, paint):
        """A rectangular timber from a to b."""
        a, b = Vector(a), Vector(b)
        along = (b - a).normalized()
        side = along.cross(Vector((0, 1, 0)))
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side.normalize()
        up = side.cross(along).normalized()
        corners = [p + side * x * width / 2 + up * y * height / 2 for p in (a, b) for x in (-1, 1) for y in (-1, 1)]
        return self.hull([tuple(p) for p in corners], paint)

    def blob(self, center, radii, segments, rings, paint, lobes=(), twist=0.5, flatten=1.0):
        """A lumpy ellipsoid: offset rings break up the UV-sphere banding."""
        cx, cy, cz = center
        rx, ry, rz = radii
        rows = [[(cx, cy + ry, cz)]]
        for j in range(1, rings):
            lat = math.pi / 2 - j * math.pi / rings
            row = []
            for i in range(segments):
                lon = (i + (j % 2) * twist) * math.tau / segments
                n = Vector((math.cos(lat) * math.cos(lon), math.sin(lat), math.cos(lat) * math.sin(lon)))
                bump = 1 + sum(k * max(0.0, n.dot(Vector(d).normalized())) ** 3 for d, k in lobes)
                y = n.y * (flatten if n.y < 0 else 1)
                row.append((cx + n.x * rx * bump, cy + y * ry * bump, cz + n.z * rz * bump))
            rows.append(row)
        rows.append([(cx, cy - ry * flatten, cz)])
        return self.loft(rows, paint, smooth=True, caps=False, soft=True)

    def finish(self, faces, paint, smooth, soft=False):
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        for f in faces:
            f.smooth = smooth
            for loop in f.loops:
                color = paint(three(loop.vert.co)) if callable(paint) else paint
                loop[self.layer] = (*color, 1.0)
        if soft:
            self.soft.append(faces)
        return faces

    def fit(self, low, high):
        """Scale and translate to exact bounds so instance transforms stay valid."""
        pts = [three(v.co) for v in self.bm.verts]
        mins = [min(p[i] for p in pts) for i in range(3)]
        maxs = [max(p[i] for p in pts) for i in range(3)]
        for v in self.bm.verts:
            p = three(v.co)
            q = [low[i] + (p[i] - mins[i]) * (high[i] - low[i]) / (maxs[i] - mins[i]) for i in range(3)]
            v.co = (q[0], -q[2], q[1])
        # Shading gradients were painted on the unfitted shape; they are relative,
        # so the fitted model keeps them.

    def build(self, collection):
        mesh = bpy.data.meshes.new(self.name)
        self.bm.faces.index_update()
        soft = []
        for faces in self.soft:
            pts = [v.co.copy() for f in faces for v in f.verts]
            low = Vector([min(p[i] for p in pts) for i in range(3)])
            high = Vector([max(p[i] for p in pts) for i in range(3)])
            soft.append(({f.index for f in faces}, (low + high) / 2, (high - low) / 2))
        self.bm.to_mesh(mesh)
        self.bm.free()
        mesh.color_attributes.active_color = mesh.color_attributes["Color"]
        mesh.color_attributes.render_color_index = 0
        if soft:
            normals = [tuple(c.vector) for c in mesh.corner_normals]
            for poly in mesh.polygons:
                for indices, centre, half in soft:
                    if poly.index in indices:
                        for corner in poly.loop_indices:
                            p = mesh.vertices[mesh.loops[corner].vertex_index].co
                            n = Vector([(p[i] - centre[i]) / max(half[i], 1e-6) ** 2 for i in range(3)])
                            normals[corner] = tuple(n.normalized())
            mesh.normals_split_custom_set(normals)
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        return obj


# Palette. Moving props carry their own colors; the rest are relative shades.
BARK = linear("#6a5038")
TIMBER = linear("#6e5034")
CANVAS = linear("#e6d6ae")


def gradient(low_y, high_y, dark, light=1.0, base=(1.0, 1.0, 1.0)):
    def paint(p):
        t = min(1.0, max(0.0, (p[1] - low_y) / (high_y - low_y)))
        return scaled(base, dark + (light - dark) * t * t * (3 - 2 * t))

    return paint


def broadleaf():
    """Forest deciduous tree; replaces the jittered sphere (bounds ±1, y −0.2…1.8)."""
    m = Model("broadleaf")
    m.loft(
        [ring((0, -0.2, 0), "y", 0.17, 0.17, 5), ring((0, 0.55, 0), "y", 0.09, 0.09, 5, 0.4)],
        scaled(BARK, 0.55),
        smooth=True,
    )
    lobes = [((0.7, 0.5, 0.2), 0.16), ((-0.6, 0.6, 0.5), 0.14), ((-0.2, 0.5, -0.8), 0.15), ((0.1, 1, 0), 0.08)]
    m.blob((0, 1.0, 0), (1.0, 0.82, 1.0), 8, 5, gradient(0.25, 1.75, 0.64), lobes, flatten=0.72)
    m.fit((-1, -0.2, -1), (1, 1.8, 1))
    return m


def conifer():
    """Tiered fir for slender forest trees; same bounds as the broadleaf."""
    m = Model("conifer")
    m.loft(
        [ring((0, -0.2, 0), "y", 0.13, 0.13, 5), ring((0, 0.3, 0), "y", 0.08, 0.08, 5, 0.3)],
        scaled(BARK, 0.5),
        smooth=True,
    )
    tiers = ((0.02, 1.0, 0.8), (0.4, 0.82, 1.15), (0.78, 0.62, 1.5), (1.12, 0.42, 1.8))
    for k, (base, radius, top) in enumerate(tiers):
        skirt = [
            (p[0] * (1.06 if i % 2 else 0.92), p[1] - (0.06 if i % 2 else 0.0), p[2] * (1.06 if i % 2 else 0.92))
            for i, p in enumerate(ring((0, base, 0), "y", radius, radius, 7, k * 0.9))
        ]
        under = [(0, base + (top - base) * 0.2, 0)]
        m.loft([under, skirt, [(0, top, 0)]], gradient(base - 0.06, top, 0.46 + k * 0.05), caps=False)
    m.fit((-1, -0.2, -1), (1, 1.8, 1))
    return m


def crown():
    """Town, orchard and woodland crown; replaces the icosahedron (bounds ±0.5)."""
    m = Model("crown")
    lobes = [((0.7, 0.4, 0.3), 0.18), ((-0.6, 0.5, 0.4), 0.15), ((0, 0.5, -0.9), 0.16), ((0, 1, 0), 0.07)]
    m.blob((0, 0, 0), (0.5, 0.5, 0.5), 8, 5, gradient(-0.4, 0.45, 0.68), lobes, flatten=0.78)
    m.fit((-0.5, -0.5, -0.5), (0.5, 0.5, 0.5))
    return m


def sheep():
    """Grazing sheep; fleece is tinted by the instance, face and legs stay dark."""
    m = Model("sheep")
    dark = linear(0.2)
    for x in (-0.24, 0.24):
        for z in (-0.28, 0.2):
            m.box((x, -0.32, z), (0.13, 0.36, 0.12), dark)
    m.blob((0, 0.1, -0.06), (0.5, 0.34, 0.44), 7, 4, gradient(-0.2, 0.45, 0.78), [((0, 1, 0.3), 0.1)], flatten=0.85)
    m.blob((0, 0.18, 0.4), (0.17, 0.2, 0.13), 6, 3, dark)
    for x in (-0.16, 0.16):
        m.box((x, 0.3, 0.38), (0.12, 0.05, 0.07), dark)
    m.fit((-0.5, -0.5, -0.5), (0.5, 0.5, 0.5))
    return m


def roof_gable():
    """Gable roof with fascia, ridge roll and recessed gable ends (bounds ±0.5, ridge along Z)."""
    m = Model("roof-gable")
    tile = linear(1.0)
    profile = [(-0.5, -0.5), (0.5, -0.5), (0.5, -0.4), (0.06, 0.42), (0.03, 0.5), (-0.03, 0.5), (-0.06, 0.42), (-0.5, -0.4)]
    faces = m.loft([[(x, y, z) for x, y in profile] for z in (-0.5, 0.5)], tile)
    caps = [f for f in faces if abs(f.normal.y) > 0.99]  # Blender Y is the renderer's −Z
    inset = bmesh.ops.inset_individual(m.bm, faces=caps, thickness=0.07, depth=-0.035)
    for f in inset["faces"] + caps:
        for loop in f.loops:
            loop[m.layer] = (*scaled(tile, 0.8), 1.0)
    return m


def roof_hip():
    """Hip roof with a fascia and a slight kick at the eaves (bounds ±0.5)."""
    m = Model("roof-hip")
    tile = linear(1.0)
    square = lambda y, h: [(-h, y, -h), (h, y, -h), (h, y, h), (-h, y, h)]
    m.loft([square(-0.5, 0.5), square(-0.42, 0.5), square(-0.26, 0.37), [(0, 0.5, 0)]], tile)
    return m


def boat():
    """Lateen-rigged harbour boat at true scale; bow along +Z, keel just below the waterline."""
    m = Model("boat")
    tar, hull, wale, deck = linear("#3a302a"), linear("#6b4a2f"), linear("#a07a4c"), linear("#8c6b45")
    stations = [  # z, half-beam, gunwale, chine, keel
        (-0.46, 0.11, 0.21, 0.05, -0.02),
        (-0.32, 0.16, 0.18, 0.0, -0.05),
        (-0.12, 0.175, 0.165, -0.02, -0.065),
        (0.08, 0.172, 0.165, -0.02, -0.065),
        (0.26, 0.14, 0.18, 0.0, -0.05),
        (0.40, 0.075, 0.21, 0.04, -0.02),
        (0.48, 0.008, 0.25, 0.12, 0.06),
    ]
    rings = []
    for z, beam, top, chine, keel in stations:
        wale_y = top - 0.045
        rings.append(
            [
                (-beam, top, z),
                (-beam * 0.97, wale_y, z),
                (-beam * 0.8, chine, z),
                (0, keel, z),
                (beam * 0.8, chine, z),
                (beam * 0.97, wale_y, z),
                (beam, top, z),
            ]
        )

    faces = m.loft(rings, hull)
    for f in faces:
        ys = [three(v.co)[1] for v in f.verts]
        n = f.normal
        color = deck if n.z > 0.9 else wale if min(ys) > max(ys) - 0.06 and max(ys) > 0.12 else tar if max(ys) < 0.06 else hull
        for loop in f.loops:
            loop[m.layer] = (*color, 1.0)
    m.loft([ring((0, 0.15, 0.06), "y", 0.02, 0.02, 6), ring((0, 0.98, 0.06), "y", 0.014, 0.014, 6)], linear("#594b39"))
    m.beam((0, 0.36, 0.44), (0, 1.02, -0.34), 0.018, 0.018, linear("#594b39"))
    tack, peak, clew = Vector((0, 0.35, 0.4)), Vector((0, 0.99, -0.32)), Vector((0, 0.27, -0.28))
    billow = lambda p, k: (p.x + k, p.y, p.z)
    mid = lambda a, b: (a + b) / 2
    front = [
        billow(tack, 0),
        billow(mid(tack, peak), 0.004),
        billow(peak, 0),
        billow(mid(peak, clew), 0.035),
        billow(clew, 0),
        billow(mid(clew, tack), 0.03),
        billow((tack + peak + clew) / 3, 0.07),
    ]
    back = [(x - 0.008, y, z) for x, y, z in front]
    verts = [m.bm.verts.new((p[0], -p[2], p[1])) for p in front + back]
    tris = [(0, 1, 6), (1, 2, 3), (1, 3, 6), (3, 4, 5), (3, 5, 6), (5, 0, 6)]
    faces = [m.bm.faces.new([verts[i] for i in t]) for t in tris]
    faces += [m.bm.faces.new([verts[7 + i] for i in reversed(t)]) for t in tris]
    edge = [0, 1, 2, 3, 4, 5]
    for i, j in zip(edge, edge[1:] + edge[:1]):
        faces.append(m.bm.faces.new((verts[i], verts[7 + i], verts[7 + j], verts[j])))
    m.finish(faces, CANVAS, False)
    return m


def cart():
    """Two-wheeled ox cart with a sacked load; centred on its own length, facing +Z."""
    m = Model("cart")
    bed, rail, load = linear("#ad8553"), linear("#8d6a42"), linear("#c9ad78")
    ox, horn, hoof = linear("#8a6d4e"), linear("#d9cfb6"), linear("#4d3c2c")
    shift = -0.07
    for x in (-0.19, 0.19):
        rim = ring((x, 0.08, -0.2 + shift), "x", 0.12, 0.12, 8, math.pi / 8)
        m.loft(
            [[(x - 0.018, y, z) for _, y, z in rim], [(x + 0.018, y, z) for _, y, z in rim]],
            lambda p, x=x: scaled(linear("#5a4a38"), 0.6 + 0.4 * min(1.0, math.hypot(p[1] - 0.08, p[2] + 0.2 - shift) / 0.12)),
        )
    m.box((0, 0.14, -0.2 + shift), (0.32, 0.035, 0.44), bed)
    for x in (-0.16, 0.16):
        m.box((x, 0.2, -0.2 + shift), (0.022, 0.09, 0.44), rail)
    for z in (-0.42, 0.02):
        m.box((0, 0.19, z + shift), (0.32, 0.075, 0.022), rail)
    m.blob((0, 0.2, -0.2 + shift), (0.13, 0.1, 0.18), 6, 4, gradient(0.12, 0.3, 0.75, base=load))
    for x in (-0.1, 0.1):
        m.beam((x, 0.15, 0.02 + shift), (x, 0.2, 0.46 + shift), 0.022, 0.022, rail)
    body = [
        ring((0, 0.25, z + shift), "z", rx, ry, 6, math.pi / 6)
        for z, rx, ry in ((0.16, 0.055, 0.065), (0.22, 0.08, 0.09), (0.4, 0.08, 0.095), (0.5, 0.06, 0.075))
    ]
    m.loft(body, gradient(0.15, 0.34, 0.7, base=ox), smooth=True)
    for x in (-0.045, 0.045):
        for z in (0.2, 0.46):
            m.box((x, 0.09, z + shift), (0.03, 0.2, 0.03), hoof)
    m.hull(
        [(x * w, y, z + shift) for x in (-1, 1) for y, z, w in ((0.32, 0.5, 0.05), (0.2, 0.5, 0.05), (0.27, 0.6, 0.035), (0.21, 0.6, 0.035))],
        ox,
    )
    for x in (-1, 1):
        m.beam((x * 0.03, 0.33, 0.52 + shift), (x * 0.1, 0.38, 0.55 + shift), 0.016, 0.016, horn)
    return m


def figure():
    """A field worker in a straw hat; feet at the pose origin's ground level."""
    m = Model("figure")
    tunic, belt, skin, straw = linear("#b17f58"), linear("#6f4b33"), linear("#dbc49b"), linear("#d6bd7c")
    m.loft(
        [ring((0, y, 0), "y", r, r, 6) for y, r in ((-0.06, 0.042), (0.09, 0.033), (0.12, 0.031))],
        lambda p: scaled(tunic, 0.72 + 0.28 * min(1.0, (p[1] + 0.06) / 0.18)),
    )
    m.loft([ring((0, y, 0), "y", r, r, 6) for y, r in ((0.12, 0.033), (0.135, 0.033))], belt)
    m.loft([ring((0, y, 0), "y", r, r * 0.8, 6) for y, r in ((0.135, 0.033), (0.18, 0.042), (0.198, 0.02))], tunic)
    m.blob((0, 0.225, 0.002), (0.028, 0.032, 0.028), 6, 4, skin)
    m.loft([ring((0, y, 0), "y", 0.064, 0.064, 8) for y in (0.243, 0.251)], straw)
    m.loft([ring((0, 0.251, 0), "y", 0.03, 0.03, 8), [(0, 0.29, 0)]], scaled(straw, 0.9))
    return m


def mill_sails():
    """Windmill rotor in the XY plane, turning about +Z (replaces four boxes, radius ≈0.9)."""
    m = Model("mill-sails")
    hub = linear("#4a3d30")
    m.loft([ring((0, 0, z), "z", 0.065, 0.065, 8, math.pi / 8) for z in (-0.03, 0.07)], hub)
    m.beam((-0.9, 0, 0.03), (0.9, 0, 0.03), 0.036, 0.036, TIMBER)
    m.beam((0, -0.9, 0.03), (0, 0.9, 0.03), 0.036, 0.036, TIMBER)
    for k in range(4):
        a = k * math.pi / 2
        radial, lateral = Vector((math.cos(a), math.sin(a), 0)), Vector((-math.sin(a), math.cos(a), 0))
        at = lambda r, s, z: tuple(radial * r + lateral * s + Vector((0, 0, z)))
        corners = [at(r, s, z) for r in (0.16, 0.88) for s in (0.025, 0.2) for z in (-0.006, 0.006)]
        m.hull(corners, CANVAS)
        for r in (0.34, 0.6, 0.86):
            m.beam(at(r, 0.0, 0.016), at(r, 0.21, 0.016), 0.014, 0.014, TIMBER)
        m.beam(at(0.16, 0.205, 0.016), at(0.88, 0.205, 0.016), 0.014, 0.014, TIMBER)
    return m


MODELS = [broadleaf, conifer, crown, sheep, roof_gable, roof_hip, boat, cart, figure, mill_sails]


def kit_collection():
    collection = bpy.data.collections.get(KIT)
    if collection is None:
        collection = bpy.data.collections.new(KIT)
        bpy.context.scene.collection.children.link(collection)
    return collection


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    collection = kit_collection()
    for make in MODELS:
        make().build(collection)
    return collection


def export(collection):
    GLB.parent.mkdir(parents=True, exist_ok=True)
    for obj in bpy.context.scene.objects:
        obj.select_set(obj.name in collection.objects)
    bpy.ops.export_scene.gltf(
        filepath=str(GLB),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="NONE",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_extras=False,
        export_animations=False,
    )
    return {
        obj.name: sum(len(p.vertices) - 2 for p in obj.data.polygons) for obj in collection.objects
    }


def preview(collection, path):
    """A labelled contact sheet seen from the map's tilted camera angle."""
    scene = bpy.context.scene
    collection.hide_render = True
    sheet = bpy.data.collections.new("Preview")
    scene.collection.children.link(sheet)
    material = bpy.data.materials.new("Vertex color")
    nodes = material.node_tree.nodes
    attribute = nodes.new("ShaderNodeVertexColor")
    attribute.layer_name = "Color"
    material.node_tree.links.new(attribute.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])
    nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    layout = [  # name, display scale (x, y, z) in renderer space, tint, label
        ("broadleaf", (0.58, 0.9, 0.58), "#2f6b45", "broadleaf"),
        ("conifer", (0.34, 1.6, 0.32), "#2c5e48", "conifer"),
        ("crown", (1.1, 1.1, 1.1), "#3f7a4a", "crown"),
        ("sheep", (0.5, 0.42, 0.8), "#dfdac2", "sheep"),
        ("roof-gable", (1.2, 0.5, 1.5), "#b45f3c", "gable roof"),
        ("roof-hip", (1.2, 0.6, 1.2), "#b45f3c", "hip roof"),
        ("boat", (1.4, 1.4, 1.4), None, "boat"),
        ("cart", (1.6, 1.6, 1.6), None, "ox cart"),
        ("figure", (4.0, 4.0, 4.0), None, "worker"),
        ("mill-sails", (0.75, 0.75, 0.75), None, "mill sails"),
    ]
    for i, (name, size, tint, label) in enumerate(layout):
        column, row = i % 5, i // 5
        x, depth = column * 1.9, -row * 2.6
        source = collection.objects[name]
        obj = source.copy()
        sheet.objects.link(obj)
        obj.location = (x, depth, 0.75 if name == "mill-sails" else 0.3 if name in ("roof-gable", "roof-hip", "crown", "sheep") else 0.05)
        obj.scale = (size[0], size[2], size[1])
        obj.color = (*linear(tint), 1.0) if tint else (1, 1, 1, 1)
        if name == "mill-sails":
            obj.rotation_euler = (math.pi / 2, 0, 0)
        if name.startswith("roof"):
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, depth, -0.1))
            wall = bpy.context.active_object
            wall.scale = (size[0] / 1.04, size[2] / 1.04, 0.6)
            wall.color = (*linear("#e9dcc2"), 1)
            for c in wall.users_collection:
                c.objects.unlink(wall)
            sheet.objects.link(wall)
        bpy.ops.mesh.primitive_plane_add(size=1.7, location=(x, depth, -0.4 if name.startswith("roof") else 0))
        ground = bpy.context.active_object
        ground.color = (*linear("#9fae7c"), 1)
        for c in ground.users_collection:
            c.objects.unlink(ground)
        sheet.objects.link(ground)
        text = bpy.data.curves.new(f"{name} label", "FONT")
        text.body = label
        text.size = 0.2
        text.align_x = "CENTER"
        caption = bpy.data.objects.new(f"{name} label", text)
        caption.location = (x, depth - 1.05, 0.01)
        caption.color = (*linear("#f0e9d8"), 1)
        sheet.objects.link(caption)
    camera = bpy.data.cameras.new("Map camera")
    camera.type = "ORTHO"
    camera.ortho_scale = 10.2
    rig = bpy.data.objects.new("Map camera", camera)
    sheet.objects.link(rig)
    tilt = math.pi * 0.29
    rig.location = (3.8, -1.3 - 30 * math.cos(tilt), 30 * math.sin(tilt))
    rig.rotation_euler = (math.pi / 2 - tilt, 0, 0)
    scene.camera = rig
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "OBJECT"
    shading.show_shadows = True
    shading.show_cavity = True
    shading.cavity_type = "BOTH"
    scene.display.light_direction = (0.45, -0.35, 0.82)
    world = bpy.data.worlds.new("Slate")
    world.color = linear("#20303a")
    scene.world = world
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.render.filepath = str(path)
    # Multiply each object color by its vertex colors through a per-object copy.
    for obj in sheet.objects:
        if obj.type == "MESH" and obj.data.color_attributes:
            colored = obj.data.copy()
            tint = Vector(obj.color[:3])
            layer = colored.color_attributes["Color"]
            for item in layer.data:
                item.color = (*[c * t for c, t in zip(item.color[:3], tint)], 1.0)
            obj.data = colored
            obj.color = (1, 1, 1, 1)
    shading.color_type = "VERTEX"
    for obj in sheet.objects:
        if obj.type in ("MESH", "FONT") and not (obj.type == "MESH" and obj.data.color_attributes):
            mesh = obj.data
            if obj.type == "MESH":
                layer = mesh.color_attributes.new("Color", "FLOAT_COLOR", "CORNER")
                for item in layer.data:
                    item.color = obj.color
    for obj in sheet.objects:
        if obj.type == "FONT":
            obj.data.materials.append(material)
    bpy.ops.render.render(write_still=True)
    sheet.hide_render = True
    sheet.hide_viewport = True
    collection.hide_render = False


def main():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if "--export-only" in args:
        collection = bpy.data.collections[KIT]
    else:
        collection = build()
    counts = export(collection)
    if "--preview" in args:
        preview(collection, ROOT / args[args.index("--preview") + 1])
    if "--export-only" not in args:
        BLEND.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    for name, tris in counts.items():
        print(f"scenery-model {name}: {tris} triangles")


main()
