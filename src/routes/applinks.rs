// Universal / App Links association files, served at the domain root so iOS and
// Android can verify ownership of burncpu.com and open magic-links (and offer
// passkeys / saved credentials) directly in the native app.
//
// Both values come from config (env). When unset the route 404s — we never serve
// an association pointing at an app whose ownership we can't prove.

use axum::{
    Json,
    body::Body,
    extract::State,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};

use crate::state::AppState;

const ANDROID_PACKAGE: &str = "com.burncpu.app";
const SECURITY_TXT: &str = "Contact: mailto:mustafa@mustafaerbay.com.tr\n\
Expires: 2027-07-14T00:00:00Z\n\
Canonical: https://burncpu.com/.well-known/security.txt\n\
Policy: https://github.com/merbay-erp/burncpu/security/policy\n\
Preferred-Languages: tr, en\n";

/// `GET /.well-known/apple-app-site-association`
/// → applinks for `/auth/verify/*` + `/invite/*`, plus webcredentials for passkeys.
pub async fn apple_app_site_association(State(state): State<AppState>) -> Response {
    let Some(app_id) = state.config.ios_app_id.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let body = serde_json::json!({
        "applinks": {
            "details": [{
                "appID": app_id,
                "paths": ["/auth/verify/*", "/invite/*"]
            }]
        },
        "webcredentials": { "apps": [app_id] }
    });
    // Apple fetches over HTTPS and expects `application/json` with no extension
    // (axum's `Json` sets the content type).
    (
        [(header::CACHE_CONTROL, "public, max-age=3600")],
        Json(body),
    )
        .into_response()
}

/// `GET /.well-known/assetlinks.json`
/// → Digital Asset Links for App Links + Smart Lock credential sharing.
pub async fn android_assetlinks(State(state): State<AppState>) -> Response {
    if state.config.android_cert_fingerprints.is_empty() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let body = serde_json::json!([{
        "relation": [
            "delegate_permission/common.handle_all_urls",
            "delegate_permission/common.get_login_creds"
        ],
        "target": {
            "namespace": "android_app",
            "package_name": ANDROID_PACKAGE,
            "sha256_cert_fingerprints": state.config.android_cert_fingerprints
        }
    }]);
    (
        [(header::CACHE_CONTROL, "public, max-age=3600")],
        Json(body),
    )
        .into_response()
}

/// RFC 9116 security contact. Nginx deliberately proxies all `/.well-known`
/// requests to this service, so this belongs beside the other association
/// endpoints instead of in the SPA's static public directory.
pub async fn security_txt() -> Response {
    let mut response = Response::new(Body::from(SECURITY_TXT));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600"),
    );
    response
}
