// Meilisearch wiring — direct HTTP via reqwest (no extra SDK).
//
// One index: `posts`. Documents shaped as:
//   {
//     id:               String (UUID — primaryKey),
//     author_id:        String,
//     author_username:  String,
//     body:             String,
//     tags:             [String]      (lowercased hashtags, no #)
//     visibility:       String,        (filterable: only "public" surfaced anon)
//     moderation_state: String,        (filterable: only "live" surfaced)
//     reactions_count:  i32,
//     replies_count:    i32,
//     created_at:       i64            (unix seconds — sortable)
//   }
//
// Failure policy: search is best-effort. If the index call fails we LOG
// and move on; we don't fail the post write. Search results going missing
// is acceptable degradation; refusing posts because search is down is not.

use crate::content::extract_hashtags;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

const INDEX: &str = "posts";

#[derive(Clone)]
pub struct Search {
    base: String,
    key: String,
    http: Client,
}

#[derive(Serialize)]
pub struct PostDoc {
    pub id: String,
    pub author_id: String,
    pub author_username: String,
    pub body: String,
    pub tags: Vec<String>,
    pub visibility: String,
    pub moderation_state: String,
    pub reactions_count: i32,
    pub replies_count: i32,
    pub created_at: i64,
}

impl PostDoc {
    #[allow(clippy::too_many_arguments)]
    pub fn from_parts(
        id: Uuid,
        author_id: Uuid,
        author_username: &str,
        body: &str,
        visibility: &str,
        moderation_state: &str,
        reactions_count: i32,
        replies_count: i32,
        created_at: DateTime<Utc>,
    ) -> Self {
        let tags = extract_hashtags(body);
        Self {
            id: id.to_string(),
            author_id: author_id.to_string(),
            author_username: author_username.to_string(),
            body: body.to_string(),
            tags,
            visibility: visibility.to_string(),
            moderation_state: moderation_state.to_string(),
            reactions_count,
            replies_count,
            created_at: created_at.timestamp(),
        }
    }
}

impl Search {
    pub fn new(base: impl Into<String>, key: impl Into<String>) -> Self {
        Self {
            base: base.into().trim_end_matches('/').to_string(),
            key: key.into(),
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(3))
                .build()
                .unwrap_or_else(|e| {
                    tracing::error!(?e, "failed to build timed search HTTP client");
                    Client::new()
                }),
        }
    }

    fn with_auth(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if self.key.trim().is_empty() {
            request
        } else {
            request.bearer_auth(&self.key)
        }
    }

    /// Idempotent — creates the index and applies settings. Call at startup.
    pub async fn ensure_ready(&self) -> anyhow::Result<()> {
        // Create index (200 OK if already exists; 202 task accepted otherwise)
        let _ = self
            .with_auth(self.http.post(format!("{}/indexes", self.base)))
            .json(&json!({ "uid": INDEX, "primaryKey": "id" }))
            .send()
            .await?
            .error_for_status()?;

        // Searchable attributes (ranked left → right)
        let _ = self
            .with_auth(self.http.put(format!(
                "{}/indexes/{INDEX}/settings/searchable-attributes",
                self.base
            )))
            .json(&json!(["body", "tags", "author_username"]))
            .send()
            .await?
            .error_for_status()?;

        // Filterable: tags + visibility + moderation_state
        let _ = self
            .with_auth(self.http.put(format!(
                "{}/indexes/{INDEX}/settings/filterable-attributes",
                self.base
            )))
            .json(&json!([
                "tags",
                "visibility",
                "moderation_state",
                "author_id"
            ]))
            .send()
            .await?
            .error_for_status()?;

        // Sortable: created_at (timeline-style results)
        let _ = self
            .with_auth(self.http.put(format!(
                "{}/indexes/{INDEX}/settings/sortable-attributes",
                self.base
            )))
            .json(&json!(["created_at", "reactions_count"]))
            .send()
            .await?
            .error_for_status()?;

        Ok(())
    }

    pub async fn index_post(&self, doc: &PostDoc) {
        let r = self
            .with_auth(
                self.http
                    .post(format!("{}/indexes/{INDEX}/documents", self.base)),
            )
            .json(&[doc])
            .send()
            .await
            .and_then(reqwest::Response::error_for_status);
        if let Err(e) = r {
            tracing::warn!(?e, id = %doc.id, "meilisearch index_post failed");
        }
    }

    pub async fn index_many(&self, docs: &[PostDoc]) -> usize {
        if docs.is_empty() {
            return 0;
        }
        let r = self
            .with_auth(
                self.http
                    .post(format!("{}/indexes/{INDEX}/documents", self.base)),
            )
            .json(docs)
            .send()
            .await;
        match r.and_then(reqwest::Response::error_for_status) {
            Ok(_) => docs.len(),
            Err(e) => {
                tracing::warn!(?e, n = docs.len(), "meilisearch index_many failed");
                0
            }
        }
    }

    pub async fn delete_post(&self, id: Uuid) {
        let r = self
            .with_auth(
                self.http
                    .delete(format!("{}/indexes/{INDEX}/documents/{id}", self.base)),
            )
            .send()
            .await
            .and_then(reqwest::Response::error_for_status);
        if let Err(e) = r {
            tracing::warn!(?e, %id, "meilisearch delete_post failed");
        }
    }

    /// Returns Meilisearch's raw response (hits + estimatedTotalHits).
    /// Caller can shape as needed for the HTTP API.
    pub async fn search_public(
        &self,
        query: &str,
        tag: Option<&str>,
        limit: usize,
    ) -> anyhow::Result<Value> {
        // Filter to live + public (anon-safe). Admin-only search can be added later.
        let mut filter_parts = vec![
            "moderation_state = \"live\"".to_string(),
            "visibility = \"public\"".to_string(),
        ];
        if let Some(t) = tag
            .map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty())
        {
            filter_parts.push(format!("tags = \"{}\"", t.replace('"', "\\\"")));
        }
        let body = json!({
            "q": query,
            "limit": limit,
            "filter": filter_parts.join(" AND "),
            "sort": ["created_at:desc"],
            "attributesToHighlight": ["body"],
            "highlightPreTag": "<mark>",
            "highlightPostTag": "</mark>",
        });
        let resp: SearchResponse = self
            .with_auth(
                self.http
                    .post(format!("{}/indexes/{INDEX}/search", self.base)),
            )
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(serde_json::to_value(resp)?)
    }
}

#[derive(Deserialize, Serialize)]
struct SearchResponse {
    hits: Vec<Value>,
    #[serde(rename = "estimatedTotalHits")]
    estimated_total_hits: Option<u64>,
    #[serde(rename = "processingTimeMs")]
    processing_time_ms: Option<u64>,
    #[serde(default)]
    query: String,
}
