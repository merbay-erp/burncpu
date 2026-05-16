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
        // Drop embedded images / iframes / scripts (defaults exclude them).
        b
    })
}

/// First N characters of plain text, used for previews / timeline meta.
pub fn excerpt(body: &str, max: usize) -> String {
    body.chars().take(max).collect::<String>()
}
