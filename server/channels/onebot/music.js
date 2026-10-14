// Finds a song on NetEase Cloud Music by name for a music card. Public
// search, no account; a miss returns null and she simply doesn't share.
export async function searchSong(
  query,
  { fetch: f = fetch, timeoutMs = 6000 } = {},
) {
  const url = "https://music.163.com/api/cloudsearch/pc";
  try {
    const r = await f(url, {
      method: "POST",
      body: new URLSearchParams({
        s: query,
        type: "1",
        limit: "10",
        offset: "0",
      }),
      headers: {
        Referer: "https://music.163.com/",
        "User-Agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const songs = (await r.json())?.result?.songs || [];
    const artists = (x) => (x.ar || x.artists || []).map((a) => a.name);
    // The original over a cover: its artist named in the query, its exact
    // title, not a "(深情版)".
    const score = (x) =>
      artists(x).some((n) => n && query.includes(n)) * 4 +
      query.includes(String(x.name)) * 2 -
      /[(（]/.test(String(x.name)) +
      (Number(x.pop) || 0) / 100;
    const song = [...songs].sort((a, b) => score(b) - score(a))[0];
    if (!song?.id) return null;
    return {
      id: song.id,
      name: String(song.name || ""),
      artist: artists(song).join("/"),
    };
  } catch {
    return null;
  }
}
