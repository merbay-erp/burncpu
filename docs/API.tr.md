# burncpu — API referansı

[English](API.md) · Base URL: `https://burncpu.com/api/v1` · Makine sözleşmesi:
`GET /api/v1/openapi.json`.

Route modülleri ve testler nihai kaynaktır. JSON gönderilir/alınır, oturum
çerezi veya scoped bearer token kullanılır, state-changing cookie istekleri
same-origin olmalıdır. Hatalar `{ "error": "code", "message": "..." }` biçiminde
döner ve `x-request-id` taşır. Timeline'lar keyset pagination kullanır.

## Ana gruplar

| Grup | Örnekler |
|---|---|
| Kimlik | `/auth/request`, `/auth/logout`, `/auth/passkeys/*`, `/auth/2fa/*` |
| OAuth | `/oauth/providers`, `/oauth/{provider}/start`, `callback`, `exchange` |
| Post | `GET/POST /posts`, restore/history/replies, repost, react, thread |
| Kullanıcı | profile, follow/block/mute, suggestions, export, trash, activity |
| Akış/arama | `/feed`, `/feed/federated`, `/search`, `/hashtags`, `/trending` |
| Medya | `POST /media`, `GET /media`, `DELETE /media/{id}` |
| DM | thread/message CRUD, reactions, clear/delete, attachment endpoints |
| Canlı | `/notifications/stream` (SSE), `/notifications`, native push devices |
| Moderasyon | reports, appeals, admin posts/users, stats, shadow, moderation log |
| Federasyon | instances, relays, blocks, remote posts, ActivityPub routes |

Anonim link preview endpoint'i cache'lenir ve anonymous çağrılar rate-limitlidir;
özel/follower-only veri anonim istemciye sızmaz. Tam parametre ve şema için
[OpenAPI JSON](https://burncpu.com/api/v1/openapi.json) kullanın.
