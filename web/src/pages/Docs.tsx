import { createSignal, For, Show, type JSX } from 'solid-js';
import { locale } from '../i18n';
import Logo from '../components/Logo';

// Bilingual helper — each call site re-evaluates with the active locale.
const tx = (tr: string, en: string) => (locale() === 'tr' ? tr : en);

const BASE = 'https://burncpu.com/api/v1';

// ── Small building blocks ───────────────────────────────────────────────────

function CodeBlock(props: { code: string; lang?: string }) {
  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — no-op */
    }
  };
  return (
    <div class="relative my-3">
      <Show when={props.lang}>
        <span class="absolute top-2.5 left-3.5 text-[10px] font-mono uppercase tracking-widest text-on-surface-variant/50 select-none">
          {props.lang}
        </span>
      </Show>
      <button
        type="button"
        onClick={copy}
        class="absolute top-2 right-2 z-10 px-2 py-1 rounded-md text-[11px] font-mono text-on-surface-variant bg-surface-container hover:text-primary hover:bg-surface-container-high transition-colors"
      >
        {copied() ? tx('kopyalandı ✓', 'copied ✓') : tx('kopyala', 'copy')}
      </button>
      <pre class="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest p-4 pt-8 text-[12.5px] leading-relaxed font-mono text-on-surface">
        <code>{props.code}</code>
      </pre>
    </div>
  );
}

function Section(props: { id: string; title: string; children: JSX.Element }) {
  return (
    <section id={props.id} class="scroll-mt-24 mt-12 first:mt-6">
      <h2 class="text-[20px] md:text-[22px] font-bold text-on-background border-b border-outline-variant pb-2 mb-4 flex items-center gap-2">
        {props.title}
      </h2>
      <div class="space-y-3 text-on-surface text-[14.5px] leading-relaxed">{props.children}</div>
    </section>
  );
}

function Pill(props: { method: string }) {
  const tone: Record<string, string> = {
    GET: 'text-sky-400 border-sky-400/30 bg-sky-400/10',
    POST: 'text-primary border-primary/30 bg-primary/10',
    PATCH: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
    DELETE: 'text-red-400 border-red-400/30 bg-red-400/10',
  };
  return (
    <span class={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${tone[props.method] ?? ''}`}>
      {props.method}
    </span>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Docs() {
  const nav = () => [
    { id: 'overview', label: tx('Genel Bakış', 'Overview') },
    { id: 'auth', label: tx('Kimlik Doğrulama', 'Authentication') },
    { id: 'create', label: tx('Gönderi Oluştur', 'Create a post') },
    { id: 'read', label: tx('Okuma', 'Reading') },
    { id: 'endpoints', label: tx('Endpointler', 'Endpoints') },
    { id: 'limits', label: tx('Limitler & Hatalar', 'Limits & Errors') },
    { id: 'recipe', label: tx('Reçete: Blog', 'Recipe: Blog') },
  ];

  const scopes = () => [
    ['all', tx('Her şey (tüm okuma + yazma)', 'Everything (all read + write)')],
    ['read', tx('Tüm GET (okuma) istekleri', 'Every GET (read) request')],
    ['read:posts', tx('Gönderileri oku', 'Read posts')],
    ['write:posts', tx('Gönderi oluştur / sil / tepki ver', 'Create / delete / react to posts')],
    ['read:feed', tx('Kişisel akışı oku', 'Read your home feed')],
    ['read:search', tx('Arama yap', 'Search')],
    ['write:media', tx('Görsel yükle', 'Upload images')],
    ['read:notifications', tx('Bildirimleri oku', 'Read notifications')],
    ['write:bookmarks', tx('Yer imi ekle/kaldır', 'Add/remove bookmarks')],
    ['write:dm', tx('DM gönder', 'Send DMs')],
  ];

  const endpoints = () => [
    ['POST', '/posts', 'write:posts', tx('Gönderi (sinyal) oluştur', 'Create a post (signal)')],
    ['GET', '/posts', 'read', tx('Genel zaman akışı (sayfalı)', 'Public timeline (paginated)')],
    ['GET', '/posts/{id}', 'read', tx('Tek gönderi', 'A single post')],
    ['PATCH', '/posts/{id}', 'write:posts', tx('Gönderiyi düzenle', 'Edit a post')],
    ['DELETE', '/posts/{id}', 'write:posts', tx('Gönderiyi sil', 'Delete a post')],
    ['POST', '/posts/{id}/react', 'write:posts', tx('Emoji ile tepki ver', 'React with an emoji')],
    ['GET', '/posts/{id}/replies', 'read', tx('Doğrudan yanıtlar', 'Direct replies')],
    ['GET', '/posts/{id}/thread', 'read', tx('Tüm konu ağacı', 'Full conversation tree')],
    ['GET', '/feed', 'read:feed', tx('Kişisel akış', 'Your home feed')],
    ['GET', '/feed/federated', 'read', tx('Federasyon keşif akışı', 'Federated explore feed')],
    ['GET', '/feed/videos', 'read', tx('Video akışı', 'Video feed')],
    ['GET', '/search?q=&tag=', 'read:search', tx('Metin + hashtag arama', 'Text + hashtag search')],
    ['GET', '/users/{username}', 'read:profile', tx('Profil', 'A profile')],
    ['GET', '/notifications', 'read:notifications', tx('Bildirim kutusu', 'Notification inbox')],
    ['POST', '/media', 'write:media', tx('Görsel/video yükle', 'Upload image/video')],
    ['GET', '/bookmarks', 'read:bookmarks', tx('Yer imlerin', 'Your bookmarks')],
    ['GET', '/link_preview?url=', 'read', tx('Link önizleme (Open Graph)', 'Link preview (Open Graph)')],
  ];

  const errors = () => [
    ['400', tx('Geçersiz istek (eksik/yanlış alan)', 'Bad request (missing/invalid field)')],
    ['401', tx('Token yok veya geçersiz', 'Missing or invalid token')],
    ['403', tx('Token scope’u yetersiz', 'Token scope not permitted')],
    ['404', tx('Bulunamadı', 'Not found')],
    ['429', tx('Hız limiti veya aynı içerik tekrarı', 'Rate limited, or duplicate content')],
    ['500', tx('Sunucu hatası', 'Server error')],
  ];

  return (
    <div class="pb-20">
      {/* Hero */}
      <header class="rounded-2xl border border-outline-variant bg-surface-container-low p-6 md:p-8 relative overflow-hidden">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-11 h-11 rounded-xl bg-surface-container-high flex items-center justify-center">
            <Logo size={26} />
          </div>
          <div>
            <h1 class="text-[26px] md:text-[30px] font-bold tracking-tight text-on-background leading-none">
              burncpu API
            </h1>
            <p class="text-on-surface-variant font-mono text-[12px] mt-1">v1 · REST · JSON</p>
          </div>
        </div>
        <p class="text-on-surface text-[15px] leading-relaxed max-w-[58ch]">
          {tx(
            'burncpu’yu kendi uygulamandan kullan: gönderi oluştur, akışı oku, ara. Aşağıdaki her şey örneklerle. Blogun makale yayınlayınca burncpu’da otomatik paylaşmak için en alttaki reçeteye bak.',
            'Use burncpu from your own app: create posts, read timelines, search. Everything below comes with examples. To auto-share when your blog publishes an article, jump to the recipe at the end.',
          )}
        </p>
        <div class="mt-4 flex items-center gap-2 flex-wrap">
          <span class="text-[11px] font-mono uppercase tracking-widest text-on-surface-variant">
            {tx('Temel adres', 'Base URL')}
          </span>
          <code class="px-2.5 py-1 rounded-lg bg-surface-container-lowest border border-outline-variant font-mono text-[13px] text-primary">
            {BASE}
          </code>
        </div>
      </header>

      {/* Sticky in-page nav */}
      <nav class="sticky top-16 z-20 -mx-4 px-4 py-3 mt-6 bg-background/85 backdrop-blur-md border-b border-outline-variant">
        <div class="flex gap-2 overflow-x-auto no-scrollbar">
          <For each={nav()}>
            {(s) => (
              <a
                href={`#${s.id}`}
                class="shrink-0 px-3 py-1.5 rounded-full text-[12.5px] font-mono text-on-surface-variant hover:text-primary hover:bg-surface-container border border-outline-variant/60 transition-colors whitespace-nowrap"
              >
                {s.label}
              </a>
            )}
          </For>
        </div>
      </nav>

      {/* ── Overview ── */}
      <Section id="overview" title={tx('Genel Bakış', 'Overview')}>
        <p>
          {tx(
            'Tüm uçlar JSON kabul eder ve JSON döner (UTF-8). Okuma uçlarının çoğu herkese açıktır; yazma işlemleri ve kişisel veriler için kimlik doğrulama gerekir.',
            'Every endpoint accepts and returns JSON (UTF-8). Most read endpoints are public; writes and personal data require authentication.',
          )}
        </p>
        <ul class="list-disc pl-5 space-y-1 text-on-surface-variant">
          <li>{tx('Temel adres', 'Base URL')}: <code class="text-primary">{BASE}</code></li>
          <li>{tx('Kimlik: Bearer API token (aşağıda)', 'Auth: Bearer API token (below)')}</li>
          <li>{tx('Tarih biçimi: ISO‑8601 (UTC)', 'Date format: ISO‑8601 (UTC)')}</li>
          <li>{tx('Sayfalama: keyset (before / before_id)', 'Pagination: keyset (before / before_id)')}</li>
        </ul>
        <div class="mt-4 rounded-xl border border-outline-variant bg-surface-container-low p-4">
          <div class="flex items-center gap-2 mb-1.5 flex-wrap">
            <Pill method="GET" />
            <code class="font-mono text-[13px] text-primary break-all">{BASE}/openapi.json</code>
          </div>
          <p class="text-on-surface-variant text-[13.5px] leading-relaxed">
            {tx(
              'Makine‑okur OpenAPI 3.1 tanımı. Postman, Insomnia veya openapi‑generator gibi araçlara doğrudan içe aktar; istemci kütüphanesi üret. Sürüm, çalışan yapıdan damgalanır.',
              'Machine‑readable OpenAPI 3.1 description. Import it straight into Postman, Insomnia, or openapi‑generator to generate a client. The version is stamped from the running build.',
            )}
          </p>
          <a
            href={`${BASE}/openapi.json`}
            target="_blank"
            rel="noreferrer"
            class="inline-flex items-center gap-1 mt-2 text-[13px] font-mono text-primary hover:underline"
          >
            openapi.json →
          </a>
        </div>
      </Section>

      {/* ── Auth ── */}
      <Section id="auth" title={tx('Kimlik Doğrulama', 'Authentication')}>
        <p>
          {tx(
            'Yazma işlemleri için kişisel bir API token oluşturup her isteğe bir başlık olarak eklersin:',
            'For writes, create a personal API token and send it as a header on every request:',
          )}
        </p>
        <CodeBlock lang="http" code={`Authorization: Bearer <TOKEN>`} />
        <p>
          {tx(
            'Token’ı burncpu’da Ayarlar → API bölümünden oluştur (önerilen). Token yalnızca bir kez gösterilir, güvenli bir yere kaydet. Güvenlik gereği token üretimi tarayıcı oturumu ister — token ile token üretilemez.',
            'Create the token in burncpu under Settings → API (recommended). It is shown only once — store it safely. For security, minting a token requires a browser session — you cannot create a token using a token.',
          )}
        </p>
        <h3 class="font-bold text-on-background mt-5 mb-1">{tx('Scope’lar (yetkiler)', 'Scopes (permissions)')}</h3>
        <p class="text-on-surface-variant">
          {tx(
            'Token’a yalnızca ihtiyacı olan yetkiyi ver. Biçim: ', 'Give a token only the access it needs. Format: ',
          )}
          <code class="text-primary">all</code>, <code class="text-primary">read</code>,{' '}
          <code class="text-primary">read:&lt;kaynak&gt;</code>, <code class="text-primary">write:&lt;kaynak&gt;</code>.
        </p>
        <div class="overflow-x-auto mt-2">
          <table class="w-full text-[13px] border-collapse">
            <tbody>
              <For each={scopes()}>
                {([s, desc]) => (
                  <tr class="border-b border-outline-variant/40">
                    <td class="py-1.5 pr-4 align-top">
                      <code class="text-primary font-mono whitespace-nowrap">{s}</code>
                    </td>
                    <td class="py-1.5 text-on-surface-variant">{desc}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <p class="text-on-surface-variant mt-2 text-[13px]">
          {tx(
            'Not: /auth, /tokens ve /admin uçları API token ile kullanılamaz (yalnızca oturum).',
            'Note: the /auth, /tokens and /admin endpoints are session-only (no API token).',
          )}
        </p>
        <h3 class="font-bold text-on-background mt-5 mb-1">{tx('Token oluşturma (curl)', 'Create a token (curl)')}</h3>
        <CodeBlock
          lang="bash"
          code={`# Önerilen: tarayıcıda giriş yapıp Ayarlar → API'den oluştur.
# Alternatif (oturum çereziyle):
curl -X POST ${BASE}/tokens \\
  -H "Content-Type: application/json" \\
  --cookie "burncpu_session=<COOKIE>" \\
  -d '{ "name": "blog", "scope": "write:posts" }'
# → { "id": "...", "token": "<BİR KEZ GÖSTERİLİR>", "scope": "write:posts" }`}
        />
      </Section>

      {/* ── Create a post ── */}
      <Section id="create" title={tx('Gönderi Oluştur', 'Create a post')}>
        <p class="flex items-center gap-2">
          <Pill method="POST" /> <code class="font-mono text-[13px] text-on-surface">/posts</code>
          <span class="text-[12px] font-mono text-on-surface-variant">· {tx('scope', 'scope')} write:posts</span>
        </p>
        <p class="text-on-surface-variant text-[13px]">{tx('Gövde alanları:', 'Body fields:')}</p>
        <div class="overflow-x-auto">
          <table class="w-full text-[13px] border-collapse">
            <tbody>
              <tr class="border-b border-outline-variant/40">
                <td class="py-1.5 pr-3"><code class="text-primary">body</code></td>
                <td class="py-1.5 pr-3 text-on-surface-variant font-mono text-[11px]">string</td>
                <td class="py-1.5 text-on-surface-variant">{tx('Zorunlu. ≤ 5000 karakter. Markdown destekli.', 'Required. ≤ 5000 chars. Markdown supported.')}</td>
              </tr>
              <tr class="border-b border-outline-variant/40">
                <td class="py-1.5 pr-3"><code class="text-primary">visibility</code></td>
                <td class="py-1.5 pr-3 text-on-surface-variant font-mono text-[11px]">string</td>
                <td class="py-1.5 text-on-surface-variant">{tx('Varsayılan public. public · followers · private.', 'Default public. public · followers · private.')}</td>
              </tr>
              <tr class="border-b border-outline-variant/40">
                <td class="py-1.5 pr-3"><code class="text-primary">content_warning</code></td>
                <td class="py-1.5 pr-3 text-on-surface-variant font-mono text-[11px]">string?</td>
                <td class="py-1.5 text-on-surface-variant">{tx('Opsiyonel. İçerik uyarısı etiketi.', 'Optional. Content-warning label.')}</td>
              </tr>
              <tr>
                <td class="py-1.5 pr-3"><code class="text-primary">reply_to_id</code></td>
                <td class="py-1.5 pr-3 text-on-surface-variant font-mono text-[11px]">uuid?</td>
                <td class="py-1.5 text-on-surface-variant">{tx('Opsiyonel. Yanıtlanan gönderinin id’si.', 'Optional. The id of the post being replied to.')}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <CodeBlock
          lang="bash"
          code={`curl -X POST ${BASE}/posts \\
  -H "Authorization: Bearer $BURNCPU_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "body": "Merhaba burncpu 🔥", "visibility": "public" }'`}
        />
        <p class="text-on-surface-variant text-[13px]">{tx('Yanıt (200):', 'Response (200):')}</p>
        <CodeBlock
          lang="json"
          code={`{
  "id": "0b9d2f1a-…",
  "author": { "username": "mustafa", "display_name": "Mustafa Erbay" },
  "body": "Merhaba burncpu 🔥",
  "body_html": "<p>Merhaba burncpu 🔥</p>",
  "visibility": "public",
  "reactions_count": 0,
  "replies_count": 0,
  "created_at": "2026-06-01T13:00:00Z"
}`}
        />
        <div class="rounded-xl border border-primary/30 bg-primary/5 p-3 text-[13px]">
          🔥{' '}
          {tx(
            'İpucu: body içine bir bağlantı koyarsan otomatik link önizleme kartı (başlık + görsel + açıklama) çıkar. Ayrı bir alan göndermene gerek yok.',
            'Tip: put a URL in the body and a link-preview card (title + image + description) renders automatically. No extra field needed.',
          )}
        </div>
      </Section>

      {/* ── Reading ── */}
      <Section id="read" title={tx('Okuma', 'Reading')}>
        <p>
          {tx(
            'Genel zaman akışı herkese açıktır ve keyset ile sayfalanır. İlk sayfa için sadece limit ver; sonraki sayfa için son gönderinin created_at + id değerlerini geri gönder.',
            'The public timeline is open and keyset-paginated. For the first page just pass a limit; for the next page send back the last post’s created_at + id.',
          )}
        </p>
        <CodeBlock
          lang="bash"
          code={`# İlk sayfa
curl "${BASE}/posts?limit=20"

# Sonraki sayfa (önceki yanıttaki next_before / next_before_id)
curl "${BASE}/posts?limit=20&before=<created_at>&before_id=<id>"

# Arama
curl "${BASE}/search?q=rust&tag=devops"`}
        />
        <p class="text-on-surface-variant text-[13px]">
          {tx(
            'Kişisel akış için GET /feed (read:feed scope’u ister).',
            'For your personalized feed use GET /feed (needs the read:feed scope).',
          )}
        </p>
      </Section>

      {/* ── Endpoints reference ── */}
      <Section id="endpoints" title={tx('Endpoint Referansı', 'Endpoint Reference')}>
        <div class="overflow-x-auto rounded-xl border border-outline-variant">
          <table class="w-full text-[13px] border-collapse">
            <thead>
              <tr class="bg-surface-container text-on-surface-variant text-[11px] font-mono uppercase tracking-wider">
                <th class="text-left py-2 px-3 font-medium">{tx('Yöntem', 'Method')}</th>
                <th class="text-left py-2 px-3 font-medium">Path</th>
                <th class="text-left py-2 px-3 font-medium">Scope</th>
                <th class="text-left py-2 px-3 font-medium">{tx('Açıklama', 'Description')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={endpoints()}>
                {([m, path, scope, desc]) => (
                  <tr class="border-t border-outline-variant/40">
                    <td class="py-2 px-3"><Pill method={m} /></td>
                    <td class="py-2 px-3"><code class="font-mono text-[12px] text-on-surface whitespace-nowrap">{path}</code></td>
                    <td class="py-2 px-3"><code class="font-mono text-[12px] text-primary whitespace-nowrap">{scope}</code></td>
                    <td class="py-2 px-3 text-on-surface-variant">{desc}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <p class="text-on-surface-variant text-[12px] mt-2">
          {tx('Tam liste için ', 'For the full list see ')}
          <code class="text-primary">GET {BASE}/</code>{tx(' adresine bak (kendini belgeler).', ' (it documents itself).')}
        </p>
      </Section>

      {/* ── Limits & Errors ── */}
      <Section id="limits" title={tx('Limitler & Hatalar', 'Limits & Errors')}>
        <ul class="list-disc pl-5 space-y-1 text-on-surface-variant">
          <li>{tx('Gönderi: hesap başına 10 / 10 dk, IP başına 50 / 10 dk.', 'Posts: 10 / 10 min per account, 50 / 10 min per IP.')}</li>
          <li>{tx('Tekrar koruması: birebir aynı içerik 24 saat içinde tekrar gönderilemez.', 'Duplicate guard: identical content can’t be re-posted within 24h.')}</li>
          <li>{tx('Görsel: ≤ 12 MiB, JPEG/PNG/WebP/GIF. Video: ≤ 64 MiB, MP4/WebM/MOV.', 'Images: ≤ 12 MiB, JPEG/PNG/WebP/GIF. Videos: ≤ 64 MiB, MP4/WebM/MOV.')}</li>
        </ul>
        <p class="mt-3">{tx('Hatalar şu biçimde döner:', 'Errors come back in this shape:')}</p>
        <CodeBlock lang="json" code={`{ "error": "rate_limited", "message": "rate limited" }`} />
        <div class="overflow-x-auto">
          <table class="w-full text-[13px] border-collapse">
            <tbody>
              <For each={errors()}>
                {([code, desc]) => (
                  <tr class="border-b border-outline-variant/40">
                    <td class="py-1.5 pr-4"><code class="font-mono font-bold text-on-background">{code}</code></td>
                    <td class="py-1.5 text-on-surface-variant">{desc}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Recipe: blog ── */}
      <Section id="recipe" title={tx('Reçete: Blogdan otomatik yayın', 'Recipe: auto-publish from your blog')}>
        <p>
          {tx(
            'Blogun bir makale yayınladığında burncpu’da otomatik paylaşsın. write:posts scope’lu bir token al, makale başlığını ve linkini gövdeye koy — gerisini link önizleme halleder.',
            'Have your blog auto-share to burncpu when it publishes. Mint a write:posts token, put the article title + link in the body — the link preview does the rest.',
          )}
        </p>
        <CodeBlock
          lang="javascript"
          code={`// Node 18+ · makale yayınlanınca çağır
async function publishToBurncpu({ title, url }) {
  const res = await fetch("${BASE}/posts", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${process.env.BURNCPU_TOKEN}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      body: \`📝 Yeni yazı: \${title}\\n\\n\${url}\`,
      visibility: "public",
    }),
  });
  if (!res.ok) throw new Error(\`burncpu \${res.status}: \${await res.text()}\`);
  return res.json();
}`}
        />
        <p class="text-on-surface-variant text-[13px]">
          {tx(
            'Her makalenin başlığı/linki farklı olduğu için tekrar korumasına takılmazsın. Sabit bir metin (“yeni yazı yayınlandı”) gönderme — ikincisi reddedilir.',
            'Since each article’s title/link differs, you won’t hit the duplicate guard. Don’t send a constant string (“new post published”) — the second one is rejected.',
          )}
        </p>
      </Section>

      <footer class="mt-14 pt-6 border-t border-outline-variant text-center text-on-surface-variant font-mono text-[12px]">
        burncpu · 1 vps yeter · {BASE}
      </footer>
    </div>
  );
}
