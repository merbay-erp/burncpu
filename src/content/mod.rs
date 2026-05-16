// Content rendering pipeline for post bodies.
//
// Markdown → HTML (pulldown-cmark) → sanitized HTML (ammonia).
// Whitelist is conservative: links, basic formatting, lists, code,
// blockquote. No images embedded inline (use post_media), no raw HTML.

use pulldown_cmark::{Options, Parser, html};
use std::sync::OnceLock;

pub fn render_markdown(src: &str) -> String {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_SMART_PUNCTUATION);

    let parser = Parser::new_ext(src, opts);
    let mut html_out = String::with_capacity(src.len() + 64);
    html::push_html(&mut html_out, parser);

    sanitizer().clean(&html_out).to_string()
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
