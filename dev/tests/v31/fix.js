// v31 시험 데이터
window.FIX = {
  user: { id: "u-lead", email: "lead@x.com" },
  tables: {
    songs: [{ id: 1, title: "은혜", main_key: "G" }, { id: 2, title: "주님의 마음", main_key: "A" }, { id: 3, title: "예수 피를 힘입어", main_key: "D" }],
    yt_videos: [{ id: "AAAAAAAAAAA", duration_sec: 300, title: "은혜 - 마커스워십 라이브" }, { id: "BBBBBBBBBBB", duration_sec: 280, title: "은혜 어쿠스틱" }],
    song_refs: [{ song_id: 1, youtube_id: "AAAAAAAAAAA", start_sec: 30, end_sec: 250 }],
    members: [{ id: "u-lead", name: "공준혁", role: "admin", status: "active", is_active: true }],
  },
  rpc: {
    conti_one: () => ({ id: "s1", date: "2099-11-15", deadline: "2099-11-12T14:59:00Z", can_edit: true, can_edit_sheets: true, target_sec: 1500,
      lineup: [{ member_id: "u-lead", name: "공준혁", pos: "leader" }, { member_id: "u2", name: "김밴드", pos: "drum" }],
      setlist: window.FIX.setlist || null }),
    medley_list: [],
    song_sheets: [],
    medley_sheets: [],
    save_setlist: (a) => ({ id: 9, version: 2, status: a.p_publish ? "published" : "draft", republished: false, past: false }),
    edit_sheet: (a) => ({ deleted: true, path: "originals/1/x.pdf" }),
  },
};
