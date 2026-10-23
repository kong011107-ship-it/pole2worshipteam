#!/usr/bin/env python3
"""Pole2 찬양팀 — 오래된 백업 지우기 (새 백업을 올린 다음에만 불러요)
 · 최근 KEEP개(기본 4)만 남기고 나머지 'pole2-backup-…' 보관본을 지워요
 · 다음 주 백업이 들어갈 자리(가장 최근 백업 크기)를 남기고도 MAX_MB(기본 450MB — GitHub 무료 비공개 저장소의
   Actions 보관 한도는 500MB)를 넘으면 오래된 것부터 더 지워요. 그래도 최근 2개는 남겨요
 필요: GH_TOKEN · REPO(owner/name)
 테스트: DRY=1 이면 지우지 않고 계획만 보여 줘요 · ARTIFACTS_JSON=파일 로 목록을 대신 줄 수 있어요
"""
import json, os, sys, urllib.request

KEEP = int(os.environ.get("KEEP", "4")); MAX = int(os.environ.get("MAX_MB", "450")) * 1024 * 1024; MIN_KEEP = 2
REPO = os.environ.get("REPO", ""); TOKEN = os.environ.get("GH_TOKEN", "")

def api(path, method="GET"):
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}{path}", method=method,
                                 headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(req) as r:
        b = r.read()
        return json.loads(b) if b else {}

def listing():
    if os.environ.get("ARTIFACTS_JSON"):
        return json.load(open(os.environ["ARTIFACTS_JSON"]))
    out, page = [], 1
    while True:
        j = api(f"/actions/artifacts?per_page=100&page={page}")
        out += j.get("artifacts", [])
        if len(j.get("artifacts", [])) < 100: break
        page += 1
    return out

def plan(arts):
    mine = sorted([a for a in arts if a["name"].startswith("pole2-backup-") and not a.get("expired")], key=lambda a: a["created_at"], reverse=True)
    keep, drop, total = [], [], 0
    room = mine[0]["size_in_bytes"] if mine else 0   # 다음 백업 자리
    for a in mine:
        if len(keep) < KEEP and (len(keep) < MIN_KEEP or total + a["size_in_bytes"] + room <= MAX):
            keep.append(a); total += a["size_in_bytes"]
        else:
            drop.append(a)
    return keep, drop, total

if __name__ == "__main__":
    keep, drop, total = plan(listing())
    for a in keep: print(f"남김  {a['name']}  {a['size_in_bytes'] // 1024 // 1024}MB")
    for a in drop: print(f"지움  {a['name']}  {a['size_in_bytes'] // 1024 // 1024}MB")
    over = len(keep) < KEEP and len(drop) > 0
    if over: print(f"::warning::보관 한도({MAX // 1024 // 1024}MB) 때문에 최근 {len(keep)}개만 남겨요")
    if keep and total + keep[0]["size_in_bytes"] > MAX: print("::warning::백업 하나가 커서 다음 주 백업이 들어갈 자리가 모자랄 수 있어요 — 안내서 '보관 한도' 참고")
    if not os.environ.get("DRY"):
        for a in drop: api(f"/actions/artifacts/{a['id']}", "DELETE")
    note = f"보관 {len(keep)}개 · {total // 1024 // 1024}MB" + (" · 한도 때문에 줄임" if over else "")
    if os.environ.get("GITHUB_ENV"):
        with open(os.environ["GITHUB_ENV"], "a") as f: f.write(f"KEPT_NOTE={note}\n")
    print(note)
