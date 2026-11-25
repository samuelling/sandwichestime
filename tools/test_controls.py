#!/usr/bin/env python3
"""Tests for the hand-control paths.

  synthetic  drives the controller with generated MediaPipe results (no camera): grasp, carry,
             press, dropouts, lid unscrewing, stepping. Deterministic.
  camera     feeds a video file to Chrome as a fake webcam and checks that MediaPipe starts,
             finds hands and that they appear in the kitchen. Needs a .y4m/.mjpeg of hands, e.g.
             ffmpeg -i hands.mp4 -pix_fmt yuv420p -s 640x360 hands.y4m

  mouse      real mouse events: click the bread clip (bag opens), carry it, click to set it down.
  touch      an emulated phone (touch events): bag, slice to plate, unscrew a lid by circling,
             knife, dip with the Press button, spread, let go.

    python3 -m http.server 8811 &
    python3 tools/test_controls.py synthetic
    python3 tools/test_controls.py mouse
    python3 tools/test_controls.py touch --shot phone.png
    python3 tools/test_controls.py camera --video hands.y4m --shot out.png
"""
import argparse, asyncio, json, os, sys
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

async def synthetic(a):
    js = open(os.path.join(HERE, 'tests', 'webcam_synthetic.js')).read()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=a.chrome, args=GL)
        pg = await b.new_page(viewport={'width': 800, 'height': 480})
        await pg.goto(f"{a.base}?auto=1&input=webcam&webcammap=upright&fakecam=1&gaze=none&quality=0&saliency=0&seed={a.seed}&fast=8")
        await pg.wait_for_function('window.__sandwich && window.__sandwich.webcamHands', timeout=120000)
        r = json.loads(await pg.evaluate(js)); await b.close()
    for k, v in r['out'].items(): print('  ok ' if v['ok'] else '  XX ', k, v.get('info', ''))
    if r.get('trace'): print('trace', json.dumps(r['trace']))
    if r['errors']: print(r['errors'])
    print('PASS' if r['pass'] and not r['errors'] else 'FAIL'); return r['pass'] and not r['errors']

async def calibration(a):
    """Guided webcam calibration with synthetic hands: first visit, saved calibration, one hand only, and skipping."""
    js = open(os.path.join(HERE, 'tests', 'webcam_calibration.js')).read(); ok = True
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=a.chrome, args=GL)
        ctx = await b.new_context(viewport={'width': 800, 'height': 480})      # one context: localStorage carries from 'full' to 'quick'
        for phase, who in ([(a.phase, 'cal_x')] if getattr(a, 'phase', None) else [('full', 'cal_a'), ('quick', 'cal_a'), ('onehand', 'cal_b'), ('wobbly', 'cal_d'), ('skip', 'cal_c')]):
            pg = await ctx.new_page()
            await pg.goto(f"{a.base}?auto=1&input=webcam&fakecam=1&calib=auto&calibspeed=2&webcammap=upright&participant={who}&gaze=none&quality=0&saliency=0&seed={a.seed}&pr=0.5&fast=1")
            await pg.wait_for_function('window.__sandwich && window.__sandwich.webcamHands', timeout=120000)
            if a.shot and phase == 'full':
                await pg.wait_for_function("!document.querySelector('#handcal').hidden", timeout=20000)
            r = json.loads(await pg.evaluate(js.replace('__PHASE__', phase)))
            print(f'[{phase}]')
            for k, v in r['out'].items(): print('  ok ' if v['ok'] else '  XX ', k, v.get('info', ''))
            if r['errors']: print(r['errors'])
            ok = ok and r['pass'] and not r['errors']; await pg.close()
        await b.close()
    print('PASS' if ok else 'FAIL'); return ok

async def head(a):
    """Webcam head tracking with synthetic face poses (and resting synthetic hands, counter mapping)."""
    js = open(os.path.join(HERE, 'tests', 'head_synthetic.js')).read()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=a.chrome, args=GL)
        pg = await b.new_page(viewport={'width': 800, 'height': 480})
        await pg.goto(f"{a.base}?auto=1&input=webcam&webcammap=counter&fakecam=1&calib=off&participant=head_test&gaze=none&quality=0&saliency=0&seed={a.seed}&pr=0.5&fast=1")
        await pg.wait_for_function('window.__sandwich && window.__sandwich.webcamHands', timeout=120000)
        r = json.loads(await pg.evaluate(js))
        if a.shot: await pg.screenshot(path=a.shot, timeout=120000)
        await b.close()
    for k, v in r['out'].items(): print('  ok ' if v['ok'] else '  XX ', k, v.get('info', ''))
    if r['errors']: print(r['errors'])
    print('PASS' if r['pass'] and not r['errors'] else 'FAIL'); return r['pass'] and not r['errors']

async def counter(a):
    """The counter mapping (palms down over the counter) with synthetic hands in front of a pinhole camera."""
    js = open(os.path.join(HERE, 'tests', 'webcam_counter.js')).read()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=a.chrome, args=GL)
        pg = await b.new_page(viewport={'width': 800, 'height': 480})
        await pg.goto(f"{a.base}?auto=1&input=webcam&webcammap=counter&fakecam=1&calib=full&calibspeed=2&participant=counter_test&gaze=none&quality=0&saliency=0&seed={a.seed}&pr=0.5&fast=1")
        await pg.wait_for_function('window.__sandwich && window.__sandwich.webcamHands', timeout=120000)
        task = asyncio.ensure_future(pg.evaluate(js))
        try: r = json.loads(await asyncio.wait_for(task, 330))
        except asyncio.TimeoutError:      # stuck: say where
            st = await pg.evaluate('''JSON.stringify({ out: window.__cout, cal: window.__sandwich.webcamHands.calView && { id: window.__sandwich.webcamHands.calView.id, phase: window.__sandwich.webcamHands.calView.phase, prog: window.__sandwich.webcamHands.calView.prog, need: window.__sandwich.webcamHands.calView.need }, calibrating: window.__sandwich.webcamHands.calibrating, rec: window.__sandwich.logger && window.__sandwich.logger.recording, hands: window.__sandwich.hands.map(h => [h.side, h.tracked, h.pinch, h.holding && h.holding.id, h.hover && h.hover.id]), body: window.__sandwich.body.x })''')
            print('TIMEOUT', st); await b.close(); return False
        if a.shot: await pg.screenshot(path=a.shot, timeout=120000)
        await b.close()
    for k, v in r['out'].items(): print('  ok ' if v['ok'] else '  XX ', k, v.get('info', ''))
    if r.get('trace'): print('trace', json.dumps(r['trace']))
    if r['errors']: print(r['errors'])
    print('PASS' if r['pass'] and not r['errors'] else 'FAIL'); return r['pass'] and not r['errors']

async def camera(a):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=a.chrome, args=GL + ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-video-capture={os.path.abspath(a.video)}'])
        pg = await b.new_page(viewport={'width': 1100, 'height': 650})
        logs = []; pg.on('console', lambda m: logs.append(m.text)); pg.on('pageerror', lambda e: logs.append(str(e)))
        await pg.goto(f"{a.base}?auto=1&input=webcam&gaze=none&quality=0&saliency=0&seed={a.seed}&handtone={a.tone}")
        try: await pg.wait_for_function('window.__sandwich && window.__sandwich.logger && window.__sandwich.logger.recording', timeout=240000)
        except Exception as e: print('did not start:', e, logs[-8:]); await b.close(); return False
        await asyncio.sleep(a.wait)
        info = json.loads(await pg.evaluate('''JSON.stringify((() => { const S = window.__sandwich, st = S.webcamHands.status();
          return { delegate: S.vision.delegate, rate: S.webcamHands.rate, seen: st.map(s => s.seen), tracked: S.hands.map(h => h.tracked),
            grips: S.hands.map(h => h.grip.toArray().map(v => +v.toFixed(3))), calibration: S.logger.calibration, errors: window.__errors || null }; })())'''))
        if a.shot: await pg.screenshot(path=a.shot, timeout=120000)
        await b.close()
    print(json.dumps(info, indent=1))
    ok = any(info['tracked']) and not info['errors']; print('PASS' if ok else 'FAIL'); return ok

async def mouse(a):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=a.chrome, args=GL)
        pg = await b.new_page(viewport={'width': 800, 'height': 480})
        await pg.goto(f"{a.base}?auto=1&input=mouse&gaze=mouse&quality=0&saliency=0&seed={a.seed}&pr=0.5")
        await pg.wait_for_function('window.__sandwich && window.__sandwich.logger && window.__sandwich.logger.recording', timeout=120000)
        px = lambda expr: pg.evaluate(f'''(() => {{ const S = window.__sandwich, v = ({expr}).clone().project(S.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }})()''')
        state = lambda: pg.evaluate('''(() => { const S = window.__sandwich, h = S.hands[1]; return { holding: h.holding && h.holding.id, hover: h.hover && h.hover.id, open: S.L.task.bag.state.open,
            types: S.logger.events.map(e => e.type).filter(t => ['grasp','release','bag_open','grasp_miss'].includes(t)), errors: window.__errors || null }; })()''')
        x, y = await px("S.L.task.bag.clip.root.getWorldPosition(new S.camera.position.constructor())")
        await pg.mouse.move(x, y, steps=8); await asyncio.sleep(2.5); s0 = await state()
        await pg.mouse.down(); await pg.mouse.up(); await asyncio.sleep(1.5); s1 = await state()
        x, y = await px("new S.camera.position.constructor(0.35, 0.91, -0.1)")
        await pg.mouse.move(x, y, steps=12); await asyncio.sleep(2.5)
        await pg.mouse.down(); await pg.mouse.up(); await asyncio.sleep(1.5); s2 = await state()
        await b.close()
    checks = {'hover finds the clip': s0['hover'] == 'bread_clip', 'click grabs it and the bag opens': s1['holding'] == 'bread_clip' and s1['open'],
              'second click releases': s2['holding'] is None and 'release' in s2['types'], 'no errors': not s2['errors']}
    for k, v in checks.items(): print('  ok ' if v else '  XX ', k)
    if not all(checks.values()): print(s0, s1, s2)
    print('PASS' if all(checks.values()) else 'FAIL'); return all(checks.values())

async def touch(a):
    import math
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=a.chrome, args=GL)
        dev = dict(p.devices['iPhone 14 landscape']); dev.pop('default_browser_type', None)
        ctx = await b.new_context(**dev); pg = await ctx.new_page(); cdp = await ctx.new_cdp_session(pg)
        await pg.goto(f"{a.base}?auto=1&gaze=none&seed={a.seed}&pr=0.75&distractors=sparse&fast=5")     # no input= : the page must pick touch itself
        await pg.wait_for_function('window.__sandwich && window.__sandwich.logger && window.__sandwich.logger.recording', timeout=180000)
        ev = lambda js: pg.evaluate(f"(() => {{ const S = window.__sandwich, T = S.L.task, V3 = S.camera.position.constructor, pos = e => e.root.getWorldPosition(new V3()), h = S.hands[1]; {js} }})()")
        px = lambda expr: ev(f"const v = ({expr}).clone().project(S.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];")
        async def sim(sec):
            t0 = await ev("return S.world.t;")
            await pg.wait_for_function(f"window.__sandwich.world.t > {t0 + sec}", timeout=120000)
        async def tap(xy): await pg.touchscreen.tap(xy[0], xy[1]); await sim(1.4)
        async def drag(pts, step=0.12):
            mk = lambda x, y: [{'x': x, 'y': y, 'id': 1}]
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': mk(*pts[0])})
            for a0, a1 in zip(pts, pts[1:]):
                for k in range(1, 5):
                    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': mk(a0[0] + (a1[0] - a0[0]) * k / 4, a0[1] + (a1[1] - a0[1]) * k / 4)}); await sim(step / 4)
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); await sim(0.5)
        btn = lambda act: pg.dispatch_event(f'#touchbar button[data-act={act}]', 'pointerdown')
        class Out(dict):
            def __setitem__(self, k, v): print('  ok ' if v else '  XX ', k, flush=True); super().__setitem__(k, v)
        types = lambda: ev("return S.logger.events.map(e => e.type);")
        out = Out()
        out['phone picks touch controls'] = await ev("return S.cfg.input === 'touch' && S.logger.meta.detail === 'standard' && !!document.getElementById('touchbar');")
        await tap(await px("pos(T.bag.clip)"))
        out['tap grabs the clip, bag opens'] = await ev("return h.holding?.id === 'bread_clip' && T.bag.state.open;")
        await tap(await px("new V3(0.42, 0.91, -0.08)"))
        out['tap elsewhere puts it down'] = await ev("return !h.holding;")
        await tap(await px("pos(T.bag.state.slices.reduce((a, b) => (b.state.index > a.state.index ? b : a))).add(new V3(0, 0.068, 0))"))
        out['tap on the open end takes a slice'] = await ev("return h.holding?.kind === 'slice';")
        await tap(await px("pos(T.plate).add(new V3(0, 0.01, 0))")); await sim(0.6)
        out['tap on the plate puts the slice there'] = await ev("return !h.holding && S.monitor.done.slice_a !== undefined;")
        c = await px("pos(T.pb).add(new V3(0, T.pb.geom.rimY + 0.005, 0))")
        await tap(c)
        out['tap on the lid grabs it for twisting'] = await ev("return h.hold?.mode === 'twist';")
        ring = [(c[0] + 60 * math.cos(t), c[1] - 60 * math.sin(t)) for t in [i * math.pi / 8 for i in range(0, 22)]]     # counter-clockwise on screen
        await drag(ring, 0.08)
        out['circling counter-clockwise unscrews it'] = 'lid_off' in await types()
        await tap(await px("pos(T.pb).add(new V3(-0.15, -0.0, 0.1))")); await sim(0.5)
        out['lid put down, jar open'] = await ev("return !h.holding && T.pb.state.open;")
        # tap a part of the knife that is actually visible (another object may stand in front of some of it)
        kp = await ev('''const k = T.knife, pts = [k.geom.grip, ...k.geom.bladeSamples].map(p => k.root.localToWorld(p.clone()));
          for (const w of pts) { const n = w.clone().project(S.camera); S.world.raycaster.setFromCamera({ x: n.x, y: n.y }, S.camera); S.world.raycaster.far = 10;
            const hit = S.world.raycaster.intersectObjects(S.world.aoiMeshes, false).find(i => i.object.visible);
            if (hit && S.world.entityOf(hit.object) === k) return [(n.x + 1) / 2 * innerWidth, (1 - n.y) / 2 * innerHeight]; }
          return null;''')
        out['some part of the knife is visible'] = kp is not None
        await tap(kp or await px("T.knife.root.localToWorld(T.knife.geom.grip.clone())"))
        out['tap grabs the knife'] = await ev("return h.holding?.id === 'knife';")
        if not out['tap grabs the knife']: print(await ev("return JSON.stringify({ holding: h.holding?.id, hint: h.pickHint?.id, grip: h.grip.toArray(), knife: pos(T.knife).toArray(), body: S.body.x, last: S.logger.events.slice(-4).map(e => [e.type, e.obj || e.near || '', e.on || '']) });"))
        # the jar may be beyond the right arm's reach from where we stand: step toward it first, as a person would
        dx = await ev("return pos(T.pb).x - S.body.x;")
        if dx < -0.1: await btn('left'); await sim(1.2)
        out['stepping keeps the knife in hand'] = await ev("return h.holding?.id === 'knife';")
        # where the finger must be so that the blade (not the hand) is over a target: blade offset from the grip, measured live
        aim = lambda target: px(f"(() => {{ const k = T.knife, b = k.root.localToWorld(k.geom.bladeSamples[3].clone()).sub(h.grip); const t = {target}; return new V3(t.x - b.x, 0.91, t.z - b.z); }})()")
        start = await px("h.grip.clone().setY(0.91)"); j = await aim("pos(T.pb)")
        await drag([(start[0], start[1] + 44), (j[0], j[1] + 44)], 0.5); await sim(0.6)
        await btn('press'); await sim(1.3)
        out['Press lowers the knife into the jar and loads it'] = await ev("return T.knife.state.substance === 'pb' && T.knife.state.load > 0.5;")
        if not out['Press lowers the knife into the jar and loads it']: print(await ev("const k = T.knife; return JSON.stringify({ holding: h.holding?.id, press: h.press, blade: k.root.localToWorld(k.geom.bladeSamples[3].clone()).toArray().map(v => +v.toFixed(3)), jar: pos(T.pb).toArray().map(v => +v.toFixed(3)), open: T.pb.state.open, surf: T.pb.state.surfaceY, grip: h.grip.toArray().map(v => +v.toFixed(3)), body: S.body.x, last: S.logger.events.slice(-5).map(e => [e.type, e.obj || e.jar || '', e.on || '']) });"))
        await btn('press'); await sim(0.5)
        sl = "pos([...S.world.entities.values()].find(e => e.kind === 'slice' && e.restingOn === 'plate'))"
        s0 = await aim(sl); await drag([(j[0], j[1] + 44), (s0[0], s0[1] + 44)], 0.5); await sim(0.5)
        await btn('press'); await sim(0.5)
        pts = [(s0[0] + dx, s0[1] + 44 + dy) for dx, dy in [(0, 0), (-22, -14), (22, -8), (-22, 0), (22, 8), (-22, 16), (22, 20), (0, 0)]]
        await drag(pts, 0.35)
        cov = await ev("const s = [...S.world.entities.values()].find(e => e.kind === 'slice' && e.restingOn === 'plate'); return Math.max(...Object.values(s.layers).map(L => L.measure()));")
        out[f'dragging with Press on spreads peanut butter (coverage {cov:.2f})'] = cov > 0.15
        await btn('press'); await sim(0.4); await btn('drop'); await sim(1.0)
        out['Let go drops the knife'] = await ev("return !h.holding;")
        errs = await pg.evaluate('window.__errors || null'); out['no errors'] = not errs
        if a.shot: await pg.screenshot(path=a.shot, timeout=120000)
        await b.close()
    if errs: print(errs)
    print('PASS' if all(out.values()) else 'FAIL'); return all(out.values())

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('which', choices=['synthetic', 'counter', 'head', 'calibration', 'camera', 'mouse', 'touch'])
    ap.add_argument('--base', default='http://localhost:8811/index.html'); ap.add_argument('--chrome', default=None); ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--video'); ap.add_argument('--shot'); ap.add_argument('--phase', default=None); ap.add_argument('--wait', type=float, default=6); ap.add_argument('--tone', default='neutral')
    a = ap.parse_args()
    sys.exit(0 if asyncio.run({'synthetic': synthetic, 'counter': counter, 'head': head, 'calibration': calibration, 'camera': camera, 'mouse': mouse, 'touch': touch}[a.which](a)) else 1)

if __name__ == '__main__':
    main()
