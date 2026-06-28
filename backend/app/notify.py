"""Outbound delivery for the daily suggestion digest.

Email uses stdlib smtplib; SMS uses Twilio's REST API via httpx (no extra
dependency). Both are gated on env-var config and never raise — they return a
status string, mirroring the resilience of `ingest.run_source`. When a channel
isn't configured they return "skipped: ... not configured" so the feature is
fully exercisable without credentials.
"""
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage

import httpx

from app import config, db
from app.models import Alert, NotifyProfile, SuggestionLogEntry
from app.suggestions import build_digest, render_email, render_sms


def send_email(profile: NotifyProfile, subject: str, text: str, html: str) -> str:
    if not profile.email or not profile.email_enabled:
        return "skipped: email not enabled"
    if not (config.SMTP_HOST and config.SMTP_FROM):
        return "skipped: smtp not configured"
    try:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = config.SMTP_FROM
        msg["To"] = profile.email
        msg.set_content(text)
        msg.add_alternative(f"<html><body>{html}</body></html>", subtype="html")

        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as server:
            if config.SMTP_STARTTLS:
                server.starttls(context=ssl.create_default_context())
            if config.SMTP_USER and config.SMTP_PASSWORD:
                server.login(config.SMTP_USER, config.SMTP_PASSWORD)
            server.send_message(msg)
        return "sent"
    except Exception as exc:  # never let delivery crash the caller
        return f"error: {exc}"


def send_sms(profile: NotifyProfile, body: str) -> str:
    if not profile.phone or not profile.sms_enabled:
        return "skipped: sms not enabled"
    if not (config.TWILIO_ACCOUNT_SID and config.TWILIO_AUTH_TOKEN and config.TWILIO_FROM_PHONE):
        return "skipped: twilio not configured"
    try:
        url = f"https://api.twilio.com/2010-04-01/Accounts/{config.TWILIO_ACCOUNT_SID}/Messages.json"
        resp = httpx.post(
            url,
            data={"To": profile.phone, "From": config.TWILIO_FROM_PHONE, "Body": body},
            auth=(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN),
            timeout=20,
        )
        resp.raise_for_status()
        return "sent"
    except Exception as exc:
        return f"error: {exc}"


def send_digest(conn, for_date: str | None = None) -> list[dict]:
    """Build the digest and deliver on every enabled+configured channel.

    Logs each channel's outcome to suggestion_log and returns per-channel status.
    """
    digest = build_digest(conn, for_date)
    for_date = digest["for_date"]
    profile = db.get_notify_profile(conn)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    subject, text, html = render_email(digest)
    sms_body = render_sms(digest)

    results = [
        {"channel": "email", "status": send_email(profile, subject, text, html)},
        {"channel": "sms", "status": send_sms(profile, sms_body)},
    ]

    db.insert_suggestion_log(conn, [
        SuggestionLogEntry(created_at=now, for_date=for_date, channel=r["channel"], status=r["status"])
        for r in results
    ])
    return results


def push_alert(conn, alert: Alert) -> None:
    """Push a single alert via any enabled+configured channel. Resilient; sets
    alert.pushed when at least one channel delivered. Logged to suggestion_log."""
    profile = db.get_notify_profile(conn)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    subject = f"[{alert.severity.upper()}] {alert.ticker}: {alert.title}"
    body = f"{alert.title} — {alert.message}"
    html = f"<b>{alert.ticker}</b> · {alert.title}<br>{alert.message}"

    statuses = [
        ("email", send_email(profile, subject, body, html)),
        ("sms", send_sms(profile, f"{alert.ticker}: {body}")),
    ]
    if any(s == "sent" for _, s in statuses):
        alert.pushed = True

    db.insert_suggestion_log(conn, [
        SuggestionLogEntry(created_at=now, for_date=alert.created_at[:10],
                           channel="alert", status=f"{ch}: {st}")
        for ch, st in statuses
    ])
