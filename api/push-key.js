// 브라우저가 알림을 구독할 때 쓰는 공개 키 (비밀 키는 서버에만)
export default function pushKey(req, res) {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: "알림 키(VAPID_PUBLIC_KEY)가 아직 설정되지 않았어요." });
  res.status(200).json({ key });
}
