#!/usr/bin/env python3
"""发布应付宝桌面端到 GitHub Releases。
依赖环境变量 GITHUB_TOKEN（GitHub PAT，需 repo 权限）。
用法：
    GITHUB_TOKEN=xxx python3 push_release.py [tag]
"""
import os, sys, json, urllib.request, urllib.error, urllib.parse

TOKEN = os.environ.get("GITHUB_TOKEN")
if not TOKEN:
    print("错误：请设置环境变量 GITHUB_TOKEN")
    sys.exit(1)

REPO = "yangxivi/yingfubao"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RELEASE_DIR = os.path.join(ROOT, "frontend", "release")

with open(os.path.join(ROOT, "frontend", "package.json"), encoding="utf-8") as f:
    VERSION = json.load(f)["version"]
TAG = sys.argv[1] if len(sys.argv) > 1 else f"v{VERSION}"

API = "https://api.github.com"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "yingfubao-release",
}

def api(method, url, data=None, extra=None):
    headers = dict(HEADERS)
    if extra:
        headers.update(extra)
    body = None
    if data is not None:
        if isinstance(data, (bytes, bytearray)):
            body = data
        else:
            body = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8", "replace"))

print(f"发布 {TAG} 到 {REPO} ...")

# 已存在同名 Release 则复用，否则新建
status, existing = api("GET", f"{API}/repos/{REPO}/releases/tags/{TAG}")
if status == 200 and existing.get("upload_url"):
    print(f"Release {TAG} 已存在，直接上传资源。")
    upload_url = existing["upload_url"].replace("{?name,label}", "")
    release_id = existing["id"]
else:
    status, rel = api("POST", f"{API}/repos/{REPO}/releases", {
        "tag_name": TAG,
        "name": f"应付宝桌面端 {TAG}",
        "body": "应付宝 Windows 桌面安装包（NSIS）。安装即自动启用自动更新。",
        "draft": False,
        "prerelease": False,
    })
    if status != 201:
        print("创建 Release 失败：", json.dumps(rel, ensure_ascii=False))
        sys.exit(1)
    upload_url = rel["upload_url"].replace("{?name,label}", "")
    release_id = rel["id"]
    print(f"Release 创建成功 (id={release_id})")

for fname in ["yingfubao-setup-%s.exe" % VERSION,
              "yingfubao-setup-%s.exe.blockmap" % VERSION,
              "latest.yml"]:
    path = os.path.join(RELEASE_DIR, fname)
    if not os.path.isfile(path):
        print(f"跳过缺失文件: {fname}")
        continue
    url = f"{upload_url}?name={urllib.parse.quote(fname)}"
    with open(path, "rb") as fh:
        data = fh.read()
    st, resp = api("POST", url, data=data, extra={
        "Content-Type": "application/octet-stream",
    })
    if st in (200, 201):
        print(f"上传成功: {fname} ({len(data)//1024} KB)")
    else:
        print(f"上传失败 {fname}: {st} {json.dumps(resp, ensure_ascii=False)}")

print(f"完成。页面：https://github.com/{REPO}/releases/tag/{TAG}")
