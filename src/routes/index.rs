// GET / — landing/placeholder page. Will be replaced with SolidJS shell
// once frontend bundle ships. For now: minimal HTML that confirms the
// service is up and brand-aware.

use axum::response::Html;

pub async fn handler() -> Html<&'static str> {
    Html(include_str!("../../static/landing.html"))
}
