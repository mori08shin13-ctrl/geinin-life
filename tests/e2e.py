"""
ブラウザ E2E テスト（Playwright for Python）
  python tests/e2e.py            … 全テスト
  python tests/e2e.py --base https://xxx.workers.dev   … 本番URLに対して実行
ローカルでは public/ を簡易サーバーで配信し、/api/* はモックで差し替える。
"""
import argparse
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
            return route.fulfill(json={"comment": comment})
        if path == "eulogy":
            return route.fulfill(json={"text": "モックの弔辞です。ほんまお疲れさん。"})
        if path == "hof":
            if req.method == "POST":
                HOF.append(json.loads(req.post_data))
            top = sorted(HOF, key=lambda e: -e["lifetime"])[:10]
            return route.fulfill(json={"top": top})
        return route.fulfill(status=404, body="{}")

    page.route("**/api/**", handle)


def start_new_game(page, base, gender="male", sei="森", mei="慎太郎", extra=""):
    page.goto(f"{base}/?tick={TICK}{extra}")
    expect(page.get_by_test_id("btn-new")).to_be_visible(timeout=10000)
    page.get_by_test_id("btn-new").click()
    expect(page.get_by_test_id("setup")).to_be_visible()
    page.get_by_test_id(f"gender-{gender}").click()
    page.get_by_test_id("input-sei").fill(sei)
    page.get_by_test_id("input-mei").fill(mei)
    page.get_by_test_id("btn-start").click()
    expect(page.get_by_test_id("game")).to_be_visible(timeout=10000)


def answer_event(page, choice=None):
    sheet = page.get_by_test_id("event-sheet")
    expect(sheet).to_be_visible()
    title = page.get_by_test_id("event-title").inner_text()
    for i in range(3):
        expect(page.get_by_test_id(f"choice-{i}")).to_be_visible()
    i = random.randrange(3) if choice is None else choice
    page.get_by_test_id(f"choice-{i}").click()
    expect(page.get_by_test_id("event-result")).to_be_visible()
    expect(page.get_by_test_id("ai-text")).to_be_visible(timeout=10000)
    name_input = page.get_by_test_id("input-unit-name")
    if name_input.count():
        name_input.fill("テストブラザーズ")
    page.get_by_test_id("btn-continue-event").click()
    expect(sheet).to_have_count(0, timeout=5000)
    return title


def play_to_end(page, max_events=70, on_event=None):
    titles = []
    while True:
        page.wait_for_selector('[data-testid="event-sheet"], [data-testid="result"]', timeout=30000)
        if page.get_by_test_id("result").count():
            break
        if on_event:
            on_event(len(titles))  # イベントシートが開いている最中でも上部バーは操作できる
        titles.append(answer_event(page))
        assert len(titles) <= max_events, "イベント数が多すぎる"
    return titles


def assert_result(page, sei):
    expect(page.get_by_test_id("result")).to_be_visible(timeout=20000)
    for tid in ["result-name", "result-lifetime", "result-awards", "result-family", "result-tv", "result-army", "result-eulogy", "result-hof"]:
        expect(page.get_by_test_id(tid)).to_be_visible()
    expect(page.get_by_test_id("result-lifetime")).to_contain_text("円")
    army = page.get_by_test_id("result-army").inner_text()
    assert f"{sei}軍団" in army, army
    assert page.get_by_test_id("result-family").inner_text().strip()


# ---------------------------------------------------------------- tests
def test_boot_skeleton_and_title(browser, base, device):
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    page.goto(base + "/")  # 通常速度で起動 → スケルトンが見える
    expect(page.get_by_test_id("skeleton")).to_be_visible()
    expect(page.get_by_test_id("title")).to_be_visible(timeout=10000)
    expect(page.get_by_test_id("skeleton")).to_have_count(0)
    ctx.close()


def test_setup_validation(browser, base, device):
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    page.goto(f"{base}/?tick={TICK}")
    page.get_by_test_id("btn-new").click()
    expect(page.get_by_test_id("speed-normal")).to_have_attribute("aria-pressed", "true")  # 初期値ふつう
    page.get_by_test_id("btn-start").click()
    expect(page.get_by_test_id("form-error")).to_contain_text("苗字と名前")
    ctx.close()


def test_full_life_with_speed_change(browser, base, device):
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    mock_api(page)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    start_new_game(page, base, gender="female", sei="森", mei="花子", extra="&ai=1")
    expect(page.get_by_test_id("age")).to_have_text("18")

    def on_event(n):
        if n == 3:  # ゲーム途中でスピード変更（ゆっくり→はやい）
            page.get_by_test_id("speed-slow").click()
            expect(page.get_by_test_id("speed-slow")).to_have_attribute("aria-pressed", "true")
            page.get_by_test_id("speed-fast").click()
            expect(page.get_by_test_id("speed-fast")).to_have_attribute("aria-pressed", "true")
            assert page.evaluate("window.__geinin.state.speed") == "fast"

    first = answer_event(page, 0)
    assert "NSC" in first, first
    # 1つ目の年イベント後、3か月ずつ進む
    page.wait_for_function("window.__geinin.state.q >= 2", timeout=10000)
    expect(page.get_by_test_id("when")).to_contain_text("年")
    titles = play_to_end(page, on_event=on_event)
    total = len(titles) + 1
    assert total == 62, f"イベント数 {total}（18〜79歳の62回のはず）"
    assert page.evaluate("window.__geinin.state.q") == 248  # 62年×4四半期
    assert_result(page, "森")
    expect(page.get_by_test_id("result-eulogy")).to_contain_text("モックの弔辞")
    expect(page.get_by_test_id("hof-list")).to_contain_text("森 花子")
    assert not errors, errors
    ctx.close()


def test_pause_and_resume_save(browser, base, device):
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    mock_api(page)
    start_new_game(page, base, sei="大和", mei="一郎")
    answer_event(page, 1)
    page.wait_for_function("window.__geinin.state.q >= 2")
    page.get_by_test_id("btn-pause").click()
    expect(page.get_by_test_id("paused")).to_have_class("paused-veil on")
    q1 = page.evaluate("window.__geinin.state.q")
    page.wait_for_timeout(400)
    assert page.evaluate("window.__geinin.state.q") == q1, "一時停止中は進まない"
    page.get_by_test_id("btn-pause").click()
    page.wait_for_function(f"window.__geinin.state.q > {q1} || !!document.querySelector('[data-testid=event-sheet]')")
    # リロードして「つづきから」
    page.reload()
    expect(page.get_by_test_id("btn-continue")).to_be_visible(timeout=10000)
    expect(page.get_by_test_id("btn-continue")).to_contain_text("大和一郎")
    page.get_by_test_id("btn-continue").click()
    expect(page.get_by_test_id("game")).to_be_visible()
    assert page.evaluate("window.__geinin.state.q") >= q1
    ctx.close()


def test_ai_comment_and_fallback(browser, base, device):
    # AI 成功
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    mock_api(page, comment="ほんで、それでええんかい！")
    start_new_game(page, base, extra="&ai=1")
    page.get_by_test_id("choice-2").click()
    expect(page.get_by_test_id("ai-text")).to_have_text("ほんで、それでええんかい！", timeout=10000)
    ctx.close()
    # AI 失敗 → 代替コメント
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    mock_api(page, ai_ok=False)
    start_new_game(page, base, extra="&ai=1")
    page.get_by_test_id("choice-0").click()
    expect(page.get_by_test_id("ai-text")).not_to_be_empty(timeout=10000)
    ctx.close()


def test_mobile_layout(browser, base, device):
    if not device.get("is_mobile"):
        return
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    mock_api(page)
    start_new_game(page, base, sei="難波", mei="次郎")
    sw = page.evaluate("document.documentElement.scrollWidth")
    vw = page.evaluate("window.innerWidth")
    assert sw <= vw, f"横スクロール発生 {sw}>{vw}"
    # 選択肢ボタンが指で押せる大きさ
    for i in range(3):
        box = page.get_by_test_id(f"choice-{i}").bounding_box()
        assert box["height"] >= 44 and box["x"] >= 0 and box["x"] + box["width"] <= vw + 1, box
    # Safari 用の -webkit-backdrop-filter が指定されているか
    css = open(os.path.join(ROOT, "style.css"), encoding="utf-8").read()
    assert "-webkit-backdrop-filter" in css
    page.screenshot(path=os.path.join(OUT, f"mobile-event.png"))
    answer_event(page, 0)
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(OUT, f"mobile-game.png"))
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
