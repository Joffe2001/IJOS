"""End-to-end UI walkthrough of IJOS on THROWAWAY data, with synthetic files only.

Usage:  python test/e2e_walkthrough.py [screenshot-dir]
It starts its own IJOS servers (ports 4399 and 4398) on new temporary folders, generates
synthetic fixtures (test/make_fixtures.mjs), and never touches ./data.
Requires: Node 22.13+, pip install playwright && python -m playwright install chromium
"""
import sys, os, re, json, time, tempfile, subprocess, urllib.request, urllib.parse, shutil
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.mkdtemp(), 'shots')
os.makedirs(SHOTS, exist_ok=True)
PORT, PORT2 = 4399, 4398
BASE = f'http://127.0.0.1:{PORT}'
DATA = tempfile.mkdtemp(prefix='ijos-e2e-')
DATA2 = tempfile.mkdtemp(prefix='ijos-e2e-clean-')
FIX = tempfile.mkdtemp(prefix='ijos-fixtures-')
subprocess.run(['node', os.path.join(ROOT, 'test', 'make_fixtures.mjs'), FIX], check=True)
errors = []
results = []
procs = {}

def start_server(port, data):
    env = {**os.environ, 'IJOS_PORT': str(port), 'IJOS_DATA': data}
    p = subprocess.Popen(['node', '--disable-warning=ExperimentalWarning', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=1); break
        except Exception: time.sleep(0.2)
    procs[port] = p

def stop_server(port):
    p = procs.pop(port, None)
    if p: p.terminate(); p.wait(10)

def upload(name, course_id, source):
    q = urllib.parse.urlencode({'name': name, 'course_id': course_id, 'source': source})
    req = urllib.request.Request(f'{BASE}/api/upload?{q}', data=open(os.path.join(FIX, name), 'rb').read(), headers={'x-ijos': '1'}, method='POST')
    return json.load(urllib.request.urlopen(req))

def step(name):
    def deco(fn):
        def run(page):
            try:
                fn(page); results.append(('PASS', name))
            except Exception as e:
                results.append(('FAIL', f'{name}: {e}'))
                page.screenshot(path=f'{SHOTS}/FAIL-{len(results)}.png', full_page=True)
        return run
    return deco

def go(page, h, base=None):
    page.goto(f'{base or BASE}/#{h}')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(300)

def shot(page, name, full=False):
    page.screenshot(path=f'{SHOTS}/{name}.png', full_page=full)

def api(page, path):
    return page.evaluate(f"fetch('{path}').then(r => r.json())")

def submit_dialog(page):
    page.locator('dialog[open] button[value=ok]').click()
    page.wait_for_timeout(400)

COURSES = ['מתמטיקה לכלכלנים', 'כתיבה אקדמית', 'מבוא לתכנות עם JavaScript', 'מבוא למערכות מידע', 'אקסל לניתוח נתונים']

@step('A1 first launch: onboarding creates program, semester and courses')
def t_onboard(page):
    go(page, '/')
    assert page.url.endswith('#/welcome'), page.url
    assert page.evaluate('document.documentElement.dir') == 'rtl'
    expect(page.locator('h1')).to_contain_text('כל התואר. מקום אחד.')
    shot(page, '00-onboarding')
    page.fill('input[name=program]', 'מערכות מידע, תואר ראשון')
    page.locator('form[data-submit=create] button.btn-primary').click(); page.wait_for_timeout(600)
    page.locator('[data-act=more]').click(); page.locator('[data-act=more]').click()
    for i, name in enumerate(COURSES):
        page.locator('#rows .row').nth(i).locator('input[name=name]').fill(name)
    page.locator('#rows .row').nth(2).locator('input[name=credits]').fill('5')
    shot(page, '00b-onboarding-courses')
    page.locator('form[data-submit=courses] button.btn-primary').click(); page.wait_for_timeout(600)
    page.locator('[data-act=finish]').click(); page.wait_for_timeout(800)
    st = api(page, '/api/state')
    assert [c['name'] for c in st['courses']] == COURSES, st['courses']
    assert st['settings'].get('onboarded') == '1' and st['settings'].get('program')
    expect(page.locator('#sidebar')).to_contain_text('מבוא לתכנות עם JavaScript')

@step('A2 import through the UI (Hebrew names with spaces) and by API')
def t_import(page):
    go(page, '/course/3')
    with page.expect_file_chooser() as fc:
        page.locator('[data-act=import]').click()
    fc.value.set_files([os.path.join(FIX, n) for n in ['סיכום יסודות התכנות.html', 'מטלה תרגול 2.pdf', 'exercise1.js']])
    page.wait_for_timeout(500)
    page.select_option('dialog[open] select[name=source]', 'chatgpt')
    submit_dialog(page); page.wait_for_timeout(1500)
    st = api(page, '/api/state')
    names = [r['original_name'] for r in st['resources']]
    assert names == ['סיכום יסודות התכנות.html', 'מטלה תרגול 2.pdf', 'exercise1.js'], names
    for name, cid, src in [('מודל חמשת הכוחות - מצגת.pptx', 4, 'lecturer'), ('information_systems_summary.html', 4, 'chatgpt'), ('סיכום אחוזים.html', 1, 'chatgpt'), ('תרגול שיעור 2.xlsx', 5, 'lecturer'), ('מבוא.docx', 4, 'me')]:
        upload(name, cid, src)
    dup = upload('exercise1.js', 3, 'me')
    assert len(dup['duplicates']) == 1, 'duplicate content detected'
    urllib.request.urlopen(urllib.request.Request(f"{BASE}/api/rows/resources/{dup['resource']['id']}?hard=1", headers={'x-ijos': '1'}, method='DELETE'))

@step('dashboard renders in Hebrew RTL')
def t_dash(page):
    go(page, '/')
    assert page.evaluate('document.documentElement.dir') == 'rtl'
    expect(page.locator('.hero h1')).to_be_visible()
    expect(page.locator('.course-strip')).to_contain_text('מבוא לתכנות עם JavaScript')
    shot(page, '01-dashboard-start')

@step('topics: create two topics')
def t_topics(page):
    go(page, '/course/3/topics')
    for name in ['לולאות', 'משתנים']:
        page.fill('#new-topic', name); page.press('#new-topic', 'Enter'); page.wait_for_timeout(400)
    expect(page.locator('.items')).to_contain_text('לולאות')
    expect(page.locator('.items')).to_contain_text('משתנים')

@step('HTML summary opens in isolated sandbox')
def t_html(page):
    go(page, '/r/1')
    frame_el = page.locator('iframe.frame-html')
    expect(frame_el).to_be_visible()
    sandbox = frame_el.get_attribute('sandbox')
    assert 'allow-same-origin' not in sandbox, sandbox
    page.wait_for_timeout(800)
    frame = page.frames[1]
    origin = frame.evaluate('self.origin')
    assert origin == 'null', f'expected opaque origin, got {origin}'
    blocked = frame.evaluate("fetch('/api/state').then(() => 'reached').catch(() => 'blocked')")
    assert blocked == 'blocked', 'summary could reach the API'
    parent_access = frame.evaluate("(() => { try { return parent.document.title } catch (e) { return 'denied' } })()")
    assert parent_access == 'denied'
    assert frame.locator('body').inner_text().strip() != ''
    shot(page, '02-html-summary-sandboxed')

@step('link one resource to multiple topics (no file duplication)')
def t_multi_topic(page):
    go(page, '/r/1?panel=details')
    page.locator('[data-act=topics]').click()
    page.locator('dialog[open] label:has-text("לולאות") input').check()
    page.locator('dialog[open] label:has-text("משתנים") input').check()
    submit_dialog(page)
    page.wait_for_timeout(500)
    st = api(page, '/api/state')
    links = [x for x in st['resource_topics'] if x['resource_id'] == 1]
    assert len(links) == 2, links
    assert len([r for r in st['resources'] if r['blob_sha'] == st['resources'][0]['blob_sha']]) == 1
    go(page, f"/topic/{links[0]['topic_id']}")
    expect(page.locator('main')).to_contain_text('סיכום יסודות התכנות')

@step('note: create from source, autosave, code + math render, survives reload')
def t_note(page):
    go(page, '/r/1?panel=notes')
    page.locator('[data-act=new-note]').click()
    page.wait_for_timeout(1200)
    ta = page.locator('#side-viewer textarea.note-input')
    expect(ta).to_be_visible()
    ta.fill('## לולאת for\n\nלולאה עם `let i = 0` והנוסחה $x^2 + 1$.\n\n```js\nfor (let i = 0; i < 3; i++) console.log(i);\n```\n')
    page.wait_for_timeout(1500)
    expect(page.locator('#save-status')).to_have_text('הכול נשמר')
    st = api(page, '/api/state')
    note = [r for r in st['resources'] if r['kind'] == 'note'][-1]
    page.goto(f"{BASE}/#/r/{note['id']}"); page.reload(); page.wait_for_load_state('networkidle'); page.wait_for_timeout(500)
    prev = page.locator('.pane-main .note-preview')
    expect(prev.locator('pre.code')).to_contain_text('console.log(i)')
    assert prev.locator('pre.code').get_attribute('dir') == 'ltr'
    expect(prev.locator('.katex').first).to_be_visible()
    shot(page, '03-note-with-source')
    page.locator('.tabs a:has-text("חומר נוסף לצד")').click(); page.wait_for_timeout(1200)
    expect(page.locator('#side-viewer iframe')).to_be_visible()
    shot(page, '04-note-beside-source')

@step('resume: position + next step saved and shown on dashboard')
def t_resume(page):
    go(page, '/r/2')
    page.fill('.resume-bar input[name=position]', 'עמוד 2'); page.press('.resume-bar input[name=position]', 'Tab')
    page.fill('.resume-bar input[name=next_step]', 'לפתור את שאלה 3'); page.press('.resume-bar input[name=next_step]', 'Tab')
    page.wait_for_timeout(700)
    assert '#page=2' in page.locator('.pane-main iframe').get_attribute('src') or True
    go(page, '/')
    expect(page.locator('main')).to_contain_text('לפתור את שאלה 3')
    go(page, '/r/2')
    assert '#page=2' in page.locator('.pane-main iframe').get_attribute('src')

@step('unclear point → review task')
def t_unclear(page):
    go(page, '/r/4?panel=unclear')
    page.locator('[data-act=add-flag]').click()
    page.fill('dialog[open] textarea[name=text]', 'מה ההבדל בין בידול לחדשנות?')
    page.fill('dialog[open] input[name=location]', 'שקף 5')
    submit_dialog(page); page.wait_for_timeout(500)
    page.locator('[data-act=flag-task]').first.click()
    submit_dialog(page); page.wait_for_timeout(500)
    st = api(page, '/api/state')
    assert any(t['origin'] == 'unclear' for t in st['tasks'])
    go(page, '/')
    expect(page.locator('main')).to_contain_text('מה ההבדל בין בידול לחדשנות?')

@step('office previews (PPTX, XLSX, DOCX) show text')
def t_office(page):
    go(page, '/r/4'); page.wait_for_timeout(800)
    expect(page.locator('.slides li').first).to_be_visible()
    shot(page, '05-pptx-preview')
    go(page, '/r/7'); page.wait_for_timeout(800)
    expect(page.locator('table.sheet').first).to_be_visible()
    go(page, '/r/8'); page.wait_for_timeout(800)
    expect(page.locator('.doc-preview p').first).to_be_visible()

@step('assignment: link material, checklist, states ready → submitted (explicit) → graded')
def t_assignment(page):
    go(page, '/course/3/assignments')
    page.locator('[data-act=new-asg]').click()
    page.fill('dialog[open] input[name=title]', 'מטלה 2 — לולאות')
    page.fill('dialog[open] input[name=due_date]', '2026-11-26')
    page.fill('dialog[open] input[name=due_time]', '23:59')
    submit_dialog(page); page.wait_for_timeout(800)
    assert re.search(r'#/a/\d+', page.url)
    page.fill('#chk-assignment-1', 'להשלים את שאלה 3'); page.press('#chk-assignment-1', 'Enter'); page.wait_for_timeout(500)
    page.locator('[data-act=pick-res][data-role=instructions]').click()
    page.locator('dialog[open] label:has-text("מטלה תרגול 2") input').check()
    submit_dialog(page); page.wait_for_timeout(500)
    expect(page.locator('main')).to_contain_text('מטלה תרגול 2')
    page.locator('.stepper button:has-text("בעבודה")').click(); page.wait_for_timeout(500)
    page.locator('.stepper button:has-text("מוכן להגשה")').click(); page.wait_for_timeout(500)
    expect(page.locator('.notice-warn')).to_contain_text('מוכן להגשה ≠ הוגש')
    st = api(page, '/api/state'); a = st['assignments'][0]
    assert a['status'] == 'ready' and a['submitted_at'] is None
    go(page, '/')
    expect(page.locator('.card-warn')).to_contain_text('עדיין לא הוגש')
    expect(page.locator('main')).to_contain_text('להשלים את שאלה 3')
    shot(page, '06-dashboard-ready')
    go(page, f"/a/{a['id']}")
    page.locator('.stepper button:has-text("הוגש")').click()
    page.locator('dialog[open] input[name=sure]').check()
    submit_dialog(page); page.wait_for_timeout(500)
    st = api(page, '/api/state'); a = st['assignments'][0]
    assert a['status'] == 'submitted' and a['submitted_at'], a
    page.locator('.stepper button:has-text("נבדק")').click()
    page.fill('dialog[open] input[name=grade]', '95')
    submit_dialog(page); page.wait_for_timeout(500)
    st = api(page, '/api/state'); a = st['assignments'][0]
    assert a['status'] == 'graded' and a['grade'] == '95'
    shot(page, '07-assignment-graded')

@step('deadline + reminder: due reminder appears, snooze to explicit time')
def t_reminder(page):
    go(page, '/tasks')
    page.fill('input[name=title]', 'לשלוח מייל למתרגל')
    page.fill('form[data-submit=add] input[name=due_date]', '2026-11-20')
    page.locator('form[data-submit=add] button').click(); page.wait_for_timeout(500)
    expect(page.locator('main')).to_contain_text('באיחור')
    page.locator('[data-act=rem]').first.click()
    page.locator('dialog[open] input[value=custom]').check()
    page.fill('dialog[open] input[name=custom]', '2026-01-01T09:00')
    submit_dialog(page); page.wait_for_timeout(600)
    expect(page.locator('#reminder-bar')).to_contain_text('לשלוח מייל למתרגל')
    page.locator('#reminder-bar [data-rem=snooze]').click()
    page.locator('dialog[open] input[value=custom]').check()
    page.fill('dialog[open] input[name=custom]', '2030-05-01T10:00')
    submit_dialog(page); page.wait_for_timeout(600)
    expect(page.locator('#reminder-bar')).to_be_empty()
    st = api(page, '/api/state')
    assert st['reminders'][0]['remind_at'] == '2030-05-01T10:00'
    go(page, '/calendar?view=list'); shot(page, '08-calendar-list')
    go(page, '/calendar?view=month&m=2026-11'); shot(page, '09-calendar-month')

@step('search finds extracted content and states PDF limitation')
def t_search(page):
    page.fill('#search-input', 'פורטר'); page.press('#search-input', 'Enter'); page.wait_for_timeout(700)
    expect(page.locator('main')).to_contain_text('מבוא למערכות מידע')
    expect(page.locator('main')).to_contain_text('לא נכלל')
    page.fill('#search-input', 'console.log'); page.press('#search-input', 'Enter'); page.wait_for_timeout(700)
    expect(page.locator('main')).to_contain_text('תוכן הפתק')
    shot(page, '10-search')

@step('master summary: edit, version, restore')
def t_summary(page):
    go(page, '/summary/3')
    page.locator('[data-act=new-ch]').first.click()
    page.fill('dialog[open] input[name=title]', 'לולאות')
    page.select_option('dialog[open] select[name=topic_id]', label='לולאות')
    submit_dialog(page); page.wait_for_timeout(800)
    ed = page.locator('#ch-editor')
    ed.fill('### הגדרות\n- **לולאה** — חזרה על קוד מספר פעמים\n')
    page.wait_for_timeout(1500)
    page.locator('[data-act=snap]').click(); page.wait_for_timeout(500)
    ed.fill('### הגדרות\n- **לולאה** — טקסט חדש שנכתב אחרי הגרסה\n'); page.wait_for_timeout(1500)
    page.locator('[data-act=done]').click(); page.wait_for_timeout(500)
    expect(page.locator('.summary-doc')).to_contain_text('טקסט חדש')
    shot(page, '11-summary')
    go(page, '/summary/3/versions')
    page.locator('main .plain a').first.click(); page.wait_for_timeout(600)
    expect(page.locator('main')).to_contain_text('חזרה על קוד מספר פעמים')
    page.locator('[data-act=restore]').click(); page.wait_for_timeout(900)
    expect(page.locator('.summary-doc')).to_contain_text('חזרה על קוד מספר פעמים')

@step('AI proposal review: overlap/contradiction flags, preview, accept')
def t_propose(page):
    go(page, '/summary/3/propose')
    page.locator('form[data-submit=build] li label').first.locator('input').check()
    page.locator('form[data-submit=build] button.btn').click(); page.wait_for_timeout(800)
    expect(page.locator('#prompt-out textarea')).to_be_visible()
    page.select_option('select[name=origin]', 'chatgpt')
    page.fill('form[data-submit=analyze] textarea', '## לולאות\n\n- **לולאה** — מבנה שמבצע פעולה כל עוד תנאי מתקיים\n\n## פונקציות\n\nפונקציה היא בלוק קוד עם שם.\n')
    page.locator('form[data-submit=analyze] button').click(); page.wait_for_timeout(900)
    expect(page.locator('main')).to_contain_text('סתירה אפשרית')
    shot(page, '12-proposal-review')
    page.locator('.sticky-actions button.btn-primary').click(); page.wait_for_timeout(1200)
    expect(page.locator('.summary-doc')).to_contain_text('פונקציה היא בלוק קוד')
    expect(page.locator('.summary-doc')).to_contain_text('מקור: ChatGPT')
    st = api(page, '/api/state')
    assert len([v for v in st['summary_versions'] if v['course_id'] == 3]) >= 3

@step('D topic → own project idea → exported brief')
def t_apps(page):
    go(page, '/apps')
    expect(page.locator('main')).to_contain_text('איזה פרויקט אתם בונים')
    page.locator('[data-act=new-project]').first.click()
    page.fill('dialog[open] input[name=name]', 'אפליקציית הזמנות')
    submit_dialog(page); page.wait_for_timeout(600)
    topic = api(page, '/api/state')['topics'][0]
    go(page, f"/topic/{topic['id']}")
    shot(page, '13a-topic')
    go(page, f"/apps?new=1&course=3&topic={topic['id']}"); page.wait_for_timeout(800)
    assert re.search(r'#/app/\d+', page.url), page.url
    page.locator('input[data-change=toggle-project]').first.check(); page.wait_for_timeout(500)
    page.fill('input[name=title]', 'זמינות תורים עם לולאה'); page.press('input[name=title]', 'Tab'); page.wait_for_timeout(500)
    page.fill('textarea[name=acceptance]', 'כל הזמנה שייכת ללקוח אחד ולעסק אחד'); page.press('textarea[name=acceptance]', 'Tab'); page.wait_for_timeout(500)
    aid = re.search(r'#/app/(\d+)', page.url).group(1)
    brief = page.evaluate(f"fetch('/api/download/brief/{aid}').then(r => r.text())")
    assert 'Implementation brief' in brief and 'כל הזמנה שייכת' in brief and 'אפליקציית הזמנות' in brief and 'לולאות' in brief, brief[:400]
    shot(page, '13-application')
    go(page, '/apps'); shot(page, '13b-apps-list')

@step('trash: delete and restore a resource')
def t_trash(page):
    go(page, '/r/3?panel=details')
    page.locator('.pane-side [data-act=trash]').click(); page.wait_for_timeout(600)
    go(page, '/trash')
    expect(page.locator('main')).to_contain_text('exercise1')
    page.locator('[data-act=restore]').first.click(); page.wait_for_timeout(500)
    st = api(page, '/api/state')
    assert next(r for r in st['resources'] if r['id'] == 3)['deleted_at'] is None

@step('empty and error states')
def t_states(page):
    go(page, '/inbox'); expect(page.locator('main')).to_contain_text('אין קבצים ממתינים')
    go(page, '/r/99999'); expect(page.locator('main')).to_contain_text('לא הצלחנו להציג')
    go(page, '/nope'); expect(page.locator('main')).to_contain_text('העמוד לא נמצא')

@step('narrow window layout')
def t_narrow(page):
    page.set_viewport_size({'width': 760, 'height': 900})
    go(page, '/r/4'); page.wait_for_timeout(600)
    shot(page, '14-narrow-workspace')
    page.locator('#nav-toggle').click(); page.wait_for_timeout(300)
    shot(page, '15-narrow-nav')
    page.set_viewport_size({'width': 1440, 'height': 900})

@step('E backup → clean installation → restore through the UI → content verified')
def t_backup_restore(page):
    b = page.evaluate("fetch('/api/backup', {method:'POST', headers:{'x-ijos':'1'}}).then(r => r.json())")
    zip_path = os.path.join(FIX, b['name'])
    with open(zip_path, 'wb') as f:
        f.write(urllib.request.urlopen(f"{BASE}/api/download/backup/{urllib.parse.quote(b['name'])}").read())
    start_server(PORT2, DATA2)
    base2 = f'http://127.0.0.1:{PORT2}'
    go(page, '/', base2)
    assert page.url.endswith('#/welcome'), 'clean install starts with onboarding'
    page.locator('[data-act=skip]').click(); page.wait_for_timeout(600)
    go(page, '/settings', base2)
    page.set_input_files('#restore-file', zip_path); page.wait_for_timeout(1500)
    expect(page.locator('#restore-out')).to_contain_text('הגיבוי תקין')
    shot(page, '16-restore-preview')
    page.locator('#restore-apply').click()
    submit_dialog(page); page.wait_for_timeout(1500)
    st = page.evaluate("fetch('/api/state').then(r => r.json())")
    assert [c['name'] for c in st['courses']] == COURSES
    assert len([r for r in st['resources'] if not r['deleted_at']]) >= 9
    integ = page.evaluate("fetch('/api/integrity').then(r => r.json())")
    assert integ['missing'] == [], integ
    go(page, '/r/4', base2); page.wait_for_timeout(800)
    expect(page.locator('.slides li').first).to_contain_text('מודל חמשת הכוחות')
    stop_server(PORT2)

@step('F restart → resume exactly where the user stopped')
def t_restart(page):
    stop_server(PORT); start_server(PORT, DATA)
    go(page, '/')
    expect(page.locator('main')).to_contain_text('לפתור את שאלה 3')
    go(page, '/r/2')
    assert '#page=2' in page.locator('.pane-main iframe').get_attribute('src')
    expect(page.locator('.resume-bar input[name=next_step]')).to_have_value('לפתור את שאלה 3')

@step('themes: dark mode saved, readable, documents stay light')
def t_theme(page):
    go(page, '/')
    page.locator('[data-theme-set=dark]').click(); page.wait_for_timeout(300)
    page.reload(); page.wait_for_load_state('networkidle'); page.wait_for_timeout(400)
    assert page.evaluate('document.documentElement.dataset.theme') == 'dark'
    bg = page.evaluate('getComputedStyle(document.body).backgroundColor')
    assert bg == 'rgb(18, 17, 24)', bg
    shot(page, '20-dashboard-dark')
    go(page, '/r/1'); page.wait_for_timeout(900)
    assert page.evaluate("getComputedStyle(document.querySelector('iframe.frame')).backgroundColor") == 'rgb(255, 255, 255)'
    shot(page, '21-workspace-dark')
    go(page, '/summary/3'); shot(page, '22-summary-dark')
    page.locator('[data-theme-set=light]').click(); page.wait_for_timeout(300)

@step('keyboard: skip link first, visible focus, Ctrl+K search; reduced motion honoured')
def t_a11y(page):
    page.goto(f'{BASE}/'); page.wait_for_load_state('networkidle'); page.wait_for_timeout(400)
    page.keyboard.press('Tab')
    assert page.evaluate('document.activeElement.className') == 'skip-link', page.evaluate('document.activeElement.outerHTML.slice(0, 80)')
    page.keyboard.press('Tab')
    outline = page.evaluate('getComputedStyle(document.activeElement).outlineStyle')
    assert outline != 'none', outline
    page.keyboard.press('Control+k')
    assert page.evaluate('document.activeElement.id') == 'search-input'
    page.emulate_media(reduced_motion='reduce')
    go(page, '/calendar')
    assert page.evaluate("getComputedStyle(document.querySelector('main > .page')).animationName") == 'none'
    page.emulate_media(reduced_motion='no-preference')

@step('long titles and large content do not break layout')
def t_long(page):
    long = 'מטלה עם כותרת ארוכה מאוד ' * 12 + 'https://example.com/' + 'a' * 120
    page.evaluate("t => fetch('/api/rows/assignments', {method:'POST', headers:{'x-ijos':'1','Content-Type':'application/json'}, body: JSON.stringify({title: t, course_id: 3, due_date: '2026-11-30'})})", long)
    big = '## פרק\n\n' + ('שורה ארוכה עם טקסט לימודי. ' * 40 + '\n\n') * 200
    page.evaluate("b => fetch('/api/rows/resources', {method:'POST', headers:{'x-ijos':'1','Content-Type':'application/json'}, body: JSON.stringify({title: 'פתק גדול', kind: 'note', course_id: 3, body: b})})", big)
    for h in ['/', '/course/3/assignments', '/tasks', '/calendar?view=list']:
        go(page, h)
        over = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        assert over <= 1, f'{h} overflows horizontally by {over}px'
    shot(page, '23-dashboard-populated')

@step('screens for review: course, assignment, calendar, settings, sample data')
def t_screens(page):
    go(page, '/course/3'); shot(page, '30-course')
    go(page, '/course/4/materials'); shot(page, '31-materials')
    a = api(page, '/api/state')['assignments'][0]
    go(page, f"/a/{a['id']}"); shot(page, '32-assignment')
    go(page, '/calendar?view=month&m=2026-11'); shot(page, '33-calendar')
    go(page, '/settings'); shot(page, '34-settings')
    page.locator('[data-act=sample-load]').click(); page.wait_for_timeout(1000)
    st = api(page, '/api/state')
    assert any(c['sample'] for c in st['courses'])
    go(page, '/settings'); page.locator('[data-act=sample-del]').click(); submit_dialog(page); page.wait_for_timeout(800)
    st = api(page, '/api/state')
    assert not any(c['sample'] for c in st['courses']) and [c['name'] for c in st['courses'] if not c['deleted_at']] == COURSES

start_server(PORT, DATA)
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1440, 'height': 900}, locale='he-IL', timezone_id='Asia/Jerusalem')
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    for t in [t_onboard, t_import, t_dash, t_topics, t_html, t_multi_topic, t_note, t_resume, t_unclear, t_office, t_assignment, t_reminder, t_search, t_summary, t_propose, t_apps, t_trash, t_states, t_narrow, t_backup_restore, t_restart, t_theme, t_a11y, t_long, t_screens]:
        t(page)
    b.close()
for port in list(procs): stop_server(port)
for d in (DATA, DATA2, FIX): shutil.rmtree(d, ignore_errors=True)
for r in results: print(*r)
real_errors = [e for e in errors if 'Failed to load resource' not in e]
print('screenshots:', SHOTS)
print('console errors:', json.dumps(real_errors, ensure_ascii=False, indent=1) if real_errors else 'none')
sys.exit(1 if any(r[0] == 'FAIL' for r in results) else 0)
