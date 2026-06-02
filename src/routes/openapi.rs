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
}
