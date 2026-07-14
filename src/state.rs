// Shared application state cloned into every handler via `with_state`.

use crate::{config::Config, search::Search};
use redis::aio::ConnectionManager;
use serde::Serialize;
use sqlx::PgPool;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
};
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

/// One event delivered through either a targeted user channel or the public
/// post channel.
#[derive(Clone, Debug, Serialize)]
pub struct NotificationEvent {
    pub user_id: Uuid,
    pub kind: String,
    pub actor_id: Option<Uuid>,
    pub actor_username: Option<String>,
    pub target_kind: String,
    pub target_id: Uuid,
    pub created_at: String, // ISO-8601
}

/// Targeted notification channels plus a separate public-post channel.
///
/// User senders are held weakly so disconnected users do not keep channels
/// alive forever. An SSE stream retains the strong sender for its lifetime.
#[derive(Clone)]
pub struct NotificationHub {
    users: Arc<Mutex<HashMap<Uuid, Weak<broadcast::Sender<NotificationEvent>>>>>,
    public_tx: broadcast::Sender<NotificationEvent>,
}

impl NotificationHub {
    pub fn new(public_capacity: usize) -> Self {
        let (public_tx, _) = broadcast::channel(public_capacity);
        Self {
            users: Arc::new(Mutex::new(HashMap::new())),
            public_tx,
        }
    }

    pub fn subscribe_user(
        &self,
        user_id: Uuid,
    ) -> (
        broadcast::Receiver<NotificationEvent>,
        Arc<broadcast::Sender<NotificationEvent>>,
    ) {
        let mut users = self.users.lock().unwrap_or_else(|e| e.into_inner());
        // Opportunistically remove disconnected entries without a background
        // sweeper. This runs only after the map grows beyond a modest bound.
        if users.len() >= 1024 {
            users.retain(|_, sender| sender.strong_count() > 0);
        }
        let sender = users
            .get(&user_id)
            .and_then(Weak::upgrade)
            .unwrap_or_else(|| {
                let (sender, _) = broadcast::channel(64);
                let sender = Arc::new(sender);
                users.insert(user_id, Arc::downgrade(&sender));
                sender
            });
        (sender.subscribe(), sender)
    }

    pub fn subscribe_public(&self) -> broadcast::Receiver<NotificationEvent> {
        self.public_tx.subscribe()
    }

    pub fn send_user(&self, user_id: Uuid, event: NotificationEvent) {
        let sender = {
            let mut users = self.users.lock().unwrap_or_else(|e| e.into_inner());
            let sender = users.get(&user_id).and_then(Weak::upgrade);
            if sender.is_none() {
                users.remove(&user_id);
            }
            sender
        };
        if let Some(sender) = sender {
            let _ = sender.send(event);
        }
    }

    pub fn send_public(&self, event: NotificationEvent) {
        let _ = self.public_tx.send(event);
    }
}

#[derive(Clone)]
pub struct AppState {
    pub pg: PgPool,
    pub redis: ConnectionManager,
    pub config: Config,
    pub search: Search,
    pub notif_hub: NotificationHub,
    /// Bounded queue for webhook + web/native push fan-out.
    pub notification_delivery_tx:
        mpsc::Sender<crate::routes::notifications::NotificationDeliveryJob>,
    /// Bounded queue into the webhook delivery worker (see `routes::webhooks`).
    pub webhook_tx: mpsc::Sender<crate::routes::webhooks::WebhookJob>,
    /// Bounded queue into the video transcode worker (see `transcode`).
    pub transcode_tx: mpsc::Sender<crate::transcode::TranscodeJob>,
}

#[cfg(test)]
mod tests {
    use super::{NotificationEvent, NotificationHub};
    use tokio::sync::broadcast::error::TryRecvError;
    use uuid::Uuid;

    fn event(user_id: Uuid, kind: &str) -> NotificationEvent {
        NotificationEvent {
            user_id,
            kind: kind.to_string(),
            actor_id: None,
            actor_username: None,
            target_kind: "post".to_string(),
            target_id: Uuid::new_v4(),
            created_at: "2026-07-14T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn targeted_events_do_not_cross_user_channels() {
        let hub = NotificationHub::new(8);
        let alice = Uuid::new_v4();
        let bob = Uuid::new_v4();
        let (mut alice_rx, _alice_sender) = hub.subscribe_user(alice);
        let (mut bob_rx, _bob_sender) = hub.subscribe_user(bob);

        hub.send_user(alice, event(alice, "mention"));

        assert_eq!(alice_rx.try_recv().unwrap().kind, "mention");
        assert!(matches!(bob_rx.try_recv(), Err(TryRecvError::Empty)));
    }

    #[test]
    fn public_events_reach_all_public_subscribers() {
        let hub = NotificationHub::new(8);
        let user_id = Uuid::new_v4();
        let mut first = hub.subscribe_public();
        let mut second = hub.subscribe_public();

        hub.send_public(event(user_id, "new_post"));

        assert_eq!(first.try_recv().unwrap().kind, "new_post");
        assert_eq!(second.try_recv().unwrap().kind, "new_post");
    }
}
