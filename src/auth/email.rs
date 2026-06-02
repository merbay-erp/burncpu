// Email sender — enum dispatch keeps it simple, no async-trait crate needed.
//
// Backends:
//   - Console: logs via tracing. Use only in dev. NEVER use in prod — the
//             magic-link URL ends up in `docker logs` for anyone with shell
//             access. The startup warning makes this obvious.
//   - Smtp:    real outbound SMTP via lettre, TLS to provider. Configured
//             entirely via env. Failure on send returns an error so the
//             /auth/request handler 5xx's (better than silently lying that
//             a link went out when it didn't).
//
// Env vars (SMTP backend):
//   EMAIL_BACKEND   = smtp
//   SMTP_HOST       = e.g. smtp.resend.com / smtp-relay.brevo.com
//   SMTP_PORT       = 587 (STARTTLS) | 465 (TLS)
//   SMTP_USERNAME   = provider key id
//   SMTP_PASSWORD   = provider key secret
//   SMTP_FROM       = "burncpu <hi@burncpu.com>"
//   SMTP_STARTTLS   = true|false (default true; false → use port 465 implicit TLS)

use anyhow::{Context, Result, anyhow};
use lettre::{
    AsyncTransport, Message, Tokio1Executor,
    message::{Mailbox, header::ContentType},
    transport::smtp::{AsyncSmtpTransport, AsyncSmtpTransportBuilder, authentication::Credentials},
};
pub enum Sender {
    Console,
    Smtp(Box<SmtpSender>),
}

pub struct SmtpSender {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

impl Sender {
    /// Build the sender from env. `site_origin` drives the fail-closed policy:
    /// a production (https) origin refuses the console backend, which would
    /// otherwise leak magic-link URLs into `docker logs`.
    pub fn from_env(site_origin: &str) -> Result<Self> {
        match std::env::var("EMAIL_BACKEND").ok().as_deref() {
            Some("smtp") => match SmtpSender::from_env() {
                Ok(s) => {
                    tracing::info!(host = %s.from, "📧 SMTP sender ready");
                    Ok(Self::Smtp(Box::new(s)))
                }
                Err(e) => Err(anyhow!("EMAIL_BACKEND=smtp is invalid: {e}")),
            },
            Some(other) => Err(anyhow!("unsupported EMAIL_BACKEND: {other}")),
            _ => {
                // Fail-closed in production: the console backend writes magic
                // links to the logs, so anyone with shell access could sign in
                // as anyone. Refuse it for an https origin unless explicitly
                // overridden (ALLOW_CONSOLE_EMAIL=1) on a non-prod box.
                let is_prod = site_origin.starts_with("https://");
                let override_ok = std::env::var("ALLOW_CONSOLE_EMAIL")
                    .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
                    .unwrap_or(false);
                if is_prod && !override_ok {
                    return Err(anyhow!(
                        "refusing console email backend for a production (https) SITE_ORIGIN \
                         — it would leak magic links to logs. Set EMAIL_BACKEND=smtp (configure \
                         SMTP_*), or ALLOW_CONSOLE_EMAIL=1 to override on a non-prod box."
                    ));
                }
                tracing::warn!(
                    "EMAIL_BACKEND not 'smtp' — magic links emitted to tracing logs only (dev mode)."
                );
                Ok(Self::Console)
            }
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
            Self::Smtp(s) => s.send(to, subject, body).await,
        }
    }
}

impl SmtpSender {
    pub fn from_env() -> Result<Self> {
        let host = std::env::var("SMTP_HOST").context("SMTP_HOST missing")?;
        let port: u16 = std::env::var("SMTP_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(587);
        let user = std::env::var("SMTP_USERNAME").context("SMTP_USERNAME missing")?;
        let pass = std::env::var("SMTP_PASSWORD").context("SMTP_PASSWORD missing")?;
        let from = std::env::var("SMTP_FROM").context("SMTP_FROM missing")?;
        let starttls = std::env::var("SMTP_STARTTLS")
            .map(|v| !matches!(v.to_lowercase().as_str(), "0" | "false" | "no" | "off"))
            .unwrap_or(true);

        let from: Mailbox = from
            .parse()
            .with_context(|| format!("invalid SMTP_FROM: {from}"))?;

        let builder: AsyncSmtpTransportBuilder = if starttls {
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host)?
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::relay(&host)?
        };

        let transport = builder
            .port(port)
            .credentials(Credentials::new(user, pass))
            .build();

        Ok(Self { transport, from })
    }

    pub async fn send(&self, to: &str, subject: &str, body: &str) -> Result<()> {
        let to: Mailbox = to
            .parse()
            .with_context(|| format!("invalid recipient: {to}"))?;
        let email = Message::builder()
            .from(self.from.clone())
            .to(to)
            .subject(subject)
            .header(ContentType::TEXT_PLAIN)
            .body(body.to_string())
            .map_err(|e| anyhow!("compose mail: {e}"))?;
        self.transport
            .send(email)
            .await
            .map_err(|e| anyhow!("smtp send: {e}"))?;
        Ok(())
    }
}
