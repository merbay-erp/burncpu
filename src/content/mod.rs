// Content rendering pipeline for post bodies.
//
// Markdown → HTML (pulldown-cmark) → sanitized HTML (ammonia).
// Whitelist is conservative: links, basic formatting, lists, code,
// blockquote. No images embedded inline (use post_media), no raw HTML.

use pulldown_cmark::{Options, Parser, html};
use std::sync::OnceLock;

pub fn render_markdown(src: &str) -> String {
    let pre = linkify_mentions(src);

    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_SMART_PUNCTUATION);

    let parser = Parser::new_ext(&pre, opts);
    let mut html_out = String::with_capacity(pre.len() + 64);
    html::push_html(&mut html_out, parser);

    sanitizer().clean(&html_out).to_string()
}

/// Pre-pass: rewrite `@username` tokens into markdown link
/// `[@username](/u/username)` so pulldown-cmark renders them as <a>
/// (and ammonia preserves with rel=noopener noreferrer ugc).
///
/// Skips matches inside fenced code blocks and inline code so people can
/// say `like @foo` in code without it becoming a link.
fn linkify_mentions(src: &str) -> String {
    // Single-pass scanner. Tracks: inside-backticks, inside-fenced-code.
    let bytes = src.as_bytes();
    let mut out = String::with_capacity(src.len() + 32);
    let mut i = 0;
    let mut in_fence = false;
    let mut in_inline = false;
    while i < bytes.len() {
        // Detect fence boundary on a fresh line
        if (i == 0 || bytes[i - 1] == b'\n')
            && bytes.len() >= i + 3
            && &bytes[i..i + 3] == b"```"
        {
            in_fence = !in_fence;
            out.push_str("```");
            i += 3;
            continue;
        }
        if in_fence {
            out.push(bytes[i] as char);
            i += 1;
            continue;
        }
        if bytes[i] == b'`' {
            in_inline = !in_inline;
            out.push('`');
            i += 1;
            continue;
        }
        if !in_inline && bytes[i] == b'@' {
            // Must be at start or preceded by ws / punctuation
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
                // Username schema: 3..=32, [a-z0-9_]
                if name.len() >= 3
                    && name.len() <= 32
                    && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
                {
                    out.push_str(&format!("[@{name}](/u/{name})"));
                    i = end;
                    continue;
                }
            }
        }
        out.push(bytes[i] as char);
        i += 1;
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
        if (i == 0 || bytes[i - 1] == b'\n')
            && bytes.len() >= i + 3
            && &bytes[i..i + 3] == b"```"
        {
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
        // Allow inline <img> (markdown ![]() syntax). Constrain src to
        // same-origin /media/ paths or absolute https URLs. alt + title
        // pass through for accessibility.
        let mut tags = b.clone_tags();
        tags.insert("img");
        b.tags(tags);
        let mut tag_attrs = b.clone_tag_attributes();
        tag_attrs.insert("img", ["src", "alt", "title"].iter().copied().collect());
        b.tag_attributes(tag_attrs);
        // No <iframe>, <script>, <object>, etc. — those stay rejected by
        // ammonia's defaults.
        b
    })
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
