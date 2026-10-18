"""
ブラウザ E2E テスト（Playwright for Python）
  python tests/e2e.py            … 全テスト
  python tests/e2e.py --base https://xxx.workers.dev   … 本番URLに対して実行
ローカルでは public/ を簡易サーバーで配信し、/api/* はモックで差し替える。
"""
import argparse
import re
import functools
import http.server
import json
import os
import random
import socketserver
import sys
import threading
import time
import traceback

from playwright.sync_api import sync_playwright, expect

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
TICK = 12  # テスト用の四半期間隔(ms)


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    handler = functools.partial(Quiet, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


HOF = []


def mock_api(page, ai_ok=True, comment="AIのツッコミやで！"):
    def handle(route):
        req = route.request
        path = req.url.split("/api/")[1].split("?")[0]
        if not ai_ok:
            return route.fulfill(status=503, body='{"error":"unavailable"}', content_type="application/json")
        if path == "comment":
            return route.fulfill(json={"comment": comment, "persona": "大阪のおかん"})
        if path == "eulogy":
            return route.fulfill(json={"text": "モックの弔辞です。ほんまお疲れさん。"})
        if path == "hof":
            if req.method == "POST":
                HOF.append(json.loads(req.post_data))
            top = sorted(HOF, key=lambda e: -e["lifetime"])[:10]
            return route.fulfill(json={"top": top})
        return route.fulfill(status=404, body="{}")

    page.route("**/api/**", handle)


def start_new_game(page, base, gender="male", name="森シンタロウ", extra=""):
    page.goto(f"{base}/?tick={TICK}{extra}")
    expect(page.get_by_test_id("btn-new")).to_be_visible(timeout=10000)
    page.get_by_test_id("btn-new").click()
    expect(page.get_by_test_id("setup")).to_be_visible()
    page.get_by_test_id(f"gender-{gender}").click()
    page.get_by_test_id("input-name").fill(name)
    page.get_by_test_id("btn-start").click()
    expect(page.get_by_test_id("game")).to_be_visible(timeout=10000)


def watch_toasts(page):
    # 上から出る通知の種類を数える
    page.evaluate("""() => { window.__toasts = {}; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
        const k = n.getAttribute && n.getAttribute('data-kind'); if (k !== null) window.__toasts[k] = (window.__toasts[k] || 0) + 1; })))
        .observe(document.getElementById('toast-root'), { childList: true }); }""")


def answer_event(page, choice=None, info=None):
    sheet = page.get_by_test_id("event-sheet")
    expect(sheet).to_be_visible()
    title = page.get_by_test_id("event-title").inner_text()
    special = sheet.get_attribute("data-special") == "1"
    if info is not None:
        info.append({"q": page.evaluate("window.__geinin.state.q"), "special": special, "title": title})
    for i in range(3):
        expect(page.get_by_test_id(f"choice-{i}")).to_be_visible(timeout=8000)
    assert page.get_by_test_id("choices").locator(".choice").count() == 3
    i = random.randrange(3) if choice is None else choice
    page.get_by_test_id(f"choice-{i}").click()
    expect(page.get_by_test_id("event-result")).to_be_visible()
    if not special:
        expect(page.get_by_test_id("outcome")).to_be_visible()
    expect(page.get_by_test_id("ai-text")).to_be_visible(timeout=10000)
    name_input = page.get_by_test_id("input-unit-name")
    if name_input.count():
        name_input.fill("テストブラザーズ")
    pet_input = page.get_by_test_id("input-pet-name")
    if pet_input.count():
        pet_input.fill("テストポチ")
    sheet.evaluate("e => e.dataset.done = '1'")
    page.get_by_test_id("btn-continue-event").click()
    # 次のイベントがすぐ開くことがあるので「このシートが閉じた」ことを待つ
    page.wait_for_function("!document.querySelector('[data-done=\"1\"]')", timeout=5000)
    return title


def play_to_end(page, max_events=180, on_event=None, info=None):
    titles = []
    while True:
        page.wait_for_selector('[data-testid="event-sheet"], [data-testid="result"]', timeout=30000)
        if page.get_by_test_id("result").count():
            break
        if on_event:
            on_event(len(titles))  # イベントシートが開いている最中でも上部バーは操作できる
        titles.append(answer_event(page, info=info))
        assert len(titles) <= max_events, "イベント数が多すぎる"
    return titles


def assert_result(page, name):
    expect(page.get_by_test_id("result")).to_be_visible(timeout=20000)
    for tid in ["result-name", "result-age", "result-lifetime", "result-awards", "result-family", "result-tv", "result-army", "result-eulogy", "result-hof"]:
        expect(page.get_by_test_id(tid)).to_be_visible()
    expect(page.get_by_test_id("result-name")).to_have_text(name)
    expect(page.get_by_test_id("result-lifetime")).to_contain_text("円")
    age_text = page.get_by_test_id("result-age").inner_text()
    import re
    death = int(re.search(r"享年(\d+)", age_text).group(1))
    assert 55 <= death <= 100, age_text
    army = page.get_by_test_id("result-army").inner_text()
    assert f"{name}軍団" in army, army
    fam = page.get_by_test_id("result-family").inner_text()
    assert fam.strip() and "さん" not in fam, fam  # 配偶者の名前は出さない
    return death


# ---------------------------------------------------------------- tests
def test_boot_skeleton_and_title(browser, base, device):
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    page.goto(base + "/")  # 通常速度で起動 → スケルトンが見える
    expect(page.get_by_test_id("skeleton")).to_be_visible()
    expect(page.get_by_test_id("title")).to_be_visible(timeout=10000)
    expect(page.get_by_test_id("skeleton")).to_have_count(0)
    ctx.close()


def test_setup_single_stage_name(browser, base, device):
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    page.goto(f"{base}/?tick={TICK}")
    page.get_by_test_id("btn-new").click()
    expect(page.get_by_test_id("speed-normal")).to_have_attribute("aria-pressed", "true")  # 初期値ふつう
    assert page.locator("#setup input, [data-testid=setup] input").count() == 1, "入力欄は芸名の1つだけ"
    expect(page.get_by_text("芸名", exact=True)).to_be_visible()
    page.get_by_test_id("btn-start").click()
    expect(page.get_by_test_id("form-error")).to_contain_text("芸名")
    ctx.close()


def test_full_life(browser, base, device):
    # 演出を短くして（OSの「動きを減らす」設定）最後まで遊び切る
    ctx = browser.new_context(**device, reduced_motion="reduce")
    page = ctx.new_page()
    mock_api(page)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    name = "森ハナコ"
    start_new_game(page, base, gender="female", name=name, extra="&ai=1")
    watch_toasts(page)
    expect(page.get_by_test_id("age")).to_have_text("18")

    def on_event(n):
        if n == 3:  # ゲーム途中でスピード変更（ゆっくり→はやい）
            page.get_by_test_id("speed-slow").click()
            expect(page.get_by_test_id("speed-slow")).to_have_attribute("aria-pressed", "true")
            page.get_by_test_id("speed-fast").click()
            expect(page.get_by_test_id("speed-fast")).to_have_attribute("aria-pressed", "true")
            assert page.evaluate("window.__geinin.state.speed") == "fast"

    info = []
    play_to_end(page, on_event=on_event, info=info)
    qs = [e["q"] for e in info]
    gaps = {b - a for a, b in zip(qs, qs[1:])}
    assert gaps == {2}, f"イベントは半年(2四半期)ごとのはず: {gaps}"
    specials = [e for e in info if e["special"]]
    assert specials and all(e["q"] % 16 == 8 for e in specials), specials[:3]
    assert len(specials) >= len([q for q in qs if q % 16 == 8]) - 1, "4年に1回の特別イベント"
    death = assert_result(page, name)
    expect(page.get_by_test_id("result-eulogy")).to_contain_text("モックの弔辞")
    expect(page.get_by_test_id("hof-list")).to_contain_text(name)
    toasts = page.evaluate("window.__toasts")
    assert any(toasts.get(k) for k in ("theater", "tv", "race", "win")), toasts
    # 結果画面の画像
    page.get_by_test_id("btn-share").click()
    expect(page.get_by_test_id("share-preview")).to_be_visible(timeout=10000)
    page.wait_for_function("document.querySelector('[data-testid=share-image]').naturalWidth === 1080")
    page.get_by_test_id("share-image").screenshot(path=os.path.join(OUT, f"share-{device.get('is_mobile', False)}.png"))
    print(f"    享年{death}・イベント{len(info)}回・特別{len(specials)}回・通知{toasts}", flush=True)
    assert not errors, errors
    ctx.close()


def test_special_event_animation(browser, base, device):
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    mock_api(page)
    start_new_game(page, base, name="特別テスト")
    for _ in range(6):
        page.wait_for_selector('[data-testid="event-sheet"]', timeout=20000)
        if page.get_by_test_id("event-sheet").get_attribute("data-special") == "1":
            break
        answer_event(page)
    sheet = page.get_by_test_id("event-sheet")
    assert sheet.get_attribute("data-special") == "1", "20歳で特別イベントが出るはず"
    expect(page.get_by_test_id("special-badge")).to_be_visible()
    stage = page.get_by_test_id("special-stage")
    expect(stage.locator(".curtain")).to_have_count(2)
    anims = page.evaluate("document.getAnimations().map(a => a.animationName).filter(Boolean)")
    for need in ("curtainOpen", "spotSweep", "specialIn", "letterDrop"):
        assert need in anims, (need, set(anims))
    page.wait_for_timeout(2400)
    page.screenshot(path=os.path.join(OUT, f"special-{device.get('is_mobile', False)}.png"))
    answer_event(page, 0)
    ctx.close()


def test_no_mosaic_on_pause_and_event(browser, base, device):
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    mock_api(page)
    start_new_game(page, base, name="ぼかし確認")
    expect(page.get_by_test_id("event-sheet")).to_be_visible()
    blur = page.evaluate("""() => [...document.querySelectorAll('.sheet-backdrop, .sheet, .sp-stage')].map(e => {
        const c = getComputedStyle(e); return (c.backdropFilter || c.webkitBackdropFilter || 'none') + '|' + c.filter; })""")
    assert all(b.startswith("none") and b.endswith("none") for b in blur), blur
    answer_event(page, 0)
    page.get_by_test_id("btn-pause").click()
    expect(page.get_by_test_id("paused")).to_have_class(re.compile("on"))
    covers = page.evaluate("""() => [...document.querySelectorAll('body *')].filter(e => {
        const c = getComputedStyle(e); const r = e.getBoundingClientRect();
        const bf = c.backdropFilter || c.webkitBackdropFilter || 'none';
        return bf !== 'none' && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9; }).length""")
    assert covers == 0, "一時停止中に画面全体をぼかす要素がある"
    q1 = page.evaluate("window.__geinin.state.q")
    page.wait_for_timeout(400)
    assert page.evaluate("window.__geinin.state.q") == q1, "一時停止中は進まない"
    ctx.close()


def test_resume_save(browser, base, device):
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    mock_api(page)
    start_new_game(page, base, name="大和イチロー")
    answer_event(page, 1)
    page.wait_for_function("window.__geinin.state.q >= 1")
    q1 = page.evaluate("window.__geinin.state.q")
    page.reload()
    expect(page.get_by_test_id("btn-continue")).to_be_visible(timeout=10000)
    expect(page.get_by_test_id("btn-continue")).to_contain_text("大和イチロー")
    page.get_by_test_id("btn-continue").click()
    expect(page.get_by_test_id("game")).to_be_visible()
    assert page.evaluate("window.__geinin.state.q") >= q1
    ctx.close()


def test_ai_comment_persona_and_fallback(browser, base, device):
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    mock_api(page, comment="ほんで、それでええんかい！")
    start_new_game(page, base, extra="&ai=1")
    page.get_by_test_id("choice-2").click()
    expect(page.get_by_test_id("ai-text")).to_have_text("ほんで、それでええんかい！", timeout=10000)
    expect(page.get_by_test_id("ai-persona")).to_contain_text("大阪のおかん")
    ctx.close()
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    mock_api(page, ai_ok=False)
    start_new_game(page, base, extra="&ai=1")
    page.get_by_test_id("choice-0").click()
    expect(page.get_by_test_id("ai-text")).not_to_be_empty(timeout=10000)
    expect(page.get_by_test_id("ai-persona")).to_contain_text("AIツッコミ：")
    ctx.close()


def test_mobile_layout(browser, base, device):
    if not device.get("is_mobile"):
        return
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    mock_api(page)
    start_new_game(page, base, name="難波ジロー")
    sw = page.evaluate("document.documentElement.scrollWidth")
    vw = page.evaluate("window.innerWidth")
    assert sw <= vw, f"横スクロール発生 {sw}>{vw}"
    for i in range(3):
        box = page.get_by_test_id(f"choice-{i}").bounding_box()
        assert box["height"] >= 44 and box["x"] >= 0 and box["x"] + box["width"] <= vw + 1, box
    css = open(os.path.join(ROOT, "style.css"), encoding="utf-8").read()
    assert "-webkit-backdrop-filter" in css
    page.screenshot(path=os.path.join(OUT, "mobile-event.png"))
    answer_event(page, 0)
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(OUT, "mobile-game.png"))
    ctx.close()


OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test-results")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=None)
    ap.add_argument("-k", default="")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    httpd = None
    base = args.base
    if not base:
        httpd, base = serve()
    tests = [v for k, v in globals().items() if k.startswith("test_") and args.k in k]
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        devices = {
            "PC Chrome": {"viewport": {"width": 1280, "height": 860}},
            "iPhone 13 (Safari相当)": {k: v for k, v in p.devices["iPhone 13"].items() if k != "default_browser_type"},
        }
        for dname, dev in devices.items():
            for t in tests:
                name = f"[{dname}] {t.__name__}"
                t0 = time.time()
                try:
                    t(browser, base, dev)
                    results.append((name, True, time.time() - t0, ""))
                    print(f"  PASS {name} ({time.time() - t0:.1f}s)", flush=True)
                except Exception as e:
                    results.append((name, False, time.time() - t0, str(e)))
                    print(f"  FAIL {name}\n{traceback.format_exc()}", flush=True)
        browser.close()
    if httpd:
        httpd.shutdown()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
