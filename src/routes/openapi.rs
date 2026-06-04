// GET /api/v1/openapi.json — machine-readable OpenAPI 3.1 description of the
// public API. The document is authored as a static file (src/routes/openapi.json,
// tooling-friendly + lintable, and inside the Docker build context); the
// `info.version` is stamped from CARGO_PKG_VERSION at first access so it can
// never drift from the build.

use crate::state::AppState;
use axum::{Router, http::header, response::IntoResponse, routing::get};
use std::sync::LazyLock;

static SPEC: LazyLock<String> = LazyLock::new(build_spec);

fn build_spec() -> String {
    let raw = include_str!("openapi.json");
    let mut doc: serde_json::Value =
        serde_json::from_str(raw).expect("openapi.json is valid JSON");
    doc["info"]["version"] = serde_json::Value::String(env!("CARGO_PKG_VERSION").to_string());
    serde_json::to_string(&doc).expect("serialize openapi spec")
}

pub fn router() -> Router<AppState> {
    Router::new().route("/openapi.json", get(spec))
}

async fn spec() -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (header::CACHE_CONTROL, "public, max-age=300"),
        ],
        SPEC.as_str(),
    )
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    fn spec() -> Value {
        serde_json::from_str(include_str!("openapi.json")).expect("valid json")
    }

    #[test]
    fn is_openapi_31() {
        assert!(spec()["openapi"].as_str().unwrap().starts_with("3.1"));
    }

    #[test]
    fn every_operation_declares_responses() {
        let doc = spec();
        let methods = ["get", "post", "put", "patch", "delete"];
        let mut ops = 0;
        for (path, item) in doc["paths"].as_object().unwrap() {
            for (method, op) in item.as_object().unwrap() {
                if methods.contains(&method.as_str()) {
                    ops += 1;
                    let responses = op["responses"].as_object();
                    assert!(
                        responses.is_some_and(|r| !r.is_empty()),
                        "{method} {path} has no responses"
                    );
                }
            }
        }
        assert!(ops >= 80, "expected the full surface, got {ops} operations");
    }

    #[test]
    fn every_local_ref_resolves() {
        let doc = spec();
        let mut refs = Vec::new();
        collect_refs(&doc, &mut refs);
        assert!(!refs.is_empty());
        for r in refs {
            let pointer = r.strip_prefix('#').expect("local ref");
            assert!(
                doc.pointer(pointer).is_some(),
                "broken $ref: {r}"
            );
        }
    }

    #[test]
    fn version_is_stamped_from_crate() {
        let doc: Value = serde_json::from_str(&super::build_spec()).unwrap();
        assert_eq!(doc["info"]["version"], env!("CARGO_PKG_VERSION"));
    }

    fn collect_refs(v: &Value, out: &mut Vec<String>) {
        match v {
            Value::Object(map) => {
                for (k, val) in map {
                    if k == "$ref" {
                        if let Some(s) = val.as_str() {
                            out.push(s.to_string());
                        }
                    } else {
                        collect_refs(val, out);
                    }
                }
            }
            Value::Array(arr) => arr.iter().for_each(|x| collect_refs(x, out)),
            _ => {}
        }
    }

    // ── Drift guard: every route advertised in the human-readable API index
    // (the `endpoints` catalog in api.rs, served at GET /api/v1/) must also be
    // described in this machine spec. The catalog is the place a developer
    // naturally lists a new endpoint, so this fails CI when they add one there
    // but forget the spec — the most common way the two docs drift apart.
    //
    // One-directional (catalog ⊆ spec): the spec may legitimately document more
    // than the curated index (e.g. niche admin/federation routes), so we don't
    // require the reverse. Path params are normalised ({u} vs {username}) away.

    /// Collapse every `{param}` to a bare `{}` so `/dm/threads/{u}` and
    /// `/dm/threads/{username}` compare equal.
    fn norm_path(p: &str) -> String {
        let mut s = String::new();
        let mut depth = 0u32;
        for c in p.chars() {
            match c {
                '{' => {
                    if depth == 0 {
                        s.push('{');
                    }
                    depth += 1;
                }
                '}' => {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        s.push('}');
                    }
                }
                _ if depth == 0 => s.push(c),
                _ => {}
            }
        }
        s
    }

    /// (METHOD, normalised full path) for every `"GET   /api/v1/…": "desc"`
    /// key in the api.rs catalog. Hand-parsed so we don't pull in a regex dep.
    fn catalog_routes() -> Vec<(String, String)> {
        const METHODS: [&str; 5] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
        let mut out = Vec::new();
        for line in include_str!("api.rs").lines() {
            let line = line.trim_start();
            let Some(rest) = line.strip_prefix('"') else {
                continue;
            };
            let Some(end) = rest.find('"') else { continue };
            let mut parts = rest[..end].split_whitespace();
            let (Some(method), Some(path)) = (parts.next(), parts.next()) else {
                continue;
            };
            if METHODS.contains(&method) && path.starts_with("/api/v1") {
                out.push((method.to_string(), norm_path(path)));
            }
        }
        out
    }

    #[test]
    fn every_catalog_route_is_documented() {
        let doc = spec();
        let mut documented = std::collections::HashSet::new();
        let http = ["get", "post", "put", "patch", "delete"];
        for (path, item) in doc["paths"].as_object().unwrap() {
            for method in item.as_object().unwrap().keys() {
                if http.contains(&method.as_str()) {
                    documented.insert((
                        method.to_uppercase(),
                        norm_path(&format!("/api/v1{path}")),
                    ));
                }
            }
        }

        let routes = catalog_routes();
        assert!(routes.len() > 50, "catalog parse looks broken: {routes:?}");

        let undocumented: Vec<_> = routes
            .into_iter()
            // The spec does not describe itself.
            .filter(|r| r.1 != "/api/v1/openapi.json")
            .filter(|r| !documented.contains(r))
            .map(|(m, p)| format!("{m} {p}"))
            .collect();

        assert!(
            undocumented.is_empty(),
            "api.rs advertises routes missing from openapi.json: {undocumented:?}"
        );
    }
}
