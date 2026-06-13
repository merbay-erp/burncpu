// Content rendering pipeline for post bodies.
//
// Markdown → HTML (pulldown-cmark) → sanitized HTML (ammonia).
// Whitelist is conservative: links, basic formatting, lists, code,
// blockquote. No images embedded inline (use post_media), no raw HTML.

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd, html};
use std::borrow::Cow;
use std::sync::OnceLock;

pub fn render_markdown(src: &str) -> String {
    let pre = linkify_hashtags(&linkify_mentions(src));

    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_SMART_PUNCTUATION);

    // Rewrite a `![](…/media/x.mp4)` image into a <video>. Uploaded clips post as
    // markdown images (same as photos), so without this they'd render as a broken
    // <img>. Done at the event level (not a regex over encoded HTML): when an
    // Image points at a local video, emit a <video> and swallow the image's
    // alt-text events until it closes. The client plays it muted while on-screen;
    // no autoplay attribute here. src stays /media/-only (sanitizer re-checks).
    let parser = Parser::new_ext(&pre, opts);
    let mut in_video = false;
    let events = parser.filter_map(move |ev| match ev {
        Event::Start(Tag::Image { ref dest_url, .. }) if is_video_media(dest_url) => {
            in_video = true;
            Some(Event::Html(
                format!(
                    "<video src=\"{dest_url}\" controls muted loop playsinline preload=\"metadata\"></video>"
                )
                .into(),
            ))
        }
        Event::End(TagEnd::Image) if in_video => {
            in_video = false;
            None
        }
        _ if in_video => None,
        other => Some(other),
    });
    let mut html_out = String::with_capacity(pre.len() + 64);
    html::push_html(&mut html_out, events);

    // Image src is constrained inside the sanitizer via an attribute filter
    // (see `sanitizer()`), so no fragile post-pass over already-encoded HTML.
    sanitizer().clean(&html_out).to_string()
}

/// A local /media/ path whose filename is a video (mp4/webm/mov). Used to route
/// a posted clip to <video> instead of <img>.
fn is_video_media(v: &str) -> bool {
    if !is_local_media_src(v) {
        return false;
    }
    let lower = v.to_ascii_lowercase();
    lower.ends_with(".mp4") || lower.ends_with(".webm") || lower.ends_with(".mov")
}

/// True only for a flat local media path: `/media/<name>` where `<name>` is a
/// content-addressed filename (alphanumeric + `.`/`_`/`-`, no `/`, no `..`).
/// Everything else — remote URLs, protocol-relative `//host`, `/media/../x`
/// traversal — is rejected.
fn is_local_media_src(v: &str) -> bool {
    match v.strip_prefix("/media/") {
        Some(rest) => {
            !rest.is_empty()
                && !rest.contains("..")
                && rest
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        }
        None => false,
    }
}

/// Pre-pass: rewrite `@username` tokens into markdown link
/// `[@username](/u/username)` so pulldown-cmark renders them as <a>
/// (and ammonia preserves with rel=noopener noreferrer ugc).
///
/// Skips matches inside fenced code blocks and inline code so people can
/// say `like @foo` in code without it becoming a link.
///
/// IMPORTANT: copies whole UTF-8 chars, not individual bytes. Casting
/// `bytes[i] as char` mojibakes any multibyte sequence (İ → Ä°, ş → Å,
/// etc.) by treating UTF-8 bytes as Latin-1 codepoints.
fn linkify_mentions(src: &str) -> String {
    let bytes = src.as_bytes();
    let mut out = String::with_capacity(src.len() + 32);
    let mut i = 0;
    let mut in_fence = false;
    let mut in_inline = false;

    // Advance i past one full UTF-8 char and push that slice to out.
    let push_char = |out: &mut String, src: &str, bytes: &[u8], i: &mut usize| {
        let start = *i;
        let mut end = start + 1;
        // Continuation bytes have top bits 10xxxxxx
        while end < bytes.len() && (bytes[end] & 0xC0) == 0x80 {
            end += 1;
        }
        out.push_str(&src[start..end]);
        *i = end;
    };

    while i < bytes.len() {
        // Detect ``` fence on a fresh line
        if (i == 0 || bytes[i - 1] == b'\n') && bytes.len() >= i + 3 && &bytes[i..i + 3] == b"```" {
            in_fence = !in_fence;
            out.push_str("```");
            i += 3;
            continue;
        }
        if in_fence {
            push_char(&mut out, src, bytes, &mut i);
            continue;
        }
        if bytes[i] == b'`' {
            in_inline = !in_inline;
            out.push('`');
            i += 1;
            continue;
        }
        if !in_inline && bytes[i] == b'@' {
            let prev_ok = i == 0
                || matches!(
                    bytes[i - 1],
                    b' ' | b'\n' | b'\r' | b'\t' | b'.' | b',' | b'!' | b'?' | b'(' | b'['
                );
            if prev_ok {
                let start = i + 1;
                let mut end = start;
                while end < bytes.len()
                    && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_')
                {
                    end += 1;
                }
                let name = &src[start..end];
                if name.len() >= 3
                    && name.len() <= 32
                    && name
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
                {
                    out.push_str(&format!("[@{name}](/u/{name})"));
                    i = end;
                    continue;
                }
            }
        }
        push_char(&mut out, src, bytes, &mut i);
    }
    out
}

/// Pre-pass: rewrite `#hashtag` tokens into markdown link
/// `[#hashtag](/hashtag/<lowercased>)` so pulldown-cmark renders them as <a>
/// (and ammonia preserves the relative href with rel=noopener noreferrer ugc).
///
/// The visible text keeps the author's original casing (`#CiCd`) while the
/// link target is lowercased to match `extract_hashtags()` and the
/// `/hashtag/:tag` route, so every linkified tag resolves to its index page.
/// Same boundary + charset (alphanumeric + `_`) rules as `extract_hashtags`.
/// Skips fenced code blocks and inline code, and copies whole UTF-8 chars.
fn linkify_hashtags(src: &str) -> String {
    let bytes = src.as_bytes();
    let mut out = String::with_capacity(src.len() + 32);
    let mut i = 0;
    let mut in_fence = false;
    let mut in_inline = false;

    let push_char = |out: &mut String, src: &str, bytes: &[u8], i: &mut usize| {
        let start = *i;
        let mut end = start + 1;
        while end < bytes.len() && (bytes[end] & 0xC0) == 0x80 {
            end += 1;
        }
        out.push_str(&src[start..end]);
        *i = end;
    };

    while i < bytes.len() {
        if (i == 0 || bytes[i - 1] == b'\n') && bytes.len() >= i + 3 && &bytes[i..i + 3] == b"```" {
            in_fence = !in_fence;
            out.push_str("```");
            i += 3;
            continue;
        }
        if in_fence {
            push_char(&mut out, src, bytes, &mut i);
            continue;
        }
        if bytes[i] == b'`' {
            in_inline = !in_inline;
            out.push('`');
            i += 1;
            continue;
        }
        if !in_inline && bytes[i] == b'#' {
            // Must be at start or preceded by whitespace / punctuation so we
            // don't fire on `foo#bar` or a URL fragment like `page.html#x`.
            let prev_ok = i == 0
                || matches!(
                    bytes[i - 1],
                    b' ' | b'\n' | b'\r' | b'\t' | b'.' | b',' | b'!' | b'?' | b'(' | b'['
                );
            if prev_ok {
                let start = i + 1;
                let mut end = start;
                while end < bytes.len()
                    && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_')
                {
                    end += 1;
                }
                let name = &src[start..end];
                // len 3..=32 matches extract_hashtags; also dodges markdown
                // headings (`# Heading` → space after `#` → empty name).
                if name.len() >= 3 && name.len() <= 32 {
                    let lower = name.to_lowercase();
                    out.push_str(&format!("[#{name}](/hashtag/{lower})"));
                    i = end;
                    continue;
                }
            }
        }
        push_char(&mut out, src, bytes, &mut i);
    }
    out
}

/// Extract mentioned usernames from a raw markdown body. Same rules as
/// linkify_mentions; deduplicated, lowercased, max 10 per post.
pub fn extract_mentions(body: &str) -> Vec<String> {
    let bytes = body.as_bytes();
    let mut out = Vec::<String>::new();
    let mut i = 0;
    let mut in_fence = false;
    let mut in_inline = false;
    while i < bytes.len() {
        if (i == 0 || bytes[i - 1] == b'\n') && bytes.len() >= i + 3 && &bytes[i..i + 3] == b"```" {
            in_fence = !in_fence;
            i += 3;
            continue;
        }
        if in_fence {
            i += 1;
            continue;
        }
        if bytes[i] == b'`' {
            in_inline = !in_inline;
            i += 1;
            continue;
        }
        if !in_inline && bytes[i] == b'@' {
            let prev_ok = i == 0
                || matches!(
                    bytes[i - 1],
                    b' ' | b'\n' | b'\r' | b'\t' | b'.' | b',' | b'!' | b'?' | b'(' | b'['
                );
            if prev_ok {
                let start = i + 1;
                let mut end = start;
                while end < bytes.len()
                    && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_')
                {
                    end += 1;
                }
                let name = body[start..end].to_lowercase();
                if name.len() >= 3 && name.len() <= 32 && !out.contains(&name) {
                    out.push(name);
                    if out.len() >= 10 {
                        break;
                    }
                }
                i = end.max(i + 1);
                continue;
            }
        }
        i += 1;
    }
    out
}

fn sanitizer() -> &'static ammonia::Builder<'static> {
    static B: OnceLock<ammonia::Builder<'static>> = OnceLock::new();
    B.get_or_init(|| {
        let mut b = ammonia::Builder::default();
        // Force all anchors to noopener + ugc; cap protocols.
        b.link_rel(Some("noopener noreferrer ugc"));
        b.url_schemes(
            ["http", "https", "mailto"]
                .iter()
                .copied()
                .collect::<std::collections::HashSet<_>>(),
        );
        // Allow inline <img> (markdown ![]() syntax). A post-pass below
        // restricts src to local /media/ paths so posts cannot beacon
        // readers to third-party tracking pixels.
        let mut tags = b.clone_tags();
        tags.insert("img");
        // <video> for posted clips (render_markdown rewrites a /media/*.mp4|webm|mov
        // image into one). No autoplay attribute — the client plays it muted only
        // while on-screen. No <source>/<iframe>/<script>: a single src is enough.
        tags.insert("video");
        b.tags(tags);
        let mut tag_attrs = b.clone_tag_attributes();
        tag_attrs.insert("img", ["src", "alt", "title"].iter().copied().collect());
        tag_attrs.insert(
            "video",
            ["src", "controls", "muted", "loop", "playsinline", "preload", "poster"]
                .iter()
                .copied()
                .collect(),
        );
        b.tag_attributes(tag_attrs);
        // Constrain <img>/<video> src (and video poster) to local /media/ during
        // sanitization. ammonia's url_schemes would otherwise happily keep remote
        // URLs (a tracking-pixel + path-traversal + SSRF surface). Invalid sources
        // collapse to an empty src rather than dropping the tag.
        b.attribute_filter(|element, attribute, value| {
            if matches!(element, "img" | "video")
                && matches!(attribute, "src" | "poster")
                && !is_local_media_src(value)
            {
                return Some(Cow::Borrowed(""));
            }
            Some(Cow::Borrowed(value))
        });
        // No <iframe>, <script>, <object>, etc. — those stay rejected by
        // ammonia's defaults.
        b
    })
}

/// Sanitize already-rendered HTML from an untrusted REMOTE source (federated
/// posts ingested over ActivityPub). Same allowlist as local content: scripts,
/// iframes, objects, event handlers and styles are dropped, and any non-local
/// `<img>` src collapses to empty — so a federated post can neither run JS nor
/// beacon the reader with a remote tracking pixel. Used at ingest in
/// `crate::federation`.
pub fn sanitize_html(html: &str) -> String {
    sanitizer().clean(html).to_string()
}

/// First N characters of plain text, used for previews / timeline meta.
pub fn excerpt(body: &str, max: usize) -> String {
    body.chars().take(max).collect::<String>()
}

/// Pull #hashtags out of post body. Returns lowercased, deduped, no leading
/// '#'. Lazy regex-free scanner so we don't drag in regex crate. Allows
/// alphanumerics + underscore in tag bodies; tag ends at first non-allowed
/// character. Min length 2, max 32. Caps at 16 tags per post.
pub fn extract_hashtags(body: &str) -> Vec<String> {
    let mut out = Vec::<String>::new();
    let bytes = body.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'#' {
            // Must be at start or preceded by whitespace / punctuation
            let is_boundary = i == 0
                || matches!(
                    bytes[i - 1],
                    b' ' | b'\n' | b'\r' | b'\t' | b'.' | b',' | b'!' | b'?' | b'(' | b'['
                );
            if is_boundary {
                let start = i + 1;
                let mut end = start;
                while end < bytes.len() {
                    let c = bytes[end];
                    if c.is_ascii_alphanumeric() || c == b'_' {
                        end += 1;
                    } else {
                        break;
                    }
                }
                let tag = &body[start..end];
                if tag.len() >= 2 && tag.len() <= 32 {
                    let t = tag.to_lowercase();
                    if !out.contains(&t) {
                        out.push(t);
                        if out.len() >= 16 {
                            return out;
                        }
                    }
                }
                i = end.max(i + 1);
                continue;
            }
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_keeps_utf8_intact() {
        let html = render_markdown("İlk Post şahane");
        assert!(html.contains("İlk"));
        assert!(html.contains("şahane"));
        assert!(!html.contains("Ä°"));
    }

    #[test]
    fn render_linkifies_mentions() {
        let html = render_markdown("hey @mustafa");
        assert!(html.contains("href=\"/u/mustafa\""));
    }

    #[test]
    fn mention_extraction_skips_code() {
        assert!(extract_mentions("`@nope`").is_empty());
        assert!(extract_mentions("```\n@nope\n```").is_empty());
    }

    #[test]
    fn image_src_allows_only_local_media() {
        let local = render_markdown("![ok](/media/abc.png)");
        assert!(local.contains("src=\"/media/abc.png\""));

        let remote = render_markdown("![x](https://example.com/pixel.png)");
        assert!(!remote.contains("example.com"));
        assert!(remote.contains("src=\"\""));

        let protocol_relative = render_markdown("![x](//example.com/pixel.png)");
        assert!(!protocol_relative.contains("//example.com"));
        assert!(protocol_relative.contains("src=\"\""));

        // Path traversal dressed up as a local media path must be rejected.
        let traversal = render_markdown("![x](/media/../../etc/passwd)");
        assert!(!traversal.contains(".."));
        assert!(traversal.contains("src=\"\""));
    }

    #[test]
    fn local_video_renders_as_video_tag() {
        let v = render_markdown("![clip](/media/abc123.mp4)");
        assert!(v.contains("<video"), "expected <video>, got: {v}");
        assert!(v.contains("src=\"/media/abc123.mp4\""));
        assert!(v.contains("muted"));
        assert!(!v.contains("<img"), "video must not stay an <img>: {v}");
        // webm + mov too
        assert!(render_markdown("![c](/media/x.webm)").contains("<video"));
        assert!(render_markdown("![c](/media/x.mov)").contains("<video"));
    }

    #[test]
    fn image_still_renders_as_img() {
        let img = render_markdown("![pic](/media/photo.jpg)");
        assert!(img.contains("<img"));
        assert!(!img.contains("<video"));
    }

    #[test]
    fn remote_video_src_collapses() {
        // A non-local video URL is not rewritten to <video> (fails is_video_media),
        // and even as an <img> its src is emptied by the sanitizer.
        let r = render_markdown("![x](https://evil.example/x.mp4)");
        assert!(!r.contains("evil.example"));
    }
}
