"""Small modelling library on top of Blender's bmesh, used by build_room_kit.py.

Everything is authored in the app's coordinates (metres, Y up, as in three.js) and converted to Blender's Z-up
only when a part is finished, so the numbers here are the numbers in src/scene/room.js.
Pieces are built as temporary bmeshes ("tb"), bevelled, UV-mapped, and absorbed into a Part: one object per part,
one primitive per material.
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix

TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))      # (x, y, z) -> (x, -z, y)
FROM_BLENDER = TO_BLENDER.inverted()
V = lambda x, y, z: Vector((x, y, z))


def material(name, color, rough=0.5, metal=0.0, alpha=1.0, emission=None):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name)
    try: m.use_nodes = True
    except Exception: pass
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
    if emission: b.inputs['Emission Color'].default_value = (*emission[:3], 1); b.inputs['Emission Strength'].default_value = emission[3]
    return m


# ---------- temporary bmeshes ----------
def tb_new():
    bm = bmesh.new(); bm.loops.layers.uv.new('UVMap'); return bm

def tb_box(x0, x1, y0, y1, z0, z1, bevel=0.0015, seg=2):
    bm = tb_new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((x0 + (v.co.x + 0.5) * (x1 - x0), y0 + (v.co.y + 0.5) * (y1 - y0), z0 + (v.co.z + 0.5) * (z1 - z0)))
    b = min(bevel, 0.45 * min(abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)))
    if b > 1e-5: bmesh.ops.bevel(bm, geom=bm.edges[:], offset=b, segments=seg, profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm

def tb_cyl(p0, p1, r0, r1=None, seg=24, caps=True, bevel=0.0):
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0
    bm = tb_new(); bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r0, radius2=r0 if r1 is None else r1, depth=d.length)
    if bevel > 0: bmesh.ops.bevel(bm, geom=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6], offset=bevel, segments=2, profile=0.5, affect='EDGES', clamp_overlap=True)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((p0 + p1) / 2) @ rot, verts=bm.verts[:])
    return bm

def _basis(axis):
    a = Vector(axis).normalized(); t = Vector((1, 0, 0)) if abs(a.x) < 0.9 else Vector((0, 1, 0))
    e1 = a.cross(t).normalized(); e2 = a.cross(e1).normalized(); return a, e1, e2

def tb_lathe(profile, origin=(0, 0, 0), axis=(0, 1, 0), seg=32):
    """profile: [(radius, height along axis)], a closed outline if it starts and ends on the axis."""
    a, e1, e2 = _basis(axis); o = Vector(origin); bm = tb_new(); rings = []
    for r, h in profile:
        if r < 1e-7: rings.append([bm.verts.new(o + a * h)] * seg)
        else: rings.append([bm.verts.new(o + a * h + (e1 * math.cos(2 * math.pi * i / seg) + e2 * math.sin(2 * math.pi * i / seg)) * r) for i in range(seg)])
    for j in range(len(profile) - 1):
        A, B = rings[j], rings[j + 1]
        for i in range(seg):
            k = (i + 1) % seg; vs = []
            for v in (A[i], A[k], B[k], B[i]):
                if v not in vs: vs.append(v)
            if len(vs) >= 3:
                try: bm.faces.new(vs)
                except ValueError: pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); return bm

def tb_tube(path, r, seg=10, caps=True, closed=False):
    """A round tube along a polyline (parallel-transported frames). r may be a list, one radius per point."""
    P = [Vector(p) for p in path]; n = len(P); bm = tb_new(); rings = []
    rs = r if isinstance(r, (list, tuple)) else [r] * n
    tang = [((P[(i + 1) % n] if closed or i < n - 1 else P[i]) - (P[(i - 1) % n] if closed or i > 0 else P[i])).normalized() for i in range(n)]
    _, e1, _ = _basis(tang[0])
    for i in range(n):
        t = tang[i]; e1 = (e1 - t * e1.dot(t)).normalized(); e2 = t.cross(e1)
        rings.append([bm.verts.new(P[i] + (e1 * math.cos(2 * math.pi * k / seg) + e2 * math.sin(2 * math.pi * k / seg)) * rs[i]) for k in range(seg)])
    for i in range(n if closed else n - 1):
        A, B = rings[i], rings[(i + 1) % n]
        for k in range(seg): bm.faces.new((A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]))
    if caps and not closed: bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); return bm

def tb_sweep(profile, path, up=(0, 1, 0), inside=None, closed=False, caps=True, flip=False):
    """Sweep an open profile [(a, b)] along a polyline lying in a plane with normal `up`, with mitred corners.
    a is measured sideways in that plane: toward `inside` (a point on the side the profile should face) if given,
    otherwise to the left of the direction of travel seen from `up` (to the right with flip). b is along `up`."""
    P = [Vector(p) for p in path]; n = len(P); up = Vector(up).normalized(); bm = tb_new()
    def side(i0, i1):
        d = (P[i1] - P[i0]).normalized(); s = up.cross(d).normalized() * (-1 if flip else 1)
        if inside is not None and (Vector(inside) - (P[i0] + P[i1]) / 2).dot(s) < 0: s = -s
        return s
    rings = []
    for i in range(n):
        s_in = side((i - 1) % n, i) if (closed or i > 0) else None
        s_out = side(i, (i + 1) % n) if (closed or i < n - 1) else None
        if s_in is None: m = s_out
        elif s_out is None: m = s_in
        else: m = (s_in + s_out).normalized(); m = m / max(0.2, m.dot(s_in))
        rings.append([bm.verts.new(P[i] + m * a + up * b) for a, b in profile])
    k = len(profile)
    for i in range(n if closed else n - 1):
        A, B = rings[i], rings[(i + 1) % n]
        for j in range(k - 1): bm.faces.new((A[j], A[j + 1], B[j + 1], B[j]))
    if caps and not closed: bm.faces.new(rings[0]); bm.faces.new(rings[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); return bm

def tb_grid(nx, ny, f, uv=None):
    """A sheet: f(u, v) -> point for u, v in [0, 1]; uv(u, v) -> texture coordinates (metres)."""
    bm = tb_new(); L = bm.loops.layers.uv.active
    vs = [[bm.verts.new(Vector(f(i / nx, j / ny))) for i in range(nx + 1)] for j in range(ny + 1)]
    for j in range(ny):
        for i in range(nx):
            fc = bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
            if uv:
                for l, (a, b) in zip(fc.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))): l[L].uv = uv(a / nx, b / ny)
    return bm

def tb_transform(bm, matrix):
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts[:]); return bm

def uv_box(bm, grain='x', scale=1.0):
    """Box-projected UVs in metres, with the texture's V axis (the wood grain) along `grain` where the face allows."""
    L = bm.loops.layers.uv.verify(); g = 'xyz'.index(grain); bm.normal_update()
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i])); axes = [i for i in range(3) if i != ax]
        u_ax, v_ax = (axes[0], axes[1]) if axes[1] == g or axes[0] != g else (axes[1], axes[0])
        for l in f.loops: l[L].uv = (l.vert.co[u_ax] * scale, l.vert.co[v_ax] * scale)
    return bm


# ---------- parts ----------
class Part:
    def __init__(self, name, smooth_only=False):
        self.name = name; self.bm = tb_new(); self.mats = []; self.smooth_only = smooth_only
    def add(self, tb, mat, uv=None, grain='x'):
        """Absorb a temporary bmesh (and free it). mat: a Blender material; uv: None (keep what it has) or 'box'."""
        if mat not in self.mats: self.mats.append(mat)
        mi = self.mats.index(mat)
        for f in tb.faces: f.material_index = mi
        if uv == 'box': uv_box(tb, grain)
        me = bpy.data.meshes.new('tmp'); tb.to_mesh(me); tb.free(); self.bm.from_mesh(me); bpy.data.meshes.remove(me)
        return self
    def finish(self, collection=None):
        bmesh.ops.transform(self.bm, matrix=TO_BLENDER, verts=self.bm.verts[:])
        me = bpy.data.meshes.new(self.name); self.bm.to_mesh(me); self.bm.free()
        for m in self.mats: me.materials.append(m)
        for p in me.polygons: p.use_smooth = True
        ob = bpy.data.objects.new(self.name, me); (collection or bpy.context.scene.collection).objects.link(ob)
        if not self.smooth_only:
            me.set_sharp_from_angle(angle=math.radians(40))
            wn = ob.modifiers.new('weighted', 'WEIGHTED_NORMAL'); wn.keep_sharp = True; wn.weight = 50
        return ob


# ---------- cloth ----------
def cloth_sheet(name, nx, ny, point, uv, keep=None):
    """A Blender mesh object for simulation. point(u, v) is in Blender coordinates here (Z up); keep(u, v) -> bool cuts a silhouette."""
    bm = tb_new(); L = bm.loops.layers.uv.active
    vs = [[bm.verts.new(Vector(point(i / nx, j / ny))) for i in range(nx + 1)] for j in range(ny + 1)]
    for j in range(ny):
        for i in range(nx):
            if keep and not keep((i + 0.5) / nx, (j + 0.5) / ny): continue
            fc = bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
            for l, (a, b) in zip(fc.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))): l[L].uv = uv(a / nx, b / ny)
    for v in [v for v in bm.verts if not v.link_faces]: bm.verts.remove(v)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); return ob

def collider(name, tb):
    """A static collision object from a temporary bmesh given in Blender coordinates."""
    me = bpy.data.meshes.new(name); tb.to_mesh(me); tb.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    ob.modifiers.new('collision', 'COLLISION'); ob.collision.thickness_outer = 0.004; ob.collision.cloth_friction = 25
    return ob

def simulate(ob, pin, frames=90, quality=12, bending=0.6, mass=0.2, self_collide=True, rest_key=None, relax=10):
    """Run a cloth simulation on `ob` with vertex indices `pin` held, and return the result as a temporary bmesh in app coordinates."""
    vg = ob.vertex_groups.new(name='pin'); vg.add(list(pin), 1.0, 'REPLACE')
    m = ob.modifiers.new('cloth', 'CLOTH'); s = m.settings
    s.quality = quality; s.mass = mass; s.vertex_group_mass = 'pin'; s.pin_stiffness = 1.0
    s.tension_stiffness = 15; s.compression_stiffness = 6; s.shear_stiffness = 6; s.bending_stiffness = bending
    s.tension_damping = 12; s.compression_damping = 12; s.shear_damping = 12; s.bending_damping = 2.0; s.air_damping = 5
    if rest_key is not None: s.rest_shape_key = rest_key
    c = m.collision_settings; c.use_collision = True; c.distance_min = 0.005; c.collision_quality = 4
    c.use_self_collision = self_collide; c.self_distance_min = 0.004; c.self_friction = 10
    sc = bpy.context.scene; sc.frame_start = 1; sc.frame_end = frames; m.point_cache.frame_start = 1; m.point_cache.frame_end = frames
    for f in range(1, frames + 1): sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    tb = tb_new(); tb.from_mesh(me); bpy.data.meshes.remove(me)
    bmesh.ops.transform(tb, matrix=FROM_BLENDER, verts=tb.verts[:])
    for _ in range(relax):      # the solver leaves fine jitter in the surface; real cloth does not hold wrinkles that small
        bmesh.ops.smooth_vert(tb, verts=tb.verts[:], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    ob.hide_viewport = True; bpy.data.objects.remove(ob)      # out of the scene before the next simulation
    return tb
