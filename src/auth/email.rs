// Email sender — enum dispatch keeps it simple, no async-trait crate needed.
//
// Dev:  Console — logs the message via tracing; pull the magic link from
//       `docker logs burncpu-app`.
// Prod: SMTP — to be added in Hafta 2 once provider secrets exist.

use anyhow::Result;
use std::sync::Arc;

pub enum Sender {
    Console,
}

impl Sender {
    pub fn from_env() -> Self {
        match std::env::var("EMAIL_BACKEND").ok().as_deref() {
            Some("smtp") => {
                tracing::warn!(
                    "EMAIL_BACKEND=smtp set but SMTP not yet implemented; using console"
                );
                Self::Console
            }
            _ => Self::Console,
        }
    }

    pub async fn send(&self, to: &str, subject: &str, body: &str) -> Result<()> {
        match self {
            Self::Console => {
                tracing::info!(
                    target: "burncpu::email",
                    %to,
                    %subject,
                    body = %body,
                    "📧 console-mail"
                );
                Ok(())
            }
        }
    }
}

pub type SharedSender = Arc<Sender>;
