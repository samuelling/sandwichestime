#!/usr/bin/env python3
"""Build the room kit: the modelled (not scanned) parts of the kitchen beyond the counter wall.

    pip install bpy                      # Blender as a Python module (or run inside Blender: blender -b -P this_file)
    python3 tools/blender/build_room_kit.py
    sh tools/compress_models.sh          # meshopt, as for the scanned models

Writes assets/models/room_kit/room_kit.gltf (+ .bin): one node per part, placed by src/scene/room.js. Materials are
plain named colours; room.js swaps them for the app's own materials by name (so paint, brass and oak match the kitchen).

Parts are authored in the app's coordinates (metres, Y up). Each part's origin and facing is noted where it is built;
"front" is +z. Room-sized parts (cornice, skirting) are in room coordinates and must match K in src/scene/kitchen.js
and R in src/scene/room.js.
"""
import bpy, bmesh, math, os, sys, random
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit_lib import *      # noqa: F401,F403

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'room_kit')
random.seed(7)

# ---- the room (keep in step with src/scene/kitchen.js K and src/scene/room.js R) ----
ROOM = dict(x0=-2.72, x1=1.72, z0=-0.62, z1=3.0, ceil=2.6)
COUNTER_END_Z = 0.0          # the right wall is clear from here back
FRIDGE_FRONT_Z = 0.08        # the left wall is clear from here back
DOOR = dict(cx=0.2, w=0.9, h=2.1, wall=0.14)               # opening in the rear wall
HALL = dict(x0=-0.7, x1=0.75, z1=5.2, ceil=2.4)
WIN_SIDE = dict(w=1.0, h=1.2)
WIN_BACK = dict(w=0.74, h=0.9)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---- materials (names are the contract with room.js) ----
PAINT = material('paint_white', (0.90, 0.88, 0.84), 0.45)
SAGE = material('paint_sage', (0.115, 0.16, 0.105), 0.42)
OAK = material('oak', (0.52, 0.38, 0.24), 0.5)
BRASS = material('brass', (0.55, 0.36, 0.11), 0.28, 1.0)
CHROME = material('chrome', (0.72, 0.74, 0.76), 0.2, 1.0)
IRON = material('iron_black', (0.02, 0.02, 0.02), 0.55, 0.6)
GLASS = material('glass', (1, 1, 1), 0.03, 0.0, alpha=0.15)
OPAL = material('glass_opal', (1, 0.96, 0.88), 0.3, emission=(1, 0.9, 0.72, 4))
ENAMEL = material('enamel_white', (0.92, 0.91, 0.88), 0.25)
PLASTIC = material('plastic_white', (0.93, 0.92, 0.9), 0.4)
DARK = material('slot_dark', (0.02, 0.02, 0.02), 0.8)
CREAM = material('stoneware_cream', (0.86, 0.82, 0.72), 0.3)
BLUE = material('stoneware_blue', (0.13, 0.22, 0.33), 0.3)
CORK = material('cork', (0.5, 0.36, 0.22), 0.9)
LINEN_BLIND = material('linen_blind', (0.82, 0.77, 0.66), 0.95)
LINEN_RUNNER = material('linen_runner', (0.62, 0.55, 0.42), 0.95)
LINEN_APRON = material('linen_apron', (0.2, 0.27, 0.36), 0.95)
TOWEL = material('towel_stripe', (0.9, 0.88, 0.84), 0.95)

parts = []
def part(name, **kw):
    p = Part(name, **kw); parts.append(p); return p

arc = lambda cx, cy, r, a0, a1, n: [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


# =====================================================================================================
# Door leaf. Origin: bottom of the hinge edge; the leaf runs along +x; its hall-side face is z = 0, room side z = +t.
# A traditional four-panel door: stiles, rails, a muntin, raised-and-fielded panels with a bead, knob, rose, hinges.
# =====================================================================================================
def build_door_leaf():
    P = part('door_leaf'); W, H, t = 0.838, 2.03, 0.04; y0 = 0.006
    st, top, lock, bot, mun = 0.105, 0.105, 0.19, 0.22, 0.095; lock_y = 0.86
    for x0, x1 in ((0, st), (W - st, W)): P.add(tb_box(x0, x1, y0, y0 + H, 0, t, 0.002), PAINT)                      # stiles
    for a, b in ((y0, y0 + bot), (y0 + lock_y, y0 + lock_y + lock), (y0 + H - top, y0 + H)): P.add(tb_box(st, W - st, a, b, 0, t, 0.002), PAINT)   # rails
    cx = W / 2
    for a, b in ((y0 + bot, y0 + lock_y), (y0 + lock_y + lock, y0 + H - top)): P.add(tb_box(cx - mun / 2, cx + mun / 2, a, b, 0, t, 0.002), PAINT)  # muntins
    for a, b in ((y0 + bot, y0 + lock_y), (y0 + lock_y + lock, y0 + H - top)):
        for x0, x1 in ((st, cx - mun / 2), (cx + mun / 2, W - st)):
            P.add(tb_box(x0 - 0.004, x1 + 0.004, a - 0.004, b + 0.004, t / 2 - 0.007, t / 2 + 0.007, 0), PAINT)       # panel
            for z0, z1, zs in ((t / 2 + 0.007, t / 2 + 0.013, 1), (t / 2 - 0.013, t / 2 - 0.007, -1)):               # raised field, both faces
                P.add(tb_box(x0 + 0.03, x1 - 0.03, a + 0.03, b - 0.03, z0, z1, 0.0055, 1), PAINT)
            bead = [(0, 0), (0.003, -0.001), (0.006, -0.004), (0.008, -0.008), (0.012, -0.0105), (0.015, -0.013)]         # a small ogee in the corner of frame and panel
            for zf, up in ((t, (0, 0, 1)), (0, (0, 0, -1))):
                P.add(tb_sweep(bead, [V(x0, a, zf), V(x1, a, zf), V(x1, b, zf), V(x0, b, zf)], up=up, inside=((x0 + x1) / 2, (a + b) / 2, zf), closed=True), PAINT)
    # knob, rose and escutcheon on both faces
    kx, ky = W - 0.062, y0 + lock_y + lock / 2
    knob = [(0, 0), (0.026, 0), (0.027, 0.003), (0.024, 0.006), (0.011, 0.008), (0.009, 0.022), (0.012, 0.03), (0.022, 0.036), (0.027, 0.046), (0.026, 0.056), (0.018, 0.064), (0, 0.066)]
    for z, ax in ((t, (0, 0, 1)), (0, (0, 0, -1))):
        P.add(tb_lathe(knob, (kx, ky, z), ax, 28), BRASS)
        P.add(tb_box(kx - 0.012, kx + 0.012, ky - 0.13, ky - 0.075, z - 0.002 if ax[2] > 0 else z - 0.003, z + 0.003 if ax[2] > 0 else z + 0.002, 0.002), BRASS)
        P.add(tb_cyl((kx, ky - 0.097, z + ax[2] * 0.0031), (kx, ky - 0.097, z + ax[2] * 0.0036), 0.0035, seg=12), DARK)
        P.add(tb_box(kx - 0.0015, kx + 0.0015, ky - 0.112, ky - 0.097, z + ax[2] * 0.0031 - 0.0003, z + ax[2] * 0.0031 + 0.0003, 0), DARK)
    # hinges (knuckles on the hall side, where the door opens to)
    for hy in (0.2, 1.0, 1.82):
        P.add(tb_cyl((0, hy - 0.05, -0.006), (0, hy + 0.05, -0.006), 0.006, seg=14, bevel=0.001), BRASS)
        P.add(tb_box(0, 0.03, hy - 0.05, hy + 0.05, -0.0015, 0.001, 0.0005), BRASS)


# =====================================================================================================
# Door frame. Origin: middle of the opening at floor level, on the room face of the wall; the room is +z,
# the hall -z (the wall runs from z = 0 to -wall). Lining with stops, and a moulded architrave on both faces.
# =====================================================================================================
ARCH = [(0.0, 0.0), (0.0, 0.011), (0.004, 0.015), (0.010, 0.017), (0.016, 0.013), (0.022, 0.013), (0.050, 0.019), (0.060, 0.021), (0.068, 0.019), (0.072, 0.014), (0.072, 0.0)]
def build_door_frame():
    P = part('door_frame'); w, h, wall = DOOR['w'], DOOR['h'], DOOR['wall']; hw = w / 2; lt = 0.03
    for x0, x1 in ((-hw, -hw + lt), (hw - lt, hw)): P.add(tb_box(x0, x1, 0, h, -wall, 0, 0.0015), PAINT)             # jamb linings
    P.add(tb_box(-hw, hw, h - lt, h, -wall, 0, 0.0015), PAINT)                                                       # head lining
    sz0, sz1 = -wall + 0.042, -wall + 0.054                                                                          # door stop: the leaf (40 mm) closes against it from the hall side
    for x0, x1 in ((-hw + lt, -hw + lt + 0.014), (hw - lt - 0.014, hw - lt)): P.add(tb_box(x0, x1, 0, h - lt, sz0, sz1 + 0.02, 0.002), PAINT)
    P.add(tb_box(-hw + lt, hw - lt, h - lt - 0.014, h - lt, sz0, sz1 + 0.02, 0.002), PAINT)
    e = 0.006                                                                                                         # architrave sits back from the lining edge by a small reveal
    for z, up in ((0.0, (0, 0, 1)), (-wall, (0, 0, -1))):
        path = [V(-hw + lt - e, 0, z), V(-hw + lt - e, h - lt + e, z), V(hw - lt + e, h - lt + e, z), V(hw - lt + e, 0, z)]
        P.add(tb_sweep(ARCH, path, up=up, flip=up[2] < 0), PAINT)
        for sx in (-1, 1):                                                                                            # plinth blocks
            x0 = sx * (hw - lt + e) + (0 if sx > 0 else -0.078); P.add(tb_box(x0, x0 + 0.078, 0, 0.135, min(z, z + up[2] * 0.025), max(z, z + up[2] * 0.025), 0.003), PAINT)
    # threshold strip between the two floors
    P.add(tb_box(-hw + lt, hw - lt, -0.002, 0.008, -wall, 0, 0.003), OAK, uv='box', grain='x')


# =====================================================================================================
# Cornice and skirting, in room coordinates.
# =====================================================================================================
CORNICE = [(0, -0.095), (0.010, -0.095), (0.010, -0.083), (0.018, -0.078)] + arc(0.073, -0.078, 0.055, 180, 90, 8)[1:] + [(0.080, -0.018), (0.080, -0.010), (0.095, -0.010), (0.095, 0)]
SKIRT = [(0, 0), (0.017, 0), (0.017, 0.092), (0.015, 0.100), (0.011, 0.104), (0.011, 0.110), (0.007, 0.118), (0.003, 0.122), (0, 0.122)]
def build_trim():
    R = ROOM; c = R['ceil']; mid = ((R['x0'] + R['x1']) / 2, 0, (R['z0'] + R['z1']) / 2)
    P = part('cornice')
    P.add(tb_sweep(CORNICE, [V(R['x0'], c, R['z0']), V(R['x1'], c, R['z0']), V(R['x1'], c, R['z1']), V(R['x0'], c, R['z1'])], inside=(mid[0], c, mid[2]), closed=True), PAINT)
    P = part('skirting'); hw = DOOR['w'] / 2 + 0.048; dx = DOOR['cx']      # stops at the architrave's plinth blocks
    P.add(tb_sweep(SKIRT, [V(R['x1'], 0, COUNTER_END_Z), V(R['x1'], 0, R['z1']), V(dx + hw, 0, R['z1'])], inside=mid), PAINT)
    P.add(tb_sweep(SKIRT, [V(dx - hw, 0, R['z1']), V(R['x0'], 0, R['z1']), V(R['x0'], 0, FRIDGE_FRONT_Z)], inside=mid), PAINT)
    P = part('hall_trim'); Hh = HALL; z0 = R['z1'] + DOOR['wall']; hm = ((Hh['x0'] + Hh['x1']) / 2, 0, (z0 + Hh['z1']) / 2)
    P.add(tb_sweep(SKIRT, [V(dx + hw, 0, z0), V(Hh['x1'], 0, z0), V(Hh['x1'], 0, Hh['z1']), V(Hh['x0'], 0, Hh['z1']), V(Hh['x0'], 0, z0), V(dx - hw, 0, z0)], inside=hm), PAINT)


# =====================================================================================================
# Windows. Origin: centre of the opening on the room face of the wall; +z into the room, the reveal runs back to z = -0.16.
# A fixed frame with two side-hung casements, glazing bars, a fastener, and a bull-nosed sill board with an apron.
# =====================================================================================================
def build_window(name, w, h, rows, apron=True):
    P = part(name); hw, hh = w / 2, h / 2; fz0, fz1 = -0.135, -0.07; f = 0.045
    for x0, x1, y0, y1 in ((-hw, hw, -hh, -hh + f), (-hw, hw, hh - f, hh), (-hw, -hw + f, -hh + f, hh - f), (hw - f, hw, -hh + f, hh - f), (-0.022, 0.022, -hh + f, hh - f)):
        P.add(tb_box(x0, x1, y0, y1, fz0, fz1, 0.003), PAINT)                                                        # frame and mullion
    s = 0.04; cz0, cz1 = -0.128, -0.086
    for sx in (-1, 1):
        a, b = (sx * 0.022, sx * (hw - f)) if sx > 0 else (sx * (hw - f), sx * 0.022); ya, yb = -hh + f, hh - f
        a += 0.003; b -= 0.003; ya += 0.003; yb -= 0.003
        for x0, x1, y0, y1 in ((a, b, ya, ya + s + 0.008), (a, b, yb - s, yb), (a, a + s, ya + s + 0.008, yb - s), (b - s, b, ya + s + 0.008, yb - s)):
            P.add(tb_box(x0, x1, y0, y1, cz0, cz1, 0.004), PAINT)                                                    # casement
        for k in range(1, rows):
            y = ya + s + 0.008 + (yb - s - ya - s - 0.008) * k / rows; P.add(tb_box(a + s, b - s, y - 0.009, y + 0.009, cz0 + 0.006, cz1 - 0.004, 0.003), PAINT)   # glazing bars
        g = tb_grid(1, 1, lambda u, v: (a + s - 0.004 + (b - a - 2 * s + 0.008) * u, ya + s + 0.004 + (yb - ya - 2 * s - 0.004) * v, (cz0 + cz1) / 2))
        P.add(g, GLASS)
        for y in (ya + 0.12, yb - 0.12): P.add(tb_cyl(((a if sx < 0 else b), y - 0.035, cz1 + 0.004), ((a if sx < 0 else b), y + 0.035, cz1 + 0.004), 0.005, seg=12, bevel=0.001), BRASS)   # hinges
    # fastener on the meeting stiles
    P.add(tb_box(-0.016, 0.016, -0.03, 0.03, cz1, cz1 + 0.004, 0.0015), BRASS)
    P.add(tb_cyl((0, 0, cz1 + 0.004), (0, 0, cz1 + 0.02), 0.006, seg=14), BRASS)
    P.add(tb_tube([V(0, 0, cz1 + 0.018), V(0.004, -0.02, cz1 + 0.022), V(0.006, -0.055, cz1 + 0.02), V(0.006, -0.075, cz1 + 0.021)], [0.0045, 0.0045, 0.0055, 0.007], seg=10), BRASS)
    # sill board (bull-nosed) and apron
    P.add(tb_box(-hw - 0.045, hw + 0.045, -hh - 0.032, -hh, -0.16, 0.05, 0.011, 3), PAINT)
    if apron: P.add(tb_sweep([(0, 0), (0, 0.014), (0.012, 0.016), (0.03, 0.01), (0.04, 0.012), (0.04, 0)], [V(-hw - 0.03, -hh - 0.032, 0), V(hw + 0.03, -hh - 0.032, 0)], up=(0, 0, 1), inside=(0, -hh - 1, 0)), PAINT)


# =====================================================================================================
# Roman blind, drawn up. Origin: middle of the top edge, on the wall face above the opening; hangs down -y, +z into the room.
# =====================================================================================================
def build_blind(name, w, flat, folds=3):
    P = part(name, smooth_only=True); hw = w / 2
    prof = [(0.0, 0.03)]; n = 6                                           # (y, z) down the face: a flat drop, then soft stacked folds
    for i in range(1, n + 1): prof.append((-flat * i / n, 0.03 + 0.002 * math.sin(math.pi * i / n)))
    y = -flat
    for k in range(folds):
        d = 0.046 - 0.004 * k; z0 = 0.03 + 0.011 * k
        for i in range(1, 9): prof.append((y - d * i / 8, z0 + 0.011 + 0.012 * math.sin(math.pi * i / 8) ** 0.8 if i < 8 else z0 + 0.011))
        y -= d
    prof += [(y - 0.004, 0.03 + 0.011 * folds - 0.004), (y - 0.002, 0.02), (y + 0.02, 0.012)]      # tucks back up behind
    L = [0.0]
    for a, b in zip(prof, prof[1:]): L.append(L[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    npr = len(prof) - 1; nx = 28
    def f(u, v):
        i = min(npr, int(round(v * npr))); yy, zz = prof[i]; t = (yy / y) if y else 0           # more sag lower down: the folds swag a little between the cords
        sag = 0.007 * max(0, t) ** 2 * math.sin(math.pi * u) ** 2 * (1 if yy < -flat * 0.6 else 0.3)
        return (-hw + w * u, yy - sag, zz + 0.004 * math.sin(math.pi * u) * max(0, t))
    P.add(tb_grid(nx, npr, f, uv=lambda u, v: (2 * w * u, 2 * L[min(npr, int(round(v * npr)))])), LINEN_BLIND)
    Q = part(name + '_rail'); Q.add(tb_box(-hw, hw, -0.028, 0.0, 0.0, 0.028, 0.002), PAINT)


# =====================================================================================================
# Column radiator. Origin: floor, middle, on the wall face; +z into the room.
# =====================================================================================================
def build_radiator(n=14, pitch=0.05):
    P = part('radiator'); x0 = -pitch * (n - 1) / 2; zc = 0.085
    for i in range(n):
        x = x0 + pitch * i
        for z in (zc - 0.032, zc + 0.032): P.add(tb_cyl((x, 0.15, z), (x, 0.66, z), 0.0135, seg=14, caps=False), ENAMEL)
        for y in (0.125, 0.685): P.add(tb_box(x - 0.021, x + 0.021, y - 0.032, y + 0.032, zc - 0.05, zc + 0.05, 0.016, 3), ENAMEL)
    for y in (0.125, 0.685): P.add(tb_cyl((x0 - 0.02, y, zc), (x0 + pitch * (n - 1) + 0.02, y, zc), 0.017, seg=16), ENAMEL)        # the run through the headers
    for i in (1, n - 2):                                                                                                         # feet
        x = x0 + pitch * i
        for z in (zc - 0.032, zc + 0.032): P.add(tb_lathe([(0, 0), (0.02, 0), (0.02, 0.006), (0.012, 0.014), (0.011, 0.085), (0.015, 0.096)], (x, 0, z), (0, 1, 0), 14), ENAMEL)
    xr = x0 + pitch * (n - 1) + 0.02; xl = x0 - 0.02
    # thermostatic valve (right) and lockshield (left), with pipes into the floor
    P.add(tb_cyl((xr, 0.125, zc), (xr + 0.035, 0.125, zc), 0.011, seg=14), CHROME)
    P.add(tb_cyl((xr + 0.045, 0.06, zc), (xr + 0.045, 0.145, zc), 0.0115, seg=14, bevel=0.002), CHROME)
    P.add(tb_cyl((xr + 0.045, 0.145, zc), (xr + 0.045, 0.165, zc), 0.016, 0.019, seg=20), PLASTIC)
    P.add(tb_cyl((xr + 0.045, 0.165, zc), (xr + 0.045, 0.215, zc), 0.021, 0.019, seg=20, bevel=0.004), PLASTIC)
    P.add(tb_cyl((xr + 0.045, 0.0, zc), (xr + 0.045, 0.06, zc), 0.0075, seg=12, caps=False), CHROME)
    P.add(tb_cyl((xr + 0.045, 0.0, zc), (xr + 0.045, 0.006, zc), 0.02, seg=18, bevel=0.002), CHROME)
    P.add(tb_cyl((xl - 0.035, 0.125, zc), (xl, 0.125, zc), 0.011, seg=14), CHROME)
    P.add(tb_cyl((xl - 0.045, 0.06, zc), (xl - 0.045, 0.14, zc), 0.0115, seg=14, bevel=0.002), CHROME)
    P.add(tb_cyl((xl - 0.045, 0.14, zc), (xl - 0.045, 0.165, zc), 0.013, 0.011, seg=16, bevel=0.003), PLASTIC)
    P.add(tb_cyl((xl - 0.045, 0.0, zc), (xl - 0.045, 0.06, zc), 0.0075, seg=12, caps=False), CHROME)
    P.add(tb_cyl((xl - 0.045, 0.0, zc), (xl - 0.045, 0.006, zc), 0.02, seg=18, bevel=0.002), CHROME)
    for x in (x0 + pitch * 2.5, x0 + pitch * (n - 3.5)): P.add(tb_box(x - 0.012, x + 0.012, 0.6, 0.64, 0.0, zc - 0.03, 0.002), ENAMEL)   # wall stays


# =====================================================================================================
# Peg rail with an apron and a tea towel (cloth simulations). Origin: middle of the rail on the wall face; +z into the room.
# =====================================================================================================
PEGS = (-0.36, -0.18, 0.0, 0.18, 0.36)
def build_peg_rail():
    P = part('peg_rail')
    P.add(tb_box(-0.46, 0.46, -0.045, 0.045, 0, 0.018, 0.004, 3), OAK, uv='box', grain='x')
    peg = [(0.0115, 0), (0.0115, 0.01), (0.0085, 0.018), (0.0075, 0.048), (0.009, 0.056), (0.0145, 0.064), (0.0155, 0.07), (0.012, 0.077), (0, 0.079)]
    for x in PEGS: P.add(tb_lathe(peg, (x, 0, 0.018), (0, 0.10, 1), 20), OAK, uv='box', grain='z')

    # ---- tea towel, hung by a loop at the middle of one short edge ----
    w, h, cell = 0.46, 0.66, 0.0115; nx, ny = round(w / cell), round(h / cell); px = PEGS[3]; top = -0.012
    pt = lambda u, v: (px - w / 2 + w * u + random.uniform(-1, 1) * 0.0006, -0.062 + random.uniform(-1, 1) * 0.004 - 0.02 * math.sin(math.pi * u) * (1 - v), top - h * (1 - v))
    ob = cloth_sheet('towel', nx, ny, pt, lambda u, v: (2 * w * u, 2 * h * v))
    pin = [v.index for v in ob.data.vertices if v.co.z > top - cell * 1.6 and abs(v.co.x - px) < cell * 2.1]
    wall = collider('wall', tb_box(-1.5, 1.5, 0.0, 0.05, -1.5, 0.5, 0))                    # Blender coordinates: the wall occupies y >= 0
    C = part('tea_towel', smooth_only=True); C.add(simulate(ob, pin, frames=170, bending=0.5, mass=0.15), TOWEL)
    Q = part('tea_towel_loop'); Q.add(tb_tube([V(px - 0.012, top, 0.062), V(px - 0.006, 0.012, 0.066), V(px, 0.018, 0.068), V(px + 0.006, 0.012, 0.066), V(px + 0.012, top, 0.062)], 0.0022, seg=8), TOWEL)

    # ---- apron, hung by its neck strap ----
    ax = PEGS[1]; W, Hh, bib_w, bib_h = 0.70, 0.84, 0.27, 0.27; top = -0.27; cell = 0.0125; nx, ny = round(W / cell), round(Hh / cell)
    def half(d):                                                             # half-width of the apron at depth d below the bib top
        if d < bib_h - 0.02: return bib_w / 2 + 0.015 * d / bib_h
        if d < bib_h + 0.10: t = (d - bib_h + 0.02) / 0.12; return bib_w / 2 + 0.015 + (W / 2 - bib_w / 2 - 0.015) * (t * t * (3 - 2 * t))
        return W / 2
    keep = lambda u, v: abs(u - 0.5) * W <= half((1 - v) * Hh)
    pt = lambda u, v: (ax - W / 2 + W * u, -0.05 + random.uniform(-1, 1) * 0.003, top - Hh * (1 - v))
    ob = cloth_sheet('apron', nx, ny, pt, lambda u, v: (2 * W * u, 2 * Hh * v), keep)
    zmax = max(v.co.z for v in ob.data.vertices); corners = [v.index for v in ob.data.vertices if v.co.z > zmax - cell * 0.5 and abs(abs(v.co.x - ax) - bib_w / 2) < cell * 1.2]
    ob.shape_key_add(name='Basis'); k = ob.shape_key_add(name='hang'); k.value = 1.0
    for v in ob.data.vertices:                                                # the strap draws the top of the bib together: start gathered, rest shape flat
        d = zmax - v.co.z
        if d < 0.16: g = 1 - 0.33 * (1 - d / 0.16) ** 2; k.data[v.index].co = Vector((ax + (v.co.x - ax) * g, v.co.y - 0.012 * math.sin((v.co.x - ax) / bib_w * math.pi * 3) * (1 - d / 0.16), v.co.z))
    tb = simulate(ob, corners, frames=170, bending=3.0, mass=0.35, self_collide=False, rest_key=ob.data.shape_keys.key_blocks['Basis'])
    tb.verts.ensure_lookup_table()
    cs = sorted([v.co.copy() for v in tb.verts if v.co.y > top - 0.03 and abs(v.co.x - ax) > 0.05], key=lambda c: c.x)
    lc, rc = (cs[0], cs[-1]) if cs else (V(ax - 0.09, top, 0.05), V(ax + 0.09, top, 0.05))
    waist = sorted([v.co.copy() for v in tb.verts if abs(v.co.y - (top - bib_h - 0.11)) < 0.02], key=lambda c: c.x)
    C = part('apron', smooth_only=True); C.add(tb, LINEN_APRON)
    S = part('apron_straps', smooth_only=True)
    pegtop = V(ax, 0.012, 0.07)
    strap = lambda a, b, sag: [a.lerp(b, i / 8) + V(0, -sag * math.sin(math.pi * i / 8), 0.004 * math.sin(math.pi * i / 8)) for i in range(9)]
    S.add(tb_tube(strap(lc, pegtop + V(-0.006, 0, 0), 0.004) + strap(pegtop + V(0.006, 0, 0), rc, 0.004)[1:], 0.0035, seg=8), LINEN_APRON)
    if waist:                                                                 # waist ties hanging from the corners
        for c, sx in ((waist[0], -1), (waist[-1], 1)):
            pts = [c + V(sx * 0.01 * math.sin(i / 10 * 2.2), -0.05 * i - 0.004 * i * i * 0.1, 0.006 * math.sin(i * 0.9)) for i in range(10)]
            S.add(tb_tube(pts, 0.003, seg=6), LINEN_APRON)
    bpy.data.objects.remove(wall)


# =====================================================================================================
# Table runner, draped over the breakfast table. Origin: floor under the middle of the table; the table's long axis is x.
# (wooden_table_02 is 1.134 x 0.706 m and 0.80 m high.)
# =====================================================================================================
def build_runner():
    L, w, cell = 1.62, 0.34, 0.0125; nx, ny = round(L / cell), round(w / cell)
    pt = lambda u, v: (-L / 2 + L * u, -w / 2 + w * v + 0.01 * math.sin(u * 9), 0.812 + random.uniform(0, 1) * 0.002 + 0.006 * math.sin(u * 23) * math.sin(v * 3.1))
    ob = cloth_sheet('runner', nx, ny, pt, lambda u, v: (2 * L * u, 2 * w * v))
    top = collider('table', tb_box(-0.567, 0.567, -0.353, 0.353, 0.74, 0.80, 0.004))
    mid = [v.index for v in ob.data.vertices if abs(v.co.x) < 0.02 and abs(v.co.y) < 0.02]                      # one point keeps it from sliding off
    C = part('table_runner', smooth_only=True); C.add(simulate(ob, mid, frames=110, bending=2.0, mass=0.3, self_collide=False, relax=6), LINEN_RUNNER)
    bpy.data.objects.remove(top)


# =====================================================================================================
# Dresser. Origin: floor, middle, on the wall face; +z into the room. Painted base with drawers and shaker doors,
# oak top, plate rack with a boarded back. The crockery is a separate part, so the room can be shown without it.
# =====================================================================================================
def shaker_front(P, x0, x1, y0, y1, z, mat, rail=0.052):
    P.add(tb_box(x0 + rail - 0.003, x1 - rail + 0.003, y0 + rail - 0.003, y1 - rail + 0.003, z - 0.014, z - 0.007, 0), mat)
    for a, b, c, d in ((x0, x0 + rail, y0, y1), (x1 - rail, x1, y0, y1), (x0 + rail, x1 - rail, y0, y0 + rail), (x0 + rail, x1 - rail, y1 - rail, y1)):
        P.add(tb_box(a, b, c, d, z - 0.02, z, 0.0022), mat)

KNOB = [(0, 0), (0.008, 0), (0.008, 0.004), (0.005, 0.008), (0.005, 0.014), (0.009, 0.019), (0.014, 0.024), (0.0155, 0.03), (0.013, 0.036), (0, 0.039)]
def build_dresser():
    P = part('dresser'); W, D, hw = 1.5, 0.46, 0.75; top = 0.87
    P.add(tb_box(-hw + 0.03, hw - 0.03, 0, 0.09, 0.02, D - 0.055, 0.002), SAGE)                                      # plinth
    for x0, x1 in ((-hw, -hw + 0.02), (hw - 0.02, hw)): P.add(tb_box(x0, x1, 0.09, top, 0, D - 0.02, 0.002), SAGE)   # sides
    P.add(tb_box(-hw + 0.02, hw - 0.02, 0.09, top, 0, 0.012, 0), SAGE); P.add(tb_box(-hw + 0.02, hw - 0.02, 0.09, 0.11, 0.012, D - 0.02, 0), SAGE)
    zf = D                                                                                                            # face frame
    for x0, x1 in ((-hw, -hw + 0.045), (hw - 0.045, hw), (-0.27, -0.23), (0.23, 0.27)): P.add(tb_box(x0, x1, 0.09, top, zf - 0.022, zf, 0.002), SAGE)
    for y0, y1 in ((0.09, 0.132), (0.652, 0.69), (0.838, top)): P.add(tb_box(-hw + 0.045, hw - 0.045, y0, y1, zf - 0.022, zf - 0.0005, 0.002), SAGE)
    bays = ((-hw + 0.045, -0.27), (-0.23, 0.23), (0.27, hw - 0.045))
    for x0, x1 in bays:
        P.add(tb_box(x0 + 0.003, x1 - 0.003, 0.693, 0.835, zf - 0.024, zf - 0.002, 0.003), SAGE)                    # drawer front
        cx = (x0 + x1) / 2
        for kx in ((cx,) if x1 - x0 < 0.45 else (cx - 0.11, cx + 0.11)): P.add(tb_lathe(KNOB, (kx, 0.764, zf - 0.002), (0, 0, 1), 20), BRASS)
        if x1 - x0 < 0.45: shaker_front(P, x0 + 0.003, x1 - 0.003, 0.135, 0.649, zf - 0.002, SAGE)
        else:
            m = (x0 + x1) / 2; shaker_front(P, x0 + 0.003, m - 0.0015, 0.135, 0.649, zf - 0.002, SAGE); shaker_front(P, m + 0.0015, x1 - 0.003, 0.135, 0.649, zf - 0.002, SAGE)
    for kx in (bays[0][1] - 0.03, bays[1][0] + (bays[1][1] - bays[1][0]) / 2 - 0.028, bays[1][0] + (bays[1][1] - bays[1][0]) / 2 + 0.028, bays[2][0] + 0.03):
        P.add(tb_lathe(KNOB, (kx, 0.56, zf - 0.002), (0, 0, 1), 20), BRASS)
    P.add(tb_box(-hw - 0.015, hw + 0.015, top, top + 0.03, 0, D + 0.018, 0.004, 3), OAK, uv='box', grain='x')        # worktop
    # ---- plate rack ----
    y0, y1, d = top + 0.03, 2.0, 0.19
    for sx in (-1, 1):
        x0 = sx * hw - (0.022 if sx > 0 else 0)
        P.add(tb_box(x0, x0 + 0.022, y0, y1, 0, d, 0.002), SAGE)
    n = 16; bw = (W - 0.044) / n
    for i in range(n): P.add(tb_box(-hw + 0.022 + bw * i + 0.0006, -hw + 0.022 + bw * (i + 1) - 0.0006, y0, y1, 0, 0.012, 0.0028, 1), SAGE)   # boarded back with V joints
    for ys in SHELVES:
        P.add(tb_box(-hw + 0.022, hw - 0.022, ys - 0.022, ys, 0.012, d - 0.012, 0.002), SAGE)
        P.add(tb_box(-hw + 0.022, hw - 0.022, ys - 0.03, ys + 0.004, d - 0.022, d - 0.008, 0.003), SAGE)             # lipped front edge
    P.add(tb_cyl((-hw + 0.022, SHELVES[1] + 0.075, 0.105), (hw - 0.022, SHELVES[1] + 0.075, 0.105), 0.0045, seg=10), OAK, uv='box', grain='x')   # plate rail
    P.add(tb_box(-hw - 0.012, hw + 0.012, y1, y1 + 0.02, 0, d + 0.012, 0.003), SAGE)                                # top board
    crown = [(0.04, 0), (0.04, -0.01), (0.034, -0.014), (0.03, -0.02), (0.018, -0.034), (0.008, -0.04), (0.004, -0.046), (0.004, -0.058), (0, -0.058)]
    P.add(tb_sweep(crown, [V(-hw, y1, 0), V(-hw, y1, d), V(hw, y1, d), V(hw, y1, 0)], flip=True), SAGE)
    for x in (-0.5, -0.25, 0.0, 0.25, 0.5):                                                                          # cup hooks under the lower shelf
        P.add(tb_tube([V(x, SHELVES[0] - 0.022, 0.13), V(x, SHELVES[0] - 0.034, 0.13), V(x, SHELVES[0] - 0.044, 0.136), V(x, SHELVES[0] - 0.048, 0.146), V(x, SHELVES[0] - 0.042, 0.154), V(x, SHELVES[0] - 0.034, 0.152)], 0.0016, seg=6), BRASS)

SHELVES = (1.27, 1.60)
PLATE = [(0, 0), (0.048, 0), (0.052, 0.003), (0.085, 0.008), (0.126, 0.019), (0.13, 0.0215), (0.127, 0.024), (0.086, 0.0125), (0.05, 0.0075), (0, 0.0065)]
MUG = [(0, 0), (0.034, 0), (0.038, 0.003), (0.0395, 0.012), (0.0405, 0.088), (0.039, 0.091), (0.0372, 0.088), (0.0362, 0.012), (0.033, 0.007), (0, 0.006)]
BOWL = [(0, 0), (0.035, 0), (0.038, 0.006), (0.05, 0.012), (0.074, 0.04), (0.08, 0.062), (0.0785, 0.064), (0.0765, 0.062), (0.07, 0.041), (0.047, 0.016), (0, 0.012)]
JAR = [(0, 0), (0.05, 0), (0.055, 0.004), (0.057, 0.02), (0.057, 0.13), (0.053, 0.14), (0.05, 0.142), (0.05, 0.146), (0.046, 0.146), (0.046, 0.14), (0, 0.14)]
JUG = [(0, 0), (0.045, 0), (0.05, 0.004), (0.066, 0.05), (0.07, 0.085), (0.062, 0.13), (0.046, 0.165), (0.043, 0.19), (0.05, 0.215), (0.0485, 0.218), (0.0405, 0.19), (0.044, 0.165), (0.06, 0.13), (0.067, 0.085), (0.063, 0.05), (0.047, 0.012), (0, 0.01)]
def build_dresser_ware():
    P = part('dresser_ware'); d = 0.19
    def handle(cx, cy, cz, r=0.024, ax=1, thick=0.0055):       # a mug or jug handle: a "D" in the plane through the pot's axis, on its +x side
        pts = [V(cx, cy + r * math.cos(math.radians(a)), cz) + V(0.9 * r * math.sin(math.radians(a)), 0, 0) for a in range(0, 181, 20)]
        return tb_tube(pts, thick, seg=8)
    # plates standing on the upper shelf, leaning back against the boards, behind the rail
    for i, x in enumerate((-0.54, -0.27, 0.0, 0.27, 0.54)):
        tb = tb_lathe(PLATE, (0, 0, 0), (0, 0, 1), 40)                                  # face toward the room
        lean = math.radians(-13)
        M = Matrix.Translation((x, SHELVES[1] + 0.128, 0.043)) @ Matrix.Rotation(lean, 4, 'X') @ Matrix.Rotation(i * 1.3, 4, 'Z')
        P.add(tb_transform(tb, M), CREAM if i % 2 == 0 else BLUE)
    # mugs on the lower shelf
    for i, x in enumerate((-0.6, -0.49, -0.38, -0.27)):
        yaw = 0.5 + 0.35 * i; M = Matrix.Translation((x, SHELVES[0], 0.095)) @ Matrix.Rotation(yaw, 4, 'Y')
        P.add(tb_transform(tb_lathe(MUG, seg=28), M), BLUE if i % 2 else CREAM)
        P.add(tb_transform(handle(0.038, 0.047, 0), M), BLUE if i % 2 else CREAM)
    # a stack of bowls and a jug on the lower shelf
    for i in range(4): P.add(tb_transform(tb_lathe(BOWL, seg=32), Matrix.Translation((0.5 + 0.002 * (i % 2), SHELVES[0] + 0.019 * i, 0.095))), CREAM if i != 2 else BLUE)
    M = Matrix.Translation((0.2, SHELVES[0], 0.095)) @ Matrix.Rotation(-0.7, 4, 'Y')
    P.add(tb_transform(tb_lathe(JUG, seg=32), M), CREAM); P.add(tb_transform(handle(0.058, 0.115, 0, r=0.05, thick=0.007), M), CREAM)
    # storage jars with cork stoppers on the worktop
    for i, (x, s) in enumerate(((0.44, 1.0), (0.57, 0.86), (0.685, 0.72))):
        M = Matrix.Translation((x, 0.9, 0.2 + 0.05 * (i % 2))) @ Matrix.Scale(s, 4)
        P.add(tb_transform(tb_lathe(JAR, seg=32), M), CREAM)
        P.add(tb_transform(tb_lathe([(0, 0.138), (0.044, 0.138), (0.047, 0.142), (0.048, 0.158), (0.044, 0.164), (0, 0.164)], seg=24), M), CORK)


# =====================================================================================================
# Small fittings. Origin: centre of the plate on the wall face; +z out of the wall.
# =====================================================================================================
def build_fittings():
    P = part('switch_plate')
    P.add(tb_box(-0.035, 0.035, -0.0575, 0.0575, 0, 0.0055, 0.0022, 3), PLASTIC)
    P.add(tb_box(-0.0165, 0.0165, -0.033, 0.033, 0.004, 0.0068, 0.001), PLASTIC)
    tb = tb_box(-0.0155, 0.0155, -0.031, 0.031, 0.006, 0.0105, 0.0015); P.add(tb_transform(tb, Matrix.Rotation(math.radians(-5), 4, 'X')), PLASTIC)     # the paddle, rocked
    for y in (-0.047, 0.047): P.add(tb_cyl((0, y, 0.0052), (0, y, 0.0062), 0.003, seg=12), PLASTIC); P.add(tb_box(-0.0025, 0.0025, y - 0.0004, y + 0.0004, 0.0061, 0.0064, 0), DARK)
    P = part('outlet_plate')
    P.add(tb_box(-0.035, 0.035, -0.0575, 0.0575, 0, 0.0055, 0.0022, 3), PLASTIC)
    P.add(tb_box(-0.017, 0.017, -0.034, 0.034, 0.004, 0.0065, 0.001), PLASTIC)
    for cy in (-0.0195, 0.0195):
        P.add(tb_box(-0.0145, 0.0145, cy - 0.0125, cy + 0.0125, 0.006, 0.0078, 0.004, 3), PLASTIC)
        P.add(tb_box(-0.0075, -0.006, cy - 0.001, cy + 0.007, 0.0076, 0.008, 0), DARK); P.add(tb_box(0.006, 0.0075, cy + 0.0, cy + 0.006, 0.0076, 0.008, 0), DARK)
        P.add(tb_cyl((0, cy - 0.0065, 0.0076), (0, cy - 0.0065, 0.008), 0.0024, seg=10), DARK)
    P.add(tb_cyl((0, 0, 0.0062), (0, 0, 0.0072), 0.003, seg=12), PLASTIC); P.add(tb_box(-0.0025, 0.0025, -0.0004, 0.0004, 0.0071, 0.0074, 0), DARK)
    # flush ceiling light for the hall. Origin: on the ceiling; hangs down -y.
    P = part('hall_light')
    P.add(tb_lathe([(0, 0), (0.125, 0), (0.125, 0.022), (0.118, 0.026), (0, 0.026)], (0, 0, 0), (0, -1, 0), 40), BRASS)
    P.add(tb_lathe([(0.112, 0.024)] + [(0.112 * math.cos(math.radians(a)), 0.024 + 0.07 * math.sin(math.radians(a))) for a in range(10, 91, 10)], (0, 0, 0), (0, -1, 0), 40), OPAL)


build_door_leaf(); build_door_frame(); build_trim()
build_window('window_side', WIN_SIDE['w'], WIN_SIDE['h'], 3); build_window('window_back', WIN_BACK['w'], WIN_BACK['h'], 2, apron=False)      # it sits in the tiled splashback
build_blind('blind_side', WIN_SIDE['w'] + 0.06, 0.16); build_blind('blind_back', WIN_BACK['w'] + 0.06, 0.05)
build_radiator(); build_peg_rail(); build_runner(); build_dresser(); build_dresser_ware(); build_fittings()

tris = 0
for p in parts:
    ob = p.finish(); n = sum(len(f.vertices) - 2 for f in ob.data.polygons); tris += n
    print(f'{p.name:18s} {n:7d} triangles  {len(ob.data.materials)} materials')
print(f'total {tris} triangles')
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT): os.remove(os.path.join(OUT, f))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'room_kit.gltf'), export_format='GLTF_SEPARATE', export_apply=True, export_yup=True,
                          export_normals=True, export_texcoords=True, export_materials='EXPORT', export_cameras=False, export_lights=False, export_animations=False)
if '--blend' in sys.argv: bpy.ops.wm.save_as_mainfile(filepath='/tmp/room_kit.blend')
print('wrote', OUT)
